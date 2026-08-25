"""Typed shapes shared across the agent, tools, store, and API layers."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from pydantic import BaseModel

DocType = Literal["IFTA_QUARTERLY", "IRP_RENEWAL", "DOT_LETTER", "UNKNOWN"]


class Ticket(BaseModel):
    """An enterprise-style intake ticket: instructions plus one attached
    PDF. This crosses the API boundary as real input (upload form or a
    sample-ticket pick), so it's a validated pydantic model rather than
    dict soup — unlike GraphState/AgentRunState below, which are internal
    execution state.
    """

    ticket_id: str
    subject: str
    instructions: str
    priority: str = "Normal"
    requester: str | None = None
    attachment_filename: str


class TraceEntry(TypedDict, total=False):
    """One step of the agent's run — either a `Thought: ...` line the agent
    emitted before acting, or a tool call it made. Persisted to SQLite per
    run (same role NodeTrace played for the old fixed pipeline) and
    streamed live over SSE as agent_thought/tool_call_started/
    tool_call_finished events — this is the source data for both the
    "agent.log" terminal and the diagram's tool-node pulses.
    """

    kind: Literal["thought", "tool_call"]
    text: str | None
    tool: str | None
    args_summary: dict[str, Any] | None
    result_summary: dict[str, Any] | None
    started_at: str
    finished_at: str | None
    duration_ms: float | None
    error: str | None


class AgentRunState(TypedDict, total=False):
    """Per-run state threaded through the agent's tool calls. Unlike the
    old fixed-pipeline GraphState, there's no fixed set of steps this must
    pass through — tools read/write this via a small per-run context
    object (see app/tools.py), not LangGraph node updates.
    """

    run_id: str
    doc_id: str
    ticket: Ticket
    pdf_path: str
    doc_type: DocType | None
    classification_confidence: float | None
    extracted: dict[str, Any]
    missing_fields: list[str]
    needs_review: bool
    deadline_flag: bool
    urgency_reason: str | None
    record_id: int | None
    trace: list[TraceEntry]
    error: str | None
