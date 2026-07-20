# Devpost submission — Forever (Track 3: Agent Society)

Everything below is ready to paste into the Devpost form fields. Deadline: **Jul 20, 5:00pm EDT**.

---

## Track
**Track 3 — Agent Society.**

## Repo URL (code)
`https://github.com/auth889-ai/ai-live-tutor` — submission project is in the [`forever/`](https://github.com/auth889-ai/ai-live-tutor/tree/main/forever) directory. Public. AGPL-3.0 license (shown in the About section).

## Proof of Alibaba Cloud deployment (paste this file link)
`https://github.com/auth889-ai/ai-live-tutor/blob/main/forever/lib/qwen/client.js`
— every model call goes to Qwen Cloud on Alibaba Cloud (`dashscope-intl.aliyuncs.com/compatible-mode/v1`). Also see [`forever/lib/tts/providers/synthesize.js`](https://github.com/auth889-ai/ai-live-tutor/blob/main/forever/lib/tts/providers/synthesize.js) (Qwen TTS) and [`forever/lib/storage/`](https://github.com/auth889-ai/ai-live-tutor/tree/main/forever/lib/storage) (MongoDB/Redis/OSS seams for ECS).

## Architecture diagram
Rendered Mermaid diagram at the top of [`forever/README.md`](https://github.com/auth889-ai/ai-live-tutor/blob/main/forever/README.md#architecture) (GitHub renders it visually). If Devpost needs an image, screenshot that rendered diagram.

---

## Text description (features & functionality)

**Forever turns any material into a real, taught course — built by a society of Qwen agents that divide the work, argue with evidence, and refuse to ship anything they can't ground.**

Most "AI course" tools ask one model to imagine a lesson. Forever is a **multi-agent system** where each agent has exactly one job and they negotiate:

- **🧭 Domain Router** (qwen3.6-flash) picks the domain and pipeline.
- **🎓 Dean** (qwen3.7-max) writes the course outline; **👨‍🏫 Teacher / Coding Instructor** (qwen3.7-max) writes every student-facing explanation.
- **🖊️ Board Director** (qwen3.7-plus) stages the screen step by step — objects, regions, diagrams.
- **⚙️ Execution Tracer + 💻 Code Runner** run the *real* algorithm in a Docker sandbox (`--network none`) and record the true trace: active line, pointers riding the array, visited sets, queues, trace tables. Animation comes from really-executed code, never from an LLM guessing frames.
- **🔍 Grounding Auditor** (qwen3.6-flash) and **🎓 Pedagogy Critic** object with cited evidence; the board revises; a bounded debate ends with an **⚖️ Arbiter** verdict — grounded-or-dropped.
- **🎙 Voice Writer** narrates; the narration text *is* the trace step's explanation, so voice and board can't drift.

**Why it's a real Agent Society (Track 3):**
- *Task division* — one job per agent, each its own file under `lib/orchestration/agents/`.
- *Dialogue & negotiation* — critics raise objections with evidence; the board answers or revises; conflicts resolve through a bounded, logged debate.
- *Conflict resolution is structural* — hand-authored motion is stripped so the real trace owns animation; a dry-run scene without a real trace refuses to ship (honest failure, no fallback fabrication).
- *Measurable efficiency gain* — on 4 matched coding materials, a single agent passes **0/4** the elite quality gate (1/4 breaks the structural contract, 0/4 provably from a real run); the society passes **4/4** with 0 contract failures, engine-recorded traces, and 3–5× depth with logged objections/repairs. Reproducible via `eval/society-vs-single.eval.mjs`.

**For the student, it's not watching — it's doing:** edit and run the lesson's code in the sandbox; quizzes pause the audio clock; every on-screen fact cites its source chunk ("Source · page N").

**Bonus features shipped:** a Chrome extension **Focus Guard** (Qwen vision detects when you drift from studying and writes a specific, goal-aware nudge to pull you back) and **Audio → Notes** (live in-class transcription → Qwen-structured study notes in a flippable book).

**Stack:** Next.js/React · Node.js worker + BullMQ/Redis · Docker code sandbox · MongoDB · **all intelligence on Qwen Cloud (DashScope / Alibaba Cloud Model Studio)**. 660+ tests, no tokens spent.

---

## 3-minute demo video script (record on YouTube/Vimeo/Facebook, make public)

**0:00–0:20 — Hook.** "This is Forever. Give it any material and a *society* of Qwen agents builds a course that actually teaches — and refuses to make anything up." Show the landing page.

**0:20–0:50 — Input → society runs.** In Studio, paste a PDF/article. Show the live SSE progress: Router → Dean → Instructor → Board Director, then the critics. Point at the agent names as they light up.

**0:50–1:40 — The negotiation (the Track-3 core).** Open the run log: show a Grounding Auditor **objection with a citation**, the Board **revising**, and the Arbiter **verdict**. Then show a scene that was **dropped** for an honest reason. Say: "No single model does this — the disagreement is the quality control."

**1:40–2:20 — Real execution, not imagined.** Play an algorithm lesson: pointer riding the array, visited set filling — narrate that this motion is from **really-executed code in a sandbox**, and the voice line *is* the trace step. Then click "Try it," edit the code, run it live.

**2:20–2:45 — Measurable gain.** Show `eval/RESULTS.md`: single agent 0/4 vs society 4/4, 3–5× depth. "Measured, not asserted."

**2:45–3:00 — Alibaba Cloud + close.** Show `lib/qwen/client.js` with the DashScope endpoint. "Every model call runs on Qwen Cloud. Track 3: Agent Society." End on the course player.

---

## Devpost form checklist
- [ ] Track: **Agent Society**
- [ ] Repo URL: `https://github.com/auth889-ai/ai-live-tutor` (public ✓, AGPL license in About ✓)
- [ ] Alibaba Cloud proof link: `.../forever/lib/qwen/client.js`
- [ ] Architecture diagram: link/screenshot of `forever/README.md` Mermaid
- [ ] Video URL (YouTube/Vimeo/Facebook, public)
- [ ] Text description: paste the section above
- [ ] (Optional) blog post URL for the Blog Post Prize
