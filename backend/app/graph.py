"""The LangGraph pipeline: receive_ticket -> consult_sop -> classify_doc ->
extract_fields -> validate -> persist.

Every node is wrapped by `_traced`, which records start/end timestamps,
a compact input/output summary, and (for LLM nodes) the raw prompt +
response into `state["trace"]`. That trace is what gets persisted to
SQLite per run and streamed live over SSE — it's the debug/diagnostics
path: given a run_id, you can reconstruct exactly what the agent read,
what it decided, and why, without re-running anything.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable

from langgraph.graph import END, StateGraph

from .llm import LLMClient
from .models import GraphState
from .store import Store
from .validation import validate as run_validation

logger = logging.getLogger("sky_intake.graph")

NodeFn = Callable[[GraphState], dict[str, Any]]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """The SOP treats usdot_number as the primary key used to match a
    document to an existing client record (see validation rule 1). Models
    are free to return it as either a JSON string or a JSON number since
    the SOP prompt doesn't pin the type — normalize to string here so
    identity comparisons downstream (and in SQLite) are consistent
    regardless of which provider/model produced the extraction.
    """
    normalized = dict(fields)
    if "usdot_number" in normalized and normalized["usdot_number"] is not None:
        normalized["usdot_number"] = str(normalized["usdot_number"])
    return normalized


def _traced(
    name: str,
    fn: NodeFn,
    *,
    publish_event: Callable[[str, dict], None] | None,
) -> NodeFn:
    def wrapped(state: GraphState) -> dict[str, Any]:
        started_at = _now_iso()
        t0 = time.monotonic()
        if publish_event:
            publish_event(
                "node_started", {"node": name, "started_at": started_at}
            )
        error: str | None = None
        output_summary: dict[str, Any] = {}
        raw_llm_call: dict[str, Any] | None = None
        try:
            update = fn(state)
        except Exception as exc:  # noqa: BLE001 - deliberately broad, recorded not swallowed
            logger.exception("node %s failed", name)
            error = f"{type(exc).__name__}: {exc}"
            update = {"error": error, "needs_review": True}
        else:
            raw_llm_call = update.pop("_raw_llm_call", None)
            output_summary = {
                k: v for k, v in update.items() if k not in ("trace",)
            }
        duration_ms = round((time.monotonic() - t0) * 1000, 1)
        finished_at = _now_iso()
        trace_entry = {
            "node": name,
            "started_at": started_at,
            "finished_at": finished_at,
            "duration_ms": duration_ms,
            "input_summary": {
                "doc_id": state.get("doc_id"),
                "doc_type": state.get("doc_type"),
            },
            "output_summary": output_summary,
            "raw_llm_call": raw_llm_call,
            "error": error,
        }
        if publish_event:
            publish_event(
                "node_finished",
                {
                    "node": name,
                    "duration_ms": duration_ms,
                    "error": error,
                    "output_summary": output_summary,
                },
            )
        trace = list(state.get("trace", [])) + [trace_entry]
        return {**update, "trace": trace}

    return wrapped


def build_graph(
    llm: LLMClient,
    sop_text: str,
    store: Store,
    *,
    publish_event: Callable[[str, dict], None] | None = None,
):
    def receive_ticket(state: GraphState) -> dict[str, Any]:
        store.create_run(state["run_id"], state["filename"], _now_iso())
        return {}

    def consult_sop(state: GraphState) -> dict[str, Any]:
        return {"sop_text": sop_text}

    def classify_doc(state: GraphState) -> dict[str, Any]:
        result = llm.classify_document(state["raw_text"], state["sop_text"])
        return {
            "doc_type": result.get("doc_type", "UNKNOWN"),
            "classification_confidence": result.get("confidence"),
            "_raw_llm_call": result.get("_raw_llm_call"),
        }

    def extract_fields(state: GraphState) -> dict[str, Any]:
        doc_type = state.get("doc_type", "UNKNOWN")
        if doc_type == "UNKNOWN":
            return {"extracted": {}, "_raw_llm_call": None}
        result = llm.extract_fields(state["raw_text"], state["sop_text"], doc_type)
        return {
            "extracted": _normalize_fields(result.get("fields", {})),
            "_raw_llm_call": result.get("_raw_llm_call"),
        }

    def validate(state: GraphState) -> dict[str, Any]:
        outcome = run_validation(
            state.get("doc_type", "UNKNOWN"), state.get("extracted", {})
        )
        return outcome

    def persist(state: GraphState) -> dict[str, Any]:
        record_id = store.add_record(
            run_id=state["run_id"],
            filename=state["filename"],
            doc_type=state.get("doc_type", "UNKNOWN"),
            fields=state.get("extracted", {}),
            missing_fields=state.get("missing_fields", []),
            needs_review=state.get("needs_review", True),
            deadline_flag=state.get("deadline_flag", False),
            urgency_reason=state.get("urgency_reason"),
            created_at=_now_iso(),
        )
        return {"record_id": record_id}

    graph = StateGraph(GraphState)
    nodes = {
        "receive_ticket": receive_ticket,
        "consult_sop": consult_sop,
        "classify_doc": classify_doc,
        "extract_fields": extract_fields,
        "validate": validate,
        "persist": persist,
    }
    for name, fn in nodes.items():
        graph.add_node(name, _traced(name, fn, publish_event=publish_event))

    graph.set_entry_point("receive_ticket")
    graph.add_edge("receive_ticket", "consult_sop")
    graph.add_edge("consult_sop", "classify_doc")
    graph.add_edge("classify_doc", "extract_fields")
    graph.add_edge("extract_fields", "validate")
    graph.add_edge("validate", "persist")
    graph.add_edge("persist", END)

    return graph.compile()
