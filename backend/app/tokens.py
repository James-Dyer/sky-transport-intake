"""Short-lived, single-use unlock tokens gating the `persist` tool.

The agent must call the `validate` tool immediately before `persist`.
`validate` mints a token bound to (run_id, doc_type, exact fields hash);
`persist` redeems it. This doesn't stop a determined attacker (it's an
in-memory dict, not real security) — it exists so the agent *cannot*
hallucinate "I validated this" and skip straight to persist: the only way
to obtain a valid token for a given field set is to actually call
`validate` with those exact fields, for that exact run, within the last
two minutes, and not have already spent it.

Process-local, same pattern as events.py's per-run queues — tokens live
and die within one run's async task, no DB table needed.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any

TOKEN_TTL_SECONDS = 120


class TokenError(Exception):
    """Raised when a token is missing, expired, already used, or doesn't
    match the run/doc_type/fields it's being redeemed against."""


@dataclass
class _TokenRecord:
    run_id: str
    fields_hash: str
    expires_at: float
    used: bool = False


_tokens: dict[str, _TokenRecord] = {}


def _hash_fields(doc_type: str, fields: dict[str, Any]) -> str:
    canonical = json.dumps({"doc_type": doc_type, "fields": fields}, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def issue_token(run_id: str, doc_type: str, fields: dict[str, Any]) -> str:
    token = secrets.token_urlsafe(24)
    _tokens[token] = _TokenRecord(
        run_id=run_id,
        fields_hash=_hash_fields(doc_type, fields),
        expires_at=time.monotonic() + TOKEN_TTL_SECONDS,
    )
    return token


def redeem_token(
    token: str, run_id: str, doc_type: str, fields: dict[str, Any]
) -> None:
    record = _tokens.get(token)
    if record is None:
        raise TokenError("unlock_token not found — call validate first")
    if record.used:
        raise TokenError("unlock_token has already been used")
    if time.monotonic() > record.expires_at:
        raise TokenError("unlock_token has expired — call validate again")
    if record.run_id != run_id:
        raise TokenError("unlock_token was issued for a different run")
    if record.fields_hash != _hash_fields(doc_type, fields):
        raise TokenError(
            "unlock_token doesn't match these exact fields — call validate "
            "again with the fields you intend to persist"
        )
    record.used = True


def cleanup_run(run_id: str) -> None:
    """Drop any tokens issued for a finished run (best-effort GC)."""
    stale = [t for t, r in _tokens.items() if r.run_id == run_id]
    for t in stale:
        _tokens.pop(t, None)
