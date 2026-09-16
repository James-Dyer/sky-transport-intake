# Compliance Document Intake — Standard Operating Procedure

This document tells the intake agent how to classify, extract, and validate
incoming compliance documents for the company's clients. Any node
that needs to know "what fields matter" or "what counts as urgent" reads this
file at runtime rather than relying on a hardcoded schema.

## Recognized document types

### IFTA_QUARTERLY
International Fuel Tax Agreement quarterly filing. Required fields:
- carrier_name
- usdot_number
- quarter (format: "QN YYYY", e.g. "Q3 2026")
- jurisdictions (list of US states/Canadian provinces the carrier operated in)
- total_miles
- total_gallons
- tax_owed (USD, may be negative if a refund is due)
- due_date

Urgency rule: due_date within 14 days of the document date is URGENT.
IFTA filings are due the last day of the month following each quarter
(Apr 30, Jul 31, Oct 31, Jan 31).

### IRP_RENEWAL
International Registration Plan (apportioned plate) renewal or supplement.
Required fields:
- carrier_name
- usdot_number
- fleet_id
- base_jurisdiction
- renewal_period (e.g. "2026-2027")
- vehicle_count
- due_date

Urgency rule: due_date within 30 days is URGENT. IRP lapses immediately
suspend a carrier's operating authority in every member jurisdiction, so a
missed IRP deadline is treated as more severe than a missed IFTA deadline
even at the same days-remaining count.

### DOT_LETTER
Correspondence from a state or federal DOT office — audit notices, permit
approvals/denials, biennial MCS-150 update reminders, out-of-service orders.
Required fields:
- carrier_name
- usdot_number
- letter_type (one of: audit_notice, permit_approval, permit_denial,
  mcs150_reminder, out_of_service_order, other)
- issuing_agency
- response_due_date (may be null if the letter is informational only)

Urgency rule: any out_of_service_order is URGENT regardless of date.
Any response_due_date within 10 days is URGENT.

## Classification guidance

If a document does not clearly match one of the three types above, classify
it as `UNKNOWN` and route it to human review rather than guessing at a
schema. Do not invent field values that are not present in the document —
leave a field null and flag `missing_fields` instead.

## Validation rules (apply after extraction, regardless of type)

1. `usdot_number` must be present and numeric. If absent, flag
   `missing_fields: ["usdot_number"]` and route to human review — this
   is the primary key used to match the document to an existing client
   record, so intake cannot safely auto-file without it.
2. `carrier_name` must be present.
3. Any field listed as "Required" above that is missing goes into
   `missing_fields`. A document with any missing required field is
   routed to human review (`needs_review = true`) instead of being
   auto-filed, even if it is otherwise urgent.
4. A document that passes all required-field checks and is not urgent is
   auto-filed (`needs_review = false`).
5. A document that passes all required-field checks but is urgent is
   still auto-filed, but also raises a `deadline_flag` so it surfaces
   at the top of the dashboard.

## Tone / escalation note

This SOP is intentionally conservative: when in doubt, the agent should
prefer routing to a human over guessing. Clients lose their operating
authority if a filing is missed, so a false "needs_review" costs a staff
member two minutes; a false auto-file on bad data costs a client their
DOT number.
