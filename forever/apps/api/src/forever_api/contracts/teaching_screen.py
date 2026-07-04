from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from forever_api.contracts.layouts import LAYOUT_REGIONS


ActionType = Literal[
    "write_text",
    "draw_arrow",
    "circle",
    "underline",
    "highlight_code_line",
    "show_output_line",
    "update_variable_table",
    "move_pointer",
    "source_focus",
    "show_quiz",
    "save_notebook_snapshot",
]


@dataclass(frozen=True)
class WordTimestamp:
    word: str
    startMs: int
    endMs: int


@dataclass(frozen=True)
class VoiceLine:
    id: str
    text: str
    startMs: int
    endMs: int
    wordTimestamps: list[WordTimestamp] = field(default_factory=list)


@dataclass(frozen=True)
class TimelineAction:
    id: str
    type: ActionType
    targetObjectId: str
    region: str
    lineNumber: int
    startMs: int
    endMs: int
    pointerOffsetMs: int = -300


@dataclass(frozen=True)
class VisualObject:
    id: str
    region: str
    kind: str
    text: str = ""


@dataclass(frozen=True)
class SubtitleWord:
    word: str
    startMs: int
    endMs: int
    beatId: str


@dataclass(frozen=True)
class SourceEvidence:
    sourceId: str
    sourceRef: str
    quote: str


@dataclass(frozen=True)
class NotebookPage:
    title: str
    keyNotes: list[str] = field(default_factory=list)
    sourceRefs: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class TeachingScreenManifest:
    sceneId: str
    layout: str
    durationMs: int
    voiceLines: list[VoiceLine]
    visualObjects: list[VisualObject]
    timelineActions: list[TimelineAction]
    subtitles: list[SubtitleWord]
    sourceEvidence: list[SourceEvidence]
    notebookPage: NotebookPage


def validate_teaching_screen_manifest(manifest: TeachingScreenManifest) -> None:
    if manifest.layout not in LAYOUT_REGIONS:
        raise ValueError(f"Unknown layout: {manifest.layout}")

    regions = LAYOUT_REGIONS[manifest.layout]
    for action in manifest.timelineActions:
        if action.region not in regions:
            raise ValueError(f"Action {action.id} uses unknown region {action.region}")
        if action.lineNumber < 0:
            raise ValueError(f"Action {action.id} has negative lineNumber")
        if action.startMs < 0 or action.endMs < 0:
            raise ValueError(f"Action {action.id} has negative timing")
        if action.endMs < action.startMs:
            raise ValueError(f"Action {action.id} has invalid timing")

    for obj in manifest.visualObjects:
        if obj.region not in regions:
            raise ValueError(f"Visual object {obj.id} uses unknown region {obj.region}")

    if manifest.durationMs <= 0:
        raise ValueError("Manifest duration must be positive")

