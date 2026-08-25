"""RAG lookup over the SOP: chunk by markdown section, embed locally with
chromadb's bundled default embedding function (all-MiniLM-L6-v2 via
onnxruntime — no API key, no network call once the model is cached), and
query it from the `search_sop` agent tool.

This changes *how* the agent gets at the SOP (targeted retrieval instead of
stuffing the whole file into every prompt) — the SOP markdown itself stays
the single source of truth.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import chromadb
from chromadb.utils import embedding_functions

_HEADING_RE = re.compile(r"^(#{2,3})\s+(.*)$", re.MULTILINE)


@dataclass
class SopChunk:
    chunk_id: str
    section: str
    text: str


# The all-MiniLM-L6-v2 model (chromadb's local default) is small and leans
# heavily on lexical overlap — a query like "this looks like an invoice, not
# a compliance doc" shares almost no vocabulary with the terse "Classification
# guidance" section heading/body, so it was ranking dead last against that
# section's own chunk (confirmed via scripts/check_sop_retrieval.py before
# this was added). Prepending a synthetic, keyword-rich topic sentence to
# each chunk purely for embedding (never shown to the agent — the returned
# `text` stays the real SOP content) closes that gap without changing what
# the SOP says or swapping to a paid embeddings API.
_SECTION_BLURBS: dict[str, str] = {
    "Classification guidance": (
        "What to do when a document does not match a known type, is "
        "unclear, ambiguous, unrelated, or not a compliance document at "
        "all — e.g. an invoice, a receipt, spam, or anything that isn't "
        "IFTA, IRP, or a DOT letter. Classify as UNKNOWN and route to "
        "human review rather than guessing."
    ),
    "Validation rules (apply after extraction, regardless of type)": (
        "Required-field checks after extraction: what to do when a "
        "required field is missing or absent, especially usdot_number "
        "(the primary key), carrier_name, or any other required field — "
        "when to flag missing_fields and route to human review versus "
        "auto-file, and when a document is urgent enough to raise a "
        "deadline flag."
    ),
}


def chunk_sop(sop_text: str) -> list[SopChunk]:
    """Split the SOP into one chunk per ##/### section, each chunk holding
    its own heading plus the body text up to the next heading."""
    headings = list(_HEADING_RE.finditer(sop_text))
    chunks: list[SopChunk] = []
    for i, match in enumerate(headings):
        start = match.start()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(sop_text)
        section = match.group(2).strip()
        body = sop_text[start:end].strip()
        if body:
            chunks.append(SopChunk(chunk_id=f"chunk-{i}", section=section, text=body))
    return chunks


def _embed_text(chunk: SopChunk) -> str:
    blurb = _SECTION_BLURBS.get(chunk.section)
    return f"{blurb}\n\n{chunk.text}" if blurb else chunk.text


class SopIndex:
    """In-process, ephemeral (not persisted to disk) vector index over one
    SOP's chunks. Rebuilt once at process startup — the SOP is small and
    changes rarely, so there's no need for incremental updates."""

    def __init__(self, sop_text: str, *, collection_name: str = "sop"):
        self._client = chromadb.EphemeralClient()
        self._embedding_fn = embedding_functions.DefaultEmbeddingFunction()
        # Ephemeral client + unique-per-instance name avoids collisions when
        # tests construct multiple indexes in the same process.
        self._collection = self._client.create_collection(
            name=f"{collection_name}-{id(self)}",
            embedding_function=self._embedding_fn,
        )
        self.chunks = chunk_sop(sop_text)
        if self.chunks:
            embeddings = self._embedding_fn([_embed_text(c) for c in self.chunks])
            self._collection.add(
                ids=[c.chunk_id for c in self.chunks],
                documents=[c.text for c in self.chunks],
                metadatas=[{"section": c.section} for c in self.chunks],
                embeddings=embeddings,
            )

    def search(self, query: str, k: int = 3) -> list[dict[str, str | float]]:
        if not self.chunks:
            return []
        k = min(k, len(self.chunks))
        result = self._collection.query(query_texts=[query], n_results=k)
        hits: list[dict[str, str | float]] = []
        for doc, meta, distance in zip(
            result["documents"][0], result["metadatas"][0], result["distances"][0]
        ):
            hits.append(
                {
                    "section": meta["section"],
                    "text": doc,
                    # cosine distance in [0, 2]; flip to an intuitive
                    # "higher is more relevant" similarity score in [0, 1].
                    "relevance": round(max(0.0, 1 - distance / 2), 3),
                }
            )
        return hits
