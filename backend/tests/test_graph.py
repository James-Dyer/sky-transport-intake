import uuid

import pytest

from app.graph import build_graph
from app.llm import FakeLLMClient
from app.store import Store


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "test.db")


@pytest.fixture
def graph(store, sop_text):
    events = []
    return build_graph(
        FakeLLMClient(), sop_text, store, publish_event=lambda t, p: events.append((t, p))
    ), events


def _run(graph_and_events, sample_doc, filename):
    graph, events = graph_and_events
    state = {
        "run_id": str(uuid.uuid4()),
        "doc_id": str(uuid.uuid4()),
        "filename": filename,
        "raw_text": sample_doc(filename),
    }
    final = graph.invoke(state)
    return final, events


def test_ifta_doc_classified_and_urgent(graph, sample_doc):
    final, events = _run(graph, sample_doc, "01_ifta_q2.txt")
    assert final["doc_type"] == "IFTA_QUARTERLY"
    assert final["deadline_flag"] is True  # due Sept 5 is within 14 days of Aug 25
    assert final["record_id"] is not None
    # FakeLLMClient only regex-extracts usdot/carrier/due_date (it's a routing
    # oracle for offline tests, not a full extractor), so quarter/jurisdictions/
    # miles/gallons/tax_owed are legitimately missing here -> needs_review.
    # AnthropicLLMClient extracts the full field set; see test_graph_live.py.
    assert final["needs_review"] is True
    assert "quarter" in final["missing_fields"]


def test_irp_doc_classified(graph, sample_doc):
    final, _ = _run(graph, sample_doc, "02_irp_renewal.txt")
    assert final["doc_type"] == "IRP_RENEWAL"
    assert final["extracted"]["usdot_number"] == "3391045"


def test_out_of_service_letter_is_urgent(graph, sample_doc):
    final, _ = _run(graph, sample_doc, "03_dot_oos_order.txt")
    assert final["doc_type"] == "DOT_LETTER"
    assert final["deadline_flag"] is True


def test_missing_usdot_routes_to_review(graph, sample_doc):
    final, _ = _run(graph, sample_doc, "05_ifta_missing_dot.txt")
    assert final["needs_review"] is True
    assert "usdot_number" in final["missing_fields"]


def test_unrelated_invoice_is_unknown_and_needs_review(graph, sample_doc):
    final, _ = _run(graph, sample_doc, "06_unrelated_invoice.txt")
    assert final["doc_type"] == "UNKNOWN"
    assert final["needs_review"] is True


def test_trace_covers_every_node_in_order(graph, sample_doc):
    final, _ = _run(graph, sample_doc, "01_ifta_q2.txt")
    node_order = [entry["node"] for entry in final["trace"]]
    assert node_order == [
        "receive_ticket",
        "consult_sop",
        "classify_doc",
        "extract_fields",
        "validate",
        "persist",
    ]
    for entry in final["trace"]:
        assert entry["duration_ms"] >= 0
        assert entry["error"] is None


def test_live_events_fire_for_every_node(graph, sample_doc):
    final, events = _run(graph, sample_doc, "01_ifta_q2.txt")
    started = [p["node"] for t, p in events if t == "node_started"]
    finished = [p["node"] for t, p in events if t == "node_finished"]
    assert started == finished == [
        "receive_ticket",
        "consult_sop",
        "classify_doc",
        "extract_fields",
        "validate",
        "persist",
    ]


def test_persisted_run_trace_matches_final_state(graph, sample_doc, store):
    final, _ = _run(graph, sample_doc, "02_irp_renewal.txt")
    store.finish_run(
        final["run_id"], "completed", final["trace"], "2026-08-25T00:00:00Z"
    )
    persisted = store.get_run(final["run_id"])
    assert persisted is not None
    assert persisted["status"] == "completed"
    assert len(persisted["trace"]) == len(final["trace"])


def test_records_appear_in_store_after_persist(graph, sample_doc, store):
    _run(graph, sample_doc, "01_ifta_q2.txt")
    _run(graph, sample_doc, "06_unrelated_invoice.txt")
    records = store.list_records()
    assert len(records) == 2
    # deadline-flagged / needs-review records sort first
    assert records[0]["needs_review"] or records[0]["deadline_flag"]
