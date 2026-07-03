from __future__ import annotations

from typing import Any, Literal, TypedDict


GenerationStatus = Literal[
    "created",
    "ingesting",
    "planning",
    "generating",
    "reviewing",
    "repairing",
    "ready",
    "failed",
]


class ForeverState(TypedDict, total=False):
    course_id: str
    session_id: str
    user_id: str
    status: GenerationStatus
    progress: int

    input_type: str
    raw_input_text: str
    source_pack: dict[str, Any]
    semantic_context: list[dict[str, Any]]

    learning_units: list[dict[str, Any]]
    course_plan: dict[str, Any]
    current_episode: dict[str, Any]
    teaching_intents: list[dict[str, Any]]
    representations: list[dict[str, Any]]

    script_beats: list[dict[str, Any]]
    tts_alignment: dict[str, Any]
    timeline_manifest: dict[str, Any]
    review_report: dict[str, Any]
    ready_scene_ids: list[str]
    errors: list[str]


def new_state(course_id: str, session_id: str, text: str, input_type: str) -> ForeverState:
    return {
        "course_id": course_id,
        "session_id": session_id,
        "status": "created",
        "progress": 0,
        "input_type": input_type,
        "raw_input_text": text,
        "errors": [],
        "ready_scene_ids": [],
    }

