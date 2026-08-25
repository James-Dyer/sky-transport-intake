import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import pytest
from dotenv import load_dotenv

# Load a real key for tests/test_agent_live.py to pick up, but do NOT let it
# flip the default offline suite over to real calls: SKY_INTAKE_FAKE_LLM=1
# is set explicitly below, after the .env load, so it always wins here.
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env.local", override=True)
os.environ["SKY_INTAKE_FAKE_LLM"] = "1"

SOP_PATH = Path(__file__).resolve().parent.parent / "sop" / "compliance-intake.md"
SAMPLE_TICKETS_DIR = Path(__file__).resolve().parent.parent / "sample_tickets"

from app.models import Ticket  # noqa: E402


@pytest.fixture
def sop_text() -> str:
    return SOP_PATH.read_text()


@pytest.fixture
def sample_ticket():
    def _load(ticket_id: str) -> tuple[Ticket, Path]:
        ticket = Ticket.model_validate_json((SAMPLE_TICKETS_DIR / f"{ticket_id}.json").read_text())
        return ticket, SAMPLE_TICKETS_DIR / ticket.attachment_filename

    return _load


@pytest.fixture
def sample_ticket_ids() -> list[str]:
    return sorted(p.stem for p in SAMPLE_TICKETS_DIR.glob("*.json"))
