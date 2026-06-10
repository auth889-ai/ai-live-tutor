"""
teacher_marks.py — generates emphasis commands: underline, circle, arrow, highlight, pointer.
These are the "teacher's hand" on the board — appear in sync with voice.
"""
from __future__ import annotations
import time, uuid
from typing import Optional

try:
    from .command_contract import BoardCommand
except ImportError:
    from google_agent.visual.board.command_contract import BoardCommand


def _cid() -> str:
    return f"mark_{int(time.time()*1000)}_{uuid.uuid4().hex[:4]}"


def underline(text: str, x: float, y: float, w: float, screen_id: str, segment_id: str, start_ms: int, voice_id: str = "") -> dict:
    return BoardCommand(
        commandId=_cid(), type="underline", text=text,
        x=x, y=y, width=w, height=0.005, color="#2563eb",
        screenId=screen_id, segmentId=segment_id,
        startMs=start_ms, durationMs=800,
        voiceLineId=voice_id, teacherIntent="emphasize_key_term",
    ).to_dict()


def circle(x: float, y: float, r: float, screen_id: str, segment_id: str, start_ms: int, voice_id: str = "", color: str = "#f59e0b") -> dict:
    return BoardCommand(
        commandId=_cid(), type="drawCircle", text="",
        x=x, y=y, width=r*2, height=r*2, color=color,
        screenId=screen_id, segmentId=segment_id,
        startMs=start_ms, durationMs=600,
        voiceLineId=voice_id, teacherIntent="circle_key_element",
        circleTarget={"x": x, "y": y, "r": r},
    ).to_dict()


def highlight(text: str, x: float, y: float, w: float, h: float, screen_id: str, segment_id: str, start_ms: int, voice_id: str = "", color: str = "#fef08a") -> dict:
    return BoardCommand(
        commandId=_cid(), type="highlight", text=text,
        x=x, y=y, width=w, height=h, color=color,
        screenId=screen_id, segmentId=segment_id,
        startMs=start_ms, durationMs=500,
        voiceLineId=voice_id, teacherIntent="highlight_source_quote",
        highlightBox={"x": x, "y": y, "w": w, "h": h, "color": color},
    ).to_dict()


def move_pointer(x: float, y: float, screen_id: str, segment_id: str, start_ms: int, voice_id: str = "") -> dict:
    return BoardCommand(
        commandId=_cid(), type="movePointer", text="",
        x=x, y=y, screenId=screen_id, segmentId=segment_id,
        startMs=start_ms, durationMs=400,
        voiceLineId=voice_id, teacherIntent="point_at_element",
        pointerTarget={"x": x, "y": y},
    ).to_dict()


def draw_arrow(from_x: float, from_y: float, to_x: float, to_y: float, label: str, screen_id: str, segment_id: str, start_ms: int, voice_id: str = "") -> dict:
    return BoardCommand(
        commandId=_cid(), type="drawArrow", text=label,
        x=from_x, y=from_y, width=to_x-from_x, height=to_y-from_y, color="#dc2626",
        screenId=screen_id, segmentId=segment_id,
        startMs=start_ms, durationMs=1000,
        voiceLineId=voice_id, teacherIntent="show_relationship",
        arrowTarget={"fromX": from_x, "fromY": from_y, "toX": to_x, "toY": to_y, "label": label},
    ).to_dict()
