# Software Architecture

## Repository Shape

```text
forever/
  apps/
    api/       FastAPI backend and Qwen Cloud boundary
    realtime/  BullMQ websocket/event gateway boundary
    web/       static first-slice tutor player
  docs/        architecture, Devpost copy, diagrams
  infra/       Alibaba Cloud, Redis, Postgres, deployment notes
  packages/    shared contracts and schemas
```

## Backend Modules

```text
forever_api/
  main.py
  settings.py
  qwen/
    client.py
  orchestration/
    forever_graph.py
    state.py
  queues/
    celery_app.py
    tasks.py
  semantic_search/
    interfaces.py
    pgvector_store.py
  messaging/
    events.py
    gateway.py
  agents/
    base.py
    registry.py
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

## Production Stack

```text
Frontend:
  Web tutor player
  Web Audio clock
  SVG/canvas board renderer
  WebSocket/SSE event client

Realtime Gateway:
  Node/TypeScript
  BullMQ for UI-facing job/event streams
  WebSocket fanout

Backend API:
  FastAPI
  Qwen Cloud client
  Course/session REST API

Workflow:
  LangGraph state graph
  Multi-agent graph nodes
  Review/repair loop

Workers:
  Celery
  Redis broker/result backend
  Long-running generation jobs

Storage:
  PostgreSQL
  pgvector semantic search
  Object storage for audio/media

AI:
  Qwen Cloud Model Studio
  LangChain wrappers where useful
```

## Why Both Celery And BullMQ Exist

They do not do the same job.

```text
Celery + Redis:
  Python generation workers
  LangGraph execution
  ingestion, planning, TTS alignment, timeline compile, review

BullMQ + Redis:
  Node realtime gateway
  websocket fanout
  UI progress/event buffering
  optional frontend-facing job queues
```

If time becomes tight, Celery remains required and BullMQ can stay as a documented realtime boundary. If we have time, BullMQ becomes the live event gateway for the Devpost demo.

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

## LangGraph Target Nodes

```text
START
  -> ingest_input
  -> build_source_pack
  -> retrieve_semantic_context
  -> extract_learning_units
  -> plan_course
  -> plan_teaching_intents
  -> plan_representations
  -> generate_script_beats
  -> align_voice
  -> compile_timeline
  -> review_grounding_pedagogy_sync
  -> repair_failed_parts
  -> persist_ready_scene
  -> publish_scene_ready
END
```

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
