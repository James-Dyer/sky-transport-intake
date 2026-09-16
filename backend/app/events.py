"""In-memory pub/sub for live run events, consumed via SSE.

One asyncio.Queue per run_id. The graph runner publishes a `node_started`
and `node_finished` event for every node; `main.py`'s SSE endpoint drains
the queue and formats it as `text/event-stream`. A `None` sentinel closes
the stream. This is intentionally process-local (no Redis) — fine for a
single-instance demo; a real multi-instance deployment would swap this for
a pub/sub backend without touching the graph or API code.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

logger = logging.getLogger("intake.events")

_queues: dict[str, asyncio.Queue] = {}


def register(run_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue()
    _queues[run_id] = queue
    return queue


def publish(run_id: str, event_type: str, payload: dict[str, Any]) -> None:
    queue = _queues.get(run_id)
    if queue is None:
        logger.warning("publish() called for unknown run_id=%s", run_id)
        return
    queue.put_nowait({"type": event_type, "payload": payload})


def close(run_id: str) -> None:
    queue = _queues.get(run_id)
    if queue is not None:
        queue.put_nowait(None)


def cleanup(run_id: str) -> None:
    _queues.pop(run_id, None)


def get_queue(run_id: str) -> asyncio.Queue | None:
    return _queues.get(run_id)


async def stream(run_id: str, queue: asyncio.Queue):
    """Yields SSE-formatted strings until the sentinel closes the stream."""
    try:
        while True:
            event = await queue.get()
            if event is None:
                yield "event: done\ndata: {}\n\n"
                break
            yield f"event: {event['type']}\ndata: {json.dumps(event['payload'])}\n\n"
    finally:
        cleanup(run_id)
