from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from forever_api.agents.registry import describe_agent_society, describe_full_agent_contracts
from forever_api.generation.demo_pipeline import generate_demo_course
from forever_api.generation.qwen_scene_pipeline import generate_qwen_course
from forever_api.orchestration.forever_graph import build_langgraph_placeholder
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


@app.get("/api/architecture/graph")
async def architecture_graph() -> dict:
    return build_langgraph_placeholder()


@app.get("/api/architecture/agents")
async def architecture_agents() -> dict:
    return {"agents": describe_agent_society()}


@app.get("/api/architecture/agent-contracts")
async def architecture_agent_contracts() -> dict:
    return {"contracts": describe_full_agent_contracts()}


@app.post("/api/courses/start", response_model=CourseStartResponse)
async def start_course(request: CourseStartRequest) -> CourseStartResponse:
    if request.use_qwen:
        result = await generate_qwen_course(
            text=request.text,
            input_type=request.input_type,
            learner_level=request.learner_level,
            target_minutes=request.target_minutes,
        )
    else:
        result = generate_demo_course(
            text=request.text,
            input_type=request.input_type,
            target_minutes=request.target_minutes,
        )
        result["generationMode"] = "deterministic"
        result["qwenUsed"] = False

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
        generationMode=result["generationMode"],
        qwenUsed=result["qwenUsed"],
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
