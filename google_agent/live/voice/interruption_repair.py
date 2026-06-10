"""
interruption_repair.py — generates repair segment when student says "I'm confused".
Reads exact board state, creates new screens, appends to session, resumes from stop point.
"""
from __future__ import annotations
import time, uuid, json, os
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

try:
    from ..voice.teacher_script_builder import build_voice_lines
    from ..voice.subtitle_aligner       import align_subtitles
except ImportError:
    from google_agent.live.voice.teacher_script_builder import build_voice_lines
    from google_agent.live.voice.subtitle_aligner       import align_subtitles


async def build_repair_segment(
    student_question: str,
    current_state: JsonDict,
    source_evidence: List[JsonDict],
    node_title: str = "",
    student_level: str = "beginner",
) -> JsonDict:
    cs         = safe_dict(current_state)
    seg_id     = f"repair_{int(time.time()*1000)}_{uuid.uuid4().hex[:4]}"
    screen_id  = f"scr_repair_{uuid.uuid4().hex[:4]}"
    cur_screen = cs.get("currentScreenId") or ""
    cur_ms     = int(cs.get("currentMs") or cs.get("currentVoiceMs") or 0)

    # Call Gemini to generate repair explanation
    explanation = await _gemini_repair(student_question, source_evidence, node_title, cur_screen)

    voice_lines = build_voice_lines(explanation, [], segment_type="repair", student_level=student_level)
    subtitles   = align_subtitles(voice_lines)

    board_cmds = [{
        "commandId":   f"cmd_repair_{uuid.uuid4().hex[:4]}",
        "type":        "write",
        "text":        f"Student question: {student_question[:60]}",
        "screenId":    screen_id,
        "segmentId":   seg_id,
        "startMs":     0,
        "durationMs":  2000,
        "color":       "#7c3aed",
        "teacherIntent": "address_confusion",
    }]

    return {
        "segmentId":       seg_id,
        "segmentType":     "repair",
        "title":           f"Answering: {student_question[:50]}",
        "resumeFromScreenId": cur_screen,
        "resumeFromMs":    cur_ms,
        "boardScreens":    [{"screenId": screen_id, "screenType": "repair", "boardCommands": board_cmds}],
        "boardCommands":   board_cmds,
        "voiceScript":     voice_lines,
        "subtitles":       subtitles,
        "sourceRefs":      safe_list(source_evidence)[:6],
        "metadata":        {"fallbackUsed": False, "isRepair": True, "studentQuestion": student_question},
    }


async def _gemini_repair(question: str, evidence: List[JsonDict], node_title: str, screen_id: str) -> str:
    api_key = (os.getenv("GOOGLE_GENAI_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        return f"Good question. {question}. Let me explain this more clearly using the source evidence."

    ev_text = "\n".join(f"[p.{safe_dict(e).get('page')}]: {clean_text(safe_dict(e).get('text') or '', 200)}" for e in evidence[:4])
    prompt  = f"""Student is learning about: "{node_title}"
Student said: "{question}"
Available evidence from PDF:
{ev_text}

Write a clear, warm, 5-8 sentence teacher response that:
1. Validates the question ("Great question.")
2. Directly answers it using the evidence
3. Uses a simple analogy if helpful
4. Connects back to the main concept
5. Ends with "Does that make sense?"
Be conversational, not robotic. Use "you" and "we"."""

    import aiohttp
    url  = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1024}}
    async with aiohttp.ClientSession() as s:
        async with s.post(url, json=body) as r:
            data = await r.json()
    parts = safe_list(safe_dict(safe_list(safe_dict(data).get("candidates",[{}]))[0]).get("content",{}).get("parts",[]))
    return clean_text("".join(safe_dict(p).get("text","") for p in parts), 3000) or "Let me explain this differently."
