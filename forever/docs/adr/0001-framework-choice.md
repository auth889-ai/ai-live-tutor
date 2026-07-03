# ADR 0001: Backend Framework Choice

## Decision

Forever uses **FastAPI** for the core backend, not NestJS.

## Reason

The main product risk is AI workflow quality:

- LangGraph orchestration
- LangChain/Qwen integration
- Celery workers
- semantic retrieval
- Python PDF/text processing
- validation and repair loops

These are stronger and faster to build in Python.

## Node Boundary

Node is still used where it is strongest:

- `apps/realtime`: BullMQ + WebSocket gateway
- frontend course player
- possible future Next.js shell

NestJS is not needed for the current hackathon path. If we later convert the realtime gateway into a larger service, NestJS can be introduced there without changing the Python generation backend.

