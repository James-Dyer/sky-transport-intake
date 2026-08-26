# Sky Transport Intake Agent

A demo of an agentic AI pipeline automating a repeated standard task for a trucking-services company. Submitted for Sky Transport Solutions' **Sky Innovation** candidate project, **Automate** track.

<p align="center">
  <img src="docs/flowchart-demo.gif" alt="Agent flowchart demo" />
</p>

---

## The Problem

Sky Transport Solutions files compliance paperwork on behalf of trucking clients: IFTA fuel-tax filings, IRP plate renewals, DOT correspondence. Every incoming document currently needs a person to read it, figure out what type it is, pull out the right fields, and file it.

This is repeated, rules-driven work that eats staff time in small increments every day, and where a missed deadline has real consequences.

## The Idea

This project watches for incoming compliance paperwork, reads it, figures out what it is, and either files it automatically or flags it for a person to check, using an AI agent that checks its own work against the company's written procedures before it takes any action.

An agent receives a work ticket with a PDF attached, decides for itself which tools it needs, consults the company's "Standard Operating Procedure" manual for policy, and either files the document or routes it to a human, with the whole reasoning process streamed live into a diagram and a terminal-style log.

## The Implementation

- The agent gets a **toolbox** (search the SOP, read the PDF, record a classification, record extracted fields, validate, persist, notify a human) and decides the order and necessity of each step itself.
- The agent's work is checked against **deterministic rules**, so the LLM's judgment can inform the outcome, but cannot hallucinate "I validated this" and file bad data.
- The SOP itself, required fields per document type, urgency thresholds, escalation rules, lives in a markdown file the agent looks up via RAG, not logic baked into the prompt or the code.
- Everything the agent does streams live to the UI, so an employee watching it work can see *why* it made a decision, not just the final filed record.
- Records persist to SQLite.


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

Open the frontend, drag a sample ticket onto the agent hub, and watch it work.

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

**v1 → v2: from a fixed pipeline to a tool-calling agent, and what that briefly traded away.** The first version was a hand-built LangGraph pipeline with six fixed nodes in a fixed order, and its own hand-rolled provider-agnostic LLM client (an `LLMClient` protocol with separate Anthropic and OpenAI implementations). Rewriting to `create_react_agent`, where the agent chooses its own tool order, meant that custom client no longer fit: LangGraph's prebuilt agent expects a single LangChain `BaseChatModel`, not a project-specific interface. Rather than resurrect the custom protocol, `build_model()` now dispatches on `MODEL_PROVIDER` between two LangChain-native model classes (`ChatAnthropic` / `ChatOpenAI`) that both already satisfy that interface, restoring multi-provider support without re-inventing it. 

**Live-testing against a real model caught bugs that offline tests couldn't.** Before landing on the current prompt and validation logic, running the real model against every sample ticket surfaced three concrete failures I hadn't anticipated from reading the code:
- One reasoning model burned its entire output-token budget on hidden reasoning tokens and returned an empty extraction, invisible until responses came back blank. It's a reminder that a model's internal "thinking" competes with its visible answer for the same budget, and that's easy to miss when you're focused on getting the agent's tool-calling logic right.
- `usdot_number`, the SOP's primary key, came back as a JSON number from one provider and a string from another, silently breaking identity comparisons downstream. Now normalized to a string in one place ([tools.py](backend/app/tools.py)) rather than trusted to come back consistent.
- The model would sometimes leak validation-stage keys (`missing_fields`, `needs_review`) into its own extracted-fields output, and would occasionally compute a calendar date from relative language like "within 5 business days", something the SOP explicitly forbids guessing at. Both are now covered by regression tests (`test_agent_live.py`) and explicit prompt instructions.

**Future work**
- **The set of recognized document types is hand-synced across three places:** the SOP markdown, the `record_classification` tool's allowed-values list, and `validation.py`'s required-field map, despite the pitch being "the SOP is the single source of truth." Adding a real fourth document type today means remembering to update all three by hand.
- **`notify_human` is currently a stub that just logs a line.** A real version would hook into whatever channel Sky Transport's staff actually watch day to day, Slack, email, or a push notification, chosen based on how the team wants to be alerted rather than what's fastest to demo.
- **There's no auth on the API at all**, and CORS is opened to any localhost port for dev convenience, never meant to be exposed as-is. A production version would move to a proper zero-trust model: every service, tool call, and human touchpoint authenticated and authorized through enforced IAM policy.
- **Everything is single-process, in-memory state** (the SSE event queues, the token store), would need a real pub/sub backend to run on more than one process.

---

## Tech stack

- **Backend:** FastAPI, LangGraph (`create_react_agent`), LangChain, Claude (`claude-haiku-4-5`), Chroma (local embeddings), SQLite, SSE

- **Frontend:** React 19, React Flow (`@xyflow/react`), Vite, TypeScript, Vitest
