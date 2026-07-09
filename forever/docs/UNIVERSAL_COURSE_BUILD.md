# Universal Course Engine — How To Build (research-backed)

Written 2026-07-09. Source: 9 web-research agents (multi-agent course systems, GitHub
survey incl. OpenMAIC internals, domain visual grammar, pedagogy quality gates, RAG
design, production architecture, PDF-figure pipelines; teacher-style research pending —
see §10). Working notes: `notes/noncoding-elite-plan.md` (repo root). Status: **approved
research, build not started — user approves each step before code.**

## 0. The product in one sentence

ONE universal machine: **any PDF/topic in → elite multi-scene voiced course out** — the
user never picks a subject; the Domain Router detects it and the same engine adapts.

## 1. Hard boundaries (never violate)

- **Never touch coding-course files** — another Claude terminal owns them:
  `lib/execution/trace/**`, `lib/orchestration/agents/coding/**`,
  `lib/orchestration/agents/planning/coding-instructor.js`, and any files dirty in git.
- Shared files (`generate-lesson.js`, `board-objects.js`, player) — additive edits only.
- One agent one job; no god files; nested folders; everything real/dynamic (no fallback
  content); research before design; build one step at a time.
- All agent intelligence = **Qwen** (hackathon proof file `lib/qwen/client.js`).
  RAG embeddings = **another AI** (user decision): local Transformers.js +
  bge-small-en-v1.5 recommended (no key, no cost, region-free); Gemini/Jina = fallback
  options. DashScope embeddings are Singapore-only — ruled out.

## 2. Why this beats a Udemy/Coursera video (the honest claim)

Not on hours — on enforced teaching mechanics a fixed video can't guarantee:
1. Built from **the student's own material**, every claim with source proof.
2. **Visible referent enforced by schema**: every narration line highlights its exact
   board element at the moment it's spoken (Mayer temporal contiguity d≈1.30 +
   signaling — the strongest known multimedia effects).
3. Diff-based **steppable visuals** (nothing pre-populated; one change per beat).
4. **Misconception named + refuted** (meta-analytic g=0.41) and **retrieval checkpoint
   before the answer reveal** (top-2 learning technique) — gate-enforced.
5. Regenerable per source/level; student edits code / re-traces; quizzes graded.

Claim for judges: "a top-1% lesson generated from YOUR document" — never "58h in a click".

## 3. Architecture (one pipeline, data-pack specialization)

```
ANY input (PDF/topic/URL/image)
  → INGEST: MinerU → text chunks + FigureAssets {image, caption, page, bbox}
  → DOMAIN ROUTER (exists) → selects a DATA PACK (data, not new agents):
      blueprint (beat sequence) + genre skeleton + critic rubric block + visual grammar
      unknown subject → 'general' pack (universality guarantee — no PDF produces nothing)
  → DEAN (exists): modules/lessons w/ durations  → one BullMQ job per lesson (exists)
  → TEACHER (exists, upgraded): specialist via injected blueprint; MUST plan a
      teach-from-figure scene when captioned figures exist
  → BOARD DIRECTOR (exists, upgraded): fills genre skeleton (edit-based > blank canvas);
      emits steppable objects {scene, steps:[{add, diff, highlight, ghost}]}
  → DETERMINISTIC GATE (new, zero tokens) → targeted repair, max 2 rounds
  → CRITICS (exist, + domain rubric blocks; independent, verdicts-only, no debate)
  → ARBITER → VOICE (ElevenLabs word-sync, exists) → PLAYER (exists + step-player)
  → EVAL: TeachQuiz (fresh model answers quiz from rendered lesson) → eval/RESULTS.md
```

Key research law: **specialists live in DATA, not more agents** — 37% of multi-agent
failures are inter-agent context loss (MAST); panels of independent critics beat debate.
14 courses = 1 engine + 14 data packs (~a day each, added AFTER the engine).

## 4. The universal step grammar (one schema, all subjects)

Every elite teaching visual (TCP arrows, Gantt ticks, tangent lines, IRAC reveals,
curve shifts, register flashes) is the SAME shape:
```
{ scene: <declared once: actors/axes/table/registers/curves>,
  steps: [{ add, diff: [{target, old, new}], highlight: [ids], ghost: [ids],
            narration (terms color-linked to highlights) }] }
```
Per-domain grammars (full detail in notes/noncoding-elite-plan.md §visual grammar):
networking = lifelines + state badges + packet-card field flashes; math = tangent +
substitution ledger in lockstep; physics = PhET breadcrumb + vector decomposition;
OS = 3 synced panels (Gantt/queue chips/table); ML = morphing boundary heatmap, 2-line
loss curve, confusion-matrix highlight-geometry; history = TimelineJS navigator+card;
law = IRAC 4-row reveal + fact↔element wiring; econ = ghost-curve 4-beat shift.

## 5. BUILD ORDER (approve each step; each independently verifiable)

### Step 1 — Deterministic lesson gate + validate-before-TTS   ← START HERE
Zero tokens; biggest measured win in the literature (compliance 0.47→0.94).
- New `lib/generation/gate/` (pure, unit-tested): every voiceLine refs an existing board
  object AND every object is referenced (coherence); narration word caps + ≤2 questions
  per check-in (TeachLM lint); required beats present (concrete example, misconception,
  checkpoint, recap); scene has ≥1 board object (fixes known motivate/recap empty-board
  bug); numbers/entities string-match source before LLM sees them.
- Failure → targeted repair prompt (name failing element/beat), smallest scope first
  (element → scene), max 2 rounds. Never TTS a scene that fails the gate.

### Step 2 — PDF-figure teaching pipeline (beats OpenMAIC)
OpenMAIC (19.5k★) CANNOT do region-level figure teaching — vision only places images;
spotlight targets whole elements; their percentage-spotlight machinery exists UNUSED.
- 2a `unpack-mineru.js`: parse `content_list.json` (currently ignored!) → figures get
  {id, path, caption[], page_idx, bbox 0-1000}. Keep glob fallback.
- 2b NEW `agents/vision/ground-figure.js`: Qwen-VL grounding ("locate every instance…
  {"bbox_2d":[x1,y1,x2,y2],"label"}"), /1000 → fractional bbox (image-content.js already
  validates this); clip/reject/retry-once; honest failure → whole-image spotlight only.
- 2c NEW `agents/authoring/figure-teaching-director.js`: figure + regions + brief →
  steps [{regionKey, action: highlight|circle|zoom, voiceLine}] (orient → region walk →
  relationships → misconception → checkpoint). Gate: step.regionKey MUST exist.
- 2d Player FigureStage: SVG overlay viewBox="0 0 1 1"; highlight = translucent fill;
  circle = stroke-dashoffset ellipse; zoom = CSS scale/translate to bbox+10% pad 800ms;
  spotlight-dim rest (OpenMAIC mask-cutout pattern); fired from the word-sync timeline
  (visual lands as its sentence starts).
- Copy from OpenMAIC: image-ID indirection ("src":"img_1" only; post-pass substitutes,
  UNKNOWN ID → element deleted); aspect-ratio-as-text + height=width/ratio rule.
- Teacher rule: captioned figures present → ≥1 figure scene planned.
- Verify: /dev/gallery fixture w/ real PDF figure → headless-Chrome screenshot → Read PNG.

### Step 3 — Strong 'general' blueprint + course-shape upgrade
Deepen `domain-teaching.js` 'general' into the full 9-beat spine so ANY pdf is elite
before specialist packs exist; Dean gets the course-shape spec (§10 research: lesson
length targets, checkpoint cadence, quick-win-in-lesson-1). Prompts/data only.

### Step 4 — Caches + prompt-prefix discipline
- Qwen implicit context cache: stable prefix (system prompt/schema/few-shots, identical
  order) first, variable tail last → hits billed at 20% of input price. Free win.
- Exact-match response cache: hash(pdfContentHash+pipelineVersion+agent+promptVersion)
  → Redis/Mongo; doubles as retry idempotency. NEVER semantic caching for generation.
- TTS cache: hash(text+voiceId+modelId+format+settings) → check before ElevenLabs.

### Step 5 — Retrieval (RAG) + grounding upgrade
- BM25 tool: MiniSearch in-process over chunks, index cached in Redis (~50 lines) →
  society-visible `search_document(query)` tool.
- Local embeddings (the "another AI"): Transformers.js + bge-small at ingest; vectors in
  Atlas; brute-force cosine (<500 chunks); hybrid = BM25 + cosine via RRF.
  Serves: in-player Q&A, multi-doc, cross-scene consistency. Lesson GENERATION stays
  full-context + focusChunkIds (NotebookLM's exact pattern — do not change).
- Quote grounding: scenes emit verbatim sourceQuote per key claim; deterministic
  string/fuzzy verify; LLM entailment check on matched snippet for important claims
  (fuzzy alone can be vacuous: 0.997 match / 0.11 entailment measured).

### Step 6 — Steppable chart + concept-sequence primitives
- renderHint 'chart' (custom SVG, NOT Mermaid xychart — no legends, zero-baseline bug):
  function plot, loss curve, supply-demand shift w/ ghost, histogram.
- Step grammar on existing renderers: sequence-stepper (TCP/DNS), derivation ledger
  (KaTeX substitution), timeline navigator, IRAC row-reveal, Gantt ticker.
- Verify each via /dev/gallery + screenshot loop (same as coding engines).

### Step 7 — Domain packs, one subject at a time
Per domain: blueprint (beats + primitives per beat) + genre skeleton (Board Director
fills, not invents) + critic rubric block (4–6 binary items w/ evidence pointers, run
INSIDE Pedagogy Critic, not a new agent; deterministic checks first — recompute numbers,
SymPy-style step checks). Order by demo value: systems/networking → ml_ai → math →
business → law → history → science. Each ships only after: showcase lesson generated →
screenshot verified → TeachQuiz scored into eval/RESULTS.md.

### Step 8 — Observability + cost controls
Langfuse Cloud free tier (trace per lesson, span per agent call; OTel GenAI attribute
names; dual-write ledger to Mongo — extend existing usage ledger); Bull Board;
per-user lessons/day quota + ONE global daily spend cap flag in Redis.

### Later (post-hackathon)
CDN + OSS URL signing, LiteLLM budgets, 429 circuit breaker, explicit cache_control,
BullMQ→Inngest only if flows outgrow trees, Atlas Vector Search at scale, Set-of-Mark
fallback for dense figures, notebook export.

## 6. Per-domain critic rubric blocks (summary)

- Math: every step justified, no skipped step, worked-example-before-you-try, answer
  substituted back, wrong step named+refuted.
- Networking: canonical step-list containment in order; every arrow has sender/receiver/
  purpose; ≥1 failure branch; concrete IPs/ports before abstraction.
- Law: IRAC all 4 in order; every rule element applied to a fact; counterargument;
  no fact outside scenario; authority qualifier.
- Business: derived figures recompute; units consistent; numbers trace to source or
  flagged assumption; decision cites a computed number; one sensitivity beat.
- Universal adds: misconception+refutation, retrieval-before-reveal, concrete-first,
  answer-not-revealed-early, signaling (narrated element is highlighted).

## 7. Off-list subjects (universality guarantee)

Router falls back to 'general' on any doubt (already in code). General blueprint = the
9-beat spine on universal primitives; figure pipeline works for every subject equally;
gate enforces quality regardless of domain. 9 domains get specialist-grade; everything
else gets a genuinely good universal teacher. A recurring off-list topic later = one new
data pack, not a rebuild.

## 8. Verification habit (permanent)

SEE→SEARCH→USE-RESULT→CODE→VERIFY. Screenshot via headless Chrome (PORT=3939, perl
'alarm N' timeout — macOS has no `timeout`; Read the PNG). /dev/gallery?i=&p= renders
real fixtures. Unit tests for every pure module (gate, compilers, view-models).

## 9. Key sources (full URL lists in notes/noncoding-elite-plan.md)

OpenMAIC (THU-MAIC), Code2Video (planner ablation −41pts; aesthetics↔learning r=0.97),
TheoremExplainAgent, Paper2Video (cursor grounding), PPTAgent (edit-based), LearnLM
rubric + binary autoraters, MAST failure taxonomy, Self-Refine (2-round plateau),
deterministic-verifier study (0.47→0.94), Mayer principles, Dunlosky retrieval practice,
refutation-text meta-analysis, MinerU output docs, Qwen3-VL grounding cookbook,
NotebookLM architecture teardowns, BullMQ production guides, Langfuse/OTel GenAI.

## 10. COURSE SHAPE SPEC (numbers for the Dean — from top-MOOC research, sourced)

Evidence base: Guo/Kim/Rubin 2014 (6.9M edX sessions), Szpunar 2013 PNAS interpolated
testing, Oakley's own npj Science of Learning design post-mortem, Angela Yu / Schmedtmann
/ Steele / Portilla / Neagoie / Schwarzmüller course analyses, Udemy quality checklist,
CS50 "Reinventing CS50" paper. Full URLs in notes/noncoding-elite-plan.md session logs.

- Modules: 4–8, phased on an explicit difficulty ladder (fundamentals → guided
  application → integration → capstone).
- Lessons/module: 8–12. **Lesson length: target 4–6 min, HARD CEILING 7 min** (median
  engagement dies at ~6 min; ≥9-min videos rarely watched past 50%). One concept = one
  lesson = one stated learning objective.
- Course intro ≤2–4 min and must SHOW the end artifact ("here's what you'll build")
  before any setup. **Quick win inside Lesson 1** (learner sees something working in the
  first hour — dropout locks in within the first two weeks).
- **Checkpoint every 3–6 minutes of instruction, IN the default path** — optional
  quizzes are skipped 88% of the time; interpolated testing halves mind-wandering and
  lifted scores 68/76% → 90% (PNAS).
- Quizzes: low-stakes MCQ mid-module + end-of-module; in-lesson recall prompts.
- Projects: 1 small per lesson-cluster, 1 portfolio-grade per module, 1 capstone in the
  final module; real-world framing, never toy abstractions (CS50 +114% enrollment).
- Spaced repetition: each core concept re-surfaces in ≥2 later modules; end-of-lesson
  recall questions target EARLIER lessons, not just the current one.
- Difficulty: start from absolute zero even for advanced audiences; withdraw scaffolding
  gradually, never abruptly. Module close = short direct-address encouragement beat;
  course close = congratulations/recap/what's-next lesson.

## 11. LESSON DELIVERY SPEC (Teacher/Voice Writer rules — same evidence base)

1. Hook 0:00–0:30 = the payoff or a concrete real problem. NEVER open with definitions.
2. Intuition/visual/analogy BEFORE formalism (Ng bottom-up; Oakley metaphor-first);
   every abstract concept gets one everyday analogy.
3. One concept per lesson — a second concept means split the lesson.
4. **Visible change every ≤30 seconds** (advance diagram/type code/highlight) — never a
   static board under narration (Oakley's 30s attention rule).
5. TEACH → CHALLENGE ("pause and try") → SOLUTION → WHY, every 3–6 min (Yu + PNAS).
6. Show one realistic mistake + diagnosis + fix per practical lesson (ZTM rule).
7. Every instruction carries its one-line WHY — no "just do this" (anti-tutorial-hell).
8. Tone: conversational second-person, FAST and enthusiastic — engagement RISES with
   speaking rate (Guo); planned light humor; warmth beats production polish (informal
   desk recordings beat studio productions in the data).
9. Presenter integrated WITH the material (pointing at it), never a face over slides
   (split-attention). For us: the pointer/highlight IS the presenter.
10. Conceptual lessons optimize first-watch flow; hands-on lessons optimize re-watch
    (numbered steps, clean state per step, an artifact the learner keeps).
11. Close (last 20–30s): one-sentence recap + name what was built + tease next lesson's
    payoff; at module boundaries add the encouragement beat.
12. End each lesson with 1–2 recall questions about EARLIER lessons.

## 12. PENDING: legendary-teacher style research (1 agent running at time of writing)

Per-domain signature techniques (3Blue1Brown, StatQuest, Ng, Lewin, Veritasium
misconception-first, Abdul Bari, Malan/CS50, OverSimplified, LegalEagle, Ben Felix…) →
mechanical encodable rules → domain-teaching.js style blocks. Append here when it lands;
fold into Steps 3 and 7.
