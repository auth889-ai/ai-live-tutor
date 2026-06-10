"""
timing_engine.py — calculates precise startMs/durationMs for all board/voice/subtitle actions.
No gaps between timings. Voice, board, subtitle, pointer all perfectly synced.
"""
from __future__ import annotations
from typing import List

try:
    from ..live_tutor_agents.contracts import JsonDict, safe_dict, safe_list
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list

MS_PER_WORD = {"beginner": 72, "intermediate": 62, "advanced": 52}
PAUSE_AFTER = {"beginner": 700, "intermediate": 350, "advanced": 150}
COMPLEXITY_PAUSE = {"easy": 0, "medium": 400, "hard": 800, "advanced": 1200}
PDF_IMAGE_HOLD_MS = 12000
POINTER_MOVE_MS   = 400
HIGHLIGHT_DELAY   = 200
BOARD_WRITE_SPEED = 40   # ms per character for animated write


def calculate_voice_timing(voice_lines: List[JsonDict], student_level: str = "beginner", complexity: str = "medium") -> List[JsonDict]:
    ms_per_word  = MS_PER_WORD.get(student_level, 62)
    pause_after  = PAUSE_AFTER.get(student_level, 350)
    comp_pause   = COMPLEXITY_PAUSE.get(complexity, 400)
    cur_ms       = 0

    for vl in voice_lines:
        v = safe_dict(vl)
        words    = len((v.get("text") or "").split())
        dur      = max(1500, words * ms_per_word + 200)
        extra    = comp_pause if v.get("teacherTransition") in ("emphasis","warning") else 0
        vl["startMs"]   = cur_ms
        vl["endMs"]     = cur_ms + dur
        vl["durationMs"] = dur
        cur_ms += dur + pause_after + extra

    return voice_lines


def sync_commands_to_voice(board_commands: List[JsonDict], voice_lines: List[JsonDict]) -> List[JsonDict]:
    """Link each board command to the voice line that matches it. No gaps."""
    voice_map = {safe_dict(v).get("voiceLineId"): safe_dict(v) for v in voice_lines}

    for cmd in board_commands:
        c   = safe_dict(cmd)
        vid = c.get("voiceLineId") or ""
        vl  = voice_map.get(vid)

        if vl:
            cmd_type = c.get("type") or ""
            if cmd_type == "showPdfPageImage":
                cmd["startMs"]    = int(vl.get("startMs") or 0)
                cmd["durationMs"] = PDF_IMAGE_HOLD_MS
            elif cmd_type == "movePointer":
                cmd["startMs"]    = int(vl.get("startMs") or 0) + POINTER_MOVE_MS
                cmd["durationMs"] = POINTER_MOVE_MS
            elif cmd_type in ("underline","highlight","drawCircle"):
                cmd["startMs"]    = int(vl.get("startMs") or 0) + HIGHLIGHT_DELAY
                cmd["durationMs"] = 600
            elif cmd_type == "write":
                text    = c.get("text") or ""
                cmd["startMs"]    = int(vl.get("startMs") or 0)
                cmd["durationMs"] = max(800, len(text) * BOARD_WRITE_SPEED)
            else:
                cmd["startMs"]    = int(vl.get("startMs") or 0)

    return board_commands


def calculate_segment_total_ms(voice_lines: List[JsonDict]) -> int:
    if not voice_lines:
        return 30000
    last = max(safe_dict(v).get("endMs") or 0 for v in voice_lines)
    return int(last) + 2000
