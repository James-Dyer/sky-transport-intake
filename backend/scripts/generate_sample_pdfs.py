"""Generates backend/sample_tickets/{id}.json + {id}.pdf — the demo data
for the v2 agent. Each ticket pairs an enterprise-style intake ticket
(subject/instructions/priority/requester) with a realistic-looking attached
PDF styled as the actual document a compliance-service client or government
agency would send: an IFTA fuel-tax return, a state DMV IRP renewal notice,
an FMCSA letter, or (the one non-compliance-doc case) a vendor invoice.

This replaces backend/sample_docs/*.txt entirely — same 6 scenarios, same
coverage of the validation/urgency rules, new format (ticket + PDF instead
of a bare text file).

Run with:
    .venv/bin/python scripts/generate_sample_pdfs.py
"""

from __future__ import annotations

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT_DIR = Path(__file__).resolve().parent.parent / "sample_tickets"

styles = getSampleStyleSheet()
h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=14, spaceAfter=4)
h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=11, spaceAfter=2)
body = ParagraphStyle("body", parent=styles["Normal"], fontSize=10, leading=14)
small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, textColor=colors.grey)


def _kv_table(rows: list[tuple[str, str]]) -> Table:
    data = [[Paragraph(f"<b>{k}</b>", body), Paragraph(v, body)] for k, v in rows]
    t = Table(data, colWidths=[2.1 * inch, 4.0 * inch])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#dddddd")),
            ]
        )
    )
    return t


def _build_pdf(path: Path, flowables: list) -> None:
    doc = SimpleDocTemplate(
        str(path),
        pagesize=letter,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        leftMargin=0.85 * inch,
        rightMargin=0.85 * inch,
    )
    doc.build(flowables)


def _letterhead(org: str, tagline: str, address: str) -> list:
    return [
        Paragraph(org, ParagraphStyle("org", parent=h1, textColor=colors.HexColor("#1a1a1a"))),
        Paragraph(tagline, small),
        Paragraph(address, small),
        Spacer(1, 10),
        Table([[""]], colWidths=[6.1 * inch], rowHeights=[1]),
        Spacer(1, 4),
    ]


# ---------------------------------------------------------------------------
# 1. IFTA_QUARTERLY — complete, all fields present, urgent (due in <14 days)
# ---------------------------------------------------------------------------

def build_01_ifta_q2(path: Path) -> None:
    flow = _letterhead(
        "INTERNATIONAL FUEL TAX AGREEMENT (IFTA)",
        "Quarterly Fuel Use Tax Return",
        "IFTA, Inc. · Processing Center · Sacramento, CA",
    )
    flow += [
        Spacer(1, 6),
        _kv_table(
            [
                ("Carrier:", "Golden Valley Trucking LLC"),
                ("USDOT Number:", "2847193"),
                ("Reporting Quarter:", "Q2 2026 (April 1 &ndash; June 30, 2026)"),
                ("Jurisdictions Traveled:", "CA, NV, AZ, OR"),
                ("Total Miles (all jurisdictions):", "41,220"),
                ("Total Gallons Purchased:", "6,187"),
                ("Net Tax Due:", "$412.55"),
                ("Return &amp; Payment Due:", "September 5, 2026"),
            ]
        ),
        Spacer(1, 10),
        Paragraph(
            "Prepared for filing by Cascade Compliance Partners on behalf of client. "
            "Document date: August 22, 2026.",
            body,
        ),
    ]
    _build_pdf(path, flow)


# ---------------------------------------------------------------------------
# 2. IRP_RENEWAL — complete, urgent (due in <30 days)
# ---------------------------------------------------------------------------

def build_02_irp_renewal(path: Path) -> None:
    flow = _letterhead(
        "CALIFORNIA DEPARTMENT OF MOTOR VEHICLES",
        "International Registration Plan (IRP) Renewal Notice",
        "PO Box 932382, Sacramento, CA 94232",
    )
    flow += [
        Spacer(1, 6),
        _kv_table(
            [
                ("Registrant:", "Pacific Crest Freight Inc."),
                ("USDOT #:", "3391045"),
                ("Fleet ID:", "PCF-01"),
                ("Base Jurisdiction:", "California"),
                ("Renewal Period:", "2026&ndash;2027"),
                ("Vehicles on Fleet:", "14"),
                ("Renewal Due:", "09/15/2026"),
            ]
        ),
        Spacer(1, 10),
        Paragraph(
            "Failure to renew by the due date will result in suspension of "
            "operating authority in all IRP member jurisdictions.",
            body,
        ),
        Spacer(1, 6),
        Paragraph("Notice generated: 09/01/2026", small),
    ]
    _build_pdf(path, flow)


# ---------------------------------------------------------------------------
# 3. DOT_LETTER / out_of_service_order — always urgent, no calendar date
# ---------------------------------------------------------------------------

def build_03_dot_oos_order(path: Path) -> None:
    flow = _letterhead(
        "FEDERAL MOTOR CARRIER SAFETY ADMINISTRATION",
        "Out-of-Service Order",
        "FMCSA Western Service Center · 1310 Chicago Ave, Suite 200, Riverside, CA",
    )
    flow += [
        Spacer(1, 6),
        _kv_table(
            [
                ("To:", "Redwood Logistics Group"),
                ("USDOT Number:", "1102938"),
                ("Issuing Agency:", "FMCSA Western Service Center"),
            ]
        ),
        Spacer(1, 10),
        Paragraph(
            "This notice confirms that, following a compliance review, the "
            "above-named motor carrier is declared <b>UNFIT</b> to operate a "
            "commercial motor vehicle in interstate commerce, effective "
            "immediately upon receipt of this order.",
            body,
        ),
        Spacer(1, 8),
        Paragraph(
            "Response required: contact FMCSA within 5 business days to "
            "schedule a corrective action review.",
            body,
        ),
        Spacer(1, 6),
        Paragraph("Letter date: August 18, 2026", small),
    ]
    _build_pdf(path, flow)


# ---------------------------------------------------------------------------
# 4. DOT_LETTER / mcs150_reminder — informational, not urgent
# ---------------------------------------------------------------------------

def build_04_mcs150_reminder(path: Path) -> None:
    flow = _letterhead(
        "FEDERAL MOTOR CARRIER SAFETY ADMINISTRATION",
        "MCS-150 Biennial Update Reminder",
        "1200 New Jersey Ave SE, Washington, DC 20590",
    )
    flow += [
        Spacer(1, 6),
        _kv_table(
            [
                ("Carrier:", "Summit Line Haulers LLC"),
                ("USDOT Number:", "2765410"),
                ("Issuing Agency:", "FMCSA"),
            ]
        ),
        Spacer(1, 10),
        Paragraph(
            "Your USDOT registration is due for its biennial MCS-150 update.",
            body,
        ),
        Spacer(1, 8),
        Paragraph("Response due by: December 1, 2026", body),
        Spacer(1, 8),
        Paragraph(
            "This is a routine reminder. No immediate action beyond the "
            "standard biennial update is required at this time.",
            body,
        ),
        Spacer(1, 6),
        Paragraph("Letter date: August 20, 2026", small),
    ]
    _build_pdf(path, flow)


# ---------------------------------------------------------------------------
# 5. IFTA_QUARTERLY — missing USDOT number (partial scan) -> forces review
# ---------------------------------------------------------------------------

def build_05_ifta_missing_dot(path: Path) -> None:
    flow = _letterhead(
        "INTERNATIONAL FUEL TAX AGREEMENT (IFTA)",
        "Quarterly Fuel Use Tax Return",
        "IFTA, Inc. · Processing Center · Sacramento, CA",
    )
    flow += [
        Spacer(1, 6),
        _kv_table(
            [
                ("Carrier:", "Blue Ridge Hauling"),
                ("USDOT Number:", "<i>(not legible on scan)</i>"),
                ("Reporting Quarter:", "Q3 2026 (July 1 &ndash; September 30, 2026)"),
                ("Jurisdictions Traveled:", "TX, NM, OK"),
                ("Total Miles (all jurisdictions):", "18,940"),
                ("Total Gallons Purchased:", "2,910"),
                ("Net Tax Due:", "$205.10"),
                ("Return &amp; Payment Due:", "October 31, 2026"),
            ]
        ),
        Spacer(1, 10),
        Paragraph(
            "<i>Note: USDOT number omitted from this scan &mdash; client "
            "submitted a partial photo of the form. Front office needs to "
            "confirm the carrier's USDOT number before this can be matched "
            "to a file.</i>",
            body,
        ),
        Spacer(1, 6),
        Paragraph("Document date: October 20, 2026", small),
    ]
    _build_pdf(path, flow)


# ---------------------------------------------------------------------------
# 6. UNKNOWN — unrelated vendor invoice, not a compliance document
# ---------------------------------------------------------------------------

def build_06_unrelated_invoice(path: Path) -> None:
    flow = _letterhead(
        "OFFICE SUPPLY DEPOT",
        "Invoice #48213",
        "4400 Distribution Way, Tracy, CA 95376",
    )
    flow += [
        Spacer(1, 6),
        Paragraph("<b>Bill To:</b> Cascade Compliance Partners, 121 East 11th Street, Tracy, CA", body),
        Spacer(1, 10),
        Table(
            [
                ["Item", "Amount"],
                ["1 case printer paper", "$34.99"],
                ["2 toner cartridges", "$118.50"],
                ["1 box binder clips", "$6.25"],
                ["Total Due", "$159.74"],
            ],
            colWidths=[4.0 * inch, 1.5 * inch],
            style=TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dddddd")),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f2f2f2")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                    ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ]
            ),
        ),
        Spacer(1, 10),
        Paragraph("Payment Terms: Net 30", body),
        Spacer(1, 6),
        Paragraph("Invoice date: August 12, 2026", small),
    ]
    _build_pdf(path, flow)


TICKETS = [
    {
        "ticket_id": "4821",
        "subject": "Process IFTA Q2 filing — Golden Valley Trucking",
        "priority": "Normal",
        "requester": "front.office@cascadecompliance.com",
        "instructions": (
            "Please process the attached quarterly IFTA return for Golden "
            "Valley Trucking. Client's filing window is coming up — confirm "
            "all required fields are captured and flag anything that's "
            "missing before we submit on their behalf."
        ),
        "attachment_filename": "01_ifta_q2.pdf",
        "build": build_01_ifta_q2,
    },
    {
        "ticket_id": "4822",
        "subject": "IRP renewal notice — Pacific Crest Freight",
        "priority": "Normal",
        "requester": "front.office@cascadecompliance.com",
        "instructions": (
            "Attached is the IRP renewal notice we received from CA DMV for "
            "Pacific Crest Freight. Please log this into the client's file "
            "and confirm whether it needs to go on the urgent list given "
            "their renewal window."
        ),
        "attachment_filename": "02_irp_renewal.pdf",
        "build": build_02_irp_renewal,
    },
    {
        "ticket_id": "4823",
        "subject": "URGENT — FMCSA out-of-service order, Redwood Logistics",
        "priority": "High",
        "requester": "compliance@cascadecompliance.com",
        "instructions": (
            "Client called in a panic — they received the attached FMCSA "
            "out-of-service order this morning. Please process immediately "
            "and make sure this is flagged as urgent regardless of any "
            "dates on the letter; an OOS order is always top priority."
        ),
        "attachment_filename": "03_dot_oos_order.pdf",
        "build": build_03_dot_oos_order,
    },
    {
        "ticket_id": "4824",
        "subject": "MCS-150 reminder — Summit Line Haulers",
        "priority": "Low",
        "requester": "front.office@cascadecompliance.com",
        "instructions": (
            "Routine MCS-150 biennial update reminder came in for Summit "
            "Line Haulers, attached. Please log it — this is informational, "
            "no rush unless the letter says otherwise."
        ),
        "attachment_filename": "04_mcs150_reminder.pdf",
        "build": build_04_mcs150_reminder,
    },
    {
        "ticket_id": "4825",
        "subject": "IFTA filing, Blue Ridge Hauling — client sent a partial scan",
        "priority": "Normal",
        "requester": "front.office@cascadecompliance.com",
        "instructions": (
            "Client emailed the attached IFTA return as a photo and part of "
            "it didn't come through clearly. Please process what's there "
            "and flag whatever's missing so we can follow up with the "
            "client directly."
        ),
        "attachment_filename": "05_ifta_missing_dot.pdf",
        "build": build_05_ifta_missing_dot,
    },
    {
        "ticket_id": "4826",
        "subject": "Office supply invoice — please file",
        "priority": "Low",
        "requester": "front.office@cascadecompliance.com",
        "instructions": (
            "Attached invoice came in through the general intake inbox by "
            "mistake — not sure it's actually a compliance document, please "
            "take a look and route it correctly."
        ),
        "attachment_filename": "06_unrelated_invoice.pdf",
        "build": build_06_unrelated_invoice,
    },
]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for ticket in TICKETS:
        build_fn = ticket["build"]
        pdf_path = OUT_DIR / ticket["attachment_filename"]
        build_fn(pdf_path)

        json_path = OUT_DIR / f"{ticket['ticket_id']}.json"
        manifest = {k: v for k, v in ticket.items() if k != "build"}
        json_path.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"wrote {pdf_path.name} + {json_path.name}")


if __name__ == "__main__":
    main()
