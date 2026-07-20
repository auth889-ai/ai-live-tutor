# Devpost submission — Forever (Track 3: Agent Society)

Every claim below was checked against the code. Paste these into the Devpost fields.

---

## Project name (≤60 chars)
`Forever — an AI agent society that teaches your slides`

Alternatives: `Forever: AI tutor built by a society of Qwen agents` · `Forever — Agent-Society AI Tutor`

## Elevator pitch (≤200 chars)
`Upload any PDF or slides and a society of Qwen agents builds a narrated course: they divide the work, debate and cite sources, and run real code — so what you learn is provably correct.`

## Track
**Track 3 — Agent Society.**

## Repo URL
`https://github.com/auth889-ai/ai-live-tutor` — the project is in [`forever/`](https://github.com/auth889-ai/ai-live-tutor/tree/main/forever). Public, AGPL-3.0 (shown in the About section).

## Proof of Alibaba Cloud deployment
- **Code file:** `https://github.com/auth889-ai/ai-live-tutor/blob/main/forever/lib/qwen/client.js` — every model call goes to Qwen Cloud / Model Studio on Alibaba Cloud (DashScope compatible-mode endpoint). Also `forever/lib/qwen/vision.js` and `forever/lib/tts/providers/synthesize.js` (Qwen TTS).
- **Live deployment:** the app runs on an **Alibaba Cloud ECS** instance (`http://47.251.32.21:3000`), containerized per `forever/Dockerfile` + `forever/docker-compose.yml`; runbook in `forever/infra/deploy-alibaba-ecs.md`. Screenshot the running app + the ECS console for the proof.

## Architecture diagram
Two rendered Mermaid diagrams in the repo README (system + agent pipeline). Screenshot them for Devpost.

---

## Text description (features & functionality) — verified

**Forever turns your own study material into a course taught by a society of Qwen agents that divide the work, debate with evidence, and run real code — so what you learn is provably correct.**

**The problem.** Students pay for course subscription after subscription and finish almost none of them, then fall back on their own dense university slides and PDFs that are hard to understand alone. AI tools that promise to help usually ask one model to *imagine* a lesson — hallucinated facts, made-up animations, passive watching.

**What it does.** Upload a PDF, article, or a photo of a slide. A faculty of specialized Qwen agents turns it into a narrated, interactive course — a tutor that writes on a board in sync with a voice, animates algorithms from **really-executed code**, quizzes you, and cites every claim back to your source. It's open source and runs on your own Qwen usage, so there's no subscription.

**How the agent society works (Track 3).**
- **Task division** — each agent has one job, one file under `lib/orchestration/agents/`. A **Domain Router** classifies the material and picks **one** planner: a **Coding Instructor**, one of 14 domain **Teachers**, or a Universal Teacher. For a full course, a **Dean** first plans the episodes and fans out one job per lesson.
- **Dialogue & negotiation** — each scene is produced through a **real LangGraph review cycle** on a shared blackboard: a **Board Director** proposes the board; a **Grounding Auditor** (hard gate) and a **Pedagogy Critic** (advisory) review it in parallel and file objections *with evidence* (an objection without evidence is rejected); the Board Director revises.
- **Conflict resolution** — bounded by a round cap; if grounding objections survive, an **Arbiter** issues a binding verdict (with a strict-consensus fallback). Only the failed stage re-runs. A dry-run scene without a real execution trace refuses to ship — no fabricated animation.
- **Real execution** — for coding scenes, an **Execution Tracer** + **Code Runner** run the real algorithm in a sandbox (**Judge0 or Docker, network-isolated**); the program emits structured step events that drive the on-screen animation (active line, visited nodes, trace table). Students can edit and re-run the code in-browser.

**One model per job — all on Qwen Cloud (DashScope):**
- `qwen3.7-max` — Dean, Teacher, Coding Instructor, Arbiter (planning & verdicts)
- `qwen3.7-plus` — Board Director, Voice Writer, and page/slide vision
- `qwen3.6-flash` — Domain Router, Grounding Auditor, Pedagogy Critic
- `qwen3-coder-plus` — Execution Tracer, Code Runner

**Measured, not asserted (`eval/`):**
- On **4 matched coding problems** (Tarjan bridges, Dijkstra, bitmask BFS, an unseen problem), a single-agent baseline's dry runs **fail the elite quality gate on all 4**; the society ships **engine-executed traces with 0 contract failures**.
- In a **blind pedagogy rubric** (7 criteria, judged in both presentation orders), the **society wins (4 and 5 of 7); the single agent wins 0**.
- **Universal dry-run engine:** **63/64 (98%)** structural-elite across 64 LeetCode problems, **0 errors, zero per-problem code**.
- Honest tradeoff: the society spends far more tokens and time — the price of validation, real execution, and grounding.

**Production-shaped.** Next.js app + a separate **BullMQ** worker (the society) on **Redis**, **MongoDB** for records, **OSS** for audio/images, all deployed on **Alibaba Cloud ECS**. Honest failures (no fake fallbacks). ~**790 tests**.

**Bonus tools shipped:** **Focus Guard** (a Chrome extension where Qwen vision detects when you drift from studying and nudges you back), **Notebooks** (each lesson synthesized by a plan → write → review Qwen chain on `qwen3.7-plus`), **Progress** (spaced-repetition that shows what you're about to forget), and **Audio → Notes** (live transcription written into structured notes by Qwen).

**Stack:** Next.js/React · Node.js worker · BullMQ/Redis · Docker/Judge0 sandbox · MongoDB · **all agent intelligence on Qwen Cloud (DashScope / Alibaba Cloud Model Studio)**. (The tutor voice in the demo uses a TTS service; it's a supporting component — the agents are all Qwen.)

---

## 3-minute demo video
See the timed teleprompter script (course → let the tutor teach → Qwen model reveal → 50-second bonus). Record 1080p, upload to YouTube/Vimeo/Facebook, set Public.

## Devpost checklist
- [ ] Track: **Agent Society**
- [ ] Repo URL (public ✓, AGPL in About ✓)
- [ ] Alibaba Cloud proof: `forever/lib/qwen/client.js` + live ECS `47.251.32.21:3000`
- [ ] Architecture diagram (screenshot the README Mermaid)
- [ ] Video URL (public)
- [ ] This description
- [ ] (Optional) blog post
