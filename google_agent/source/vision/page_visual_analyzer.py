"""
page_visual_analyzer.py — calls Gemini Vision on a real PDF page image.
Returns structured visual analysis: layout, diagrams, tables, text regions.
"""
from __future__ import annotations
import json
import os
from typing import Optional

try:
    from ...live_tutor_agents.contracts import JsonDict, clean_text, safe_dict, safe_list
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, clean_text, safe_dict, safe_list

try:
    from .image_loader import load_image_base64
except ImportError:
    from google_agent.source.vision.image_loader import load_image_base64


def _get_api_key() -> str:
    return (os.getenv("GOOGLE_GENAI_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()


def _get_vision_model() -> str:
    return os.getenv("GOOGLE_GEMINI_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"


async def analyze_page(resource_id: str, page_num: int, node_title: str = "", page_text: str = "") -> JsonDict:
    import aiohttp
    api_key = _get_api_key()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY missing", "page": page_num}

    b64 = load_image_base64(resource_id, page_num)
    if not b64:
        return {"ok": False, "error": f"No image for page {page_num}", "page": page_num}

    prompt = f"""Analyze this PDF page image. Concept being taught: "{node_title}".

Return JSON only:
{{
  "hasTable": bool,
  "hasDiagram": bool,
  "hasCode": bool,
  "hasFlowchart": bool,
  "layoutBlocks": ["heading|paragraph|bullet|table|diagram|code|image"],
  "textRegions": [{{"text": "...", "x": 0-1, "y": 0-1, "w": 0-1, "h": 0-1}}],
  "diagramArea": {{"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}} or null,
  "tableArea":   {{"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}} or null,
  "coreVisualFacts": ["fact from what you see"],
  "teacherMarkingHints": ["circle X", "arrow from A to B"],
  "confidence": 0.0-1.0
}}"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{_get_vision_model()}:generateContent?key={api_key}"
    body = {
        "contents": [{"role": "user", "parts": [
            {"inlineData": {"mimeType": "image/png", "data": b64}},
            {"text": prompt}
        ]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2048, "responseMimeType": "application/json"},
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=body) as resp:
            data = await resp.json()
    text = "".join(p.get("text", "") for p in safe_list(safe_dict(safe_list(safe_dict(data).get("candidates", [{}]))[0]).get("content", {}).get("parts", [])))
    try:
        result = json.loads(text.strip())
        result["page"] = page_num
        result["ok"]   = True
        return result
    except Exception:
        return {"ok": False, "page": page_num, "rawText": text[:200]}
