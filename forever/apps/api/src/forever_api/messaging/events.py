from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


EventType = Literal[
    "COURSE_PROGRESS",
    "GRAPH_NODE_STARTED",
    "GRAPH_NODE_COMPLETED",
    "SCENE_READY",
    "REVIEW_FAILED",
    "GENERATION_FAILED",
]


class ForeverEvent(BaseModel):
    type: EventType
    course_id: str = Field(alias="courseId")
    session_id: str = Field(alias="sessionId")
    payload: dict = Field(default_factory=dict)

