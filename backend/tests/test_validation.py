from datetime import datetime, timedelta

from app.validation import full_field_set, validate


def test_missing_usdot_forces_review_even_if_otherwise_complete():
    fields = {
        "carrier_name": "Blue Ridge Hauling",
        "quarter": "Q3 2026",
        "jurisdictions": ["TX", "NM"],
        "total_miles": 18940,
        "total_gallons": 2910,
        "tax_owed": 205.10,
        "due_date": "October 31, 2026",
    }
    result = validate("IFTA_QUARTERLY", fields, now=datetime(2026, 8, 25))
    assert "usdot_number" in result["missing_fields"]
    assert result["needs_review"] is True


def test_complete_non_urgent_ifta_auto_files():
    fields = {
        "carrier_name": "Golden Valley Trucking LLC",
        "usdot_number": "2847193",
        "quarter": "Q2 2026",
        "jurisdictions": ["CA", "NV"],
        "total_miles": 41220,
        "total_gallons": 6187,
        "tax_owed": 412.55,
        "due_date": "December 31, 2026",
    }
    result = validate("IFTA_QUARTERLY", fields, now=datetime(2026, 8, 25))
    assert result["missing_fields"] == []
    assert result["needs_review"] is False
    assert result["deadline_flag"] is False


def test_ifta_within_14_days_is_urgent_but_still_auto_files():
    due = datetime(2026, 8, 25) + timedelta(days=10)
    fields = {
        "carrier_name": "Golden Valley Trucking LLC",
        "usdot_number": "2847193",
        "quarter": "Q2 2026",
        "jurisdictions": ["CA"],
        "total_miles": 100,
        "total_gallons": 10,
        "tax_owed": 5,
        "due_date": due.strftime("%B %d, %Y"),
    }
    result = validate("IFTA_QUARTERLY", fields, now=datetime(2026, 8, 25))
    assert result["needs_review"] is False
    assert result["deadline_flag"] is True
    assert "10 day" in result["urgency_reason"]


def test_irp_urgency_threshold_is_30_days_not_14():
    due = datetime(2026, 8, 25) + timedelta(days=21)
    fields = {
        "carrier_name": "Pacific Crest Freight Inc.",
        "usdot_number": "3391045",
        "fleet_id": "PCF-01",
        "base_jurisdiction": "California",
        "renewal_period": "2026-2027",
        "vehicle_count": 14,
        "due_date": due.strftime("%m/%d/%Y"),
    }
    result = validate("IRP_RENEWAL", fields, now=datetime(2026, 8, 25))
    assert result["deadline_flag"] is True
    # same 21-day gap would NOT be urgent under the 14-day IFTA threshold
    ifta_check = validate(
        "IFTA_QUARTERLY",
        {**fields, "quarter": "Q3 2026", "jurisdictions": ["CA"],
         "total_miles": 1, "total_gallons": 1, "tax_owed": 1},
        now=datetime(2026, 8, 25),
    )
    assert ifta_check["deadline_flag"] is False


def test_out_of_service_order_is_always_urgent_regardless_of_date():
    fields = {
        "carrier_name": "Redwood Logistics Group",
        "usdot_number": "1102938",
        "letter_type": "out_of_service_order",
        "issuing_agency": "FMCSA Western Service Center",
        "response_due_date": None,
    }
    result = validate("DOT_LETTER", fields, now=datetime(2026, 8, 25))
    assert result["deadline_flag"] is True
    assert "out-of-service" in result["urgency_reason"]


def test_unknown_doc_type_always_needs_review():
    result = validate("UNKNOWN", {}, now=datetime(2026, 8, 25))
    assert result["needs_review"] is True


def test_dot_letter_response_due_date_is_optional_not_required():
    # SOP explicitly allows response_due_date to be null for informational
    # letters (e.g. mcs150_reminder with no response needed) — it must be
    # part of the SOP's field set (extractable) without forcing needs_review
    # when absent, unlike the other DOT_LETTER fields.
    fields = {
        "carrier_name": "Summit Line Haulers LLC",
        "usdot_number": "2765410",
        "letter_type": "mcs150_reminder",
        "issuing_agency": "FMCSA",
        "response_due_date": None,
    }
    result = validate("DOT_LETTER", fields, now=datetime(2026, 8, 25))
    assert result["missing_fields"] == []
    assert result["needs_review"] is False
    assert "response_due_date" in full_field_set("DOT_LETTER")
    assert "response_due_date" not in full_field_set("IFTA_QUARTERLY")
