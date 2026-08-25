"""Typed shapes shared across the graph, store, and API layers."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

DocType = Literal["IFTA_QUARTERLY", "IRP_RENEWAL", "DOT_LETTER", "UNKNOWN"]

NODE_ORDER = [
    "receive_ticket",
    "consult_sop",
    "classify_doc",
    "extract_fields",
    "validate",
    "persist",
]


class NodeTrace(TypedDict):
    """One node's execution, kept for the debug/diagnostics view."""

    node: str
    started_at: str
    finished_at: str
    duration_ms: float
    input_summary: dict[str, Any]
    output_summary: dict[str, Any]
    raw_llm_call: dict[str, Any] | None
    error: str | None


class GraphState(TypedDict, total=False):
    run_id: str
    doc_id: str
    filename: str
    raw_text: str
    sop_text: str
    doc_type: DocType | None
    classification_confidence: float | None
    extracted: dict[str, Any]
    missing_fields: list[str]
    needs_review: bool
    deadline_flag: bool
    urgency_reason: str | None
    record_id: int | None
    trace: list[NodeTrace]
    error: str | None
