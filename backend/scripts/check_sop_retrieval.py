"""Standalone sanity check for SopIndex retrieval quality.

Run with:
    .venv/bin/python scripts/check_sop_retrieval.py

Not a pytest test — this is a human-eyeball checkpoint per the v2 plan:
confirm local embeddings retrieve the right SOP section before building
tools on top of it. If results look poor, swap DefaultEmbeddingFunction
for a provider embeddings API in sop_index.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.sop_index import SopIndex

SOP_PATH = Path(__file__).resolve().parent.parent / "sop" / "compliance-intake.md"

QUERIES = [
    ("what fields does an IFTA quarterly filing need?", "IFTA_QUARTERLY"),
    ("client got an out-of-service order, how urgent is that?", "DOT_LETTER"),
    ("IRP plate renewal required fields", "IRP_RENEWAL"),
    ("what do I do if usdot number is missing", "Validation rules"),
    ("this looks like an invoice not a compliance doc, what do I do", "Classification guidance"),
    ("when is a DOT letter urgent", "DOT_LETTER"),
]


def main() -> None:
    sop_text = SOP_PATH.read_text()
    index = SopIndex(sop_text)
    print(f"indexed {len(index.chunks)} chunks:")
    for c in index.chunks:
        print(f"  - {c.chunk_id}: {c.section!r} ({len(c.text)} chars)")
    print()

    for query, _expected_hint in QUERIES:
        hits = index.search(query, k=2)
        print(f"query: {query!r}")
        for h in hits:
            print(f"    [{h['relevance']:.3f}] {h['section']}")
        print()


if __name__ == "__main__":
    main()
