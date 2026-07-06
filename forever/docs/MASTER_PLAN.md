# Forever — Master Plan (the definitive, decision-complete roadmap)

Goal: a universal AI tutor that beats every Udemy/Coursera course and every YouTube
instructor, and for coding beats Striver — real, elite, production-grade, never
compromised. This is THE plan: every capability, how it's built, which tool, which agent,
priority, and status. Consolidates GAP_ANALYSIS + ADVANCED_TOOLS + POWER_ROADMAP.
Discipline: research → decide → one tested slice → commit. Never random code.

Status legend: ✅ done · 🟡 partial · ⬜ not started · 🔒 blocked

---

## PART 1 — CAPABILITIES (what makes it premium)

### 1. Multimodal PDF ingestion  — PRIORITY: VERY HIGH  — ⬜
The unlock from "text pasted" to "real learning-material → course".
- **How:** PDF → MinerU (text + figures + tables) + pdftocairo page-images → qwen3.7-plus
  VISION pass sees every page/figure (meaning, arrows, relations, bbox) → multimodal
  SourcePack (text chunks + image assets) → Teacher builds lessons that TEACH FROM the real
  figures (image board object + full-page overlay, tutor points at parts).
- **Tools:** MinerU (have key) · pdftocairo · qwen3.7-plus vision · new `image` renderHint.
- **Agents:** Librarian (ingest+vision), Archivist (embed text+captions).

### 2. Course structure (Udemy sidebar feeling)  — VERY HIGH  — 🟡 (contract only)
- **How:** wire the 3-tier contract into the UI: Course → Part/Section → Lesson → Scene →
  Quiz. Sidebar with sections, lesson durations, ✅ completion, next-lesson, section quiz.
- **Tools:** existing course-outline contract · new sidebar/nav components · progress store.
- **Agents:** Dean (plans Parts/Sections/Lessons + durations).

### 3. Deep narration + pacing  — HIGH  — 🟡 (deepened; needs Striver-grade)
- **How:** board stays short, voice goes deep: why → intuition → example → common mistake →
  recap. For coding: brute-force → better → optimal progression + dry-run trace tables.
- **Tools:** Teacher/Voice prompts (qwen3.7-max thinking) · trace-table tool.
- **Agents:** Teacher (pedagogy roles), Voice Writer (multi-line deep narration ✅).

### 4. Real diagrams / visual tools  — HIGH  — ⬜
Non-code subjects (science/history/math/business) need real visuals.
- **How:** a diagram engine renders flowchart, cycle, tree, timeline, cause-effect map,
  math equation, charts — as real SVG (rough.js shapes + dagre/elk auto-layout; KaTeX for
  math; charts from real executed code or SVG). New board object types + renderer support.
- **Tools:** rough.js · dagre/elk · KaTeX · matplotlib(headless)/SVG charts.
- **Agents:** Board Director (chooses diagram type per concept).

### 5. Code editor + real tools UI  — MEDIUM-HIGH  — 🟡 (display done)
- **Done:** dark editor panel, line numbers, syntax highlighting, output panel ✅; real
  execution (3-tier: Judge0/Docker/local) ✅; self-debug loop ✅.
- **Remaining:** dry-run trace table (variable states per step); interactive editing (Monaco
  + in-browser run) later.
- **Tools:** react-syntax-highlighter ✅ · Monaco (interactive) · execution engine ✅.

### 6. Quizzes, exercises, notebook  — HIGH  — 🟡 (contracts only)
- **How:** MCQ + section quiz that pauses the clock and grades; coding exercise (edit+run);
  notebook auto-compiled from board + PDF export; downloadable notes/code.
- **Tools:** quiz contract ✅ · notebook contract ✅ · PDF export (server render) · Monaco.
- **Agents:** Quiz Master (questions + worked answers + source-cited), Notebook Scribe.

### 7. Real voice  — ✅ DONE (ElevenLabs, word-synced). Polish: emphasis/pacing/persona ⬜.

---

## PART 2 — THE PRODUCTION MULTI-AGENT SYSTEM (what gives it life + wins Track 3)

### Agent society (the faculty)  — 🟡 (Board Director, Voice Writer, Grounding Auditor,
Arbiter, Teacher, Code Runner built; rest designed)
- Full roster: Librarian, Researcher, Archivist, Dean, Domain Router, Teacher, Board
  Director, Voice Writer, Code Runner, Quiz Master, Notebook Scribe, + Review Board
  (Grounding/Pedagogy/Sync/Clutter critics) + Arbiter + Timeline Compiler + Reconciler.
- Task division, typed blackboard messages, evidence-required objections, binding arbiter —
  contracts ✅, grounding loop live ✅.

### Orchestration — LangGraph + custom kernel + BullMQ  — ⬜ (sync now)
- **LangGraph.js**: the cyclic generate→critique→debate→repair loop per scene (research:
  cycles are LangGraph's purpose; agents critique+improve their own output).
- **Custom kernel**: deterministic fan-out, blackboard, message protocol (Track 3 core).
- **BullMQ + Redis(Tair)**: async per-scene jobs, retries, resumability. **SSE**: live
  progress → the Studio shows the faculty working (the demo money-shot).

### RAG / memory  — ⬜
- **pgvector (ApsaraDB RDS)**: embed text chunks + image captions (text-embedding-v4);
  semantic retrieval + reranking feeds every agent. Learner memory (quiz results →
  remediation) + rubric memory (arbiter verdicts → reusable heuristics).

### Native Qwen tools (advanced, in-ecosystem)  — ⬜
- `web_search` + `web_extractor` (URL/topic/Researcher) · `t2i_search`/`i2i_search` (topic
  images) · `code_interpreter` (numeric checks) · explicit prompt cache (5-10× cost cut) ·
  Structured Outputs (schema-enforced) · Function Calling.

### Storage + deploy  — 🟡 (fs seam) / ⬜
- RDS PostgreSQL+pgvector · OSS (audio/images/manifests/PDFs) · ECS/SAE (web+workers) ·
  Simple Log Service + token/cost ledger. Alibaba deploy + **proof recording** (submission).

### The benchmark (Track 3 clincher)  — ⬜
- `eval/`: same SourcePack through single mega-prompt vs the society; report validation pass
  rate, grounding coverage, sync errors, quiz answerability, cost, wall time. Numbers prove
  the society beats one agent.

---

## PART 3 — DEFINITIVE BUILD ORDER (impact-first, your priorities honored)

**WAVE 1 — every lesson becomes PREMIUM & world-class**
1. Deep teaching: brute→better→optimal + multiple examples + trace tables (Teacher/Voice).
2. Diagram engine + KaTeX (real visuals for all subjects).
3. Motion layer (draw arrows, slide-in, spotlight zoom) — the "real video" feel.
4. Pedagogy + clarity critics (consistent premium bar, like Coursera).

**WAVE 2 — real material → GIANT multimodal course** (your #1 + #2)
5. Multimodal PDF ingestion: MinerU + page-images + qwen3.7-plus vision + image board objects.
6. URL + YouTube + topic ingestion (web_extractor/web_search) + topic images (t2i_search).
7. Course structure wired: sidebar, Parts/Sections/Lessons, durations, progress, next-lesson.

**WAVE 3 — Udemy/Coursera parity + HACKATHON WIN** (your #6 + #7)
8. Quizzes (section quiz, pause+grade) + notebook + PDF export + downloads.
9. Interactive coding exercises (Monaco + execution).
10. LangGraph review cycle + full critic panel + BullMQ async + SSE live progress.
11. RAG (pgvector) + learner/rubric memory.
12. eval/ benchmark (society vs single agent).
13. Alibaba deploy (ECS/RDS/Tair/OSS) + proof recording + architecture diagram + 3-min demo.

**WAVE 4 — polish to elite**
14. Plots/charts · visual richness (braces, sticky notes, avatar) · voice persona/emphasis ·
    bookmarks/notes · reliability hardening (0 dropped scenes) · more input types.

---

## PART 4 — WHAT'S DONE vs REMAINING (honest tracker)
Done ✅: contracts + 116 tests · clock-driven seekable player · SVG board (flow layout, wrap)
· real code execution (3-tier) + editor panel + self-debug · deep multi-line narration ·
real ElevenLabs voice word-synced · grounding-debate society (partial) · API + Studio + home.
Remaining ⬜/🟡: everything in Waves 1-4 above — ~33 capability gaps + 10 advanced tools +
the production stack (LangGraph/BullMQ/RAG/native-tools/deploy/benchmark).

No compromise: each remaining item ships researched, tested, committed — elite or not at all.
