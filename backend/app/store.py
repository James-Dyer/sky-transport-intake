"""SQLite persistence.

Two tables: `records` (the business outcome — one row per processed
document) and `runs` (one row per graph execution holding the full node
trace as JSON, for diagnostics). Keeping the trace in the DB rather than
only in logs means the frontend debug panel and any post-hoc analysis can
pull up "what did the agent actually see and decide" for a specific run
without grepping log files.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sky_intake.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    trace_json TEXT,
    error TEXT
);

CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    missing_fields_json TEXT NOT NULL,
    needs_review INTEGER NOT NULL,
    deadline_flag INTEGER NOT NULL,
    urgency_reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs (run_id)
);
"""


class Store:
    def __init__(self, db_path: Path | str = DEFAULT_DB_PATH):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def create_run(self, run_id: str, filename: str, created_at: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO runs (run_id, filename, status, created_at) "
                "VALUES (?, ?, 'running', ?)",
                (run_id, filename, created_at),
            )

    def finish_run(
        self,
        run_id: str,
        status: str,
        trace: list[dict[str, Any]],
        finished_at: str,
        error: str | None = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE runs SET status = ?, trace_json = ?, finished_at = ?, "
                "error = ? WHERE run_id = ?",
                (status, json.dumps(trace), finished_at, error, run_id),
            )

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["trace"] = json.loads(result.pop("trace_json") or "[]")
        return result

    def add_record(
        self,
        run_id: str,
        filename: str,
        doc_type: str,
        fields: dict[str, Any],
        missing_fields: list[str],
        needs_review: bool,
        deadline_flag: bool,
        urgency_reason: str | None,
        created_at: str,
    ) -> int:
        with self._conn() as conn:
            cursor = conn.execute(
                "INSERT INTO records (run_id, filename, doc_type, fields_json, "
                "missing_fields_json, needs_review, deadline_flag, urgency_reason, "
                "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id,
                    filename,
                    doc_type,
                    json.dumps(fields),
                    json.dumps(missing_fields),
                    int(needs_review),
                    int(deadline_flag),
                    urgency_reason,
                    created_at,
                ),
            )
            return cursor.lastrowid

    def list_records(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM records ORDER BY "
                "deadline_flag DESC, needs_review DESC, created_at DESC"
            ).fetchall()
        records = []
        for row in rows:
            record = dict(row)
            record["fields"] = json.loads(record.pop("fields_json"))
            record["missing_fields"] = json.loads(record.pop("missing_fields_json"))
            record["needs_review"] = bool(record["needs_review"])
            record["deadline_flag"] = bool(record["deadline_flag"])
            records.append(record)
        return records

    def reset(self) -> None:
        """Wipe all data — used by tests and the demo-reset endpoint."""
        with self._conn() as conn:
            conn.execute("DELETE FROM records")
            conn.execute("DELETE FROM runs")
