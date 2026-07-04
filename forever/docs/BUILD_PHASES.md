# Forever Build Phases

This is the canonical build plan. Do not create another phase/roadmap file for the same purpose.

The project is built in dependency order:

```text
contracts -> ingestion -> execution tools -> course planning -> scene generation -> playback -> multi-input adapters -> reviewers -> deployment
```

If a later phase depends on an earlier contract, do not skip ahead.

## Phase 0: Foundations

Goal:

```text
plain text input -> SourcePack -> chunks -> source refs
```

This phase nails the three non-negotiables:

1. Region layout system
2. TeachingScreen manifest schema
3. Audio master clock

Files:

- `apps/api/requirements.txt`
- `apps/api/src/forever_api/main.py`
- `apps/api/src/forever_api/contracts/layouts.py`
- `apps/api/src/forever_api/contracts/teaching_screen.py`
- `apps/api/src/forever_api/contracts/audio_clock.py`
- `apps/api/src/forever_api/ingestion/source_pack.py`
- `apps/api/src/forever_api/routers/source_packs.py`
- `apps/api/src/forever_api/services/source_pack_service.py`
- `apps/api/tests/test_main_http_optional.py`
- `apps/api/tests/test_source_pack_api.py`
- `apps/api/tests/test_source_pack.py`
- `apps/api/tests/test_phase0_contracts.py`
- `apps/api/tests/test_service.py`

Quality gate:

```text
No lesson generation without source chunks and source references.
```

Done when:

```text
A user can paste text and the backend returns a real SourcePack.
```

Implementation order:

1. Define `SourcePack`.
2. Define named layout regions.
3. Define teaching-screen manifest schema.
4. Define audio clock math.
5. Wrap the builder in a service layer.
6. Expose dependency-free API behavior for source-pack creation.
7. Add the FastAPI entrypoint.
8. Add tests that fail on unsupported input types.

## Phase 1: Code Lesson Tooling

Goal:

```text
code output shown in the lesson must come from sandbox artifacts
```

Build:

- Monaco editor
- Docker sandbox execution
- stdout and stderr artifacts
- dry-run trace extraction
- code panel output rendering
- code execution request/response contract

Files:

- `apps/api/src/forever_api/services/code_sandbox_service.py`
- `apps/api/src/forever_api/services/dry_run_service.py`
- `apps/api/tests/test_code_sandbox.py`
- `apps/web/src/components/player/CodePanel.tsx`
- `apps/web/src/components/player/VariableTable.tsx`
- `apps/web/src/components/player/OutputPanel.tsx`

Quality gate:

```text
A code lesson can execute in a locked-down sandbox and produce a trace.
```

Done when:

```text
A nested-loop lesson shows code, dry-run table, and output from real artifacts.
```

Implementation order:

1. Add code sandbox interface.
2. Add a Docker-backed executor adapter.
3. Add a dry-run trace compiler for pattern-printing lessons.
4. Render stdout, trace tables, and source code panels from real artifacts.
5. Add tests for sandbox command shape and trace output.

## Phase 2: Course Planner

Goal:

```text
User material produces a variable-length course outline.
```

Build:

- learning unit graph
- course outline
- episode count selection
- scene count selection
- duration estimation
- course approval payload
- regenerate-one-scene flow

Files:

- `apps/api/src/forever_api/pipelines/course_pipeline.py`
- `apps/api/src/forever_api/agents/course_planner_agent.py`
- `apps/api/src/forever_api/agents/learning_unit_agent.py`
- `apps/api/src/forever_api/tests/test_course_planner.py`

Quality gate:

```text
Scene count and duration must be chosen from content, not hardcoded.
```

Implementation order:

1. Split the SourcePack into learning units.
2. Order learning units by dependency.
3. Ask Qwen for a course outline.
4. Validate episode count and duration against content.
5. Let the user approve or edit the outline before generation.

## Phase 3: Scene And Script Beats

Goal:

```text
one scene teaches one main idea
```

Build:

- teaching intent
- script beats
- source refs
- review report
- notebook page
- voice lines
- layout choice per scene
- validation failures for repair

Files:

- `apps/api/src/forever_api/agents/script_beat_agent.py`
- `apps/api/src/forever_api/agents/voice_director_agent.py`
- `apps/api/src/forever_api/agents/visual_director_agent.py`
- `apps/api/src/forever_api/agents/notebook_compiler_agent.py`
- `apps/api/src/forever_api/pipelines/scene_pipeline.py`

Quality gate:

```text
One scene can be generated, validated, and reviewed independently.
```

Implementation order:

1. Generate a pedagogy plan for one scene.
2. Generate 3-7 script beats.
3. Generate voice lines from the beats.
4. Choose a region layout for the scene.
5. Generate the notebook page and source evidence.
6. Validate the whole scene before allowing playback.

## Phase 4: Timeline Player

Goal:

```text
visuals follow the audio clock
```

Build:

- region-based whiteboard
- subtitles
- pointer motion
- code/output panels
- source proof
- quiz actions
- playback controls
- scene switching
- note saving
- audio-clock driven animation

Files:

- `apps/web/src/engine/AudioEngine.ts`
- `apps/web/src/engine/PointerEngine.ts`
- `apps/web/src/engine/ActionDispatcher.ts`
- `apps/web/src/components/LectureStage.tsx`
- `apps/web/src/components/PointerLayer.tsx`
- `apps/web/src/components/SubtitleBar.tsx`
- `apps/web/src/components/SourceProofPanel.tsx`

Quality gate:

```text
A scene plays with synchronized visuals and audio timing.
```

Implementation order:

1. Render the stage from named regions.
2. Drive all animations from the audio clock.
3. Highlight subtitles by word timing.
4. Move the pointer before spoken mentions.
5. Show code, output, source proof, and quiz overlays as timeline actions.

## Phase 5: Multi-Input Ingestion

Goal:

```text
Every adapter returns chunks and source refs, or fails clearly.
```

Build:

- PDF text extraction
- website readability extraction
- YouTube transcript extraction
- image OCR
- code ingestion
- input-specific source refs
- input-specific failure messages

Files:

- `apps/api/src/forever_api/adapters/pdf_adapter.py`
- `apps/api/src/forever_api/adapters/url_adapter.py`
- `apps/api/src/forever_api/adapters/youtube_adapter.py`
- `apps/api/src/forever_api/adapters/image_adapter.py`
- `apps/api/src/forever_api/adapters/code_adapter.py`

Quality gate:

```text
Each input type produces the same SourcePack contract.
```

Implementation order:

1. Add PDF ingestion.
2. Add website URL ingestion.
3. Add YouTube transcript ingestion.
4. Add image OCR ingestion.
5. Normalize all of them into the same SourcePack shape.

## Phase 6: Reviewer And Repair

Goal:

```text
validation errors create targeted repair prompts
```

Build:

- grounding reviewer
- pedagogy reviewer
- sync reviewer
- visual clutter reviewer
- repair agent
- retry rules
- targeted patch generation

Files:

- `apps/api/src/forever_api/agents/grounding_reviewer_agent.py`
- `apps/api/src/forever_api/agents/pedagogy_reviewer_agent.py`
- `apps/api/src/forever_api/agents/sync_reviewer_agent.py`
- `apps/api/src/forever_api/agents/visual_clutter_reviewer_agent.py`
- `apps/api/src/forever_api/agents/repair_agent.py`

Quality gate:

```text
Failed parts are repaired specifically, not regenerated blindly.
```

Implementation order:

1. Validate grounding.
2. Validate pedagogy.
3. Validate timing.
4. Validate layout density.
5. Repair only the failed stage and keep the rest.

## Phase 7: Alibaba Cloud And Devpost

Goal:

```text
The repo has live backend proof and Devpost-ready documentation.
```

Build:

- Alibaba Cloud backend deployment
- Qwen Cloud proof
- architecture diagram
- demo video
- submission copy
- repo hygiene
- deployment proof recording

Files:

- `infra/alibaba-cloud/qwen_cloud_healthcheck.py`
- `docs/diagrams/system_architecture.mmd`
- `docs/DEVPOST_SUBMISSION.md`
- `docs/DEVPOST_RULES_CHECKLIST.md`

Quality gate:

```text
Local-only demo is not acceptable for submission.
```

Implementation order:

1. Deploy backend on Alibaba Cloud.
2. Prove Qwen Cloud API access.
3. Record deployment proof.
4. Produce architecture diagram.
5. Produce demo video.
6. Finalize Devpost submission text.

## Non-Negotiables

- No fake generation.
- No hardcoded input-type screen switching.
- No unsourced claims in generated lessons.
- No visual action outside the audio clock.
- No giant scene that teaches everything.
- Each scene teaches one primary idea.
- Board writes less than the tutor says.
- Procedural topics require worked example or dry run.
- Keep files small and responsibility-focused.
