# Production Stack

This is the stack Forever should show to judges. The current implementation builds it one vertical slice at a time.

## Required Core

```text
FastAPI
LangGraph
LangChain
Qwen Cloud Model Studio
Celery
Redis
PostgreSQL + pgvector
WebSocket/SSE messaging
Web Audio API tutor player
Alibaba Cloud deployment
```

## Required Deployment Layer

For Devpost, Alibaba Cloud deployment is mandatory.

```text
Alibaba Cloud ECS/ACK deployment
Qwen Cloud Model Studio
Alibaba Cloud proof recording
Backend health endpoint
Qwen health endpoint
Deployment proof file in repo
```

## Optional But Strong

```text
BullMQ Node realtime gateway
Alibaba Cloud OSS for media/audio
Object storage signed URLs
OpenTelemetry traces
```

## Responsibility Map

| Layer | Technology | Responsibility |
| --- | --- | --- |
| API | FastAPI | course/session REST API |
| Workflow | LangGraph | stateful teaching graph and repair loop |
| LLM | Qwen Cloud | planning, script, visual timeline, review |
| Agent wrappers | LangChain | model/tool abstractions |
| Queue | Celery + Redis | long-running generation jobs |
| Realtime | BullMQ + WebSocket | UI progress and scene-ready events |
| Search | PostgreSQL + pgvector | semantic retrieval over source chunks |
| Player | Web Audio + SVG/canvas | audio-clock-synced lesson rendering |
| Deployment | Alibaba Cloud ECS/ACK | mandatory Devpost backend hosting |

## Alibaba Cloud Submission Gate

The project is not submission-ready until all are true:

```text
Backend runs on Alibaba Cloud.
/health returns ok from the deployed backend.
/api/qwen/health returns ok from the deployed backend.
Repo includes a proof file showing Alibaba/Qwen API usage.
Demo includes a short deployment proof recording.
Devpost text includes Alibaba Cloud deployment URL/proof.
```

## Multi-Agent Society

Forever uses a society internally, but the HLD remains product-object-first.

```text
SourceGroundingAgent
LearningUnitAgent
CoursePlannerAgent
TeachingIntentAgent
RepresentationAgent
ScriptBeatAgent
TimelineCompilerAgent
GroundingReviewerAgent
PedagogyReviewerAgent
SyncReviewerAgent
RepairAgent
```

Each agent writes to the same `ForeverState` and must emit strict JSON contracts.

## Agent Contracts

Each agent must have a tool boundary, input contract, output contract, quality gate, and repair behavior.

| Agent | Purpose | Tools | Output | Quality Gate |
| --- | --- | --- | --- | --- |
| SourcePackAgent | Convert raw input into trusted source material | PyMuPDF, Playwright, chunker, embeddings, pgvector | `SourcePack` | every chunk has `sourceRef` |
| LearningUnitAgent | Extract smallest teachable ideas | Qwen, semantic search | `LearningUnit[]` | one primary teaching goal per unit |
| CourseSeriesPlannerAgent | Plan Udemy/Coursera-style course flow | Qwen | `CourseSeriesPlan` | episode order follows prerequisites |
| EpisodePlannerAgent | Break one episode into short scenes | Qwen | `EpisodePlan` | one primary idea per scene |
| PedagogyPlannerAgent | Choose human teaching sequence | Qwen, teaching pattern library | `PedagogyPlan` | procedural topics include dry run |
| ScriptBeatWriterAgent | Write natural spoken tutor narration | Qwen | `ScriptBeat[]` | spoken, not textbook; source refs on claims |
| VoiceDirectorAgent | Prepare voice lines and alignment hints | TTS, forced alignment | `VoiceLine[]`, `SubtitleWord[]` | short natural voice lines |
| VisualDirectorAgent | Design notebook/code/diagram actions | Qwen, renderer capability registry | `TimelineAction[]`, `VisualObject[]` | visual actions anchored to voice |
| TimelineCompilerAgent | Compile replayable audio-clock timeline | schema validator | `TimelineManifest` | valid refs and timing |
| NotebookCompilerAgent | Create saved notebook pages | canvas snapshotter, PDF exporter | `NotebookPage` | useful without replay |
| ReviewerSociety | Reject weak scenes before users see them | Qwen, validators, semantic search | `ReviewReport` | accuracy, grounding, pedagogy, sync, polish |
| RepairAgent | Patch failed scene parts | Qwen, targeted context | `RepairPatch` | patch preserves scene intent and source refs |

## Lecture Player Action Set

```text
speak
write_text
draw_arrow
circle
underline
highlight_code_line
show_output_line
update_variable_table
move_pointer
source_focus
show_quiz
save_notebook_snapshot
```

## Runtime Sync Rule

```text
Audio is the master clock.
Subtitles follow audio.
Notebook writing follows voice beats.
Code highlights follow voice beats.
Output and dry-run updates follow voice beats.
Quiz moments may pause audio.
```
