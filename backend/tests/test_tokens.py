import time

import pytest

from app import tokens
from app.tokens import TokenError


@pytest.fixture(autouse=True)
def _clear_tokens():
    tokens._tokens.clear()
    yield
    tokens._tokens.clear()


def test_issue_then_redeem_succeeds():
    token = tokens.issue_token("run-1", "IFTA_QUARTERLY", {"usdot_number": "123"})
    tokens.redeem_token(token, "run-1", "IFTA_QUARTERLY", {"usdot_number": "123"})


def test_redeem_unknown_token_rejected():
    with pytest.raises(TokenError, match="not found"):
        tokens.redeem_token("bogus", "run-1", "IFTA_QUARTERLY", {})


def test_redeem_twice_rejected():
    token = tokens.issue_token("run-1", "IFTA_QUARTERLY", {"a": 1})
    tokens.redeem_token(token, "run-1", "IFTA_QUARTERLY", {"a": 1})
    with pytest.raises(TokenError, match="already been used"):
        tokens.redeem_token(token, "run-1", "IFTA_QUARTERLY", {"a": 1})


def test_redeem_wrong_run_rejected():
    token = tokens.issue_token("run-1", "IFTA_QUARTERLY", {"a": 1})
    with pytest.raises(TokenError, match="different run"):
        tokens.redeem_token(token, "run-2", "IFTA_QUARTERLY", {"a": 1})


def test_redeem_mismatched_fields_rejected():
    token = tokens.issue_token("run-1", "IFTA_QUARTERLY", {"a": 1})
    with pytest.raises(TokenError, match="doesn't match"):
        tokens.redeem_token(token, "run-1", "IFTA_QUARTERLY", {"a": 2})


def test_redeem_mismatched_doc_type_rejected():
    token = tokens.issue_token("run-1", "IFTA_QUARTERLY", {"a": 1})
    with pytest.raises(TokenError, match="doesn't match"):
        tokens.redeem_token(token, "run-1", "IRP_RENEWAL", {"a": 1})


def test_redeem_expired_token_rejected(monkeypatch):
    token = tokens.issue_token("run-1", "IFTA_QUARTERLY", {"a": 1})
    future = time.monotonic() + 999
    monkeypatch.setattr(time, "monotonic", lambda: future)
    with pytest.raises(TokenError, match="expired"):
        tokens.redeem_token(token, "run-1", "IFTA_QUARTERLY", {"a": 1})


def test_cleanup_run_drops_its_tokens():
    t1 = tokens.issue_token("run-1", "IFTA_QUARTERLY", {"a": 1})
    t2 = tokens.issue_token("run-2", "IFTA_QUARTERLY", {"a": 1})
    tokens.cleanup_run("run-1")
    with pytest.raises(TokenError, match="not found"):
        tokens.redeem_token(t1, "run-1", "IFTA_QUARTERLY", {"a": 1})
    # run-2's token is untouched
    tokens.redeem_token(t2, "run-2", "IFTA_QUARTERLY", {"a": 1})
