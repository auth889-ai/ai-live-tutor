# Software Architecture

## Repository Shape

```text
forever/
  apps/
    api/       FastAPI backend and Qwen Cloud boundary
    web/       static first-slice tutor player
  docs/        architecture, Devpost copy, diagrams
  infra/       Alibaba Cloud proof and deployment notes
  packages/    shared contracts and schemas
```

## Backend Modules

```text
forever_api/
  main.py
  settings.py
  qwen/
    client.py
  generation/
    demo_pipeline.py
  modules/
    ingestion/
    learning_units/
    planning/
    script/
    tts/
    timeline/
    review/
  schemas/
  storage/
```

Each module owns one responsibility and communicates through typed schemas.

## Runtime Pipeline

```text
POST /api/courses/start
  -> build_source_pack
  -> extract_learning_units
  -> plan_course
  -> generate_script_beats
  -> align_voice
  -> compile_timeline
  -> review_manifest
  -> persist
  -> return course + first scene
```

The first slice uses a deterministic demo pipeline so the player can be judged without paid TTS or long generation jobs. Qwen Cloud is isolated behind `QwenClient` and can be enabled by environment variables.

## Frontend Runtime

```text
TutorPlayer
  AudioClock
  SceneTimeline
  WhiteboardCanvas
  MediaPanel
  PointerLayer
  SubtitleBar
  SourceProofPanel
```

The player uses Web Audio `currentTime` as the master clock. Board actions, subtitles, pointer movement, and source proof all follow that clock.

## Strict Sync Rule

No visual event uses backend-guessed delays as the source of truth. Every visual action is anchored to a voice beat or word timestamp.

