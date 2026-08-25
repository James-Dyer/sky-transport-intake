"""The tool surface exposed to the agent.

Each tool is built fresh per run by `build_tools(ctx)`, closing over a
`RunContext` rather than any global/module state — `search_sop` and
`read_pdf` are read-only lookups into that run's SOP index and PDF;
`record_classification`/`record_extraction` write the agent's own
reasoning into `ctx.state` (see models.AgentRunState) purely so it's
captured for the trace/UI, not as a second opinion; `validate` and
`persist` are the deterministic, non-agentic steps — `validate` mints the
short-lived unlock_token (app/tokens.py) that `persist` must redeem before
it will write anything to the store. `notify_human` is a stub the agent
calls after persist when validate flagged needs_review.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from langchain_core.tools import StructuredTool
from pypdf import PdfReader

from . import tokens, validation
from .models import AgentRunState, Ticket
from .sop_index import SopIndex
from .store import Store

logger = logging.getLogger("sky_intake.tools")


@dataclass
class RunContext:
    run_id: str
    ticket: Ticket
    pdf_path: Path
    sop_index: SopIndex
    store: Store
    state: AgentRunState = field(default_factory=dict)
    _pdf_text_cache: str | None = field(default=None, repr=False)


def _normalize_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """Mirrors the old graph.py behavior: usdot_number is the primary key
    used to match a document to an existing client record, and models are
    free to return it as either a JSON string or number — normalize to
    string here so identity comparisons downstream stay consistent."""
    normalized = dict(fields)
    if "usdot_number" in normalized and normalized["usdot_number"] is not None:
        normalized["usdot_number"] = str(normalized["usdot_number"])
    return normalized


def build_tools(ctx: RunContext) -> list[StructuredTool]:
    def search_sop(query: str) -> str:
        """Search Sky Transport's compliance SOP for guidance relevant to
        the current ticket — what fields a document type requires, when a
        document counts as urgent, or what to do when a document doesn't
        clearly match a known type. Call this before classifying or
        extracting fields, and again whenever you're unsure what the SOP
        says. Returns the top matching SOP section(s)."""
        hits = ctx.sop_index.search(query, k=3)
        if not hits:
            return "No SOP sections indexed."
        return "\n\n---\n\n".join(f"[{h['section']}]\n{h['text']}" for h in hits)

    def read_pdf() -> str:
        """Extract and return the full text of this ticket's attached PDF
        document. Call this to actually read what the client/agency sent —
        the ticket instructions alone are not the document."""
        if ctx._pdf_text_cache is not None:
            return ctx._pdf_text_cache
        try:
            reader = PdfReader(str(ctx.pdf_path))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"could not read PDF {ctx.pdf_path.name}: {exc}") from exc
        ctx._pdf_text_cache = text
        return text

    def record_classification(doc_type: str, confidence: float, reasoning: str) -> str:
        """Record your classification of the attached document's type.
        doc_type must be one of: IFTA_QUARTERLY, IRP_RENEWAL, DOT_LETTER,
        UNKNOWN. Use UNKNOWN if the document doesn't clearly match a known
        type per the SOP's classification guidance — do not guess."""
        valid_types = ("IFTA_QUARTERLY", "IRP_RENEWAL", "DOT_LETTER", "UNKNOWN")
        if doc_type not in valid_types:
            return f"error: doc_type must be one of {valid_types}, got {doc_type!r}"
        ctx.state["doc_type"] = doc_type
        ctx.state["classification_confidence"] = confidence
        return f"recorded classification: {doc_type} (confidence={confidence})"

    def record_extraction(fields: dict[str, Any]) -> str:
        """Record the fields you extracted from the document, per the SOP's
        field list for this document's type. Set a field to null/omit it if
        it's not explicitly present in the document text — never invent a
        value, and never compute a date from relative language."""
        ctx.state["extracted"] = _normalize_fields(fields)
        return f"recorded {len(fields)} extracted field(s)"

    def validate_extraction(doc_type: str, fields: dict[str, Any]) -> str:
        """Deterministically validate the classified doc_type and extracted
        fields against the SOP's required-field and urgency rules. You must
        call this before persist, passing the exact doc_type/fields you
        intend to persist — it returns an unlock_token that persist checks,
        so persist will be rejected if you skip this or change the fields
        afterward. Returns a JSON object."""
        outcome = validation.validate(doc_type, fields)
        token = tokens.issue_token(ctx.run_id, doc_type, fields)
        return json.dumps({**outcome, "unlock_token": token})

    def persist(
        doc_type: str,
        fields: dict[str, Any],
        missing_fields: list[str],
        needs_review: bool,
        deadline_flag: bool,
        unlock_token: str,
        urgency_reason: str | None = None,
    ) -> str:
        """Write the final record to the database. Requires the
        unlock_token returned by your most recent validate call for these
        exact doc_type/fields — call validate again if this is rejected.
        After this succeeds, call notify_human if your most recent validate
        call returned needs_review: true — only then is the ticket fully
        processed. Returns a JSON object."""
        try:
            tokens.redeem_token(unlock_token, ctx.run_id, doc_type, fields)
        except tokens.TokenError as exc:
            return json.dumps({"error": str(exc)})
        record_id = ctx.store.add_record(
            run_id=ctx.run_id,
            filename=ctx.ticket.attachment_filename,
            doc_type=doc_type,
            fields=fields,
            missing_fields=missing_fields,
            needs_review=needs_review,
            deadline_flag=deadline_flag,
            urgency_reason=urgency_reason,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        ctx.state.update(
            {
                "doc_type": doc_type,
                "extracted": fields,
                "missing_fields": missing_fields,
                "needs_review": needs_review,
                "deadline_flag": deadline_flag,
                "urgency_reason": urgency_reason,
                "record_id": record_id,
            }
        )
        return json.dumps({"record_id": record_id})

    def notify_human(reason: str) -> str:
        """Alert a human reviewer that this ticket needs their attention.
        Call this once, after persist succeeds, if your most recent validate
        call returned needs_review: true — pass a short reason (e.g. why the
        document was flagged). Skip this entirely if needs_review was false.
        Stub: there's no real notification channel wired up yet, so this
        just logs the request."""
        logger.info("human review requested for run %s: %s", ctx.run_id, reason)
        return json.dumps({"notified": True})

    return [
        StructuredTool.from_function(
            func=search_sop, name="search_sop", description=search_sop.__doc__
        ),
        StructuredTool.from_function(func=read_pdf, name="read_pdf", description=read_pdf.__doc__),
        StructuredTool.from_function(
            func=record_classification,
            name="record_classification",
            description=record_classification.__doc__,
        ),
        StructuredTool.from_function(
            func=record_extraction,
            name="record_extraction",
            description=record_extraction.__doc__,
        ),
        StructuredTool.from_function(
            func=validate_extraction,
            name="validate",
            description=validate_extraction.__doc__,
        ),
        StructuredTool.from_function(func=persist, name="persist", description=persist.__doc__),
        StructuredTool.from_function(
            func=notify_human, name="notify_human", description=notify_human.__doc__
        ),
    ]
