"""Live-model validation: runs the real Claude agent against every sample
ticket and checks classification + extraction quality. Skipped
automatically when no LLM_API_KEY is present, so the default `pytest` run
(CI, offline) never needs one — this file is what you run before recording
the demo to confirm the real model actually gets the domain right, not
just the plumbing.

Run explicitly with:
    .venv/bin/python -m pytest tests/test_agent_live.py -v -s
"""

import json
import os

import pytest

from app.agent import build_model, run_agent
from app.sop_index import SopIndex
from app.store import Store
from app.tools import RunContext
from app.validation import REQUIRED_FIELDS, full_field_set

pytestmark = pytest.mark.skipif(
    not os.environ.get("LLM_API_KEY"),
    reason="LLM_API_KEY not set — skipping live-model validation (see backend/.env.example)",
)


@pytest.fixture(scope="module")
def live_model():
    return build_model()


@pytest.fixture
def live_sop_index(sop_text):
    return SopIndex(sop_text)


@pytest.fixture
def live_store(tmp_path):
    return Store(tmp_path / "live_test.db")


def _run_live(live_model, live_store, live_sop_index, sample_ticket, ticket_id):
    ticket, pdf_path = sample_ticket(ticket_id)
    live_store.create_run(ticket_id, ticket.attachment_filename, "2026-08-25T00:00:00Z")
    ctx = RunContext(
        run_id=ticket_id,
        ticket=ticket,
        pdf_path=pdf_path,
        sop_index=live_sop_index,
        store=live_store,
    )
    final = run_agent(ctx, live_model)
    print(f"\n--- {ticket_id} ({ticket.attachment_filename}) ---")
    print(f"doc_type={final.get('doc_type')} confidence={final.get('classification_confidence')}")
    print(f"extracted={json.dumps(final.get('extracted'), indent=2)}")
    print(
        f"missing_fields={final.get('missing_fields')} needs_review={final.get('needs_review')} "
        f"deadline_flag={final.get('deadline_flag')} urgency_reason={final.get('urgency_reason')}"
    )
    # Regression guard: extraction must not leak validation-stage keys
    # (missing_fields/needs_review/deadline_flag) into the extracted fields
    # dict — this scope leak was observed live in v1 from gpt-5-mini before
    # the extraction instructions were tightened to forbid it.
    doc_type = final.get("doc_type")
    if doc_type in REQUIRED_FIELDS:
        leaked = set(final.get("extracted", {})) - full_field_set(doc_type)
        assert not leaked, f"extraction leaked out-of-scope keys: {leaked}"
    return final


def test_live_ifta_classification_and_key_fields(live_model, live_store, live_sop_index, sample_ticket):
    final = _run_live(live_model, live_store, live_sop_index, sample_ticket, "4821")
    assert final["doc_type"] == "IFTA_QUARTERLY"
    assert final["extracted"].get("usdot_number") == "2847193"
    assert "golden valley" in (final["extracted"].get("carrier_name") or "").lower()
    assert final["needs_review"] is False, final["missing_fields"]
    assert final["deadline_flag"] is True
    assert final["record_id"] is not None


def test_live_irp_classification_and_key_fields(live_model, live_store, live_sop_index, sample_ticket):
    final = _run_live(live_model, live_store, live_sop_index, sample_ticket, "4822")
    assert final["doc_type"] == "IRP_RENEWAL"
    assert final["extracted"].get("usdot_number") == "3391045"
    assert final["needs_review"] is False, final["missing_fields"]
    assert final["deadline_flag"] is True


def test_live_out_of_service_letter(live_model, live_store, live_sop_index, sample_ticket):
    final = _run_live(live_model, live_store, live_sop_index, sample_ticket, "4823")
    assert final["doc_type"] == "DOT_LETTER"
    assert final["extracted"].get("letter_type") == "out_of_service_order"
    assert final["deadline_flag"] is True
    assert "out-of-service" in (final["urgency_reason"] or "").lower()
    # Regression: the document only states a relative deadline ("within 5
    # business days"), never a calendar date — response_due_date must stay
    # null rather than the model computing one.
    assert final["extracted"].get("response_due_date") is None


def test_live_mcs150_reminder_not_urgent(live_model, live_store, live_sop_index, sample_ticket):
    final = _run_live(live_model, live_store, live_sop_index, sample_ticket, "4824")
    assert final["doc_type"] == "DOT_LETTER"
    assert final["extracted"].get("letter_type") == "mcs150_reminder"
    assert final["deadline_flag"] is False


def test_live_missing_usdot_forces_review(live_model, live_store, live_sop_index, sample_ticket):
    final = _run_live(live_model, live_store, live_sop_index, sample_ticket, "4825")
    assert final["doc_type"] == "IFTA_QUARTERLY"
    assert final["needs_review"] is True
    assert "usdot_number" in final["missing_fields"]


def test_live_unrelated_invoice_is_unknown(live_model, live_store, live_sop_index, sample_ticket):
    final = _run_live(live_model, live_store, live_sop_index, sample_ticket, "4826")
    assert final["doc_type"] == "UNKNOWN"
    assert final["needs_review"] is True
