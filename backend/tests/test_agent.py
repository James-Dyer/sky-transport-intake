"""Outcome + integrity tests for the tool-calling agent, run against
FakeAgentModel so they're offline/free. Node order is agent-decided now,
not fixed, so these assert *outcomes* (doc_type, needs_review,
deadline_flag — same semantics the old .txt fixtures encoded) and
*integrity* (persist was reached only after a validate call, in the same
run) rather than a hardcoded step sequence.
"""

import pytest

from app.agent import run_agent
from app.fake_agent import FakeAgentModel
from app.store import Store
from app.tools import RunContext


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "test.db")


@pytest.fixture
def sop_index(sop_text):
    from app.sop_index import SopIndex

    return SopIndex(sop_text)


def _run(store, sop_index, sample_ticket, ticket_id, run_id=None):
    ticket, pdf_path = sample_ticket(ticket_id)
    run_id = run_id or ticket_id
    # Mirrors main.py's _start_run: the "running" row is created by the API
    # layer before the agent starts, not by the agent itself.
    store.create_run(run_id, ticket.attachment_filename, "2026-08-25T00:00:00Z")
    ctx = RunContext(
        run_id=run_id, ticket=ticket, pdf_path=pdf_path, sop_index=sop_index, store=store
    )
    events = []
    final = run_agent(
        ctx, FakeAgentModel(), publish_event=lambda t, p: events.append((t, p))
    )
    return final, events


def test_ifta_doc_classified_and_urgent(store, sop_index, sample_ticket):
    final, _ = _run(store, sop_index, sample_ticket, "4821")
    assert final["doc_type"] == "IFTA_QUARTERLY"
    assert final["deadline_flag"] is True  # due Sept 5 is within 14 days of Aug 25
    assert final["record_id"] is not None
    # FakeAgentModel only regex-extracts usdot/carrier/due_date (a routing
    # oracle for offline tests, not a full extractor), so quarter/
    # jurisdictions/miles/gallons/tax_owed are legitimately missing here ->
    # needs_review. The real agent extracts the full field set; see
    # test_agent_live.py.
    assert final["needs_review"] is True
    assert "quarter" in final["missing_fields"]


def test_irp_doc_classified(store, sop_index, sample_ticket):
    final, _ = _run(store, sop_index, sample_ticket, "4822")
    assert final["doc_type"] == "IRP_RENEWAL"
    assert final["extracted"]["usdot_number"] == "3391045"


def test_out_of_service_letter_is_urgent(store, sop_index, sample_ticket):
    final, _ = _run(store, sop_index, sample_ticket, "4823")
    assert final["doc_type"] == "DOT_LETTER"
    assert final["deadline_flag"] is True


def test_missing_usdot_routes_to_review(store, sop_index, sample_ticket):
    final, _ = _run(store, sop_index, sample_ticket, "4825")
    assert final["needs_review"] is True
    assert "usdot_number" in final["missing_fields"]


def test_unrelated_invoice_is_unknown_and_needs_review(store, sop_index, sample_ticket):
    final, _ = _run(store, sop_index, sample_ticket, "4826")
    assert final["doc_type"] == "UNKNOWN"
    assert final["needs_review"] is True


def test_notify_human_fires_when_needs_review(store, sop_index, sample_ticket):
    final, _ = _run(store, sop_index, sample_ticket, "4821")
    assert final["needs_review"] is True
    tool_names = [e["tool"] for e in final["trace"] if e["kind"] == "tool_call"]
    assert "notify_human" in tool_names
    assert tool_names.index("persist") < tool_names.index("notify_human")


def test_trace_has_no_errors(store, sop_index, sample_ticket):
    final, _ = _run(store, sop_index, sample_ticket, "4821")
    assert len(final["trace"]) > 0
    for entry in final["trace"]:
        assert entry["error"] is None


def test_persist_only_reached_after_validate_in_same_run(store, sop_index, sample_ticket):
    """Integrity check: the agent cannot reach a successful persist without
    a validate tool call earlier in the same run's trace (the unlock_token
    round-trip enforces this at the tools layer; this confirms it shows up
    in the trace too)."""
    final, _ = _run(store, sop_index, sample_ticket, "4821")
    tool_calls = [e for e in final["trace"] if e["kind"] == "tool_call"]
    tool_names = [e["tool"] for e in tool_calls]
    assert "persist" in tool_names
    assert "validate" in tool_names
    assert tool_names.index("validate") < tool_names.index("persist")
    persist_entry = next(e for e in tool_calls if e["tool"] == "persist")
    assert persist_entry["error"] is None


def test_live_events_fire_for_thoughts_and_tool_calls(store, sop_index, sample_ticket):
    final, events = _run(store, sop_index, sample_ticket, "4821")
    event_types = {t for t, _ in events}
    assert event_types == {"agent_thought", "tool_call_started", "tool_call_finished"}
    started = [p["tool"] for t, p in events if t == "tool_call_started"]
    finished = [p["tool"] for t, p in events if t == "tool_call_finished"]
    assert started == finished
    assert "persist" in finished


def test_persisted_run_trace_matches_final_state(store, sop_index, sample_ticket):
    final, _ = _run(store, sop_index, sample_ticket, "4822")
    store.finish_run(final["run_id"], "completed", final["trace"], "2026-08-25T00:00:00Z")
    persisted = store.get_run(final["run_id"])
    assert persisted is not None
    assert persisted["status"] == "completed"
    assert len(persisted["trace"]) == len(final["trace"])


def test_records_appear_in_store_after_persist(store, sop_index, sample_ticket):
    _run(store, sop_index, sample_ticket, "4821", run_id="run-a")
    _run(store, sop_index, sample_ticket, "4826", run_id="run-b")
    records = store.list_records()
    assert len(records) == 2
    # deadline-flagged / needs-review records sort first
    assert records[0]["needs_review"] or records[0]["deadline_flag"]


def test_all_sample_tickets_run_without_error(store, sop_index, sample_ticket, sample_ticket_ids):
    for i, ticket_id in enumerate(sample_ticket_ids):
        final, _ = _run(store, sop_index, sample_ticket, ticket_id, run_id=f"run-{i}")
        assert final["record_id"] is not None
        assert final["doc_type"] is not None
