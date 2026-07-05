# Build Workflow

Each phase has an exit gate. A phase is done only when its gate passes — no phase starts on top of an unvalidated one. `npm test` must stay green at every phase.

## Phase 0: Contracts (foundation)

Build and test the schemas everything else obeys (`packages/@forever/contracts`):

- board layout regions + visual objects (region + line_number, never x/y)
- timeline actions (write / point / highlight / zoom / revealCode / showOutput / quiz)
- voice lines bound to objects/regions
- source evidence (sourceRef: chunk id + page + bbox)
- course series (course → episode → lesson → scene)
- society messages (proposal / objection / evidence / revision / verdict / handoff)
- teaching scene manifest + validator

**Exit gate:** `npm test` — every contract has fixture-based validation tests, including rejection cases.

## Phase 1: Renderer Shell (no AI)

The real player, driven by hand-written fixture manifests:

- course sidebar, episode playlist, progress
- tutor panel (avatar asset — idle/talking states, never generative video)
- SVG board renderer: region layout, stroke-by-stroke writing, pointer
- code/source panel slots, subtitle bar
- playback controls, timeline thumbnails, seek/scrub/speed
- one clock: `<audio>.currentTime` drives everything

**Exit gate:** a fixture scene plays end-to-end; seeking to any time renders the correct board state; e2e test passes.

## Phase 2: TTS + Timestamp Reconciler

- CosyVoice render per voice line → OSS
- Paraformer ASR alignment on the rendered audio → word offsets
- reconciler replaces provisional timings in the timeline; validation re-runs

**Exit gate:** fixture scene plays with real audio; board writing lands on the narrated words within tolerance.

## Phase 3: Single Scene Generation (society, minimal)

Wire Qwen through the staged agents for ONE scene from a real SourcePack: Librarian (text input first) → Teacher → Board Director + Voice Writer → Timeline Compiler → Review Board (grounding critic at minimum) → manifest store.

Every stage validates before the next runs. Blackboard + message log live from day one.

**Exit gate:** a real generated scene passes validation and plays in the Phase 1 player. The Studio shows the message log.

## Phase 4: Episode Pipeline (parallel scenes)

- Dean + Domain Router + full Teacher plan
- 4–8 scenes as parallel BullMQ jobs, continuity via blackboard constraints
- Code Runner (real sandbox execution) + Quiz Master + Notebook Scribe
- full Review Board with debate + Arbiter; repair only the failed stage
- budget negotiation (Board Director ↔ Voice Writer) live

**Exit gate:** one full episode generates unattended, resumes after a killed worker, and plays end-to-end.

## Phase 5: Course Series

- Udemy-style course outline from source material (Dean)
- episode list, locking/progression, resume, notebook library, quizzes tab
- scope negotiation (Dean ↔ Teacher) live

**Exit gate:** a multi-episode course generates and the player navigates it like the reference UI.

## Phase 6: Full Ingestion + Grounding

- adapters: PDF (page images + vision), URL, YouTube transcript, code, syllabus, paper, topic name (Researcher builds a cited SourcePack via web search)
- pgvector retrieval everywhere; Source & Proof panel with bbox overlays
- grounding audit: every board object and narration claim resolves to a sourceRef

**Exit gate:** the same course pipeline succeeds from a PDF and from a bare topic name, with grounding coverage reported.

## Phase 7: Society Memory + Benchmark

- rubric memory (Arbiter verdicts → retrievable heuristics) and learner memory (quiz results → remediation)
- `eval/` harness: same SourcePack through single-agent baseline vs society
- `eval/RESULTS.md`: validation pass rate, grounding coverage, sync errors, quiz answerability, repair rounds, wall time, token cost

**Exit gate:** benchmark table shows the society's gain with numbers.

## Phase 8: Production + Submission

- Alibaba Cloud: ECS/SAE (web + workers), RDS PostgreSQL + pgvector, Tair, OSS, Model Studio
- Simple Log Service, token/cost ledger, rate-limit handling, caching
- deployment-proof recording; architecture diagram export; ~3 min demo video; Devpost text; LICENSE visible; optional blog post

**Exit gate:** the deployed URL generates and plays a course; the submission checklist in ARCHITECTURE.md §8 is fully checked.
