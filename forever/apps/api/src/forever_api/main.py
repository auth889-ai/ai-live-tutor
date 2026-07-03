from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from forever_api.generation.demo_pipeline import generate_demo_course
from forever_api.qwen.client import QwenClient
from forever_api.schemas.course import CourseStartRequest, CourseStartResponse
from forever_api.storage.memory_store import store

app = FastAPI(title="Forever API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "service": "forever-api"}


@app.get("/api/qwen/health")
async def qwen_health() -> dict:
    return await QwenClient().health()


@app.post("/api/courses/start", response_model=CourseStartResponse)
async def start_course(request: CourseStartRequest) -> CourseStartResponse:
    result = generate_demo_course(
        text=request.text,
        input_type=request.input_type,
        target_minutes=request.target_minutes,
    )
    course = result["course"]
    manifest = result["manifest"]
    store.save_course(course, manifest)

    return CourseStartResponse(
        courseId=course["courseId"],
        sessionId="session_demo_001",
        title=course["title"],
        status="ready",
        firstSceneId=manifest["sceneId"],
        manifest=manifest,
    )


@app.get("/api/scenes/{scene_id}/manifest")
async def get_scene_manifest(scene_id: str) -> dict:
    manifest = store.get_scene(scene_id)
    if manifest is None:
        demo = generate_demo_course(
            text="Nested loop pattern lesson",
            input_type="topic",
            target_minutes=8,
        )
        manifest = demo["manifest"]
        store.save_course(demo["course"], manifest)

    if manifest["sceneId"] != scene_id:
        raise HTTPException(status_code=404, detail="Scene not found")

    return manifest

