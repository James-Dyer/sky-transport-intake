"""Live-model validation: runs the real graph (whatever MODEL_PROVIDER/
MODEL_NAME is configured in backend/.env) against every sample document and
checks classification + extraction quality. Skipped automatically when no
LLM_API_KEY is present, so the default `pytest` run (CI, offline) never
needs one — this file is what you run before recording the demo to confirm
the real model actually gets the domain right, not just the plumbing.

Run explicitly with:
    .venv/bin/python -m pytest tests/test_graph_live.py -v -s
"""

import json
import os
import uuid

import pytest

from app.graph import build_graph
from app.llm import build_llm_client
from app.store import Store
from app.validation import REQUIRED_FIELDS, full_field_set

pytestmark = pytest.mark.skipif(
    not os.environ.get("LLM_API_KEY"),
    reason="LLM_API_KEY not set — skipping live-model validation (see backend/.env.example)",
)


@pytest.fixture(scope="module")
def live_llm():
    return build_llm_client(use_fake=False)


@pytest.fixture
def live_store(tmp_path):
    return Store(tmp_path / "live_test.db")


def _run_live(live_llm, live_store, sop_text, sample_doc, filename):
    graph = build_graph(live_llm, sop_text, live_store)
    state = {
        "run_id": str(uuid.uuid4()),
        "doc_id": str(uuid.uuid4()),
        "filename": filename,
        "raw_text": sample_doc(filename),
    }
    final = graph.invoke(state)
    print(f"\n--- {filename} ---")
    print(f"doc_type={final.get('doc_type')} confidence={final.get('classification_confidence')}")
    print(f"extracted={json.dumps(final.get('extracted'), indent=2)}")
    print(f"missing_fields={final.get('missing_fields')} needs_review={final.get('needs_review')} "
          f"deadline_flag={final.get('deadline_flag')} urgency_reason={final.get('urgency_reason')}")
    # Regression guard: extraction must not leak validation-stage keys
    # (missing_fields/needs_review/deadline_flag) into the extracted fields
    # dict — that scope leak was observed live from gpt-5-mini before the
    # EXTRACT_PROMPT was tightened to forbid it.
    doc_type = final.get("doc_type")
    if doc_type in REQUIRED_FIELDS:
        leaked = set(final.get("extracted", {})) - full_field_set(doc_type)
        assert not leaked, f"extraction leaked out-of-scope keys: {leaked}"
    return final


def test_live_ifta_classification_and_key_fields(live_llm, live_store, sop_text, sample_doc):
    final = _run_live(live_llm, live_store, sop_text, sample_doc, "01_ifta_q2.txt")
    assert final["doc_type"] == "IFTA_QUARTERLY"
    assert final["extracted"].get("usdot_number") == "2847193"
    assert "golden valley" in (final["extracted"].get("carrier_name") or "").lower()
    assert final["needs_review"] is False, final["missing_fields"]
    assert final["deadline_flag"] is True


def test_live_irp_classification_and_key_fields(live_llm, live_store, sop_text, sample_doc):
    final = _run_live(live_llm, live_store, sop_text, sample_doc, "02_irp_renewal.txt")
    assert final["doc_type"] == "IRP_RENEWAL"
    assert final["extracted"].get("usdot_number") == "3391045"
    assert final["needs_review"] is False, final["missing_fields"]
    assert final["deadline_flag"] is True


def test_live_out_of_service_letter(live_llm, live_store, sop_text, sample_doc):
    final = _run_live(live_llm, live_store, sop_text, sample_doc, "03_dot_oos_order.txt")
    assert final["doc_type"] == "DOT_LETTER"
    assert final["extracted"].get("letter_type") == "out_of_service_order"
    assert final["deadline_flag"] is True
    assert "out-of-service" in (final["urgency_reason"] or "").lower()
    # Regression: the document only states a relative deadline ("within 5
    # business days"), never a calendar date. An earlier prompt version let
    # the model compute one anyway (observed live: "2026-08-25"), violating
    # the SOP's "never invent a value" rule. It must stay null.
    assert final["extracted"].get("response_due_date") is None


def test_live_mcs150_reminder_not_urgent(live_llm, live_store, sop_text, sample_doc):
    final = _run_live(live_llm, live_store, sop_text, sample_doc, "04_mcs150_reminder.txt")
    assert final["doc_type"] == "DOT_LETTER"
    assert final["extracted"].get("letter_type") == "mcs150_reminder"
    assert final["deadline_flag"] is False


def test_live_missing_usdot_forces_review(live_llm, live_store, sop_text, sample_doc):
    final = _run_live(live_llm, live_store, sop_text, sample_doc, "05_ifta_missing_dot.txt")
    assert final["doc_type"] == "IFTA_QUARTERLY"
    assert final["needs_review"] is True
    assert "usdot_number" in final["missing_fields"]


def test_live_unrelated_invoice_is_unknown(live_llm, live_store, sop_text, sample_doc):
    final = _run_live(live_llm, live_store, sop_text, sample_doc, "06_unrelated_invoice.txt")
    assert final["doc_type"] == "UNKNOWN"
    assert final["needs_review"] is True
