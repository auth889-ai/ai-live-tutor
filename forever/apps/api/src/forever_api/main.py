from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from forever_api.routers.source_packs import create_source_pack_endpoint


app = FastAPI(title="Forever API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "service": "forever-api"}


@app.post("/api/source-packs")
async def create_source_pack(payload: dict[str, Any]) -> dict[str, Any]:
    status_code, body = create_source_pack_endpoint(payload)
    if status_code >= 400:
        raise HTTPException(status_code=status_code, detail=body["error"])
    return body

