"""API-level tests: use TestClient's synchronous wrapper around the FastAPI
app (fake agent, isolated tmp SQLite db) to check the HTTP surface end to
end, including that the SSE stream actually delivers agent_thought/
tool_call events and that the run's persisted trace is retrievable
afterward for diagnostics."""

import io
import time

import pytest

SAMPLE_PDF_BYTES = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>"
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SKY_INTAKE_DB_PATH", str(tmp_path / "api_test.db"))
    monkeypatch.setenv("SKY_INTAKE_FAKE_LLM", "1")
    # main.py builds `store`/`model`/`sop_index` at import time, so import
    # after env vars are set and force a fresh module each test.
    import sys

    sys.modules.pop("app.main", None)
    from app.main import app as fastapi_app
    from fastapi.testclient import TestClient

    with TestClient(fastapi_app) as c:
        yield c


def test_health_reports_fake_model(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["model"] == "FakeAgentModel"
    assert body["sop_loaded_chars"] > 0
    assert body["sop_chunks"] > 0


def test_sample_tickets_listed(client):
    resp = client.get("/api/sample-tickets")
    assert resp.status_code == 200
    tickets = resp.json()
    ids = [t["ticket_id"] for t in tickets]
    assert "4821" in ids
    ifta_ticket = next(t for t in tickets if t["ticket_id"] == "4821")
    assert ifta_ticket["attachment_filename"] == "01_ifta_q2.pdf"
    assert len(ifta_ticket["instructions"]) > 0
    assert "4826" in ids


def test_unknown_sample_ticket_404s(client):
    resp = client.post("/api/tickets/sample/does-not-exist")
    assert resp.status_code == 404


def test_submit_sample_and_read_back_run_trace(client):
    resp = client.post("/api/tickets/sample/4822")
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]

    # Drain the SSE stream until the run finishes.
    with client.stream("GET", f"/api/runs/{run_id}/stream") as stream_resp:
        assert stream_resp.status_code == 200
        tool_finished_events = []
        for line in stream_resp.iter_lines():
            if line.startswith("event: tool_call_finished"):
                tool_finished_events.append(line)
            if line.startswith("event: done"):
                break
    # search_sop, read_pdf, record_classification, record_extraction,
    # validate, persist — six tool calls for this scripted fake run.
    assert len(tool_finished_events) == 6

    run = client.get(f"/api/runs/{run_id}").json()
    assert run["status"] == "completed"
    assert len(run["trace"]) > 0
    tool_calls = [e for e in run["trace"] if e["kind"] == "tool_call"]
    assert tool_calls[-1]["tool"] == "persist"
    assert run["ticket_subject"]
    assert run["ticket_instructions"]


def test_records_endpoint_reflects_processed_tickets(client):
    client.post("/api/tickets/sample/4821")
    client.post("/api/tickets/sample/4826")
    for _ in range(20):
        records = client.get("/api/records").json()
        if len(records) >= 2:
            break
        time.sleep(0.05)
    assert len(records) == 2


def test_reset_clears_records(client):
    client.post("/api/tickets/sample/4821")
    time.sleep(0.5)
    client.post("/api/reset")
    assert client.get("/api/records").json() == []


def test_cors_allows_any_localhost_port(client):
    # Vite picks the next free port when one is taken (observed live: landed
    # on 5174 instead of the assumed 5173), so CORS must not hardcode a
    # single port or the dashboard silently fails every fetch with a CORS
    # error that looks identical to "backend is down".
    resp = client.get("/api/health", headers={"Origin": "http://127.0.0.1:5174"})
    assert resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:5174"


def test_upload_non_pdf_rejected(client):
    resp = client.post(
        "/api/tickets",
        files={"file": ("bad.txt", b"not a pdf", "text/plain")},
        data={"instructions": "please process this"},
    )
    assert resp.status_code == 400


def test_upload_pdf_with_bad_magic_bytes_rejected(client):
    resp = client.post(
        "/api/tickets",
        files={"file": ("bad.pdf", b"not actually a pdf", "application/pdf")},
        data={"instructions": "please process this"},
    )
    assert resp.status_code == 400


def test_upload_valid_pdf_starts_a_run(client):
    resp = client.post(
        "/api/tickets",
        files={"file": ("upload.pdf", io.BytesIO(SAMPLE_PDF_BYTES), "application/pdf")},
        data={"instructions": "please process this", "subject": "Test upload"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["run_id"]
    assert body["filename"] == "upload.pdf"
