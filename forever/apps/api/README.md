# Forever API

FastAPI backend for the Forever tutor generation pipeline.

The first slice exposes a deterministic demo pipeline plus a real Qwen Cloud client boundary. This keeps the demo reliable while still proving the intended Alibaba Cloud integration.

## Run

```bash
pip install -r requirements.txt
uvicorn forever_api.main:app --reload --port 8000
```

