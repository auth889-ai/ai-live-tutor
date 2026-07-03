from __future__ import annotations

from pydantic import BaseModel, Field


class SourceEvidence(BaseModel):
    source_id: str = Field(alias="sourceId")
    source_ref: str = Field(alias="sourceRef")
    quote: str


class VoiceLine(BaseModel):
    voice_line_id: str = Field(alias="voiceLineId")
    beat_id: str = Field(alias="beatId")
    text: str
    start_ms: int = Field(alias="startMs", ge=0)
    end_ms: int = Field(alias="endMs", ge=0)


class SubtitleWord(BaseModel):
    word: str
    start_ms: int = Field(alias="startMs", ge=0)
    end_ms: int = Field(alias="endMs", ge=0)
    beat_id: str = Field(alias="beatId")


class LayoutRegion(BaseModel):
    region_id: str = Field(alias="regionId")
    capability: str
    x: float
    y: float
    w: float
    h: float


class TimelineObject(BaseModel):
    object_id: str = Field(alias="objectId")
    type: str
    region_id: str = Field(alias="regionId")
    x: float = 0
    y: float = 0
    w: float = 0
    h: float = 0
    content: dict = Field(default_factory=dict)
    style: dict = Field(default_factory=dict)


class BoardAction(BaseModel):
    action_id: str = Field(alias="actionId")
    type: str
    start_ms: int = Field(alias="startMs", ge=0)
    end_ms: int = Field(alias="endMs", ge=0)
    object_id: str | None = Field(default=None, alias="objectId")
    target_object_id: str | None = Field(default=None, alias="targetObjectId")
    target_region: str | None = Field(default=None, alias="targetRegion")
    payload: dict = Field(default_factory=dict)


class TimelineManifest(BaseModel):
    version: str = "1.0"
    scene_id: str = Field(alias="sceneId")
    learning_unit_id: str = Field(alias="learningUnitId")
    teaching_intent: str = Field(alias="teachingIntent")
    duration_ms: int = Field(alias="durationMs", ge=1)
    layout: dict
    objects: list[TimelineObject]
    actions: list[BoardAction]
    voice_lines: list[VoiceLine] = Field(alias="voiceLines")
    subtitles: list[SubtitleWord]
    interactions: list[dict] = Field(default_factory=list)
    source_evidence: list[SourceEvidence] = Field(alias="sourceEvidence")

