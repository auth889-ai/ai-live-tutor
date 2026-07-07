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

## The measurable gain (Track 3 requirement)

`eval/RESULTS.md` — regenerate with `node --env-file=.env eval/benchmark.eval.js`.
Same material through a **single mega-prompt agent** vs **the society**; every number is
measured, none asserted: contract validity (programmatic validators), grounding (the same
citation check on both arms), real token usage (client ledger), wall time, and a blind
7-criterion pedagogy rubric judged in **both presentation orders** (a win only counts if it
survives the swap).

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
npm test                   # 278 tests, no tokens spent
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
tests/                  278 tests — contracts, agents (injected), stores, e2e flow
```

Built for the Global AI Hackathon with Qwen Cloud (Track 3: Agent Society). AGPL-3.0.
