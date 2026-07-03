from __future__ import annotations

from pydantic import BaseModel, Field

from forever_api.schemas.contracts import TimelineManifest


class CourseStartRequest(BaseModel):
    input_type: str = Field(default="topic", alias="inputType")
    text: str
    learner_level: str = Field(default="beginner", alias="learnerLevel")
    target_minutes: int = Field(default=8, alias="targetMinutes", ge=1, le=120)


class CourseStartResponse(BaseModel):
    course_id: str = Field(alias="courseId")
    session_id: str = Field(alias="sessionId")
    title: str
    status: str
    first_scene_id: str = Field(alias="firstSceneId")
    manifest: TimelineManifest

