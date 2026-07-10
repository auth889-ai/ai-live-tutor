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
- All agent/teaching intelligence = **Qwen** (hackathon proof file `lib/qwen/client.js`).
  **RAG subsystem = ANOTHER AI's models (user decision, confirmed twice):**
  - Embeddings: Gemini `gemini-embedding-001` (free tier, one GEMINI_API_KEY) — or local
    Transformers.js bge-small if the user prefers zero keys.
  - Retrieval-side LLM work (query rewrite, rerank, chunk selection for Q&A): Gemini
    Flash — cheap, behind-the-scenes.
  - GUARD: any text the STUDENT reads/hears (lesson content, Q&A answers) is still
    composed by Qwen from the retrieved chunks — the other AI only finds and ranks,
    never teaches. Keeps the hackathon story clean: "Qwen is the teacher; a second AI
    is the librarian."
  DashScope embeddings are Singapore-only — ruled out.

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

**EXECUTION METHOD (user-mandated, permanent): ONE STEP AT A TIME — never all at once.**
Every step runs the same loop:
1. VALIDATE DESIGN — check how the best production GitHub repo does this exact piece
   (OpenMAIC / MinerU / Presenton / the 9 research reports; fresh targeted search if
   a gap remains). No code until the pattern is confirmed.
2. BUILD — smallest complete vertical slice, one-file-one-job, nested folders.
3. VERIFY — unit tests green + headless-Chrome screenshot (SEE the render) + one real
   lesson exercising the step end-to-end.
4. SHOW the user → approval → next step. A step that isn't verified doesn't count.

**EXECUTION CHECKLIST (validated against OpenMAIC/marker/MinerU/TEA repo practices):**
- Freeze the 3-min demo script FIRST; every task must improve that path or gets cut
  (Vercel hackathon finding: shippable-and-demoable wins).
- Trunk-based, hour-scale commits, `feat(scope): thing (Epic Part A)` convention —
  OpenMAIC lands big features as many small Part-A/Part-B PRs on main; main never
  undemoable overnight.
- Vertical slices only (agent → renderer → fixture → test in one strip). NO refactors/
  extractions mid-sprint — OpenMAIC extracted @openmaic/dsl only at v0.3.0, after the
  boundary survived production.
- Test the SCAFFOLDING, not the model (OpenMAIC tests/generation shape: JSON repair,
  retry boundaries, routing gates, prompt wiring — all model-free). Every live-Qwen
  flake becomes a recorded fixture + deterministic regression test.
- CI model-free and fast; live evals out-of-band, never a merge gate.
- Golden fixtures assert PROPERTIES (schema-valid, required fields, no overlapping
  bboxes — OpenMAIC ships a geometry-conflict detector), never string equality.
- Stage-isolation flags (TEA's --only_plan/--only_render pattern): each agent stage
  runnable against the previous stage's recorded output — never burn Qwen calls
  iterating on rendering. (Our /dev/gallery + gen-trace-fixtures already do this for
  traces; extend per stage.)
- Screenshot check fails → feed the image back for ONE automated fix attempt before
  failing (TEA --use_visual_fix_code; matches our SEE→FIX loop).
- Prompts versioned in-repo; risky new stages behind env flags (FOREVER_X_ENABLED=,
  default off) — demo day = flip flags, not merge branches.
- Renderers TOLERATE malformed generated data (OpenMAIC: "fix(slide): tolerate
  malformed generated slide data") — degrade beats white-screen.
- Tag a release every 2-3 days; **feature freeze day 9-10** — after that only fixes,
  fixtures, demo polish (OpenMAIC's last-20%-of-release-notes is always hardening).

UI premium pass: see docs/PREMIUM_UI_SPEC.md (research-backed palette/type/depth/motion
spec that elevates the Pandio-blush baseline — deep espresso ink, Fraunces+Inter,
hue-matched layered shadows, theater-mode player).

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

## 12. LEGENDARY-TEACHER RULES (from ~20 teachers' own talks/theses/interviews)

Sources incl. PRIMARY: 3B1B's SoME criteria + Lex interview, Sal Khan's TED/book,
Ng's teaching guide, Starmer method interviews, Lewin's MIT material, **Muller's
(Veritasium) PhD thesis** — clear expository videos raise CONFIDENCE but NOT test scores
(learners map clean explanations onto existing misconceptions); misconception-first
dialogue videos nearly DOUBLED post-test scores despite feeling "confusing" —
Malan's CS50 design essays, Nasser's Substack, Tabarrok's Cato essay, Cooper interviews,
UChicago Socratic-method text, pretesting-effect literature (committed guess before
instruction improves learning even when wrong).

### 12.1 UNIVERSAL RULES → 'general' blueprint + Voice Writer + gate items (Step 3)

1. **Concrete-before-abstract, always** — a specific instance (demo/dataset/trace/case/
   packet/story) exists ON SCREEN before any rule, symbol, or definition. (The single
   most shared rule across all ~20 teachers.)
2. **Open with stakes, not a syllabus** — within ~30s it's clear why to care; topic name
   may come AFTER the hook. Never open with a definition.
3. **Prediction/misconception beat BEFORE the reveal** — learner commits to an answer,
   or the common wrong belief is voiced plausibly then refuted in dialogue.
   (Muller thesis + pretesting literature: works even when the guess is wrong.)
4. One concept per lesson unit; explicit prerequisite chain; nothing used before built.
5. **Symbols/jargon only after their referent exists on screen** — draw the quantity,
   THEN name it (3B1B's dA rule, Ng, Bari).
6. Content builds at speaking pace — incremental, never pre-rendered walls. (Matches
   our progressive-reveal gate rule.)
7. **Fixed ritual frame per course** — verbatim opener + sign-off + named recurring
   segments (CS50's "This is CS50", StatQuest's "BAM!", CrashCourse's "Thought Bubble").
   The repeated template itself is pedagogy. → Forever should have its OWN rituals.
8. Persistent visual conventions — same color/shape per role across every lesson
   (we already do this in the coding engines; extend to all domains).
9. **Errors are content** — live failures diagnosed aloud, ignorance admitted, wrong
   paths pursued to their visible consequence, penalty-free retries.
10. **Structural callback ending** — return to the opening object/question and restate
    the core claim (thesis return / "Physics works!" / definition sandwich).
11. Verify the general rule against the opening concrete instance, numerically.
12. **Checks target the misconception, not recall** — quiz distractors = the wrong
    intuitive answer (Muller); mastery gates on demonstrated ability, not time (Khan).

Conflict dial: intra-lesson repetition is a LEARNER-LEVEL parameter, not universal —
beginners get the definition sandwich (PowerCert), advanced learners get zero recap (MRU).

### 12.2 PER-DOMAIN OVERLAYS → domain-teaching.js style blocks (Step 7)

- **MATH (3B1B/Khan/Leonard)**: rediscovery voice ("how you might invent this"); ONE
  running concrete object interrogated all lesson; zero skipped algebra steps;
  re-derive forgotten prerequisites inline; notation labels what's already drawn.
- **ML/STATS (Ng/StatQuest)**: one seed model (y=wx+b), every new model a named delta on
  it; every formula evaluated BY HAND on ~5 data points before symbols; explicit deferral
  permission ("don't worry, we'll come back — and actually return"); escalating
  celebration markers on sub-results; intuition → math → code, always that order.
- **PHYSICS (Lewin/Muller)**: demo → question it raises → math, never equation-first;
  committed numeric prediction (with ±uncertainty) BEFORE every reveal; payoff line
  fires only on match; deliberate cognitive conflict is a feature — smooth = no learning.
- **CS/ALGORITHMS (Bari/Malan/Eater)**: hand-trace on one concrete input before code;
  one persistent mutating diagram; complexity derived by COUNTING the trace; one physical
  anchor-analogy per abstraction referenced back by name ("remember the phone book");
  planned live failure + diagnosis; strict no-black-box dependency order.
- **SYSTEMS/NETWORKING (Nasser/ByteByteGo/PowerCert/Practical Networking)**:
  origin-story opener (the pain before the tool); numbered-arrow master diagram walked
  arrow by arrow; back-of-envelope numbers before any architecture; trade-off table +
  explicit pick for every choice; follow ONE packet/request end-to-end, re-walked at
  increasing depth; ≥2 "what happens if this fails" probes; quote the RFC by number.
- **HISTORY/HUMANITIES (OverSimplified/CrashCourse/Fall of Civilizations)**: unbroken
  causal chain (every event has stated cause AND consequence); every actor gets a motive;
  argue a THESIS, don't list chronology; second-person sensory immersion beat ("imagine
  you are standing in..."); primary sources performed as quoted voices; map updated one
  move at a time; solemn-flag tone gate for grave material; bookend at the ruins/thesis.
- **LAW (LegalEagle/Socratic)**: case/scenario before doctrine; IRAC slots in order;
  mutate-ONE-fact hypothetical drills (2-4 rounds) to locate the rule's boundary;
  wrong answers pursued to their consequence, not corrected; error-interrupt naming the
  violated rule; single reusable takeaway separate from the verdict.
- **ECON/FINANCE (MRU/Ben Felix)**: real-world puzzle before the model; EVERY causal
  claim carries a named citation shown when invoked; steelman the popular belief before
  testing it; affect-free lexicon (no superlatives/urgency/fear); 2-4 retrieval questions
  per lesson; persistent cross-lesson comparison rubric. ANTI-PATTERN: single-cause
  narratives without sources (Economics Explained's documented failure).
- **META**: 5-Levels laddering (same concept restated at escalating abstraction — use
  for learner-level adaptation); Feynman freshman-test as a generation-time gate (can't
  render it at beginner level → the concept model is inadequate).

→ Fold 12.1 into Step 3 (general blueprint + gate), 12.2 into Step 7 (domain packs).
ALL RESEARCH COMPLETE — 9 agents total. Build starts at Step 1 upon user approval.
