# Devpost submission — Forever (Track 3: Agent Society)

Every claim below was re-verified against the code on 2026-07-20 (three independent code
audits + a live test run + a live probe of the ECS deployment). Paste straight into Devpost.

---

## Project name (≤60 chars)

`Forever — an AI agent society that teaches your slides`

Alternatives: `Forever: a society of Qwen agents that really teaches` · `Forever — Agent-Society AI Tutor`

## Elevator pitch (≤200 chars)

`Upload any PDF or slides and a society of Qwen agents builds a narrated course: they divide the work, debate and cite sources, and run real code — so what you learn is provably correct.`

(186 chars)

## Track

**Track 3 — Agent Society.**

## Repo URL

`https://github.com/auth889-ai/ai-live-tutor` — the project is in
[`forever/`](https://github.com/auth889-ai/ai-live-tutor/tree/main/forever). Public, AGPL-3.0
(`"license": "AGPL-3.0-or-later"` in package.json, LICENSE in repo).

## Proof of Alibaba Cloud usage

- **Code file:** `forever/lib/qwen/client.js` — the single door for every model call:
  DashScope compatible-mode endpoint (`dashscope-intl.aliyuncs.com/compatible-mode/v1`),
  per-agent token usage ledger. Also `forever/lib/qwen/vision.js` (page/slide vision) and
  `forever/lib/tts/providers/synthesize.js` (Qwen3-TTS adapter, `qwen3-tts-flash`).
- **Live deployment:** Alibaba Cloud ECS at `http://47.251.32.21:3000` (probed HTTP 200 on
  2026-07-20), containerized per `forever/Dockerfile` + `forever/docker-compose.yml`;
  runbook `forever/infra/deploy-alibaba-ecs.md`, one-command `forever/infra/deploy.sh`.
  Screenshot the running app + the ECS console for the proof images.

## Architecture diagram

Two rendered Mermaid diagrams in the repo README (system + agent pipeline). Screenshot them.

---

# About the project (Devpost "Project details" — paste the sections below)

## Inspiration

Students pay for course subscription after subscription and finish almost none of them — then
fall back on their own dense university slides and PDFs that are impossible to understand
alone. The AI tools meant to help just ask one model to *imagine* a lesson: hallucinated
facts, made-up animations, passive watching. We wanted the opposite: a teacher you can
**check** — where every animation comes from code that really ran, and every claim points at
your own source.

## What it does

Bring any material — a PDF with figures, a web article, pasted notes, a photo of a slide —
and a **society of Qwen-powered AI teachers** turns it into a narrated, interactive,
Udemy-style course:

- A **Dean** plans the episodes and lessons; each lesson is built by its own crew of agents,
  streamed live to the Studio over SSE so you watch the faculty debate as it works.
- The tutor writes on a board **in sync with its voice** (one audio clock drives board, code,
  subtitles, and quizzes — quizzes pause the clock until you answer).
- **The signature feature:** algorithms are animated from **really-executed code**. The
  engine runs the algorithm in a network-isolated sandbox, records structured step events,
  and drives the screen from that recording — active line, pointers riding the array, visited
  sets, a step-by-step trace table. A dry-run scene that cannot produce a real execution
  trace **refuses to ship** (`generate-scene.js` throws — no fabricated animation, ever).
- Real figures are lifted from your PDF (MinerU: figures, tables, LaTeX, page renders) and
  shown with a "Source · page N" stamp; an independent auditor blocks unsupported claims.
- The student **does, not watches**: edit and re-run the lesson's code against the server
  sandbox, or entirely in the browser (real CPython on WebAssembly via Pyodide in a Web
  Worker).
- Learning sticks: SuperMemo-2 spaced repetition with a forgetting-curve view, bookmarks that
  capture the exact second and teaching context, and notebooks that write back (grounded
  notes, quizzes, dry runs).

It's open source (AGPL-3.0) and runs on **your own Qwen usage** — no subscription.

## How we built it — the agent society (Track 3)

**Task division.** Each agent is one job in one file under `lib/orchestration/agents/`:
a **Domain Router** classifies the material and picks exactly ONE planner — the **Coding
Instructor**, one of **15 specialist domain Teachers** (math, physics, chemistry, biology,
ML/AI, agents/RAG, databases, networking, OS, architecture, SRS, SQA, history, law,
economics), or the **Universal Teacher**. For a full course, the **Dean** plans episodes and
fans out **one queue job per lesson** (BullMQ on Redis when `REDIS_URL` is set; an in-process
queue otherwise), so lessons generate in parallel across workers.

**Dialogue & negotiation.** Every scene's board goes through a **real LangGraph
`StateGraph`** (`lib/orchestration/review/grounding-review-loop.js`): the **Board Director**
proposes; a **Grounding Auditor** (hard gate) and a **Pedagogy Critic** (advisory) audit in
parallel; the Director revises against their objections. The blackboard is an append-only
log of six typed message kinds — proposal, objection, evidence, revision, verdict, handoff —
and an objection with no evidence is **rejected by code** ("no evidence, no objection").

**Conflict resolution.** Debate is bounded by `MAX_DEBATE_ROUNDS` (default 3). If grounding
objections survive at the cap, the **Arbiter** issues a **binding verdict** — the message
schema itself enforces that only the Arbiter may issue verdicts and that verdicts are
binding — with a strict-consensus fallback (every objected object is removed) if the
Arbiter's own call fails. Only the failed stage re-runs.

**Real execution.** For coding scenes, the **Execution Tracer** + **Code Runner** write and
run the real program in the sandbox (Judge0, or Docker with `--network none --memory 256m
--cpus 1 --pids-limit 128`). The traced run emits step events; **15 behavioral detectors**
then pick the teaching lens from the recording itself — DP grid, graph walk with per-node
state (Tarjan's disc/low riding under the nodes), heap, trie, union-find, recursion tree,
linked list, intervals, and more — with **zero per-problem code**. Authority on any
disagreement: execution > structure > behavioral invariants > AI interpretation.

**One model per job — all agent intelligence on Qwen Cloud (DashScope):**

| Agents | Model |
|---|---|
| Dean · 15 Teachers · Coding Instructor · Arbiter | `qwen3.7-max` |
| Board Director · Voice Writer · page/slide vision | `qwen3.7-plus` |
| Domain Router · Grounding Auditor · Pedagogy Critic | `qwen3.6-flash` |
| Execution Tracer · Code Runner | `qwen3-coder-plus` |

Every call goes through one client (`lib/qwen/client.js`) with a per-agent token ledger.

## Challenges we ran into

- **Making "no hallucinated animation" structural, not aspirational** — the fix was a hard
  gate: a dry-run scene without a real ExecutionTrace throws instead of shipping, and
  hand-authored traces are stripped by the validator.
- **One lens for 4,000 problems** — instead of per-problem visualizers, we built
  record-once/detect-later: one real execution, then behavioral detectors choose the view.
  Adversarial rounds on unseen algorithms (8-node Tarjan, Prim's MST) exposed mis-lens bugs
  (a DP fingerprint out-ranking graph evidence) that are now impossible by construction.
- **Keeping debates honest** — evidence-required objections and an arbiter that only exists
  for deadlocks; otherwise critics would either rubber-stamp or filibuster.
- **Production reality** — slow regional model pools, per-scene concurrency, worker fan-out,
  honest failure recording for dropped scenes, and timeline reconciliation so voice and board
  can't drift.

## Accomplishments we're proud of (measured, not asserted — `eval/`)

- **Mechanical validators, 4 matched coding problems** (`eval/society-vs-single.eval.mjs`,
  results JSON in repo): the single-agent baseline's hand-written dry runs fail the elite
  quality gate on **all 4** (e.g. "0 steps carry pointers") and ship 1 structural contract
  violation; the society's traces show **0 contract failures across all 4**.
- **Blind pedagogy rubric** (`eval/RESULTS.md`): 7 criteria judged in BOTH presentation
  orders — the society wins **4 and 5 of 7**; the single agent wins **0**.
- **Universal dry-run engine**: **63/64 (98%) structural-elite, 0 errors, zero per-problem
  code** on the 64-problem LeetCode battery (2026-07-15 run; the battery has since grown to
  68 problems). The single floor case is Euclid's GCD — pure arithmetic with no structure to
  draw.
- **793 passing tests** (`npm test`, no tokens spent).
- **Honest tradeoff, reported plainly:** the society spends far more tokens and wall-time
  than a single agent (e.g. 224k vs 7.4k tokens on one benchmark topic) — that is the price
  of validation, real execution, and grounded debate.

## What we learned

A single model asked to "make a lesson" will confidently fabricate the parts students trust
most — the animations and the numbers. The gains came from **structure**: one agent per job,
critics that must attach evidence, a gate that prefers honest failure over plausible output,
and an execution engine so the screen shows what the code *did*, not what a model *imagined*.

## What's next

Progressive playback (play scene 1 while the rest generate), swapping the media seam to
Alibaba OSS (the code already writes through one seam), a persistent accumulating board, and
richer non-coding visual engines.

## Bonus tools shipped

- **Focus Guard** — a Chrome (MV3) extension + companion server: Qwen vision
  (`qwen3.7-plus`) classifies whether your current page/screenshot matches your study goal
  and writes a specific nudge to pull you back.
- **Audio → Notes** — live in-class transcription (browser speech recognition, or
  faster-whisper for uploads) that Qwen structures into clean study notes.
- **Notebooks** — a LangGraph synthesis chain (retrieve → plan → evidence gate → parallel
  self-citing writers → reviewer) that turns saved moments into grounded, cited pages.
- **Progress** — SM-2 spaced repetition, forgetting curves, streaks, awards.

## Built with

Next.js 16 · React 19 · Node.js · BullMQ + Redis · MongoDB · LangGraph
(`@langchain/langgraph`) · Docker / Judge0 sandbox · Pyodide (CPython/WASM) · MinerU (PDF) ·
**all agent intelligence on Qwen Cloud / Alibaba Cloud Model Studio (DashScope)**:
`qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-flash`, `qwen3-coder-plus` · deployed on Alibaba
Cloud ECS.

*Voice note (honest):* the codebase ships a **Qwen3-TTS adapter (`qwen3-tts-flash`) as the
code default**; the demo deployment sets `TTS_PROVIDER=elevenlabs` for built-in word-level
timestamps that drive the karaoke subtitles. All reasoning/agents are Qwen.

---

## 3-minute demo video

See the timed teleprompter script (course → let the tutor teach → Qwen model reveal →
50-second bonus). Record 1080p, upload to YouTube/Vimeo, set Public.

## Devpost checklist

- [ ] Track: **Agent Society**
- [ ] Repo URL (public ✓, AGPL ✓)
- [ ] Alibaba Cloud proof: `forever/lib/qwen/client.js` + live ECS `47.251.32.21:3000`
- [ ] Architecture diagram (screenshot the README Mermaid)
- [ ] Video URL (public)
- [ ] This description
- [ ] Thumbnail: 3:2 image — use `screenshots/06-dryrun-dijkstra-graph.png` or `01-home.png`
