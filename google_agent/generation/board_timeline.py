"""
google_agent/generation/board_timeline.py
===============================================================================
BOARD TIMELINE AGENT — Stage B ("generate actions" over the screen content).

A REAL Gemini agent (uses the API key) — NOT a rule-based compiler.
Given a screen's content (elements + voice lines) and the REAL PDF regions the
vision agent found, the model generates the ORDERED teacher Action timeline:
which element/region to spotlight, when to speak, what to write.

How "correct thing at correct time" is guaranteed REAL (not estimated by rules):
  - Correct THING: the model may target ONLY a real elementId (from this screen)
    or a real regionId (from the vision list). A validator REJECTS any target
    that is not real and re-prompts (no fake fallback). The frontend resolves the
    region's real bbox via getBoundingClientRect() -> pixel-accurate pointing.
  - Correct TIME: actions carry an ORDER and a sync type. Real timing is produced
    at playback: the player fires the visual-focus action, plays the TTS audio for
    the speech, and WAITS for the audio to actually end before the next action.
    So timing comes from real TTS audio duration (Stage D), not guesses.

Action model the agent follows (enforced by the validator):
  - fire-and-forget actions (spotlight/movePointer/highlight/circle/zoomRegion)
    come BEFORE their speech; speech/writing are synchronous.
  - writing actions place text on a FIXED 1000x563 canvas inside the safe zone.
===============================================================================
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional

try:
    from ..pipeline.gemini_structured import (
        generate_structured_async, FLASH_MODEL, GeminiStructuredError,
    )
    from ..live_tutor_agents.contracts import clean_text, safe_dict, safe_list, make_id
except ImportError:  # pragma: no cover
    from google_agent.pipeline.gemini_structured import (  # type: ignore
        generate_structured_async, FLASH_MODEL, GeminiStructuredError,
    )
    from google_agent.live_tutor_agents.contracts import (  # type: ignore
        clean_text, safe_dict, safe_list, make_id,
    )


CANVAS_W = 1000
CANVAS_H = 563
SAFE_MARGIN = 40

WRITE_TYPES = {"writeText", "drawArrow", "drawTable", "drawCode", "drawLatex", "drawBox", "labelDiagram"}


class TimelineError(RuntimeError):
    """Honest failure — never emit a meaningless/targetless action."""


# ─────────────────────────────────────────────────────────────────────────────
# Action timeline schema (what the model returns)
# ─────────────────────────────────────────────────────────────────────────────

_ACTION = {
    "type": "object",
    "properties": {
        "order":       {"type": "number", "description": "play order within the screen (0,1,2,...)"},
        "type":        {"type": "string",
                        "description": "spotlight|movePointer|highlight|circle|underline|zoomRegion|"
                                       "traceConnection|speech|writeText|drawArrow|drawTable|drawCode|drawLatex|drawBox"},
        "sync":        {"type": "string", "description": "fire_and_forget | synchronous"},
        "elementId":   {"type": "string", "description": "a real elementId from this screen (or empty)"},
        "regionId":    {"type": "string", "description": "a real regionId from the vision list (or empty)"},
        "voiceLineId": {"type": "string", "description": "the voice line this action belongs to"},
        "text":        {"type": "string", "description": "speech text, or the text to write"},
        "canvas":      {"type": "object", "properties": {
                            "x": {"type": "number"}, "y": {"type": "number"},
                            "width": {"type": "number"}, "height": {"type": "number"},
                            "fontSize": {"type": "number"}},
                        "description": "for write actions only: position on the 1000x563 board"},
    },
    "required": ["order", "type", "sync", "voiceLineId"],
}

_SCREEN_TIMELINE = {
    "type": "object",
    "properties": {
        "screenId": {"type": "string"},
        "actions":  {"type": "array", "items": _ACTION},
    },
    "required": ["screenId", "actions"],
}

TIMELINE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {"screens": {"type": "array", "items": _SCREEN_TIMELINE}},
    "required": ["screens"],
}


# ─────────────────────────────────────────────────────────────────────────────
# Prompt context
# ─────────────────────────────────────────────────────────────────────────────

def _region_index(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for x in safe_list(payload.get("visionIndex")):
        r = safe_dict(x)
        if r.get("regionId"):
            out[r["regionId"]] = r
    return out


def _screen_context(screen: Dict[str, Any], regions: Dict[str, Dict[str, Any]]) -> str:
    screen = safe_dict(screen)
    lines = [f"SCREEN {screen.get('screenId')}  (mode={screen.get('mode')}, template={screen.get('template')})",
             f"  title: {clean_text(screen.get('title'), 160)}",
             "  ELEMENTS on this screen (use these exact elementIds):"]
    for el in safe_list(screen.get("elements")):
        el = safe_dict(el)
        lines.append(f"    - elementId={el.get('elementId')} type={el.get('elementType')} "
                     f"region={el.get('regionId') or '-'} :: {clean_text(el.get('title') or el.get('body'), 120)}")
    pages = {int(p) for p in safe_list(screen.get("pages")) if str(p).isdigit()}
    lines.append("  REAL PDF REGIONS you may point at (use these exact regionIds):")
    for rid, r in regions.items():
        if pages and int(r.get("page") or 0) not in pages:
            continue
        b = safe_dict(r.get("bbox"))
        lines.append(f"    - regionId={rid} page={r.get('page')} bbox=({b.get('x')},{b.get('y')},{b.get('w')},{b.get('h')}) "
                     f":: {clean_text(r.get('title') or r.get('description'), 90)}")
    lines.append("  VOICE LINES to sequence (each needs its visual-focus action BEFORE it):")
    for v in safe_list(screen.get("voiceLines")):
        v = safe_dict(v)
        lines.append(f"    - voiceLineId={v.get('lineId')} suggestedTarget={v.get('targetRegionId') or v.get('targetElementId') or '-'} "
                     f":: {clean_text(v.get('text'), 160)}")
    return "\n".join(lines)


_PROMPT = """You are the BOARD TIMELINE agent for an AI tutor. For each screen below, generate the
ORDERED list of teacher Actions so the lesson "points / writes at the correct thing while speaking"
— like a great human teacher at a board.

RULES (must follow exactly):
- For EACH voice line: emit its visual-focus action (spotlight / movePointer / highlight / circle /
  zoomRegion) with a SMALLER `order` than that line's speech action (focus BEFORE speech).
  Focus actions have sync="fire_and_forget".
- Then emit the speech action: type="speech", sync="synchronous", the same voiceLineId, and its text.
- Point at the regionId (or elementId) that the voice line is ACTUALLY talking about — match the
  voice text to the region's description. This is what makes "correct thing at correct time" true.
- For REALTIME_WRITING screens, also emit write actions (writeText / drawArrow / drawTable /
  drawCode / drawLatex), sync="synchronous", with a `canvas` box on the FIXED {cw}x{ch} board.
  Keep every box inside the safe zone (x>={margin}, y>={margin}, x+width<={cw}-{margin},
  y+height<={ch}-{margin}) and DO NOT overlap boxes — stack them top to bottom.
- Every visual-focus / write action MUST target a real elementId (from that screen) OR a real
  regionId (from the region list). NEVER invent an id. A speech action may have an empty target.
- `order` increases 0,1,2,... in play order within the screen. Do NOT output timestamps — real
  timing comes from the audio at playback.

SCREENS:
{screens}

Return JSON: {{ "screens": [ {{ "screenId", "actions": [ ... ] }} ] }} only.
"""


# ─────────────────────────────────────────────────────────────────────────────
# Validation (no fake fallback)
# ─────────────────────────────────────────────────────────────────────────────

def _validate(screens_out: List[Dict[str, Any]], content_screens: List[Dict[str, Any]],
              regions: Dict[str, Dict[str, Any]]) -> List[str]:
    errors: List[str] = []
    by_id = {safe_dict(s).get("screenId"): s for s in content_screens}
    out_ids = {safe_dict(s).get("screenId") for s in screens_out}
    for s in content_screens:
        if safe_dict(s).get("screenId") not in out_ids:
            errors.append(f"missing timeline for screen {safe_dict(s).get('screenId')}")

    for sc in screens_out:
        sid = sc.get("screenId")
        src = safe_dict(by_id.get(sid))
        valid_elems = {safe_dict(e).get("elementId") for e in safe_list(src.get("elements"))}
        valid_lines = {safe_dict(v).get("lineId") for v in safe_list(src.get("voiceLines"))}
        actions = safe_list(sc.get("actions"))
        if not actions:
            errors.append(f"{sid}: no actions")
            continue
        for v in safe_list(src.get("voiceLines")):
            lid = safe_dict(v).get("lineId")
            la = [safe_dict(a) for a in actions if safe_dict(a).get("voiceLineId") == lid]
            focus = [a for a in la if a.get("sync") == "fire_and_forget"]
            speech = [a for a in la if a.get("type") == "speech"]
            if speech and focus and min(a.get("order", 0) for a in focus) > speech[0].get("order", 0):
                errors.append(f"{sid}/{lid}: focus ordered after its speech")
        for a in actions:
            a = safe_dict(a)
            atype = a.get("type")
            if a.get("voiceLineId") and valid_lines and a.get("voiceLineId") not in valid_lines:
                errors.append(f"{sid}: action references unknown voiceLineId {a.get('voiceLineId')}")
            if atype != "speech":
                eid, rid = a.get("elementId"), a.get("regionId")
                if not ((eid and eid in valid_elems) or (rid and rid in regions)):
                    errors.append(f"{sid}: {atype} targets a non-real id (elementId={eid}, regionId={rid})")
            if atype in WRITE_TYPES and safe_dict(a.get("canvas")):
                c = safe_dict(a.get("canvas"))
                if (c.get("x", -1) < SAFE_MARGIN - 1 or c.get("y", -1) < SAFE_MARGIN - 1
                        or c.get("x", 0) + c.get("width", 0) > CANVAS_W - SAFE_MARGIN + 1
                        or c.get("y", 0) + c.get("height", 0) > CANVAS_H - SAFE_MARGIN + 1):
                    errors.append(f"{sid}: write action outside safe zone")
    return errors


def _attach_bbox(screens_out: List[Dict[str, Any]], regions: Dict[str, Dict[str, Any]]) -> None:
    """Resolve each action's real bbox + sourceRef from the AI-chosen regionId (pure data lookup)."""
    for sc in screens_out:
        for a in safe_list(sc.get("actions")):
            a = safe_dict(a)
            r = regions.get(a.get("regionId")) if a.get("regionId") else None
            if r:
                a["bbox"] = safe_dict(r.get("bbox"))
                a["sourceRef"] = f"page:{r.get('page')}:{a.get('regionId')}"
            a.setdefault("actionId", make_id("act"))


# ─────────────────────────────────────────────────────────────────────────────
# The agent
# ─────────────────────────────────────────────────────────────────────────────

async def generate_segment_timeline(
    segment_content: Dict[str, Any],
    payload: Dict[str, Any],
    *,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    REAL Gemini agent: generate the ordered Action timeline for one segment.
    Validates targets are real + focus-before-speech; re-prompts once on failure.
    No fake fallback. Timing is resolved later by TTS + the player.
    """
    segment_content = safe_dict(segment_content)
    regions = _region_index(payload)
    content_screens = safe_list(segment_content.get("screens"))
    if not content_screens:
        raise TimelineError("segment has no screens")

    prompt = _PROMPT.format(
        cw=CANVAS_W, ch=CANVAS_H, margin=SAFE_MARGIN,
        screens="\n\n".join(_screen_context(s, regions) for s in content_screens),
    )

    async def _call(extra: str) -> List[Dict[str, Any]]:
        result = safe_dict(await generate_structured_async(
            prompt + extra, TIMELINE_SCHEMA, model=model or FLASH_MODEL,
            temperature=0.2, max_output_tokens=65536,
        ))
        return safe_list(result.get("screens"))

    screens_out = await _call("")
    errors = _validate(screens_out, content_screens, regions)
    if errors:
        print(f"[board_timeline] {segment_content.get('segmentId')}: {len(errors)} issues — re-prompting",
              file=sys.stderr)
        repair = ("\n\nREPAIR — your previous timeline had these problems; fix them EXACTLY and "
                  "return the full corrected JSON:\n- " + "\n- ".join(errors[:10]))
        screens_out = await _call(repair)
        errors = _validate(screens_out, content_screens, regions)
        if errors:
            raise TimelineError("timeline invalid after repair: " + "; ".join(errors[:6]))

    _attach_bbox(screens_out, regions)

    total = sum(len(safe_list(s.get("actions"))) for s in screens_out)
    focus = sum(1 for s in screens_out for a in safe_list(s.get("actions"))
                if safe_dict(a).get("sync") == "fire_and_forget")
    speech = sum(1 for s in screens_out for a in safe_list(s.get("actions"))
                 if safe_dict(a).get("type") == "speech")
    print(f"[board_timeline] {segment_content.get('segmentId')}: {len(screens_out)} screens, "
          f"{total} actions ({focus} focus, {speech} speech) — validated", file=sys.stderr)

    return {
        "segmentId": clean_text(segment_content.get("segmentId"), 120),
        "title": clean_text(segment_content.get("title"), 200),
        "canvas": {"width": CANVAS_W, "height": CANVAS_H},
        "screens": screens_out,
        "scenarioQuestions": safe_list(segment_content.get("scenarioQuestions")),
        "valid": True,
        "timingResolvedBy": "tts+player",
    }
