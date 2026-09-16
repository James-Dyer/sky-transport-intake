"""Deterministic stand-in for the real Claude agent, used by the offline
test suite (INTAKE_FAKE_LLM=1) so `pytest` never makes a network call.

Unlike the old FakeLLMClient (which answered two fixed method calls),
this is a fake *chat model* plugged into the same
`langgraph.prebuilt.create_react_agent` loop the real agent uses — it
inspects the running message history and picks the next tool call with a
small rule-based state machine (read_pdf -> search_sop -> classify ->
extract -> validate -> persist -> notify_human if needs_review), using the
same keyword/regex heuristics
FakeLLMClient used. This exercises the *real* tool-calling wiring
(including the unlock_token round-trip) with zero cost/network, just like
FakeLLMClient exercised the real graph wiring in v1.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, Optional

from langchain_core.callbacks.manager import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult


def _classify(text: str) -> str:
    up = text.upper()
    if "IFTA" in up and "QUARTER" in up:
        return "IFTA_QUARTERLY"
    if "IRP" in up or "APPORTIONED REGISTRATION" in up:
        return "IRP_RENEWAL"
    if "FMCSA" in up or "OUT-OF-SERVICE" in up or "MCS-150" in up:
        return "DOT_LETTER"
    return "UNKNOWN"


def _extract(text: str, doc_type: str) -> dict[str, Any]:
    fields: dict[str, Any] = {}

    dot_match = re.search(r"USDOT\s*(?:Number|#):?\s*\n?\s*(\d{5,})", text, re.I)
    fields["usdot_number"] = dot_match.group(1) if dot_match else None

    name_match = re.search(r"(?:Carrier|Registrant|To):\s*\n?\s*(.+)", text, re.I)
    fields["carrier_name"] = name_match.group(1).strip() if name_match else None

    if doc_type == "DOT_LETTER":
        up = text.upper()
        if "OUT-OF-SERVICE" in up:
            fields["letter_type"] = "out_of_service_order"
        elif "MCS-150" in up:
            fields["letter_type"] = "mcs150_reminder"
        else:
            fields["letter_type"] = "other"
        agency_match = re.search(r"Issuing Agency:\s*\n?\s*(.+)", text, re.I)
        fields["issuing_agency"] = agency_match.group(1).strip() if agency_match else None
        due_match = re.search(
            r"Response due by:\s*\n?\s*([A-Za-z]+ \d{1,2}, \d{4})", text, re.I
        )
        fields["response_due_date"] = due_match.group(1) if due_match else None
    else:
        due_match = re.search(
            r"(?:Return & Payment Due|Renewal Due):\s*\n?\s*"
            r"([A-Za-z]+ \d{1,2}, \d{4}|\d{1,2}/\d{1,2}/\d{4})",
            text,
            re.I,
        )
        fields["due_date"] = due_match.group(1) if due_match else None

    return fields


class FakeAgentModel(BaseChatModel):
    """A `BaseChatModel` whose `_generate` runs a scripted ReAct loop
    instead of calling a real model — deterministic, offline, free."""

    @property
    def _llm_type(self) -> str:
        return "fake-agent-model"

    def bind_tools(self, tools: Any, **kwargs: Any) -> "FakeAgentModel":
        # The fake model already knows the fixed 6-tool script; nothing to
        # bind. create_react_agent calls this once to get a tool-calling
        # runnable, so just hand back self.
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: Optional[list[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        ai_message = self._decide(messages)
        return ChatResult(generations=[ChatGeneration(message=ai_message)])

    def _decide(self, messages: list[BaseMessage]) -> AIMessage:
        by_name: dict[str, list[ToolMessage]] = {}
        for m in messages:
            if isinstance(m, ToolMessage):
                by_name.setdefault(m.name, []).append(m)

        def ok(name: str) -> bool:
            msgs = by_name.get(name)
            return bool(msgs) and getattr(msgs[-1], "status", "success") != "error"

        def last_text(name: str) -> str:
            return by_name[name][-1].content

        if not ok("read_pdf"):
            return self._call("Reading the attached document.", "read_pdf", {})

        pdf_text = last_text("read_pdf")

        if not ok("search_sop"):
            return self._call(
                "Checking the SOP for the relevant field list and urgency rule.",
                "search_sop",
                {"query": "required fields and urgency rule"},
            )

        doc_type = _classify(pdf_text)

        if not ok("record_classification"):
            return self._call(
                f"This looks like a {doc_type} document.",
                "record_classification",
                {"doc_type": doc_type, "confidence": 0.9, "reasoning": "keyword heuristic (FakeAgentModel)"},
            )

        fields = _extract(pdf_text, doc_type)

        if not ok("record_extraction"):
            return self._call(
                "Extracting the fields the SOP requires for this document type.",
                "record_extraction",
                {"fields": fields},
            )

        if not ok("validate"):
            return self._call(
                "Validating the extracted fields before persisting.",
                "validate",
                {"doc_type": doc_type, "fields": fields},
            )

        validated = json.loads(last_text("validate"))

        if not ok("persist"):
            return self._call(
                "Validation passed — persisting the record now.",
                "persist",
                {
                    "doc_type": doc_type,
                    "fields": fields,
                    "missing_fields": validated["missing_fields"],
                    "needs_review": validated["needs_review"],
                    "deadline_flag": validated["deadline_flag"],
                    "urgency_reason": validated["urgency_reason"],
                    "unlock_token": validated["unlock_token"],
                },
            )

        if validated["needs_review"] and not ok("notify_human"):
            return self._call(
                "This was flagged for review — notifying a human.",
                "notify_human",
                {"reason": validated.get("urgency_reason") or "flagged during validation"},
            )

        return AIMessage(content="Thought: Ticket processed.\nDone.")

    @staticmethod
    def _call(thought: str, tool_name: str, args: dict[str, Any]) -> AIMessage:
        call_id = f"fake-{tool_name}-{uuid.uuid4().hex[:8]}"
        return AIMessage(
            content=f"Thought: {thought}",
            tool_calls=[
                {"name": tool_name, "args": args, "id": call_id, "type": "tool_call"}
            ],
        )
