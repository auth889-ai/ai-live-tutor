"""
subtitle_aligner.py — assigns precise startMs/endMs to subtitle lines.
Syncs to voice lines. Max 12 words per subtitle line. No gap between timings.
"""
from __future__ import annotations
import time, uuid
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

MS_PER_WORD   = 65     # base ms per word at normal pace
MAX_WORDS     = 12     # max words per subtitle display line
MIN_DURATION  = 1200   # ms
POINTER_DELAY = 100    # ms delay: subtitle → pointer
BOARD_DELAY   = 200    # ms delay: subtitle → board action


def align_subtitles(voice_lines: List[JsonDict], pace_multiplier: float = 1.0) -> List[JsonDict]:
    subtitles: List[JsonDict] = []
    for vl in safe_list(voice_lines):
        v      = safe_dict(vl)
        text   = clean_text(v.get("text") or "", 600)
        start  = int(v.get("startMs") or 0)
        end    = int(v.get("endMs")   or start + 2000)
        vid    = v.get("voiceLineId") or ""
        words  = text.split()

        if len(words) <= MAX_WORDS:
            subtitles.append(_make_sub(text, start, end, vid))
        else:
            # Split long line into chunks of MAX_WORDS
            chunks = [words[i:i+MAX_WORDS] for i in range(0, len(words), MAX_WORDS)]
            total_words = len(words)
            cur_ms = start
            for chunk in chunks:
                chunk_text = " ".join(chunk)
                chunk_ms   = max(MIN_DURATION, int((len(chunk) / max(total_words,1)) * (end - start) * pace_multiplier))
                subtitles.append(_make_sub(chunk_text, cur_ms, cur_ms + chunk_ms, vid))
                cur_ms += chunk_ms

    return subtitles


def _make_sub(text: str, start_ms: int, end_ms: int, voice_line_id: str) -> JsonDict:
    return {
        "subtitleId":   f"sub_{int(time.time()*1000)}_{uuid.uuid4().hex[:4]}",
        "text":         text,
        "startMs":      start_ms,
        "endMs":        max(end_ms, start_ms + MIN_DURATION),
        "voiceLineId":  voice_line_id,
        "pointerMs":    start_ms + POINTER_DELAY,
        "boardActionMs": start_ms + BOARD_DELAY,
    }


def get_timing_offsets(start_ms: int) -> dict:
    """Returns all timing offsets for perfect sync — no gaps."""
    return {
        "voiceStartMs":   start_ms,
        "subtitleStartMs": start_ms,
        "pointerStartMs":  start_ms + POINTER_DELAY,
        "boardActionMs":   start_ms + BOARD_DELAY,
        "highlightMs":     start_ms + BOARD_DELAY + 100,
    }
