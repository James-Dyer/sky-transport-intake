"""LLM client abstraction.

The graph nodes depend on this `Protocol`, not on the Anthropic SDK
directly, so tests can substitute `FakeLLMClient` and run the whole graph
deterministically with zero network calls and zero cost. `AnthropicLLMClient`
is the real implementation used at runtime.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

logger = logging.getLogger("sky_intake.llm")


class LLMError(RuntimeError):
    """Raised when the model response can't be parsed into the expected shape."""


class LLMClient(Protocol):
    def classify_document(self, raw_text: str, sop_text: str) -> dict[str, Any]:
        """Return {"doc_type": ..., "confidence": ..., "reasoning": ...}."""
        ...

    def extract_fields(
        self, raw_text: str, sop_text: str, doc_type: str
    ) -> dict[str, Any]:
        """Return {"fields": {...}, "reasoning": ...}."""
        ...


def _extract_json_block(text: str) -> dict[str, Any]:
    """Model responses sometimes wrap JSON in prose or a fenced block; salvage it."""
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fence_match.group(1) if fence_match else text
    brace_match = re.search(r"\{.*\}", candidate, re.DOTALL)
    if brace_match:
        candidate = brace_match.group(0)
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise LLMError(f"could not parse JSON from model response: {exc}") from exc


CLASSIFY_PROMPT = """You are a document intake classifier for a trucking \
compliance service company. Read the SOP below, then classify the document.

SOP:
{sop_text}

DOCUMENT:
{raw_text}

Respond with ONLY a JSON object, no prose, matching this shape:
{{"doc_type": "IFTA_QUARTERLY" | "IRP_RENEWAL" | "DOT_LETTER" | "UNKNOWN", \
"confidence": <float 0-1>, "reasoning": "<one sentence>"}}
"""

EXTRACT_PROMPT = """You are a document intake field-extraction agent for a \
trucking compliance service company. The document has already been \
classified as {doc_type}. Read the SOP below for the exact field list for \
this document type, then extract those fields from the document. If a \
field is not present in the text, set it to null — never invent a value.

SOP:
{sop_text}

DOCUMENT:
{raw_text}

Respond with ONLY a JSON object, no prose, matching this shape:
{{"fields": {{<field_name>: <value or null>, ...}}, "reasoning": "<one sentence>"}}
"""


@dataclass
class AnthropicLLMClient:
    model: str = field(
        default_factory=lambda: os.environ.get(
            "SKY_INTAKE_MODEL", "claude-haiku-4-5-20251001"
        )
    )
    max_tokens: int = 1024

    def __post_init__(self) -> None:
        import anthropic

        api_key = os.environ.get("SKY_INTAKE_LLM_API_KEY")
        if not api_key:
            raise RuntimeError(
                "SKY_INTAKE_LLM_API_KEY is not set — required for AnthropicLLMClient. "
                "Set it in backend/.env or use FakeLLMClient for offline runs."
            )
        self._client = anthropic.Anthropic(api_key=api_key)

    def _call(self, prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
        response = self._client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(
            block.text for block in response.content if block.type == "text"
        )
        raw = {
            "model": self.model,
            "prompt": prompt,
            "response_text": text,
            "usage": {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            },
        }
        return _extract_json_block(text), raw

    def classify_document(self, raw_text: str, sop_text: str) -> dict[str, Any]:
        prompt = CLASSIFY_PROMPT.format(sop_text=sop_text, raw_text=raw_text)
        parsed, raw = self._call(prompt)
        parsed["_raw_llm_call"] = raw
        return parsed

    def extract_fields(
        self, raw_text: str, sop_text: str, doc_type: str
    ) -> dict[str, Any]:
        prompt = EXTRACT_PROMPT.format(
            sop_text=sop_text, raw_text=raw_text, doc_type=doc_type
        )
        parsed, raw = self._call(prompt)
        parsed["_raw_llm_call"] = raw
        return parsed


class FakeLLMClient:
    """Deterministic stand-in for tests and offline demos.

    Uses simple keyword heuristics over the sample-doc corpus so the graph's
    control flow (routing, validation, urgency) can be exercised in CI
    without a network call. Real accuracy work happens in AnthropicLLMClient.
    """

    def classify_document(self, raw_text: str, sop_text: str) -> dict[str, Any]:
        text = raw_text.upper()
        if "IFTA" in text and "QUARTER" in text:
            doc_type = "IFTA_QUARTERLY"
        elif "IRP" in text or "APPORTIONED REGISTRATION" in text:
            doc_type = "IRP_RENEWAL"
        elif "FMCSA" in text or "OUT-OF-SERVICE" in text or "MCS-150" in text:
            doc_type = "DOT_LETTER"
        else:
            doc_type = "UNKNOWN"
        return {
            "doc_type": doc_type,
            "confidence": 0.95 if doc_type != "UNKNOWN" else 0.4,
            "reasoning": "keyword heuristic (FakeLLMClient)",
            "_raw_llm_call": None,
        }

    def extract_fields(
        self, raw_text: str, sop_text: str, doc_type: str
    ) -> dict[str, Any]:
        fields: dict[str, Any] = {}
        dot_match = re.search(r"USDOT\s*(?:Number|#)?:?\s*(\d{5,})", raw_text, re.I)
        fields["usdot_number"] = dot_match.group(1) if dot_match else None
        name_match = re.search(
            r"(?:Carrier|Registrant)(?:\s+Name)?:\s*(.+)", raw_text, re.I
        )
        fields["carrier_name"] = name_match.group(1).strip() if name_match else None
        due_match = re.search(
            r"(?:due(?: no later than| by)?|received by|response due by)"
            r":?\s*([A-Za-z]+ \d{1,2}, \d{4}|\d{1,2}/\d{1,2}/\d{4})",
            raw_text,
            re.I,
        )
        fields["due_date"] = due_match.group(1) if due_match else None
        if doc_type == "DOT_LETTER":
            fields["letter_type"] = (
                "out_of_service_order"
                if "OUT-OF-SERVICE" in raw_text.upper()
                else "mcs150_reminder"
                if "MCS-150" in raw_text.upper()
                else "other"
            )
            fields["response_due_date"] = fields.pop("due_date", None)
        return {
            "fields": fields,
            "reasoning": "regex heuristic (FakeLLMClient)",
            "_raw_llm_call": None,
        }


def build_llm_client(use_fake: bool | None = None) -> LLMClient:
    """Factory used by the graph builder and the API layer.

    `use_fake=None` reads SKY_INTAKE_FAKE_LLM from the environment so the
    same code path is used for `pytest` (fake, no cost) and `uvicorn`
    (real, unless explicitly overridden).
    """
    if use_fake is None:
        use_fake = os.environ.get("SKY_INTAKE_FAKE_LLM", "").lower() in (
            "1",
            "true",
            "yes",
        )
    if use_fake:
        logger.info("using FakeLLMClient (SKY_INTAKE_FAKE_LLM set)")
        return FakeLLMClient()
    return AnthropicLLMClient()
