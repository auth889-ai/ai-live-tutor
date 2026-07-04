# Forever Build Phases

This is the only phase plan file. Do not create duplicate roadmap files.

## Phase 0: Foundations

Build the first honest slice.

```text
plain text input -> SourcePack -> chunks -> source refs
```

Quality gate:

```text
No lesson generation without source chunks and source references.
```

Done when:

```text
A user can paste text and the backend returns a real SourcePack.
```

## Phase 1: Code Lesson Tooling

Build code as a real teaching tool, not a screenshot.

Build:

- Monaco editor
- Docker sandbox execution
- stdout and stderr artifacts
- dry-run trace extraction
- code panel output rendering

Quality gate:

```text
Code output shown in the lesson must come from sandbox artifacts.
```

Done when:

```text
A code lesson can execute in a locked-down sandbox and produce a trace.
```

## Phase 2: Course Planner

Use Qwen to create a dynamic course outline from SourcePack chunks.

Build:

- learning unit graph
- course outline
- episode count selection
- scene count selection
- duration estimation

Quality gate:

```text
Scene count and duration must be chosen from content, not hardcoded.
```

Done when:

```text
User material produces a variable-length course outline.
```

## Phase 3: Scene And Script Beats

Generate one scene at a time.

Build:

- teaching intent
- script beats
- source refs
- review report
- notebook page

Quality gate:

```text
One scene teaches one main idea.
```

Done when:

```text
One scene can be generated, validated, and reviewed independently.
```

## Phase 4: Timeline Player

Render the lesson like a human tutorial.

Build:

- region-based whiteboard
- subtitles
- pointer motion
- code/output panels
- source proof
- quiz actions

Quality gate:

```text
Visuals follow the audio clock.
```

Done when:

```text
A scene plays with synchronized visuals and audio timing.
```

## Phase 5: Multi-Input Ingestion

Add the remaining adapters.

Build:

- PDF text extraction
- website readability extraction
- YouTube transcript extraction
- image OCR
- code ingestion

Quality gate:

```text
Each input type produces the same SourcePack contract.
```

Done when:

```text
Every adapter returns chunks and source refs, or fails clearly.
```

## Phase 6: Reviewer And Repair

Add quality control.

Build:

- grounding reviewer
- pedagogy reviewer
- sync reviewer
- visual clutter reviewer
- repair agent

Quality gate:

```text
Failed parts are repaired specifically, not regenerated blindly.
```

Done when:

```text
Validation errors create targeted repair prompts.
```

## Phase 7: Alibaba Cloud And Devpost

Deploy and submit.

Build:

- Alibaba Cloud backend deployment
- Qwen Cloud proof
- architecture diagram
- demo video
- submission copy

Quality gate:

```text
Local-only demo is not acceptable for submission.
```

Done when:

```text
The repo has live backend proof and Devpost-ready documentation.
```
