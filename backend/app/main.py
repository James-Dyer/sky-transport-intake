"""FastAPI app: upload a document -> run the LangGraph intake pipeline ->
stream live progress over SSE -> list processed records for the dashboard.

Diagnostics surface: `GET /api/runs/{run_id}` returns the full per-node
trace (timing, LLM prompts/responses, validation outcome) for any run,
`GET /api/health` reports which LLM client is active, and every request
is logged to backend/data/sky_intake.log. This is the "go back and assess
success" plumbing — a run's full story is reconstructable after the fact
without re-running anything.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import events
from .graph import build_graph
from .llm import build_llm_client
from .logging_conf import configure_logging
from .store import Store

_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_DIR / ".env")
load_dotenv(_BACKEND_DIR / ".env.local", override=True)

configure_logging()
logger = logging.getLogger("sky_intake.api")

SOP_PATH = Path(__file__).resolve().parent.parent / "sop" / "compliance-intake.md"
SAMPLE_DOCS_DIR = Path(__file__).resolve().parent.parent / "sample_docs"

app = FastAPI(title="Sky Transport Intake Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_db_path_override = os.environ.get("SKY_INTAKE_DB_PATH")
store = Store(_db_path_override) if _db_path_override else Store()
llm_client = build_llm_client()
sop_text = SOP_PATH.read_text()

logger.info(
    "startup: llm=%s db=%s sop_chars=%d",
    type(llm_client).__name__,
    store.db_path,
    len(sop_text),
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _run_pipeline(run_id: str, doc_id: str, filename: str, raw_text: str) -> None:
    loop = asyncio.get_running_loop()

    def publish(event_type: str, payload: dict) -> None:
        payload = {**payload, "run_id": run_id}
        loop.call_soon_threadsafe(events.publish, run_id, event_type, payload)

    graph = build_graph(llm_client, sop_text, store, publish_event=publish)
    state = {
        "run_id": run_id,
        "doc_id": doc_id,
        "filename": filename,
        "raw_text": raw_text,
    }
    try:
        final = await loop.run_in_executor(None, graph.invoke, state)
        store.finish_run(run_id, "completed", final["trace"], _now_iso())
        events.publish(
            run_id,
            "run_completed",
            {
                "run_id": run_id,
                "doc_type": final.get("doc_type"),
                "needs_review": final.get("needs_review"),
                "deadline_flag": final.get("deadline_flag"),
                "record_id": final.get("record_id"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("run %s failed", run_id)
        store.finish_run(run_id, "failed", [], _now_iso(), error=str(exc))
        events.publish(run_id, "run_failed", {"run_id": run_id, "error": str(exc)})
    finally:
        events.close(run_id)


async def _start_run(filename: str, raw_text: str) -> dict:
    run_id = str(uuid.uuid4())
    doc_id = str(uuid.uuid4())
    events.register(run_id)
    logger.info("run %s started for filename=%s (%d chars)", run_id, filename, len(raw_text))
    asyncio.create_task(_run_pipeline(run_id, doc_id, filename, raw_text))
    return {"run_id": run_id, "doc_id": doc_id, "filename": filename}


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "llm_client": type(llm_client).__name__,
        "sop_loaded_chars": len(sop_text),
        "db_path": str(store.db_path),
    }


@app.get("/api/sample-docs")
async def list_sample_docs() -> list[dict]:
    return [
        {"filename": p.name, "preview": p.read_text()[:160]}
        for p in sorted(SAMPLE_DOCS_DIR.glob("*.txt"))
    ]


@app.post("/api/tickets/sample/{filename}")
async def submit_sample(filename: str) -> dict:
    path = SAMPLE_DOCS_DIR / filename
    if not path.exists() or path.parent != SAMPLE_DOCS_DIR:
        raise HTTPException(404, f"no sample doc named {filename!r}")
    return await _start_run(filename, path.read_text())


@app.post("/api/tickets")
async def submit_ticket(file: UploadFile) -> dict:
    raw_bytes = await file.read()
    try:
        raw_text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(400, f"could not decode {file.filename} as UTF-8 text: {exc}")
    return await _start_run(file.filename or "upload.txt", raw_text)


@app.get("/api/runs/{run_id}/stream")
async def stream_run(run_id: str) -> StreamingResponse:
    queue = events.get_queue(run_id)
    if queue is None:
        raise HTTPException(404, f"no active run {run_id} (already finished or unknown)")
    return StreamingResponse(events.stream(run_id, queue), media_type="text/event-stream")


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str) -> dict:
    run = store.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"no run {run_id}")
    return run


@app.get("/api/records")
async def list_records() -> list[dict]:
    return store.list_records()


@app.post("/api/reset")
async def reset() -> dict:
    store.reset()
    logger.info("store reset")
    return {"status": "reset"}
