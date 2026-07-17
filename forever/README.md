# ◎ Forever — an agent society that teaches like the best teacher you ever had

**Global AI Hackathon with Qwen Cloud · Track 3: Agent Society · AGPL-3.0**

Bring any material — a PDF with figures, a web article, notes, an image — and a society of
Qwen-powered AI teachers turns it into a **narrated, interactive Udemy-style course**: a tutor
that writes on a board in sync with its voice, **really executes** the code it teaches,
animates algorithms step by step from **real execution traces** (never imagined frames),
pauses for quizzes, proves every claim against your source — and lets the student edit and
run the lesson's code themselves in a sandbox.

## Architecture

```mermaid
flowchart LR
    subgraph Client["Next.js + React (player, studio, syllabus)"]
        UI[Course player<br/>one audio clock drives<br/>board · trace · subtitles]
    end
    subgraph Backend["Node.js backend (Alibaba Cloud ECS)"]
        API[API routes<br/>auth · jobs · courses · uploads · run]
        Q[(BullMQ queue<br/>Redis)]
        W[Worker<br/>concurrency N]
        SB[Docker sandbox<br/>real code execution<br/>--network none]
    end
    subgraph Society["The agent society (all Qwen on DashScope / Model Studio)"]
        R[🧭 Domain Router<br/>qwen flash]
        D[🎓 Dean<br/>course outline · qwen max]
        CI[👨‍🏫 Coding Instructor /<br/>📚 Teacher · qwen max]
        BD[🖊️ Board Director<br/>qwen plus]
        ET[⚙️ Execution Tracer]
        CR[💻 Code Runner]
        VW[🎙 Voice Writer]
        GA[🔍 Grounding Auditor<br/>qwen flash]
        PC[🎓 Pedagogy Critic]
        AR[⚖️ Arbiter verdict]
    end
    subgraph Data["Storage"]
        M[(MongoDB<br/>users · lessons · courses)]
        F[(OSS / static<br/>audio · images)]
    end
    UI -->|SSE progress| API --> Q --> W
    W --> R --> CI --> BD
    D --> CI
    BD <-->|objections / revisions| GA & PC --> AR
    ET --> SB
    CR --> SB
    W --> M
    VW --> F
    API -->|student "Try it" code| SB
```

**Task division:** every agent has ONE job (its own file under `lib/orchestration/agents/`).
**Dialogue & negotiation:** the Board Director proposes; the Grounding Auditor and Pedagogy
Critic object with evidence; the board revises; a bounded debate ends with an Arbiter verdict
— grounded-or-dropped, never fake. **Conflict resolution is structural too:** hand-authored
animation is stripped (the Execution Tracer, which ran the real algorithm, owns motion), and
a dry-run scene without a real trace refuses to ship.

## The universal dry-run engine — and who writes what

> **Compiler extracts. AI interprets. Validator proves. Resolver fills. Renderer draws.**

The AI never authors a runtime fact. For any coding problem the engine records ONE real
execution (`sys.settrace`: every line, local, call/return/exception) and **17 behavioral
detectors** pick the teaching lens from the run itself — DP grid with proved dependency rules,
graph walk with per-node state (Tarjan's disc/low riding under the nodes), heap, trie,
union-find, recursion tree, bitmask semantics, call-stack frames (Active/Waiting/Returned/
Threw). Regression battery: **64 problems, 0 errors, zero per-problem code** (a pass rate,
not a coverage claim — an unfamiliar shape degrades to a simpler-but-true view, never wrong).

On top of the trace sit four contracts (see `notes/16july.md` for the full locked design):
`ProblemStructureSpec` (typed ids: `graphNode:4`, `gridCell:1:2`) → `ExecutionTraceIR`
(typed events, structured formulas, frames) → `SemanticVisualSpec` (the **Semantic Visual
Director** — an AI that composes each problem's cockpit as **bindings**, validated
behaviorally against the recording; its hallucination attempts are rejected by name in the
shadow log) → `ResolvedVisualFrame` (a no-eval resolver fills bindings with recorded values).
Authority on any disagreement: **execution > structure > behavioral invariants > AI
interpretation > detector confidence.** Dev galleries: `/dev/lenses`, `/dev/cockpit`.

## The measurable gain (Track 3 requirement)

`eval/RESULTS.md` — regenerate with `node --env-file=.env eval/benchmark.eval.js`.
Two benchmarks, every number measured, none asserted:
- **Mechanical validators, N=4 matched coding materials** (`eval/society-vs-single.eval.mjs`):
  single agent — **0/4** hand-written dry runs pass the elite quality gate, 1/4 violates the
  structural contract, 0/4 screen values provably from a real run; society — 0 contract
  failures, 4/4 engine-recorded, 3–5× depth with logged objections/repairs/refusals.
- **Cross-domain blind rubric** (`eval/benchmark.eval.js`): contract validity, grounding,
  tokens, wall time, 7-criterion pedagogy judged in both presentation orders.

## What makes it different

| | Typical AI course tools | Forever |
|---|---|---|
| Algorithm animation | LLM-imagined frames or static diagrams | **ExecutionTrace from really-executed code**: active line, pointers riding the array, visited set, queue, trace table |
| Voice ↔ board sync | separate scripts drift | narration text **is** the trace step's explanation; the timeline is reconciled to the real audio — drift is structurally impossible |
| Trust | hallucinations shipped | every object cites its source chunk; an independent auditor blocks unsupported claims; figures carry "Source · page N" |
| Failure | silent degradation | honest: dropped scenes carry recorded reasons; no fallback content, ever |
| Student role | watching | **doing**: edit and run the lesson's code in the sandbox; quizzes pause the clock |

## Qwen Cloud / Alibaba Cloud usage (deployment proof pointers)

- **All models on Qwen Cloud (DashScope / Model Studio)** through one client:
  [`lib/qwen/client.js`](lib/qwen/client.js) — qwen3.7-max (planners, judge), qwen3.7-plus
  (board, vision), qwen3.6-flash (routing, auditing), qwen3-coder-plus (tracker programs),
  Qwen TTS adapter ([`lib/tts/providers/synthesize.js`](lib/tts/providers/synthesize.js)).
- Backend deploys on **Alibaba Cloud ECS**; records in **MongoDB (ApsaraDB-compatible)**;
  queue on **Redis (Tair-compatible)**; media to **OSS** behind the storage seams
  (`lib/storage/`).

## Run it

```bash
cd forever && npm install
cp .env.example .env       # set DASHSCOPE_API_KEY, MONGODB_URI, REDIS_URL, SESSION_SECRET
docker pull python:3.12-slim node:22-slim   # the code sandbox
npm run dev:all            # web + worker (worker restarts on code changes)
# open http://localhost:3000 → create an account → Studio → paste material → watch the society work
npm test                   # 660+ tests, no tokens spent
```

A full course fans out one queued job per lesson (parallel workers, live SSE progress per
lesson); scene generation inside a lesson is concurrency-bounded (`SCENE_CONCURRENCY`).
Set `DISABLE_TTS=1` to iterate without spending TTS credits — voicing later re-reconciles
the whole timeline to the real audio.

## Repository map

```text
app/                    routes: cover · login · dashboard · courses/[id] syllabus · course/[id] player · api/*
components/             course player (algorithm stage, panels, try-it editor) · dashboard shell
lib/
  orchestration/        the society: agents (planning/authoring/critics/coding/vision), review loop, messages
  generation/           lesson pipeline: briefs -> scenes -> timeline (bounded fan-out)
  board/                board contracts: objects, regions, diagrams, ExecutionTrace
  execution/            real code execution: docker/judge0 sandbox, trace parsing, run contract
  ingest/               pdf (MinerU + figures + page renders) · url · image
  source-pack/          chunking, source refs, focus packs, input dispatcher
  playback/             the one clock: audio-backed, reconciled timelines, action engine
  storage/              mongo/fs dual stores: lessons, courses, users, uploads, assets
  tts/                  qwen + elevenlabs adapters, word timings, gapless concat
eval/                   benchmark (society vs single agent) + live proof scripts
tests/                  660+ tests — contracts, agents (injected), engines, stores, e2e flow
```

Built for the Global AI Hackathon with Qwen Cloud (Track 3: Agent Society). AGPL-3.0.
