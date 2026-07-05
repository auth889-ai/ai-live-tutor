# Forever — Features and How Each One Is Real

Forever is a universal AI tutor course platform. Give it anything — a PDF, notes, an article, a YouTube transcript, code, a syllabus, a research paper, or just a topic name — and it produces a full Udemy-style course: episodes, lessons, a tutor who talks and writes on a board in sync, real code execution, source proof, quizzes, and a notebook that fills itself.

This document lists every user-facing feature and the engineering that makes it real rather than faked. Contracts live in `packages/@forever/contracts`; the pipeline in ARCHITECTURE.md §4.

---

## 1. Any input becomes a course (universal ingestion)

**Feature:** Upload/paste PDF, text notes, website URL, YouTube transcript, code, syllabus, research paper — or type just a topic name — and get a structured course.

**How:** Every input type has an adapter that normalizes into ONE format: the **SourcePack** (chunks + page images + source refs + concept graph). Downstream agents only ever see SourcePacks, so a new input type is one adapter, zero pipeline changes.
- PDF → pdfjs text + rasterized page images → qwen3-vl vision pass transcribes every page, finds regions, diagrams, relationships (a diagram-only page counts as evidence — the image is the proof).
- URL → Jina Reader/Firecrawl extraction. YouTube → transcript fetch with timestamps as source refs.
- **Topic name** (the hard one): the Researcher agent web-searches, reads multiple sources, and builds a *cited* SourcePack — so even a bare topic keeps full source grounding. Grounding is never skipped; it's constructed.

## 2. Teaches ANY subject — no fixed domain list

**Feature:** SQL today, organic chemistry tomorrow, medieval history, guitar theory, Kubernetes — same product, appropriate teaching style each time.

**How:** Nothing subject-specific is hardcoded. Registries hold TYPES (layouts, action kinds, message kinds), never content. Universality comes from three mechanisms:
1. **Dynamic persona synthesis.** The Domain Router doesn't pick from a fixed teacher list — it *generates* a Teacher persona per course: teaching conventions, board notation habits, example genres, misconception patterns for THAT subject (a chemistry teacher draws mechanisms and warns about electron-pushing errors; a history teacher builds timelines and argues causes). The persona is data on the blackboard, produced by qwen3-max, validated against a persona contract.
2. **Open board vocabulary.** Board objects have a free-string `objectType` + a rendering hint (text / list / table / diagram / code / math / timeline / annotation). The Board Director invents subject-appropriate objects (`reaction_mechanism`, `battle_map_annotation`, `chord_diagram`); the renderer maps hints to primitives, so unknown types still render.
3. **Domain-agnostic quality gates.** The Review Board rubrics check grounding, pacing, clarity, and sync — properties of good teaching in ANY subject — so the quality floor holds without per-domain rules.

## 3. A tutor that explains like a human — voice + board in perfect sync

**Feature:** The tutor talks step by step while handwriting appears on the board, the pointer moves to what's being discussed, and subtitles track the voice — the feel of a great YouTube teacher, generated on demand. No AI-generated video anywhere.

**How:** Three-layer sync engineering:
1. **Binding at generation time.** Every narration line is bound to the board object and region it explains (contract-enforced — a voice line without a target fails validation).
2. **Deterministic timeline compile.** A compiler (code, no LLM) orders actions on one clock: focus actions (point/highlight) fire a beat *before* their speech, writing animates at narration pace, canvas safe zones prevent overlap.
3. **Real word timestamps.** CosyVoice renders the voice; Paraformer ASR aligns the audio to word-level offsets; the Reconciler replaces every provisional timing with measured ones. The board writes the word *as the tutor says it* because the timing comes from the actual audio, not an estimate.
Playback is one clock: the `<audio>` element's currentTime drives everything. Seek, scrub, 2× speed, and replay are free and always in sync — there are no other timers to drift.

## 4. Real code, really executed

**Feature:** For programming topics: a code panel with the full program, line-by-line highlighting synced to the explanation, dry-run traces, and an output panel showing what the code actually prints.

**How:** The Code Runner agent (qwen3-coder) writes the example, then **executes it in a sandbox** (Docker on ECS; Judge0 fallback). The output panel shows captured stdout — if the code doesn't run, the scene fails validation and gets repaired. Forever never displays invented output. Dry-run tables (variable states per iteration) are generated from the actual trace.

## 5. Source & Proof — every claim has receipts

**Feature:** A panel showing the original source page with the exact region highlighted that backs what the tutor is currently saying, plus page numbers, related diagrams, and key quotes.

**How:** Every board object and voice line carries a `sourceRef` (chunk id + page + bbox). The original page image is never cropped — the renderer overlays a highlight and zooms with CSS transforms (reversible, pixel-accurate via DOM measurement). The Grounding Auditor critic blocks any scene where a claim's sourceRef doesn't resolve. This is the anti-hallucination feature no chatbot tutor has: you can always check the receipt.

## 6. A real course, not one lesson

**Feature:** Udemy-style structure — course outline, 8–12 episodes with durations, lessons within episodes, progressive unlock, resume-where-you-left-off, progress %, timeline thumbnails per scene.

**How:** The Dean plans the series from the SourcePack concept graph with explicit duration budgets; the Teacher negotiates scope per episode (logged negotiation, ARCHITECTURE.md §3.3). Scenes generate as parallel BullMQ jobs with continuity constraints on the blackboard, so a 12-episode course is a queue workload, not a 12× wait. Manifests, audio, and thumbnails persist to RDS + OSS; playback position per user makes resume trivial.

## 7. Quizzes that pause the lesson

**Feature:** Checkpoint questions appear mid-lesson, the clock pauses, the student answers, gets a worked explanation, and the course adapts.

**How:** Quiz actions are timeline events like any other — the player pauses the audio clock and renders the question. The Quiz Master generates each item WITH a worked answer and a sourceRef; an independent answerability check (different agent, fresh context) must solve the question from the cited source alone, or the item is rejected. Results feed learner memory (below).

## 8. The notebook writes itself

**Feature:** Every lesson's board ends up as a saved notebook page — reviewable anytime, exportable as PDF, organized by course/episode/lesson.

**How:** The board's final state is data (objects + regions), so the Notebook Scribe compiles it plus key takeaways into a notebook-page manifest deterministically re-rendered by the same renderer — the notebook looks exactly like the board because it IS the board. PDF export renders server-side to OSS.

## 9. It remembers — the tutor gets better and knows the student

**Feature:** Cross-session memory: the platform remembers what a student got wrong and schedules remediation; the faculty remembers what reviews taught it and stops repeating mistakes.

**How:** Two memory stores (Postgres + pgvector, recency-decayed):
- **Learner memory:** quiz misses and re-watched segments → the Teacher's next lesson plan includes targeted remediation scenes.
- **Rubric memory:** every Arbiter verdict is distilled into a retrievable heuristic critics apply on future scenes — quality compounds across runs.

## 10. Watch the faculty work (Studio)

**Feature:** While the course generates, the Studio shows the agent society live: who's working on what, proposals, objections with evidence, negotiations, verdicts, repair rounds — plus per-stage progress.

**How:** Every society message is a typed, persisted event streamed over SSE. This is both a product feature (trust through transparency) and the Track 3 demo centerpiece: judges watch task division, dialogue, and conflict resolution happen.

## 11. Production-grade, honestly

**Feature-level guarantees:** no placeholder content ever (a stage that can't succeed raises — honest failure over fake success); every manifest validates before storage; generation is crash-resumable (BullMQ); costs are metered per run (token/cost ledger); deployed fully on Alibaba Cloud (ECS/SAE + RDS + Tair + OSS + Model Studio) with observability via Simple Log Service.

---

## Why this beats other AI tutors

| Typical AI tutor | Forever |
|---|---|
| Chat bubbles of text | A teacher who writes, points, and talks in measured sync |
| Hallucinates confidently | Every claim carries a resolving sourceRef; a critic blocks ungrounded scenes |
| Fake or pasted code output | Sandbox-executed code; real captured output or the scene fails |
| One answer, then amnesia | Structured course series + learner memory + remediation |
| Fixed subjects or fixed templates | Dynamic persona synthesis + open board vocabulary → genuinely any subject |
| One mega-prompt, quality lottery | A faculty that debates, negotiates, and repairs — with a benchmark proving the gain |

**Versus human tutors** the honest claim is: Forever delivers the *structure* of a great human-taught course — sequencing, board work, worked examples, checking understanding — on any topic, on demand, at near-zero marginal cost, with perfect patience and receipts for every claim. That's the pitch: not "better than the best human teacher," but "a very good human-style teacher for everything, instantly."

## Why this wins Track 3

Task division (a real faculty, §ARCHITECTURE 3.1) + dialogue and conflict resolution (evidence-carrying debate, budget/scope negotiation, binding arbitration, §3.3) + **measurable efficiency gain** (eval/ harness vs single-agent baseline with a numbers table, §3.5) — the three things the track brief explicitly asks for — wrapped in a product real enough to use the day after the hackathon ends.
