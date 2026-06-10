"""
teacher_script_builder.py — converts explanation into natural teacher voice lines.
Each line linked to a board command. Sounds like a real human, not robotic text.
"""
from __future__ import annotations
import re, time, uuid
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

TEACHER_TRANSITIONS = {
    "emphasis":   ["Notice that", "Pay attention to", "This is important:"],
    "reveal":     ["Now watch", "Here is what happens", "Let me show you"],
    "analogy":    ["Think of it like", "It is similar to", "Imagine"],
    "source":     ["The PDF states exactly:", "According to your source:", "From page {page}:"],
    "question":   ["Have you ever wondered", "Ask yourself:", "Here is the question:"],
    "warning":    ["Stop. This is where most people get it wrong.", "Be careful:", "Common mistake:"],
    "connection": ["This connects to", "Remember when we said", "Building on that:"],
    "summary":    ["So in summary:", "The key insight is:", "What this means is:"],
}

_VID = lambda: f"v_{int(time.time()*1000)}_{uuid.uuid4().hex[:4]}"


def build_voice_lines(
    explanation_text: str,
    board_commands: List[JsonDict],
    segment_type: str = "definition",
    student_level: str = "beginner",
) -> List[JsonDict]:
    sentences  = _split_sentences(clean_text(explanation_text, 20000))
    cmd_list   = safe_list(board_commands)
    voice_lines = []
    cur_ms      = 0
    pace_ms     = 70 if student_level == "beginner" else 55  # ms per word

    for i, sentence in enumerate(sentences[:80]):
        wcount    = len(sentence.split())
        dur_ms    = max(1500, wcount * pace_ms + 300)
        cmd_match = cmd_list[i] if i < len(cmd_list) else {}
        cid       = safe_dict(cmd_match).get("commandId") or ""
        sid       = safe_dict(cmd_match).get("screenId")  or ""
        seg_id    = safe_dict(cmd_match).get("segmentId") or ""

        voice_lines.append({
            "voiceLineId":      _VID(),
            "text":             sentence,
            "linkedCommandId":  cid,
            "screenId":         sid,
            "segmentId":        seg_id,
            "startMs":          cur_ms,
            "endMs":            cur_ms + dur_ms,
            "durationMs":       dur_ms,
            "wordCount":        wcount,
            "emotion":          _emotion(segment_type, i),
            "pace":             "slow" if student_level == "beginner" else "normal",
            "teacherTransition": _transition(sentence, segment_type),
        })
        cur_ms += dur_ms + (600 if student_level == "beginner" else 200)

    return voice_lines


def _split_sentences(text: str) -> List[str]:
    raw = re.split(r"(?<=[.!?])\s+", text)
    out = []
    for s in raw:
        s = s.strip()
        if len(s) > 200:  # split very long sentences at commas
            parts = [p.strip() for p in s.split(",") if len(p.strip()) > 10]
            out.extend(parts)
        elif s:
            out.append(s)
    return out


def _emotion(seg_type: str, index: int) -> str:
    if seg_type == "warning":    return "serious"
    if seg_type == "quiz":       return "encouraging"
    if seg_type == "intro":      return "enthusiastic"
    if seg_type == "recap":      return "warm"
    return "teacher-clear"


def _transition(sentence: str, seg_type: str) -> str:
    low = sentence.lower()
    if any(w in low for w in ["notice", "important", "key", "critical"]): return "emphasis"
    if seg_type == "warning":   return "warning"
    if "for example" in low or "e.g." in low: return "analogy"
    if "?" in sentence:         return "question"
    return ""
