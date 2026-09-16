"""Structured JSON-line logging to backend/data/intake.log plus stderr.

Every log record includes run_id (when available) via a filter, so
`grep run_id backend/data/intake.log` reconstructs one run's full
server-side story — the append-only companion to the SQLite trace, useful
when something fails before persist() ever runs (e.g. an LLM call raising
before it reaches the trace-recording wrapper).
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

LOG_PATH = Path(__file__).resolve().parent.parent / "data" / "intake.log"


def configure_logging(level: int = logging.INFO) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fmt = "%(asctime)s %(levelname)s %(name)s: %(message)s"
    formatter = logging.Formatter(fmt)

    root = logging.getLogger("intake")
    root.setLevel(level)
    root.handlers.clear()

    stream_handler = logging.StreamHandler(sys.stderr)
    stream_handler.setFormatter(formatter)
    root.addHandler(stream_handler)

    file_handler = logging.FileHandler(LOG_PATH)
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)
