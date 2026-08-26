"""FastAPI app: hand the agent a ticket (instructions + an attached PDF) ->
it plans and executes SOP lookup / PDF read / classification / extraction /
validation / persist via tool calls, in whatever order it decides -> stream
its reasoning + tool calls live over SSE -> list processed records for the
dashboard.

Diagnostics surface: `GET /api/runs/{run_id}` returns the full per-run
trace (thoughts, tool calls, timing, results) for any run, `GET /api/health`
reports which model is active and whether the SOP RAG index loaded, and
every request is logged to backend/data/sky_intake.log.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from . import events
from .agent import build_model, run_agent
from .logging_conf import configure_logging
from .models import Ticket
from .sop_index import SopIndex
from .store import Store
from .tools import RunContext

_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_DIR / ".env")
load_dotenv(_BACKEND_DIR / ".env.local", override=True)

configure_logging()
logger = logging.getLogger("sky_intake.api")

SOP_PATH = Path(__file__).resolve().parent.parent / "sop" / "compliance-intake.md"
SAMPLE_TICKETS_DIR = Path(__file__).resolve().parent.parent / "sample_tickets"
UPLOADS_DIR = Path(__file__).resolve().parent.parent / "data" / "uploads"

app = FastAPI(title="Sky Transport Intake Agent")
app.add_middleware(
    CORSMiddleware,
    # Vite picks the next free port (5173, 5174, ...) when one is taken, so
    # pin by hostname/scheme rather than a single hardcoded port.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

_db_path_override = os.environ.get("SKY_INTAKE_DB_PATH")
store = Store(_db_path_override) if _db_path_override else Store()
sop_text = SOP_PATH.read_text()
sop_index = SopIndex(sop_text)

_use_fake = os.environ.get("SKY_INTAKE_FAKE_LLM", "").lower() in ("1", "true", "yes")
if _use_fake:
    from .fake_agent import FakeAgentModel

    model = FakeAgentModel()
    logger.info("using FakeAgentModel (SKY_INTAKE_FAKE_LLM set)")
else:
    model = build_model()
    logger.info("using %s", type(model).__name__)

logger.info(
    "startup: model=%s db=%s sop_chars=%d sop_chunks=%d",
    type(model).__name__,
    store.db_path,
    len(sop_text),
    len(sop_index.chunks),
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_sample_tickets() -> list[Ticket]:
    tickets = []
    for json_path in sorted(SAMPLE_TICKETS_DIR.glob("*.json")):
        tickets.append(Ticket.model_validate_json(json_path.read_text()))
    return tickets


async def _run_pipeline(run_id: str, doc_id: str, ticket: Ticket, pdf_path: Path) -> None:
    loop = asyncio.get_running_loop()

    def publish(event_type: str, payload: dict) -> None:
        payload = {**payload, "run_id": run_id}
        loop.call_soon_threadsafe(events.publish, run_id, event_type, payload)

    ctx = RunContext(run_id=run_id, ticket=ticket, pdf_path=pdf_path, sop_index=sop_index, store=store)
    try:
        final = await loop.run_in_executor(
            None, functools.partial(run_agent, ctx, model, publish_event=publish)
        )
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


async def _start_run(ticket: Ticket, pdf_path: Path) -> dict:
    run_id = str(uuid.uuid4())
    doc_id = str(uuid.uuid4())
    events.register(run_id)
    store.create_run(
        run_id,
        ticket.attachment_filename,
        _now_iso(),
        ticket_subject=ticket.subject,
        ticket_instructions=ticket.instructions,
    )
    logger.info(
        "run %s started for ticket=%s attachment=%s",
        run_id,
        ticket.ticket_id,
        ticket.attachment_filename,
    )
    asyncio.create_task(_run_pipeline(run_id, doc_id, ticket, pdf_path))
    return {"run_id": run_id, "doc_id": doc_id, "filename": ticket.attachment_filename}


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "model": type(model).__name__,
        "sop_loaded_chars": len(sop_text),
        "sop_chunks": len(sop_index.chunks),
        "db_path": str(store.db_path),
    }


@app.get("/api/sample-tickets")
async def list_sample_tickets() -> list[dict]:
    return [t.model_dump() for t in _load_sample_tickets()]


@app.get("/api/sample-tickets/{ticket_id}/attachment")
async def get_sample_ticket_attachment(ticket_id: str) -> FileResponse:
    json_path = SAMPLE_TICKETS_DIR / f"{ticket_id}.json"
    if not json_path.exists() or json_path.parent != SAMPLE_TICKETS_DIR:
        raise HTTPException(404, f"no sample ticket {ticket_id!r}")
    ticket = Ticket.model_validate_json(json_path.read_text())
    pdf_path = SAMPLE_TICKETS_DIR / ticket.attachment_filename
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=ticket.attachment_filename,
        content_disposition_type="inline",
    )


@app.post("/api/tickets/sample/{ticket_id}")
async def submit_sample_ticket(ticket_id: str) -> dict:
    json_path = SAMPLE_TICKETS_DIR / f"{ticket_id}.json"
    if not json_path.exists() or json_path.parent != SAMPLE_TICKETS_DIR:
        raise HTTPException(404, f"no sample ticket {ticket_id!r}")
    ticket = Ticket.model_validate_json(json_path.read_text())
    pdf_path = SAMPLE_TICKETS_DIR / ticket.attachment_filename
    return await _start_run(ticket, pdf_path)


@app.post("/api/tickets")
async def submit_ticket(
    file: UploadFile,
    instructions: str = Form(...),
    subject: str | None = Form(None),
    priority: str = Form("Normal"),
    requester: str | None = Form(None),
) -> dict:
    filename = file.filename or "upload.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(400, "only PDF attachments are accepted")
    raw_bytes = await file.read()
    if not raw_bytes.startswith(b"%PDF-"):
        raise HTTPException(400, f"{filename} does not look like a valid PDF")

    run_id_prefix = uuid.uuid4().hex[:8]
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = UPLOADS_DIR / f"{run_id_prefix}-{filename}"
    pdf_path.write_bytes(raw_bytes)

    ticket = Ticket(
        ticket_id=run_id_prefix,
        subject=subject or f"Uploaded ticket: {filename}",
        instructions=instructions,
        priority=priority,
        requester=requester,
        attachment_filename=filename,
    )
    return await _start_run(ticket, pdf_path)


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
