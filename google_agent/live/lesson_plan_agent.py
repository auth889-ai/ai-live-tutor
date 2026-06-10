"""
lesson_plan_agent.py — calls Gemini to generate a rich lesson outline.
Decides segment sequence, titles, teaching goals per segment — dynamically from PDF.
"""
from __future__ import annotations
import json, os
from typing import List

try:
    from ..live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

try:
    from ..pipeline.lesson_planner import plan_lesson
except ImportError:
    from google_agent.pipeline.lesson_planner import plan_lesson


async def generate_lesson_outline(
    node: JsonDict,
    source_context: JsonDict,
    student_level: str = "beginner",
    lesson_mode: str = "masterclass",
) -> JsonDict:
    n   = safe_dict(node)
    sc  = safe_dict(source_context)

    # Start with structural plan (fast, no Gemini needed)
    structural = plan_lesson(n, student_level, lesson_mode)

    # Enrich with Gemini-generated titles and goals
    enriched = await _enrich_with_gemini(structural, n, sc, student_level, lesson_mode)
    return enriched


async def _enrich_with_gemini(plan: JsonDict, node: JsonDict, ctx: JsonDict, level: str, mode: str) -> JsonDict:
    api_key = (os.getenv("GOOGLE_GENAI_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        return plan

    n         = safe_dict(node)
    summary   = clean_text(safe_dict(ctx.get("fullPdfSummary") or {}).get("title") or "", 100)
    evidence  = "\n".join(f"[p.{safe_dict(e).get('page')}] {clean_text(safe_dict(e).get('text') or '', 150)}"
                           for e in safe_list(ctx.get("selectedEvidence") or [])[:4])
    seg_types = [s.get("segmentType") for s in safe_list(plan.get("segments") or [])]

    prompt = f"""You are planning a {mode} lesson about: "{n.get('title', '')}"
PDF context: {summary}
Evidence:\n{evidence}
Student level: {level}

For each of these segment types: {seg_types}
Generate a specific title and teaching goal (1 sentence each).
Return JSON:
{{
  "segments": [
    {{"segmentType": "intro", "title": "specific title", "teachingGoal": "what student will achieve"}}
  ],
  "lessonHook": "opening question or scenario to engage student",
  "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"]
}}"""

    import aiohttp
    url  = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    body = {"contents":[{"role":"user","parts":[{"text":prompt}]}],
            "generationConfig":{"temperature":0.5,"maxOutputTokens":2048,"responseMimeType":"application/json"}}
    async with aiohttp.ClientSession() as s:
        async with s.post(url,json=body) as r:
            data = await r.json()

    parts = safe_list(safe_dict(safe_list(safe_dict(data).get("candidates",[{}]))[0]).get("content",{}).get("parts",[]))
    raw   = "".join(safe_dict(p).get("text","") for p in parts)
    try:
        enrichment = json.loads(raw.strip())
        for orig, enr in zip(safe_list(plan.get("segments")), safe_list(enrichment.get("segments") or [])):
            orig["title"]       = enr.get("title")       or orig.get("title", "")
            orig["teachingGoal"]= enr.get("teachingGoal") or ""
        plan["lessonHook"]    = enrichment.get("lessonHook")    or ""
        plan["keyTakeaways"]  = enrichment.get("keyTakeaways")  or []
    except Exception:
        pass

    return plan
