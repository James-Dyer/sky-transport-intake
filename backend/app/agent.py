"""The v2 tool-calling agent: given a Ticket, plans and executes SOP lookup,
PDF reading, its own classification/extraction reasoning, deterministic
validation, and token-gated persist — in whatever order it decides — via
`langgraph.prebuilt.create_react_agent`. Replaces the old fixed 6-node
graph.py pipeline entirely.

Streaming: we drive the compiled agent with `.stream(..., stream_mode=
"values")`, diff the growing message list each step, and translate each
new AIMessage/ToolMessage into a TraceEntry plus an SSE event
(agent_thought / tool_call_started / tool_call_finished) — this is what
feeds both the "agent.log" terminal and the diagram's tool-node pulses.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.prebuilt import create_react_agent

from . import tokens as tokens_module
from .models import AgentRunState, Ticket
from .tools import RunContext, build_tools

logger = logging.getLogger("sky_intake.agent")

SYSTEM_PROMPT = """You are the document-intake agent for Sky Transport \
Solutions, a trucking compliance service company (DOT compliance, MC \
authority, IRP plates, IFTA permits, DQF, safety audits, and related \
services for owner-operators and fleet managers).

You've been handed one intake ticket: enterprise instructions from a \
staff member, plus one attached PDF document. Your job is to read the \
document, figure out what it is and what to do with it per the company's \
SOP, and get it correctly filed.

You have these tools:
- search_sop: look up relevant SOP guidance (required fields per doc \
  type, urgency rules, what to do with an unclear document). Use it — \
  don't rely on general knowledge of trucking compliance paperwork.
- read_pdf: extract the attached document's text. You must read it \
  before you can classify or extract anything from it.
- record_classification: log the document type you've decided on.
- record_extraction: log the fields you've extracted, per the SOP's \
  field list for that document type. Never invent a value — leave a \
  field null if it isn't explicitly stated, and never compute a date \
  from relative language like "within 5 business days".
- validate: deterministically checks your classification/fields against \
  the SOP's required-field and urgency rules, and returns an unlock_token.
- persist: writes the final record. Requires the unlock_token from your \
  most recent validate call, for these exact doc_type/fields — you must \
  call validate immediately before persist, every time.
- notify_human: alerts a human reviewer. Call this once, right after \
  persist succeeds, if your most recent validate call returned \
  needs_review: true — pass a short reason. Skip it if needs_review was \
  false.

Before every tool call, write one short line starting exactly with \
"Thought: " explaining what you're about to do and why, then call the \
tool. Work through this at your own pace and in whatever order makes \
sense — this is not a fixed checklist.

When persist succeeds, call notify_human if needs_review was true, then \
reply with a brief final summary (no more tool calls needed) — that ends \
your work on this ticket.
"""


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return ""


def _summarize_args(args: dict[str, Any], limit: int = 220) -> dict[str, Any]:
    """Truncate long values (raw PDF text, SOP chunks) for events/trace."""
    out: dict[str, Any] = {}
    for k, v in args.items():
        s = str(v)
        out[k] = v if len(s) <= limit else s[:limit] + "…"
    return out


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_model() -> BaseChatModel:
    api_key = os.environ.get("LLM_API_KEY")
    if not api_key:
        raise RuntimeError(
            "LLM_API_KEY is not set — required for the real agent. Set it in "
            "backend/.env, or set SKY_INTAKE_FAKE_LLM=1 for offline runs."
        )
    provider = os.environ.get("MODEL_PROVIDER", "anthropic").lower()

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        model_name = os.environ.get("MODEL_NAME", "gpt-5-mini")
        # gpt-5-mini (and other reasoning models) draw hidden reasoning
        # tokens from the same output budget as the visible response, so a
        # budget sized for a non-reasoning chat model can be fully consumed
        # by reasoning and leave nothing for the agent's actual tool call —
        # this bit the v1 pipeline (see README "The Learning"). Keep the
        # budget generous and reasoning effort low for a short-answer,
        # tool-calling agent like this one.
        return ChatOpenAI(
            model=model_name,
            api_key=api_key,
            max_tokens=4096,
            reasoning_effort="low",
        )

    if provider != "anthropic":
        raise RuntimeError(
            f"unknown MODEL_PROVIDER={provider!r}; supported: anthropic, openai"
        )

    from langchain_anthropic import ChatAnthropic

    model_name = os.environ.get("MODEL_NAME", "claude-haiku-4-5-20251001")
    return ChatAnthropic(model=model_name, api_key=api_key, max_tokens=2048)


def run_agent(
    ctx: RunContext,
    model: BaseChatModel,
    *,
    publish_event: Callable[[str, dict], None] | None = None,
) -> AgentRunState:
    tools = build_tools(ctx)
    agent = create_react_agent(model, tools, prompt=SYSTEM_PROMPT)

    ticket = ctx.ticket
    user_message = (
        f"New ticket #{ticket.ticket_id} (priority: {ticket.priority})\n"
        f"Subject: {ticket.subject}\n"
        f"Requester: {ticket.requester or 'unknown'}\n\n"
        f"Instructions:\n{ticket.instructions}\n\n"
        f"Attached document: {ticket.attachment_filename} — call read_pdf "
        f"to read it."
    )

    trace: list[dict[str, Any]] = []
    # tool_call_id -> {tool, args, started_at, t0} for matching the
    # ToolMessage that answers each AIMessage.tool_calls entry.
    pending_calls: dict[str, dict[str, Any]] = {}

    try:
        prev_len = 0
        for state in agent.stream(
            {"messages": [HumanMessage(content=user_message)]},
            config={"recursion_limit": 40},
            stream_mode="values",
        ):
            messages = state["messages"]
            new_messages = messages[prev_len:]
            prev_len = len(messages)

            for msg in new_messages:
                if isinstance(msg, AIMessage):
                    text = _extract_text(msg.content).strip()
                    for line in text.splitlines():
                        line = line.strip()
                        if not line.startswith("Thought:"):
                            continue
                        trace.append(
                            {
                                "kind": "thought",
                                "text": line,
                                "started_at": _now_iso(),
                                "finished_at": _now_iso(),
                                "duration_ms": 0,
                                "error": None,
                            }
                        )
                        if publish_event:
                            publish_event("agent_thought", {"text": line})

                    for call in msg.tool_calls or []:
                        pending_calls[call["id"]] = {
                            "tool": call["name"],
                            "args": call["args"],
                            "started_at": _now_iso(),
                            "t0": time.monotonic(),
                        }
                        if publish_event:
                            publish_event(
                                "tool_call_started",
                                {
                                    "tool": call["name"],
                                    "args_summary": _summarize_args(call["args"]),
                                },
                            )

                elif isinstance(msg, ToolMessage):
                    pending = pending_calls.pop(msg.tool_call_id, None)
                    result_text = _extract_text(msg.content)
                    duration_ms = (
                        round((time.monotonic() - pending["t0"]) * 1000, 1)
                        if pending
                        else None
                    )
                    is_error = getattr(msg, "status", None) == "error"
                    trace.append(
                        {
                            "kind": "tool_call",
                            "tool": pending["tool"] if pending else msg.name,
                            "args_summary": _summarize_args(pending["args"])
                            if pending
                            else {},
                            "result_summary": {"result": result_text[:300]},
                            "started_at": pending["started_at"]
                            if pending
                            else _now_iso(),
                            "finished_at": _now_iso(),
                            "duration_ms": duration_ms,
                            "error": result_text if is_error else None,
                        }
                    )
                    if publish_event:
                        publish_event(
                            "tool_call_finished",
                            {
                                "tool": pending["tool"] if pending else msg.name,
                                "result_summary": {"result": result_text[:300]},
                                "duration_ms": duration_ms,
                                "error": result_text if is_error else None,
                            },
                        )
    finally:
        tokens_module.cleanup_run(ctx.run_id)

    ctx.state["run_id"] = ctx.run_id
    ctx.state["trace"] = trace
    ctx.state.setdefault("missing_fields", [])
    ctx.state.setdefault("needs_review", True)
    ctx.state.setdefault("deadline_flag", False)
    ctx.state.setdefault("urgency_reason", None)
    ctx.state.setdefault("record_id", None)
    return ctx.state
