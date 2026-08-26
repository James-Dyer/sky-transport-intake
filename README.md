# Sky Transport Intake Agent

A demo of an agentic AI pipeline automating a repeated standard tasks for a trucking-services company. Submitted for Sky Transport Solutions' **Sky Innovation** candidate project, **Automate** track.

An agent receives a work ticket with a PDF attatched, decides for itself which tools it needs, consults the company's SOP manual for policy, and either files the document or routes it to a human, with the whole reasoning process streamed live into a diagram and a terminal-style log.

<p align="center">
  <img src="docs/flowchart-demo.gif" alt="Agent flowchart demo" />
</p>

---

## The Problem

Sky Transport Solutions files compliance paperwork on behalf of trucking clients: IFTA fuel-tax filings, IRP plate renewals, DOT correspondence. Every incoming document currently needs a person to: read it, figure out what type it is, pull out the right fields, and file it.
This is a repeated, rules-driven task. The type of work that eats staff time in small increments every day, yet where a missed deadline has real consequences.

## The Idea

Give the intake step to an agent, but don't hard-code the workflow into it. Instead of a fixed "read → classify → extract → file" script:

- The agent gets a **toolbox** (search the SOP, read the PDF, record a classification, record extracted fields, validate, persist, notify a human) and decides the order and necessity of each step itself.
- The agent's classification/extraction is checked against **deterministic, code-enforced rules** derived from the SOP, so the LLM's judgment can inform the outcome, but can't skip a required check.
- The SOP itself, required fields per document type, urgency thresholds, escalation rules, lives in a markdown file the agent looks up via RAG, not logic baked into the prompt or the code.
- Everything the agent does streams live to the UI, so a employee watching it work can see *why* it made a decision, not just the final filed record.

## The Implementation

**Backend:** FastAPI + [LangGraph](https://github.com/langchain-ai/langgraph)'s `create_react_agent`, running **Claude** (`claude-haiku-4-5` via `langchain-anthropic`) as the reasoning model by default, with an OpenAI (`langchain-openai`) option available via `MODEL_PROVIDER=openai`.

- The agent has 7 tools: `search_sop`, `read_pdf`, `record_classification`, `record_extraction`, `validate`, `persist`, `notify_human`. It plans its own sequence over these, the graph itself has no fixed node order.
- `search_sop` is backed by a small local RAG index: the SOP markdown is chunked by section and embedded with Chroma's bundled local embedding model (`all-MiniLM-L6-v2`), so the agent retrieves just the relevant policy section instead of the whole document being stuffed into every prompt.
- `validate` and `persist` are the one deliberately *non-agentic* part of the system: `validate` deterministically checks the agent's proposed classification/fields and mints a short-lived, single-use `unlock_token`; `persist` will refuse to write a record unless it's handed back that exact token for that exact `(doc_type, fields)` pair. This means the agent can reason freely, but cannot hallucinate "I validated this" and file bad data.
- Every agent step (a `Thought:` line or a tool call) is turned into an SSE event and a stored trace entry, so the UI animates in real time and every run's full reasoning trace is queryable afterward (`GET /api/runs/{run_id}`).
- Records persist to SQLite.

**Frontend:** React 19 + React Flow (`@xyflow/react`). A animated flowchart represents the agent and its tools, alongside a terminal-style log of the agent's `Thought:` lines. Tickets can be dragged onto the diagram to submit them.

### Running it

```bash
# backend
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # add an API key for your chosen provider, or set SKY_INTAKE_FAKE_LLM=1 for an offline run
.venv/bin/uvicorn app.main:app --reload --port 8811

# frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open the frontend, drag a sample ticket onto the agent hub, and watch it work. By default this runs on Claude; set `MODEL_PROVIDER=openai` in `.env` (plus `LLM_API_KEY` and optionally `MODEL_NAME`, e.g. `gpt-5-mini`) to run it on OpenAI instead.

Tests: `.venv/bin/pytest` (offline, uses the fake model). `.venv/bin/pytest tests/test_agent_live.py -v -s` (uses the configured live model's API)
## The Result

Six sample tickets exercise the range of behavior the SOP is meant to enforce:

| Ticket | Document | Outcome |
|---|---|---|
| 4821 | IFTA quarterly filing | Classified correctly, all required fields present → **auto-filed**, flagged urgent (due date inside the 14-day window) |
| 4822 | IRP renewal | Classified correctly → **auto-filed**, flagged urgent (due date inside the 30-day window) |
| 4823 | DOT out-of-service order | Classified correctly → **auto-filed**, flagged urgent regardless of date (per SOP); correctly leaves `response_due_date` null rather than inventing a date from "within 5 business days" |
| 4824 | MCS-150 reminder letter | Classified correctly → **auto-filed**, not flagged urgent |
| 4825 | IFTA filing missing USDOT number | Classified correctly, but missing the primary-key field → **routed to human review** rather than guessed |
| 4826 | Unrelated invoice | Correctly classified `UNKNOWN` → **routed to human review** rather than misfiled |

## The Learning

This went through one real architectural rewrite mid-build, and turned up a few concrete bugs and shortcuts.

**v1 → v2: from a fixed pipeline to a tool-calling agent, and what that briefly traded away.** The first version was a hand-built LangGraph pipeline with six fixed nodes in a fixed order, and its own hand-rolled provider-agnostic LLM client (an `LLMClient` protocol with separate Anthropic and OpenAI implementations). Rewriting to `create_react_agent`, where the agent chooses its own tool order, meant that custom client no longer fit: LangGraph's prebuilt agent expects a single LangChain `BaseChatModel`, not a project-specific interface. Rather than resurrect the custom protocol, `build_model()` now dispatches on `MODEL_PROVIDER` between two LangChain-native model classes (`ChatAnthropic` / `ChatOpenAI`) that both already satisfy that interface, restoring multi-provider support without re-inventing it. The real lesson wasn't "provider flexibility is gone", it's that provider flexibility should live in the same abstraction the agent framework already expects, not a parallel one layered on top.

**Live-testing against a real model caught bugs that offline tests couldn't.** Before landing on the current prompt and validation logic, running the real model against every sample ticket surfaced three concrete failures I hadn't anticipated from reading the code:
- One reasoning model burned its entire output-token budget on hidden reasoning tokens and returned an empty extraction. Token budgeting is a whole different beast than agentic graph management and context engineering. (kinda weak sentence here)
- `usdot_number`, the SOP's primary key, came back as a JSON number from one provider and a string from another, silently breaking identity comparisons downstream. Now normalized to a string in one place ([tools.py](backend/app/tools.py)) rather than trusted to come back consistent.
- The model would sometimes leak validation-stage keys (`missing_fields`, `needs_review`) into its own extracted-fields output, and would occasionally compute a calendar date from relative language like "within 5 business days", something the SOP explicitly forbids guessing at. Both are now covered by regression tests (`test_agent_live.py`) and explicit prompt instructions.

Prompt correctness isn't something you can fully verify by reading the prompt. It needed an actual live run against the real model to find real failure modes. This is the same as any other software, you can reason and predict, but running and iterating is the fastest way to fix bugs.

**Future work**
- **The urgency math is wall-clock relative to hardcoded sample-document dates.** The sample PDFs bake in fixed due dates; `validate()` compares them to `datetime.now()`. That's fine for a demo run today, but it's fragile: once a sample's due date passes, the "N days away" urgency reasoning text reads oddly for an overdue document, and the sample set will eventually need refreshed dates to keep demonstrating the same scenarios.
- **The set of recognized document types is hand-synced across three places:** the SOP markdown, the `record_classification` tool's allowed-values list, and `validation.py`'s required-field map, despite the pitch being "the SOP is the single source of truth." Adding a real fourth document type today means remembering to update all three by hand.
- **The `validate`/`persist` token handshake is a safety rail against the *agent*, not a security boundary.** It's an in-memory dict with a 2-minute TTL that doesn't survive a process restart, good enough to stop the LLM from hallucinating past a check, not a substitute for real authorization.
- **`notify_human` is a stub.** It logs a line; there's no actual Slack/email/ticketing integration behind it yet.
- **Everything is single-process, in-memory state** (the SSE event queues, the token store), fine for one demo instance, would need a real pub/sub backend to run on more than one process.
- **No auth on the API at all**, and CORS is opened to any localhost port for dev convenience, never meant to be exposed as-is.

---

## Tech stack

- **Backend:** FastAPI, LangGraph (`create_react_agent`), LangChain, Claude (`claude-haiku-4-5`), Chroma (local embeddings), SQLite, SSE
- **Frontend:** React 19, React Flow (`@xyflow/react`), Vite, TypeScript, Vitest
