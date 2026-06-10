"""
segment_pipeline.py — generates ONE segment at a time.
Frontend plays segment N while segment N+1 generates. No timeout. No gaps.
"""
from __future__ import annotations
import time, uuid, json, os
from typing import List

try:
    from ..live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

try:
    from ..source.rag.evidence_selector  import select_evidence
    from ..source.rag.citation_builder   import build_source_badge
    from ..visual.board.screen_planner   import plan_screens_for_segment
    from ..visual.board.command_contract import BoardCommand
    from ..live.voice.teacher_script_builder import build_voice_lines
    from ..live.voice.subtitle_aligner   import align_subtitles
    from .timing_engine import calculate_voice_timing, sync_commands_to_voice, calculate_segment_total_ms
except ImportError:
    from google_agent.source.rag.evidence_selector  import select_evidence
    from google_agent.source.rag.citation_builder   import build_source_badge
    from google_agent.visual.board.screen_planner   import plan_screens_for_segment
    from google_agent.visual.board.command_contract import BoardCommand
    from google_agent.live.voice.teacher_script_builder import build_voice_lines
    from google_agent.live.voice.subtitle_aligner   import align_subtitles
    from google_agent.pipeline.timing_engine import calculate_voice_timing, sync_commands_to_voice, calculate_segment_total_ms


async def generate_segment(
    segment_plan: JsonDict,
    all_chunks: List[JsonDict],
    node: JsonDict,
    vision_packet: JsonDict,
    lesson_context: JsonDict,
) -> JsonDict:
    sp   = safe_dict(segment_plan)
    n    = safe_dict(node)
    lc   = safe_dict(lesson_context)
    seg_type     = sp.get("segmentType") or "definition"
    seg_id       = sp.get("segmentId")   or f"seg_{uuid.uuid4().hex[:6]}"
    student_level = lc.get("studentLevel") or "beginner"
    lesson_mode   = lc.get("lessonMode")   or "masterclass"
    page_nums     = [int(p) for p in safe_list(n.get("pageRefs") or [])]

    # Per-segment RAG: different evidence per segment type
    evidence = select_evidence(all_chunks, n.get("title") or "", seg_type, page_nums, max_items=10)

    # Plan screens for this segment
    screens = plan_screens_for_segment(seg_type, n, vision_packet, student_level, lesson_mode)
    for scr in screens:
        scr["segmentId"] = seg_id

    # Generate content from Gemini
    explanation = await _gemini_segment_content(seg_type, n, evidence, lc)

    # Build voice lines
    flat_cmds   = [c for scr in screens for c in safe_list(scr.get("boardCommands") or [])]
    voice_lines = build_voice_lines(explanation, flat_cmds, seg_type, student_level)
    voice_lines = calculate_voice_timing(voice_lines, student_level, n.get("complexity") or "medium")

    # Sync board commands to voice timing
    sync_commands_to_voice(flat_cmds, voice_lines)

    # Subtitles
    subtitles = align_subtitles(voice_lines)

    source_badge = build_source_badge(evidence)
    total_ms     = calculate_segment_total_ms(voice_lines)

    return {
        "segmentId":    seg_id,
        "segmentIndex": sp.get("segmentIndex") or 1,
        "segmentType":  seg_type,
        "title":        sp.get("title") or "",
        "boardScreens": screens,
        "boardCommands": flat_cmds,
        "voiceScript":  voice_lines,
        "subtitles":    subtitles,
        "sourceRefs":   evidence,
        "sourceBadge":  source_badge,
        "estimatedMs":  total_ms,
        "voiceLineCount": len(voice_lines),
        "commandCount": len(flat_cmds),
        "generated":    True,
        "generatedAt":  int(time.time() * 1000),
        "metadata":     {"fallbackUsed": False, "segmentType": seg_type, "evidenceCount": len(evidence)},
    }


async def _gemini_segment_content(seg_type: str, node: JsonDict, evidence: List[JsonDict], ctx: JsonDict) -> str:
    api_key = (os.getenv("GOOGLE_GENAI_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        return f"This segment teaches {seg_type} for {node.get('title', 'this concept')}."

    n     = safe_dict(node)
    level = clean_text(ctx.get("studentLevel") or "beginner", 20)
    mode  = clean_text(ctx.get("lessonMode")   or "masterclass", 20)
    ev_text = "\n".join(f"[p.{safe_dict(e).get('page')}] {clean_text(safe_dict(e).get('text') or '', 300)}" for e in evidence[:5])

    prompts = {
        "intro":       f"Write an engaging 2-minute introduction for '{n.get('title')}'. Start with a real-world scenario. Create curiosity. Use evidence: {ev_text}",
        "definition":  f"Write a crystal-clear definition segment for '{n.get('title')}'. Include: formal definition, plain English, analogy, key terms to circle. Evidence: {ev_text}",
        "source_proof":f"Write a 'source proof' segment showing the student the real PDF evidence for '{n.get('title')}'. Read the text carefully and point to exact quotes. Evidence: {ev_text}",
        "pdf_diagram": f"Write teacher narration for explaining a diagram about '{n.get('title')}'. Walk through each element. Use pointer and highlight language. Evidence: {ev_text}",
        "example":     f"Write a detailed worked example for '{n.get('title')}'. Use real case from evidence. Step by step. Evidence: {ev_text}",
        "warning":     f"Write a dramatic warning segment for '{n.get('title')}'. Show the WRONG way, then the RIGHT way. Use evidence. Evidence: {ev_text}",
        "comparison":  f"Write a comparison segment for '{n.get('title')}'. Build a table row by row explaining each row. Evidence: {ev_text}",
        "quiz":        f"Write a quiz checkpoint for '{n.get('title')}'. 1 question, 4 options, 1 correct. Explain after answer. Evidence: {ev_text}",
        "recap":       f"Write a warm, memorable recap for '{n.get('title')}'. List 5 key points. Reference sources. End with encouragement. Evidence: {ev_text}",
    }
    prompt = prompts.get(seg_type) or prompts["definition"]
    prompt += f"\n\nStudent level: {level}. Lesson mode: {mode}. Be a world-class human teacher. Natural speech, not robotic."

    import aiohttp
    url  = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    body = {"contents": [{"role":"user","parts":[{"text":prompt}]}],
            "generationConfig": {"temperature":0.65,"maxOutputTokens":3000}}
    async with aiohttp.ClientSession() as s:
        async with s.post(url, json=body) as r:
            data = await r.json()
    parts = safe_list(safe_dict(safe_list(safe_dict(data).get("candidates",[{}]))[0]).get("content",{}).get("parts",[]))
    return clean_text("".join(safe_dict(p).get("text","") for p in parts), 6000) or f"Teaching {seg_type} for {n.get('title','')}."
