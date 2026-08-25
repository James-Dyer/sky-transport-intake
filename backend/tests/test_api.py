"""API-level tests: use TestClient's synchronous wrapper around the FastAPI
app (fake LLM, isolated tmp SQLite db) to check the HTTP surface end to end,
including that the SSE stream actually delivers node events and that the
run's persisted trace is retrievable afterward for diagnostics."""

import os

import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SKY_INTAKE_DB_PATH", str(tmp_path / "api_test.db"))
    monkeypatch.setenv("SKY_INTAKE_FAKE_LLM", "1")
    # main.py builds `store`/`llm_client` at import time, so import after
    # env vars are set and force a fresh module each test.
    import sys

    sys.modules.pop("app.main", None)
    from app.main import app as fastapi_app
    from fastapi.testclient import TestClient

    with TestClient(fastapi_app) as c:
        yield c


def test_health_reports_fake_llm(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["llm_client"] == "FakeLLMClient"
    assert body["sop_loaded_chars"] > 0


def test_sample_docs_listed(client):
    resp = client.get("/api/sample-docs")
    assert resp.status_code == 200
    docs = resp.json()
    names = [d["filename"] for d in docs]
    assert "01_ifta_q2.txt" in names
    # full_text backs the ticket detail view in the UI - must be the whole
    # document, not just the preview snippet.
    ifta_doc = next(d for d in docs if d["filename"] == "01_ifta_q2.txt")
    assert len(ifta_doc["full_text"]) > len(ifta_doc["preview"])
    assert "USDOT Number: 2847193" in ifta_doc["full_text"]
    assert "06_unrelated_invoice.txt" in names


def test_unknown_sample_doc_404s(client):
    resp = client.post("/api/tickets/sample/does-not-exist.txt")
    assert resp.status_code == 404


def test_submit_sample_and_read_back_run_trace(client):
    resp = client.post("/api/tickets/sample/02_irp_renewal.txt")
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]

    # Drain the SSE stream until the pipeline finishes.
    with client.stream("GET", f"/api/runs/{run_id}/stream") as stream_resp:
        assert stream_resp.status_code == 200
        node_events = []
        for line in stream_resp.iter_lines():
            if line.startswith("event: node_finished"):
                node_events.append(line)
            if line.startswith("event: done"):
                break
    assert len(node_events) == 6  # one per graph node

    run = client.get(f"/api/runs/{run_id}").json()
    assert run["status"] == "completed"
    assert len(run["trace"]) == 6
    assert run["trace"][0]["node"] == "receive_ticket"
    assert run["trace"][-1]["node"] == "persist"


def test_records_endpoint_reflects_processed_docs(client):
    client.post("/api/tickets/sample/01_ifta_q2.txt")
    client.post("/api/tickets/sample/06_unrelated_invoice.txt")
    # both are synchronous under the hood via run_in_executor; poll briefly
    import time

    for _ in range(20):
        records = client.get("/api/records").json()
        if len(records) >= 2:
            break
        time.sleep(0.05)
    assert len(records) == 2


def test_reset_clears_records(client):
    client.post("/api/tickets/sample/01_ifta_q2.txt")
    import time

    time.sleep(0.3)
    client.post("/api/reset")
    assert client.get("/api/records").json() == []


def test_cors_allows_any_localhost_port(client):
    # Vite picks the next free port when one is taken (observed live: landed
    # on 5174 instead of the assumed 5173), so CORS must not hardcode a
    # single port or the dashboard silently fails every fetch with a CORS
    # error that looks identical to "backend is down".
    resp = client.get("/api/health", headers={"Origin": "http://127.0.0.1:5174"})
    assert resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:5174"


def test_upload_non_utf8_rejected(client):
    resp = client.post(
        "/api/tickets",
        files={"file": ("bad.bin", b"\xff\xfe\x00\x01", "application/octet-stream")},
    )
    assert resp.status_code == 400
