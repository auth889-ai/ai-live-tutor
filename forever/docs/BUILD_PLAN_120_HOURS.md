# 120-Hour Build Plan

This is the canonical build plan. Do not create another phase/roadmap file for the same purpose.

## Phase 1: Product Shell

Goal:

```text
Forever already feels like a real Udemy/Coursera-style course platform before generation is connected.
```

Build:

- course sidebar
- lecture header
- teacher panel
- notebook board
- code/output panel
- source proof panel
- playback controls
- scene timeline cards
- notebook entry point

Quality gate:

```text
The first screen must look like a product, not a prompt demo or AI chat.
```

Done when:

```text
Static browser player opens and resembles the reference course-player screens.
```

## Phase 2: Dynamic Course Planner

Goal:

```text
Qwen decides course, episode, scene count, scene duration, and layout dynamically.
```

Build:

- `CourseSeriesPlan`
- dynamic episode planner
- dynamic scene planner
- course builder review UI
- regenerate/approve outline flow

Rules:

```text
Episode duration: 5-30 minutes.
Scene duration: 30 seconds-4 minutes.
One scene teaches one primary idea.
Layout is chosen from required affordances, not input type.
```

Done when:

```text
User input produces a Qwen-generated outline with variable scene count and estimated timing.
```

## Phase 3: Timeline Action Engine

Goal:

```text
The lesson plays like a human tutor video because all visuals follow the audio clock.
```

Build actions:

- `speak`
- `write_text`
- `draw_arrow`
- `circle`
- `underline`
- `highlight_code_line`
- `show_output_line`
- `update_variable_table`
- `move_pointer`
- `source_focus`
- `show_quiz`
- `save_notebook_snapshot`

Quality gate:

```text
No visual action is driven by random fixed delays. Audio clock is the source of truth.
```

Done when:

```text
One multi-scene episode plays with synchronized notebook, code, output, subtitles, and pointer actions.
```

## Phase 4: Qwen Scene Generator

Goal:

```text
Qwen generates a real scene through staged contracts, not one giant prompt.
```

Generation stages:

- pedagogy plan
- script beats
- voice lines
- visual plan
- timeline actions
- source evidence
- notebook page

Quality gate:

```text
Narration sounds spoken and human. Board writes less than the voice says.
```

Done when:

```text
Qwen generates one full scene that passes review and plays in the lecture player.
```

## Phase 5: Source Grounding And Semantic Search

Goal:

```text
Forever teaches from source evidence instead of hallucinating.
```

Build:

- text/PDF/code ingestion
- source chunking
- source refs
- embeddings
- PostgreSQL + pgvector retrieval
- source proof sidebar
- grounding reviewer

Quality gate:

```text
No important factual claim without source evidence.
```

Done when:

```text
Generated scenes cite source chunks and the proof panel shows the exact supporting material.
```

## Phase 6: Reviewer And Repair Loop

Goal:

```text
Weak scenes are rejected and repaired before the student sees them.
```

Reviewers:

- grounding reviewer
- pedagogy reviewer
- sync reviewer
- visual clutter reviewer
- human tutor reviewer

Repair targets:

- source
- script
- voice
- timeline
- layout
- notebook

Quality gate:

```text
Repair only the failed part. Do not regenerate the whole course unnecessarily.
```

Done when:

```text
Failed scene parts produce targeted repair patches and then pass validation.
```

## Phase 7: Production, Alibaba Cloud, And Devpost

Goal:

```text
The project is deployed, testable, documented, and ready for Devpost judging.
```

Build:

- Alibaba Cloud backend deployment
- deployed `/health`
- deployed `/api/qwen/health`
- public repo safety check
- architecture diagram
- unit/integration/e2e tests
- 3-minute demo video
- Alibaba Cloud proof recording
- Devpost submission copy

Quality gate:

```text
Local-only demos are not enough. Alibaba Cloud deployment is mandatory.
```

Done when:

```text
Devpost submission includes repo, live backend proof, architecture diagram, demo video, and track description.
```

## Non-Negotiables

- No fake video promise.
- No hardcoded input-type screen switching.
- No unsourced claims in generated lesson.
- No visual action outside the audio clock.
- No giant scene that teaches everything.
- Each scene teaches one primary idea.
- Board writes less than the tutor says.
- Procedural topics require worked example or dry run.
- Keep files small and responsibility-focused.

## Winning Demo Story

```text
Paste nested-loop material
Generate episode outline
Approve scenes
Play human-like lecture
Show source proof
Show saved notebook
Show Qwen/Alibaba architecture
```
