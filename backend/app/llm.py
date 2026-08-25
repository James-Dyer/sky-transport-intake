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
    if not candidate.strip():
        raise LLMError(
            "model returned empty content — for reasoning models this usually "
            "means the token budget was consumed by hidden reasoning tokens "
            "before any visible output; increase max_tokens or lower reasoning effort"
        )
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
this document type, then extract ONLY those fields from the document. If a \
field is not present in the text, set it to null — never invent a value.

Do not add any keys beyond the exact field list for {doc_type} given in the \
SOP. In particular, do not add missing_fields, needs_review, or \
deadline_flag — validating what's missing and deciding urgency is a \
separate step downstream from this one, not your job here.

The "never invent a value" rule applies to dates too: only fill in a date \
field if the document states an explicit calendar date for it. Do not \
calculate or infer a date from relative language (e.g. "within 5 business \
days" or "due 30 days from receipt") — leave the field null in that case \
rather than computing one.

SOP:
{sop_text}

DOCUMENT:
{raw_text}

Respond with ONLY a JSON object, no prose, matching this shape:
{{"fields": {{<field_name>: <value or null>, ...}}, "reasoning": "<one sentence>"}}
"""


class _ChatCompletionLLMClientBase:
    """Shared classify/extract logic for any provider that exposes a plain
    chat-style call. Subclasses implement only `_call` (send one prompt,
    return the parsed JSON dict plus a raw-call record for diagnostics);
    the prompts, JSON salvage, and response shape are provider-independent.
    """

    model: str

    def _call(self, prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
        raise NotImplementedError

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


def _require_api_key() -> str:
    api_key = os.environ.get("LLM_API_KEY")
    if not api_key:
        raise RuntimeError(
            "LLM_API_KEY is not set — required for a real LLM client. "
            "Set it in backend/.env, or set SKY_INTAKE_FAKE_LLM=1 for offline runs."
        )
    return api_key


@dataclass
class AnthropicLLMClient(_ChatCompletionLLMClientBase):
    model: str = field(
        default_factory=lambda: os.environ.get("MODEL_NAME", "claude-haiku-4-5-20251001")
    )
    max_tokens: int = 1024

    def __post_init__(self) -> None:
        import anthropic

        self._client = anthropic.Anthropic(api_key=_require_api_key())

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


@dataclass
class OpenAILLMClient(_ChatCompletionLLMClientBase):
    model: str = field(default_factory=lambda: os.environ.get("MODEL_NAME", "gpt-5-mini"))
    # gpt-5-mini is a reasoning model: hidden reasoning tokens are drawn from
    # the same max_completion_tokens budget as the visible answer, so a
    # budget sized for a "normal" chat model (e.g. 1024) can be fully
    # consumed by reasoning and leave zero tokens for actual JSON output.
    # 4096 plus a low reasoning-effort hint keeps output reliable for a
    # short-answer extraction task like this one.
    max_tokens: int = 4096

    def __post_init__(self) -> None:
        import openai

        self._client = openai.OpenAI(api_key=_require_api_key())

    def _call(self, prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
        response = self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=self.max_tokens,
            reasoning_effort="low",
        )
        text = response.choices[0].message.content or ""
        usage = response.usage
        raw = {
            "model": self.model,
            "prompt": prompt,
            "response_text": text,
            "usage": {
                "input_tokens": usage.prompt_tokens if usage else None,
                "output_tokens": usage.completion_tokens if usage else None,
            },
        }
        return _extract_json_block(text), raw


class FakeLLMClient:
    """Deterministic stand-in for tests and offline demos.

    Uses simple keyword heuristics over the sample-doc corpus so the graph's
    control flow (routing, validation, urgency) can be exercised in CI
    without a network call. Real accuracy work happens in the provider
    clients (AnthropicLLMClient / OpenAILLMClient).
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


PROVIDER_CLIENTS: dict[str, type[_ChatCompletionLLMClientBase]] = {
    "anthropic": AnthropicLLMClient,
    "openai": OpenAILLMClient,
}


def build_llm_client(use_fake: bool | None = None) -> LLMClient:
    """Factory used by the graph builder and the API layer.

    `use_fake=None` reads SKY_INTAKE_FAKE_LLM from the environment so the
    same code path is used for `pytest` (fake, no cost) and `uvicorn`
    (real, unless explicitly overridden). The real path is provider-neutral:
    `MODEL_PROVIDER` (default "anthropic") picks the SDK, `MODEL_NAME` picks
    the model, `LLM_API_KEY` authenticates — swapping providers is a .env
    change, not a code change.
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

    provider = os.environ.get("MODEL_PROVIDER", "anthropic").lower()
    client_cls = PROVIDER_CLIENTS.get(provider)
    if client_cls is None:
        raise RuntimeError(
            f"unknown MODEL_PROVIDER={provider!r}; supported: {sorted(PROVIDER_CLIENTS)}"
        )
    logger.info("using %s (MODEL_PROVIDER=%s)", client_cls.__name__, provider)
    return client_cls()
