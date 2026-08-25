"""Regression test for a real bug caught by the live-model suite: gpt-5-mini
returns usdot_number as a JSON number, not a string, which would silently
break identity matching downstream since the SOP treats it as a primary key."""

from app.tools import _normalize_fields


def test_numeric_usdot_number_is_coerced_to_string():
    assert _normalize_fields({"usdot_number": 3391045})["usdot_number"] == "3391045"


def test_string_usdot_number_is_left_alone():
    assert _normalize_fields({"usdot_number": "3391045"})["usdot_number"] == "3391045"


def test_missing_usdot_number_is_left_alone():
    assert _normalize_fields({"carrier_name": "Acme"}) == {"carrier_name": "Acme"}


def test_null_usdot_number_stays_null():
    assert _normalize_fields({"usdot_number": None})["usdot_number"] is None
