import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import pytest
from dotenv import load_dotenv

# Load a real key for tests/test_graph_live.py to pick up, but do NOT let it
# flip the default offline suite over to real calls: SKY_INTAKE_FAKE_LLM=1
# is set explicitly below, after the .env load, so it always wins here.
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env.local", override=True)
os.environ["SKY_INTAKE_FAKE_LLM"] = "1"

SOP_PATH = Path(__file__).resolve().parent.parent / "sop" / "compliance-intake.md"
SAMPLE_DOCS_DIR = Path(__file__).resolve().parent.parent / "sample_docs"


@pytest.fixture
def sop_text() -> str:
    return SOP_PATH.read_text()


@pytest.fixture
def sample_doc():
    def _load(name: str) -> str:
        return (SAMPLE_DOCS_DIR / name).read_text()

    return _load
