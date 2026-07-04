# Forever

Forever is a source-grounded, audio-synchronized human tutor course player.

It does not generate fake talking-head videos. It turns PDFs, URLs, transcripts, code, syllabi, notes, slides, question banks, and topics into timed interactive lessons: tutor narration, word subtitles, whiteboard writing, pointer movement, source focus, dry-runs, quizzes, and source proof.

## Devpost Track

Recommended track: **Agent Society**.

Reason: Forever uses Qwen Cloud as a multi-step teaching society behind a clean product object model:

- Source Pack Builder
- Learning Unit Graph Builder
- Adaptive Course Planner
- Teaching Intent Planner
- Representation Planner
- Script Beat Generator
- Timeline Compiler
- Grounding and Pedagogy Reviewer

These are not exposed as messy product boxes. The product boxes are stable: `Course`, `LearningUnit`, `Scene`, `TimelineManifest`, `BoardAction`, `VoiceLine`, and `SourceEvidence`.

## First Build Slice

This repository starts with a narrow, high-quality first slice:

- strict architecture documents
- Qwen Cloud backend boundary
- LangGraph/Celery/Redis/semantic-search production boundaries
- optional BullMQ realtime gateway boundary
- deterministic demo generation pipeline
- strict timeline manifest contracts
- audio-clock-synchronized web tutor player
- Alibaba Cloud proof file for Devpost

## Run The Static Player

Open this file in a browser:

```text
apps/web/index.html
```

No build step is required for the first slice.

## Run The API

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn forever_api.main:app --reload --port 8000
```

Optional Qwen Cloud environment:

```bash
export DASHSCOPE_API_KEY="sk-..."
export QWEN_BASE_URL="https://dashscope-us.aliyuncs.com/compatible-mode/v1"
export QWEN_MODEL="qwen-plus"
```

For Singapore, Japan, Beijing, or Hong Kong workspaces, use the workspace-specific Model Studio base URL.

## Submission Requirements Covered

- Public repo ready: `LICENSE` is included.
- Qwen Cloud usage: `apps/api/src/forever_api/qwen/client.py`.
- Alibaba Cloud proof file: `infra/alibaba-cloud/qwen_cloud_healthcheck.py`.
- Architecture diagram: `docs/diagrams/system_architecture.mmd`.
- Text description: `docs/DEVPOST_SUBMISSION.md`.
- HLD and software architecture: `docs/HLD.md`, `docs/SOFTWARE_ARCHITECTURE.md`.

## Mandatory Alibaba Cloud Deployment

The Qwen hackathon requires backend deployment on Alibaba Cloud. Local demo is not enough for submission.

Required final proof:

```text
Deployed backend URL on Alibaba Cloud
GET /health returns ok
GET /api/qwen/health returns ok
Short deployment proof recording
Repo proof script: infra/alibaba-cloud/qwen_cloud_healthcheck.py
```

## Production Stack Shape

The target stack is documented and scaffolded:

- FastAPI API
- Qwen Cloud Model Studio
- LangGraph orchestration
- LangChain agent/tool wrappers
- Celery + Redis worker queue
- PostgreSQL + pgvector semantic search
- BullMQ realtime gateway for websocket event fanout
- Web Audio API tutor player

See `docs/PRODUCTION_STACK.md` and `docs/BUILD_PLAN_120_HOURS.md`.
