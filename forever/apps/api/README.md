# Forever API

Backend responsibility:

```text
learning material -> SourcePack -> service response
```

Nested structure:

- `contracts/` for region layout, teaching screen, and audio clock rules
- `ingestion/` for SourcePack building
- `routers/` for dependency-free route behavior
- `services/` for response wrappers around ingestion
- `main.py` for the FastAPI app entrypoint

Current slice:

- plain text SourcePack ingestion
- source-pack API behavior for `POST /api/source-packs`
- HTTP wrapper for `POST /api/source-packs`
- `/health`
- contract validation
- tests

Later slices:

- code sandbox
- Qwen orchestration
- multi-input ingestion

Run after installing dependencies:

```bash
pip install -r apps/api/requirements.txt
uvicorn forever_api.main:app --reload --port 8000
```
