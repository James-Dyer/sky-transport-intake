import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("SKY_INTAKE_FAKE_LLM", "1")

import pytest

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
