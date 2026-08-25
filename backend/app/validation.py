"""Programmatic validation mirroring sop/compliance-intake.md.

The SOP markdown is what the LLM reads to decide *what fields to extract*.
This module is the deterministic enforcement of the SOP's validation rules
once fields are extracted — it must stay in sync with the "Required fields"
and "Urgency rule" sections of the SOP by hand, the same way an engineer
would keep code in sync with a written policy doc at a real company. This
split (LLM for open-ended reading, code for the yes/no rule enforcement)
is deliberate: we don't want a filing outcome to depend on the model
correctly re-deriving arithmetic every run.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from dateutil import parser as date_parser

REQUIRED_FIELDS: dict[str, list[str]] = {
    "IFTA_QUARTERLY": [
        "carrier_name",
        "usdot_number",
        "quarter",
        "jurisdictions",
        "total_miles",
        "total_gallons",
        "tax_owed",
        "due_date",
    ],
    "IRP_RENEWAL": [
        "carrier_name",
        "usdot_number",
        "fleet_id",
        "base_jurisdiction",
        "renewal_period",
        "vehicle_count",
        "due_date",
    ],
    "DOT_LETTER": [
        "carrier_name",
        "usdot_number",
        "letter_type",
        "issuing_agency",
    ],
    "UNKNOWN": [],
}

# Fields the SOP asks the extractor to capture for a doc type but that are
# legitimately allowed to be null (per SOP: "response_due_date ... may be
# null if the letter is informational only") — so they're excluded from
# REQUIRED_FIELDS (a null value must NOT force needs_review) but they are
# still part of the SOP's field list, not an extraction scope leak.
OPTIONAL_FIELDS: dict[str, list[str]] = {
    "DOT_LETTER": ["response_due_date"],
}


def full_field_set(doc_type: str) -> set[str]:
    """All fields the SOP defines for this doc type, required or optional."""
    return set(REQUIRED_FIELDS.get(doc_type, [])) | set(OPTIONAL_FIELDS.get(doc_type, []))


URGENCY_DAYS: dict[str, int] = {
    "IFTA_QUARTERLY": 14,
    "IRP_RENEWAL": 30,
    "DOT_LETTER": 10,
}


def _parse_date(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = date_parser.parse(value, fuzzy=True)
    except (ValueError, OverflowError):
        return None
    return parsed.replace(tzinfo=None)


def validate(
    doc_type: str, fields: dict[str, Any], *, now: datetime | None = None
) -> dict[str, Any]:
    """Returns missing_fields, needs_review, deadline_flag, urgency_reason."""
    # Sample/extracted due dates are naive (no timezone in source documents);
    # keep `now` naive too so subtraction below never raises on aware/naive mix.
    now = now or datetime.now()
    required = REQUIRED_FIELDS.get(doc_type, [])
    missing = [f for f in required if not fields.get(f)]

    # Rule 1: usdot_number is the primary key — its absence always forces review.
    if doc_type != "UNKNOWN" and not fields.get("usdot_number"):
        if "usdot_number" not in missing:
            missing.append("usdot_number")

    needs_review = doc_type == "UNKNOWN" or bool(missing)

    deadline_flag = False
    urgency_reason: str | None = None

    if doc_type == "DOT_LETTER" and fields.get("letter_type") == "out_of_service_order":
        deadline_flag = True
        urgency_reason = "out-of-service order — urgent regardless of date"

    date_field = "response_due_date" if doc_type == "DOT_LETTER" else "due_date"
    due = _parse_date(fields.get(date_field))
    threshold = URGENCY_DAYS.get(doc_type)
    if due is not None and threshold is not None and not deadline_flag:
        days_remaining = (due - now).days
        if days_remaining <= threshold:
            deadline_flag = True
            urgency_reason = (
                f"due date {due.date()} is {days_remaining} day(s) away "
                f"(threshold: {threshold} days for {doc_type})"
            )

    return {
        "missing_fields": missing,
        "needs_review": needs_review,
        "deadline_flag": deadline_flag,
        "urgency_reason": urgency_reason,
    }
