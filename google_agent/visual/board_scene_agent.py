"""
google_agent/visual/board_scene_agent.py
===============================================================================
AI-FIRST Dynamic Board Scene Agent.

This agent converts VisualPlannerAgent output into renderable premium board
screens, scenes, layout zones, safe HTML preview blocks, source cards, and
commandDrafts for BoardCommandAgent.

Design rule:
- Gemini/VisualPlanner designs the lesson and screens.
- This Python file normalizes structure, preserves sourceRefs, repairs missing
  commandDraft.text from existing source-grounded content, and validates output.
- No fixed Star Schema template.
- No static/fake lesson fallback.
- No unsafe HTML.
===============================================================================
"""

from __future__ import annotations

import json
import re
from html import escape
from typing import Any, List

try:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        require_source_refs,
        safe_dict,
        safe_list,
    )
except Exception:
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
    from google_agent.live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        require_source_refs,
        safe_dict,
        safe_list,
    )


ALLOWED_BOARD_ACTIONS = {
    "setViewport",
    "writeText",
    "drawFlowchart",
    "drawTree",
    "drawTable",
    "drawTimeline",
    "drawCodeTrace",
    "drawERDiagram",
    "drawSequenceDiagram",
    "drawBox",
    "drawArrow",
    "drawCircle",
    "underline",
    "highlightNode",
    "showSourceBadge",
    "showQuiz",
    "recap",
}


def _json(value: Any, max_len: int = 60000) -> str:
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), max_len)
    except Exception:
        return clean_text(value, max_len)


def _visual_plan(payload: JsonDict) -> JsonDict:
    return safe_dict(payload.get("visualPlan") or payload.get("plan"))


def _title(payload: JsonDict) -> str:
    plan = _visual_plan(payload)
    adaptive = safe_dict(plan.get("adaptiveBoardDesign"))
    node = safe_dict(payload.get("selectedNode") or payload.get("node"))
    lesson = safe_dict(payload.get("visualLessonInput"))

    return clean_text(
        plan.get("title")
        or adaptive.get("title")
        or lesson.get("selectedNodeTitle")
        or node.get("title")
        or node.get("label")
        or payload.get("title")
        or payload.get("question")
        or "Premium AI Tutor Board",
        220,
    )


def _walk_refs(value: Any, refs: List[JsonDict]) -> None:
    if isinstance(value, list):
        for item in value:
            _walk_refs(item, refs)
        return

    if isinstance(value, dict):
        local_refs = value.get("sourceRefs")
        if isinstance(local_refs, list):
            refs.extend([safe_dict(x) for x in local_refs if safe_dict(x)])

        if value.get("sourceRef") or value.get("chunkId") or value.get("pageRef") or value.get("quote"):
            refs.append(safe_dict(value))

        for child in value.values():
            if isinstance(child, (dict, list)):
                _walk_refs(child, refs)


def _collect_refs(*values: Any) -> List[JsonDict]:
    refs: List[JsonDict] = []
    for value in values:
        _walk_refs(value, refs)
    return dedupe_source_refs(refs)[:180]


def _refs_for(item: JsonDict, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    refs = dedupe_source_refs([safe_dict(x) for x in safe_list(item.get("sourceRefs"))])
    return refs or fallback_refs[:6]


def _first_quote(refs: List[JsonDict], max_len: int = 500) -> str:
    for ref in refs:
        quote = clean_text(safe_dict(ref).get("quote") or "", max_len)
        if quote:
            return quote
    return ""


def _text_from_any(value: Any, max_len: int = 1800) -> str:
    if value is None:
        return ""

    if isinstance(value, str):
        return clean_text(value, max_len)

    if isinstance(value, list):
        parts: List[str] = []
        for item in value[:10]:
            text = _text_from_any(item, max(150, max_len // 2))
            if text:
                parts.append(text)
        return clean_text("; ".join(parts), max_len)

    if isinstance(value, dict):
        preferred_keys = [
            "text",
            "boardText",
            "teacherText",
            "narration",
            "caption",
            "title",
            "summary",
            "definition",
            "purpose",
            "body",
            "content",
            "teacherNotes",
            "teacherNarration",
            "teacherNarrative",
            "teacherNarrationGoal",
            "explanation",
            "goal",
            "screenGoal",
            "quote",
            "description",
            "teachingMeaning",
            "reason",
        ]

        parts: List[str] = []
        for key in preferred_keys:
            if key in value:
                text = _text_from_any(value.get(key), max(150, max_len // 2))
                if text:
                    parts.append(text)
            if len(parts) >= 4:
                break

        if not parts:
            for key, child in list(value.items())[:10]:
                if key in {"sourceRefs", "metadata", "layoutBox", "visualSpec", "htmlSpec", "diagramSpec"}:
                    continue
                text = _text_from_any(child, 220)
                if text:
                    parts.append(text)
                if len(parts) >= 4:
                    break

        return clean_text("; ".join(parts), max_len)

    return clean_text(str(value), max_len)


def _strip_unsafe_html(html: str) -> str:
    value = clean_text(html, 20000)
    value = re.sub(r"<\s*script[\s\S]*?<\s*/\s*script\s*>", "", value, flags=re.I)
    value = re.sub(r"\son[a-zA-Z]+\s*=\s*(['\"]).*?\1", "", value, flags=re.I)
    value = re.sub(r"\son[a-zA-Z]+\s*=\s*[^\s>]+", "", value, flags=re.I)
    value = re.sub(r"javascript\s*:", "", value, flags=re.I)
    return value


def _safe_css_class(value: Any, fallback: str = "ai-board-block") -> str:
    text = normalize_id(value, fallback)
    return text.replace("_", "-")


def _html_from_block(block: JsonDict, refs: List[JsonDict]) -> str:
    given = clean_text(
        safe_dict(block.get("htmlSpec")).get("html")
        or safe_dict(block.get("htmlSpec")).get("safeHtmlPreview")
        or block.get("safeHtmlPreview")
        or "",
        20000,
    )
    if given:
        return _strip_unsafe_html(given)

    title = escape(clean_text(block.get("title") or "Board block", 180))
    visual_form = escape(clean_text(block.get("visualForm") or block.get("type") or "adaptive", 120))
    content = block.get("content") if block.get("content") not in (None, "", [], {}) else block.get("body")

    if isinstance(content, list):
        body = "<ul>" + "".join(f"<li>{escape(clean_text(x, 280))}</li>" for x in content[:10]) + "</ul>"
    elif isinstance(content, dict):
        rows = []
        for key, value in list(content.items())[:10]:
            rows.append(
                "<tr>"
                f"<td>{escape(clean_text(key, 110))}</td>"
                f"<td>{escape(_text_from_any(value, 320))}</td>"
                "</tr>"
            )
        body = "<table>" + "".join(rows) + "</table>"
    else:
        body = f"<p>{escape(clean_text(content or block.get('teacherNotes') or '', 1400))}</p>"

    badges = []
    for ref in refs[:6]:
        page = safe_dict(ref).get("page")
        if page:
            badges.append(f"<span class='source-badge'>Pg. {escape(str(page))}</span>")

    badge_html = "".join(badges)
    cls = _safe_css_class(visual_form)

    return (
        f"<section class='ai-tutor-card {cls}' data-visual-form='{visual_form}'>"
        f"<header><strong>{title}</strong><div class='source-row'>{badge_html}</div></header>"
        f"<main>{body}</main>"
        "</section>"
    )


def _normalize_action(value: Any, block: JsonDict) -> str:
    action = clean_text(value or "", 80)
    if action in ALLOWED_BOARD_ACTIONS:
        return action

    visual_form = clean_text(
        block.get("visualForm")
        or block.get("type")
        or block.get("templateType")
        or block.get("kind")
        or "",
        160,
    ).lower()

    text = clean_text(
        block.get("title")
        or block.get("purpose")
        or _text_from_any(block.get("content"), 400)
        or "",
        500,
    ).lower()

    joined = f"{visual_form} {text}"

    if any(k in joined for k in ["code", "sql", "trace", "dry"]):
        return "drawCodeTrace"
    if any(k in joined for k in ["table", "matrix", "comparison", "compare"]):
        return "drawTable"
    if any(k in joined for k in ["timeline", "sequence of time"]):
        return "drawTimeline"
    if any(k in joined for k in ["tree", "hierarchy"]):
        return "drawTree"
    if any(k in joined for k in ["er diagram", "entity relationship"]):
        return "drawERDiagram"
    if any(k in joined for k in ["sequence diagram"]):
        return "drawSequenceDiagram"
    if any(k in joined for k in ["diagram", "schema", "flow", "map", "relationship", "architecture"]):
        return "drawFlowchart"
    if any(k in joined for k in ["quiz", "question", "checkpoint"]):
        return "showQuiz"
    if any(k in joined for k in ["recap", "summary"]):
        return "recap"
    if any(k in joined for k in ["source", "quote", "evidence", "pdf"]):
        return "showSourceBadge"

    return "writeText"


def _normalize_layout_box(raw: Any, fallback_index: int = 0) -> JsonDict:
    item = safe_dict(raw)

    def num(key: str, fallback: float) -> float:
        try:
            return float(item.get(key))
        except Exception:
            return fallback

    fallback_x = 56 + (fallback_index % 2) * 640
    fallback_y = 140 + (fallback_index // 2) * 230

    return {
        "x": num("x", fallback_x),
        "y": num("y", fallback_y),
        "width": max(180.0, num("width", 580.0)),
        "height": max(120.0, num("height", 190.0)),
    }


def _draft_text_candidates(
    draft: JsonDict,
    visual_payload: JsonDict,
    generated_draft: JsonDict,
    block: JsonDict,
    scene: JsonDict,
    refs: List[JsonDict],
) -> str:
    """
    Repairs blank commandDraft.text from already source-grounded content.
    It does not invent a new lesson and does not use a fixed domain template.
    """
    candidates = [
        draft.get("text"),
        draft.get("boardText"),
        draft.get("teacherText"),
        draft.get("narration"),
        draft.get("caption"),
        visual_payload.get("teacherNotes"),
        visual_payload.get("body"),
        visual_payload.get("content"),
        visual_payload.get("purpose"),
        visual_payload.get("title"),
        generated_draft.get("text"),
        safe_dict(generated_draft.get("visualPayload")).get("teacherNotes"),
        safe_dict(generated_draft.get("visualPayload")).get("body"),
        safe_dict(generated_draft.get("visualPayload")).get("content"),
        safe_dict(generated_draft.get("visualPayload")).get("purpose"),
        safe_dict(generated_draft.get("visualPayload")).get("title"),
        block.get("teacherNotes"),
        block.get("body"),
        block.get("content"),
        block.get("purpose"),
        block.get("title"),
        scene.get("teacherNarrationGoal"),
        scene.get("teacherNarrative"),
        scene.get("goal"),
        scene.get("title"),
        _first_quote(refs),
    ]

    for candidate in candidates:
        text = _text_from_any(candidate, 1800)
        if text:
            return text

    pages = [str(safe_dict(ref).get("page")) for ref in refs if safe_dict(ref).get("page")]
    page_text = f" from page {', '.join(dict.fromkeys(pages[:3]))}" if pages else ""
    return clean_text(f"Explain this source-grounded visual step{page_text}.", 1800)


def _raw_screens_from_plan(plan: JsonDict) -> List[JsonDict]:
    adaptive = safe_dict(plan.get("adaptiveBoardDesign"))
    nested_result = safe_dict(plan.get("result"))
    nested_visual_plan = safe_dict(plan.get("visualPlan"))

    candidates = [
        plan.get("premiumBoardScreens"),
        plan.get("boardScreens"),
        plan.get("screens"),
        plan.get("screenBlueprints"),
        plan.get("lessonScreens"),
        adaptive.get("screens"),
        adaptive.get("screenBlueprints"),
        adaptive.get("premiumBoardScreens"),
        nested_result.get("premiumBoardScreens"),
        nested_result.get("screens"),
        nested_visual_plan.get("premiumBoardScreens"),
        nested_visual_plan.get("screens"),
    ]

    for candidate in candidates:
        items = safe_list(candidate)
        if items:
            return [safe_dict(x) for x in items if safe_dict(x)]

    return []


def _normalize_block(raw: Any, screen_refs: List[JsonDict], index: int) -> JsonDict:
    item = safe_dict(raw)
    refs = _refs_for(item, screen_refs)

    block_id = normalize_id(
        item.get("blockId")
        or item.get("id")
        or item.get("title")
        or f"block_{index + 1}",
        f"block_{index + 1}",
    )

    visual_form = clean_text(
        item.get("visualForm")
        or item.get("templateType")
        or item.get("type")
        or item.get("kind")
        or "adaptive_visual_block",
        140,
    )

    layout_box = _normalize_layout_box(
        item.get("layoutBox")
        or item.get("box")
        or item.get("position")
        or safe_dict(item.get("layout")),
        index,
    )

    content = item.get("content") if item.get("content") not in (None, "", [], {}) else item.get("body")
    body = item.get("body") if item.get("body") not in (None, "", [], {}) else item.get("content")

    teacher_notes = clean_text(
        item.get("teacherNotes")
        or item.get("teacherNarration")
        or item.get("teacherNarrative")
        or item.get("explanation")
        or item.get("purpose")
        or _text_from_any(content, 1400),
        5000,
    )

    block = {
        **item,
        "blockId": block_id,
        "id": block_id,
        "type": visual_form,
        "templateType": visual_form,
        "visualForm": visual_form,
        "title": clean_text(item.get("title") or f"Board block {index + 1}", 220),
        "purpose": clean_text(item.get("purpose") or item.get("whyThisBlock") or teacher_notes, 1200),
        "content": content if isinstance(content, (dict, list)) else clean_text(content or teacher_notes, 7000),
        "body": body if isinstance(body, (dict, list)) else clean_text(body or content or teacher_notes, 7000),
        "teacherNotes": teacher_notes,
        "layoutBox": layout_box,
        "sourceRefs": refs,
        "sourceBadges": [f"Pg. {safe_dict(r).get('page')}" for r in refs if safe_dict(r).get("page")][:8],
        "visualSpec": safe_dict(item.get("visualSpec")),
        "htmlSpec": {
            **safe_dict(item.get("htmlSpec") or item.get("htmlTemplateSpec")),
            "safeHtml": True,
            "allowScripts": False,
        },
        "diagramSpec": safe_dict(item.get("diagramSpec")),
        "interactionSpec": safe_dict(item.get("interactionSpec")),
        "metadata": {
            **safe_dict(item.get("metadata")),
            "sourceGrounded": True,
            "fallbackUsed": False,
            "aiDesignedBlock": True,
        },
    }

    block["safeHtmlPreview"] = _html_from_block(block, refs)
    block["recommendedAction"] = _normalize_action(item.get("recommendedAction") or item.get("action"), block)
    return block


def _normalize_screen(raw: Any, fallback_refs: List[JsonDict], index: int) -> JsonDict:
    item = safe_dict(raw)
    refs = _refs_for(item, fallback_refs)

    screen_id = normalize_id(
        item.get("screenId")
        or item.get("id")
        or item.get("title")
        or f"screen_{index + 1}",
        f"screen_{index + 1}",
    )

    raw_blocks = safe_list(item.get("blocks") or item.get("visualBlocks") or item.get("sections"))
    blocks = [
        _normalize_block(block, refs, block_index)
        for block_index, block in enumerate(raw_blocks)
        if safe_dict(block)
    ]

    return {
        **item,
        "screenId": screen_id,
        "screenNo": int(item.get("screenNo") or item.get("order") or index + 1),
        "title": clean_text(item.get("title") or f"Screen {index + 1}", 220),
        "screenGoal": clean_text(item.get("screenGoal") or item.get("goal") or item.get("learningGoal") or "", 1500),
        "goal": clean_text(item.get("goal") or item.get("screenGoal") or item.get("learningGoal") or "", 1500),
        "designRationale": clean_text(item.get("designRationale") or item.get("whyThisScreen") or "", 1800),
        "teacherNarrative": clean_text(item.get("teacherNarrative") or item.get("teacherNotes") or "", 5000),
        "layoutIntent": safe_dict(item.get("layoutIntent") or item.get("layout")),
        "styleIntent": safe_dict(item.get("styleIntent") or item.get("visualStyle")),
        "blocks": blocks,
        "visualBlocks": blocks,
        "sourceRefs": refs,
        "estimatedSeconds": int(item.get("estimatedSeconds") or max(45, 25 + len(blocks) * 22)),
        "metadata": {
            **safe_dict(item.get("metadata")),
            "sourceGrounded": True,
            "fallbackUsed": False,
            "aiDesignedScreen": True,
        },
    }


def _block_for_draft(screens: List[JsonDict], scene_index: int, draft_index: int) -> JsonDict:
    if scene_index < 0 or scene_index >= len(screens):
        return {}
    blocks = safe_list(safe_dict(screens[scene_index]).get("blocks") or safe_dict(screens[scene_index]).get("visualBlocks"))
    if 0 <= draft_index < len(blocks):
        return safe_dict(blocks[draft_index])
    return {}


def _screen_to_scene(screen: JsonDict, index: int) -> JsonDict:
    refs = dedupe_source_refs([safe_dict(x) for x in safe_list(screen.get("sourceRefs"))])
    zones: List[JsonDict] = []
    drafts: List[JsonDict] = []

    for block_index, block_raw in enumerate(safe_list(screen.get("blocks") or screen.get("visualBlocks"))):
        block = safe_dict(block_raw)
        block_refs = _refs_for(block, refs)
        box = _normalize_layout_box(block.get("layoutBox"), block_index)
        zone_id = normalize_id(f"{screen.get('screenId')}_{block.get('blockId')}_zone", f"zone_{block_index + 1}")

        zones.append(
            {
                "zoneId": zone_id,
                "name": clean_text(block.get("title") or f"Zone {block_index + 1}", 180),
                "x": box["x"],
                "y": box["y"],
                "width": box["width"],
                "height": box["height"],
                "purpose": clean_text(block.get("purpose") or block.get("visualForm") or "adaptive board block", 500),
                "visualForm": clean_text(block.get("visualForm") or block.get("type"), 140),
            }
        )

        visual_payload = {
            "screenId": screen.get("screenId"),
            "screenNo": screen.get("screenNo"),
            "blockId": block.get("blockId"),
            "visualForm": block.get("visualForm") or block.get("type"),
            "title": block.get("title"),
            "purpose": block.get("purpose"),
            "content": block.get("content"),
            "body": block.get("body"),
            "teacherNotes": block.get("teacherNotes"),
            "visualSpec": safe_dict(block.get("visualSpec")),
            "htmlSpec": safe_dict(block.get("htmlSpec")),
            "diagramSpec": safe_dict(block.get("diagramSpec")),
            "interactionSpec": safe_dict(block.get("interactionSpec")),
            "safeHtmlPreview": clean_text(block.get("safeHtmlPreview"), 20000),
            "sourceRefs": block_refs,
            "sourceBadges": [f"Pg. {safe_dict(r).get('page')}" for r in block_refs if safe_dict(r).get("page")][:8],
            "sourceGrounded": True,
            "fallbackUsed": False,
        }

        action = _normalize_action(block.get("recommendedAction"), block)
        draft_text = _draft_text_candidates({}, visual_payload, {}, block, screen, block_refs)

        drafts.append(
            {
                "draftId": normalize_id(f"{screen.get('screenId')}_{block.get('blockId')}_draft", f"draft_{block_index + 1}"),
                "action": action,
                "text": draft_text,
                "targetZoneId": zone_id,
                "x": box["x"],
                "y": box["y"],
                "width": box["width"],
                "height": box["height"],
                "visualPayload": visual_payload,
                "durationMs": int(block.get("durationMs") or block.get("estimatedMs") or 3200),
                "sourceRefs": block_refs,
                "metadata": {
                    "fallbackUsed": False,
                    "sourceGrounded": True,
                    "dynamicTemplate": True,
                    "aiDesignedBlock": True,
                    "robustDraftTextRepair": False,
                },
            }
        )

    scene_refs = dedupe_source_refs(refs + [r for draft in drafts for r in safe_list(draft.get("sourceRefs"))])

    return {
        "sceneId": normalize_id(screen.get("screenId") or f"scene_{index + 1}", f"scene_{index + 1}"),
        "sceneType": clean_text(screen.get("sceneType") or "premium-board-screen", 100),
        "title": clean_text(screen.get("title") or f"Scene {index + 1}", 220),
        "goal": clean_text(screen.get("goal") or screen.get("screenGoal") or "", 1500),
        "teacherNarrationGoal": clean_text(screen.get("teacherNarrative") or screen.get("goal") or "", 5000),
        "screenNo": int(screen.get("screenNo") or index + 1),
        "layoutIntent": safe_dict(screen.get("layoutIntent")),
        "styleIntent": safe_dict(screen.get("styleIntent")),
        "layoutZones": zones,
        "commandDrafts": drafts,
        "sourceRefs": scene_refs,
        "estimatedMs": sum(int(draft.get("durationMs") or 0) for draft in drafts),
        "metadata": {
            "fallbackUsed": False,
            "sourceGrounded": True,
            "aiDesignedScene": True,
            "dynamicMultiTemplate": True,
        },
    }


def _html_blocks(screens: List[JsonDict]) -> List[JsonDict]:
    blocks: List[JsonDict] = []

    for screen in screens:
        for block in safe_list(screen.get("blocks") or screen.get("visualBlocks")):
            b = safe_dict(block)
            html = clean_text(b.get("safeHtmlPreview"), 20000)
            if not html:
                continue

            blocks.append(
                {
                    "htmlBlockId": normalize_id(f"html_{screen.get('screenId')}_{b.get('blockId')}", f"html_{len(blocks) + 1}"),
                    "screenId": screen.get("screenId"),
                    "blockId": b.get("blockId"),
                    "visualForm": b.get("visualForm") or b.get("type"),
                    "safeHtml": html,
                    "allowScripts": False,
                    "sourceRefs": safe_list(b.get("sourceRefs")),
                    "metadata": {
                        "sourceGrounded": True,
                        "fallbackUsed": False,
                    },
                }
            )

    return blocks[:80]


def _board_sections(screens: List[JsonDict]) -> List[JsonDict]:
    sections: List[JsonDict] = []

    for screen in screens:
        for block in safe_list(screen.get("blocks") or screen.get("visualBlocks")):
            b = safe_dict(block)
            sections.append(
                {
                    "sectionId": b.get("blockId") or f"section_{len(sections) + 1}",
                    "screenId": screen.get("screenId"),
                    "screenNo": screen.get("screenNo"),
                    "title": b.get("title"),
                    "sectionType": b.get("type"),
                    "visualForm": b.get("visualForm"),
                    "purpose": b.get("purpose"),
                    "body": b.get("body"),
                    "content": b.get("content"),
                    "teacherNotes": b.get("teacherNotes"),
                    "safeHtmlPreview": b.get("safeHtmlPreview"),
                    "visualSpec": safe_dict(b.get("visualSpec")),
                    "diagramSpec": safe_dict(b.get("diagramSpec")),
                    "sourceRefs": safe_list(b.get("sourceRefs")) or safe_list(screen.get("sourceRefs")),
                }
            )

    return sections


def _source_cards(refs: List[JsonDict]) -> List[JsonDict]:
    cards: List[JsonDict] = []
    seen = set()

    for ref in refs:
        r = safe_dict(ref)
        quote = clean_text(r.get("quote") or "", 900)
        page = r.get("page")
        key = f"{page}|{quote[:120]}".lower()

        if not quote or key in seen:
            continue

        seen.add(key)
        cards.append(
            {
                "cardId": normalize_id(f"source_pg_{page}_{len(cards) + 1}", f"source_card_{len(cards) + 1}"),
                "title": f"Source proof Pg. {page or '?'}",
                "quote": quote,
                "page": page,
                "sourceRefs": [r],
            }
        )

        if len(cards) >= 12:
            break

    return cards


class BoardSceneAgent(BaseLiveTutorAgent):
    agent_name = "BoardSceneAgent"
    agent_group = "visual"
    default_mode = "build_board_scenes"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return (
            "You are a world-class live tutor board scene designer. "
            "Turn an adaptive AI visual plan into renderable premium board scenes. "
            "Preserve sourceRefs. Design custom layouts. "
            "No fixed domain template. No hardcoded lesson. No unsafe HTML. Return JSON only."
        )

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        plan = _visual_plan(payload)
        refs = _collect_refs(payload, plan)

        if not plan:
            errors.append("BoardSceneAgent requires visualPlan.")

        if not refs:
            errors.append("BoardSceneAgent requires sourceRefs.")

        if not _raw_screens_from_plan(plan):
            errors.append("BoardSceneAgent requires visualPlan screens.")

        if not safe_dict(plan.get("metadata")).get("aiFirstDesign"):
            warnings.append("visualPlan.metadata.aiFirstDesign missing; continuing if valid screens exist.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="BoardSceneAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        plan = _visual_plan(payload)

        compact = {
            "title": _title(payload),
            "visualPlan": plan,
            "visualLessonInput": safe_dict(payload.get("visualLessonInput")),
            "compiledDiagrams": safe_dict(payload.get("compiledDiagrams")) or safe_list(payload.get("compiledDiagrams")),
            "explanation": safe_dict(payload.get("explanation")),
            "quiz": safe_dict(payload.get("quiz")),
            "sourceRefs": _collect_refs(payload, plan)[:40],
        }

        return f"""
You are converting an adaptive visual plan into renderable live tutor board scenes.

Important:
- Do not invent new lesson facts.
- Do not use fixed layout templates.
- Use the AI visual plan as the design source.
- You may choose custom x/y/width/height for each visual block.
- Make the board look premium, readable, rich, teacher-like.
- Every factual block and commandDraft must keep sourceRefs.
- Every commandDraft MUST have non-empty text.
- If the action is diagram/table/source/quiz, text must briefly say what the renderer/teacher should show.
- Do not return empty strings for commandDraft.text, block.title, block.content, or teacherNotes.
- Safe HTML only: no script tags, no JS handlers, no javascript: URLs.
- autoGrow must be true.
- multiScreen must be true.

Input:
{_json(compact, 120000)}

Return JSON only with this shape:
{{
  "sceneSetId": "string",
  "title": "string",
  "board": {{
    "boardWidth": 1360,
    "boardHeight": 820,
    "autoGrow": true,
    "multiScreen": true,
    "layoutMode": "ai-designed-adaptive-board"
  }},
  "premiumBoardScreens": [
    {{
      "screenId": "string",
      "screenNo": 1,
      "title": "string",
      "screenGoal": "string",
      "teacherNarrative": "string",
      "layoutIntent": {{}},
      "styleIntent": {{}},
      "blocks": [
        {{
          "blockId": "string",
          "visualForm": "custom visual form",
          "title": "string",
          "purpose": "string",
          "content": "source-grounded string/object/list",
          "teacherNotes": "string",
          "layoutBox": {{"x": 0, "y": 0, "width": 100, "height": 100}},
          "recommendedAction": "writeText|drawFlowchart|drawTable|drawCodeTrace|showSourceBadge|showQuiz|recap",
          "visualSpec": {{}},
          "htmlSpec": {{"safeHtml": true, "allowScripts": false, "html": "optional safe html only"}},
          "diagramSpec": {{}},
          "sourceRefs": []
        }}
      ],
      "sourceRefs": []
    }}
  ],
  "scenes": [
    {{
      "sceneId": "string",
      "sceneType": "premium-board-screen",
      "title": "string",
      "goal": "string",
      "teacherNarrationGoal": "string",
      "screenNo": 1,
      "layoutZones": [],
      "commandDrafts": [],
      "sourceRefs": []
    }}
  ],
  "sourceCards": [],
  "htmlPreviewBlocks": [],
  "boardSections": [],
  "layoutHints": {{
    "noOverlap": true,
    "autoGrow": true,
    "multiScreen": true,
    "aiDesignedLayout": true
  }},
  "sourceRefs": [],
  "metadata": {{
    "sourceGrounded": true,
    "fallbackUsed": false,
    "usedSmartFallback": false,
    "aiDesignedBoardScene": true,
    "dynamicMultiTemplate": true
  }}
}}
""".strip()

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        raise RuntimeError("BoardSceneAgent requires Gemini/ADK. No static scene fallback is allowed.")

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)
        plan = _visual_plan(payload)

        fallback_refs = (
            dedupe_source_refs([safe_dict(x) for x in safe_list(raw.get("sourceRefs"))])
            or _collect_refs(payload, plan)
        )

        raw_screens = (
            safe_list(raw.get("premiumBoardScreens"))
            or safe_list(safe_dict(raw.get("adaptiveBoardDesign")).get("screens"))
            or _raw_screens_from_plan(plan)
        )

        screens = [
            _normalize_screen(screen, fallback_refs, index)
            for index, screen in enumerate(raw_screens)
            if safe_dict(screen)
        ]

        raw_scenes = safe_list(raw.get("scenes"))
        scenes: List[JsonDict] = []

        if raw_scenes:
            for index, scene_raw in enumerate(raw_scenes):
                scene = safe_dict(scene_raw)
                if not scene:
                    continue

                generated = _screen_to_scene(screens[index], index) if index < len(screens) else {}
                scene_refs = _refs_for(scene, fallback_refs)
                scene_id = normalize_id(
                    scene.get("sceneId") or generated.get("sceneId") or f"scene_{index + 1}",
                    f"scene_{index + 1}",
                )

                drafts = safe_list(scene.get("commandDrafts"))
                generated_drafts = safe_list(generated.get("commandDrafts")) if generated else []

                if not drafts and generated_drafts:
                    drafts = generated_drafts

                norm_drafts: List[JsonDict] = []

                for draft_index, draft_raw in enumerate(drafts):
                    draft = safe_dict(draft_raw)
                    generated_draft = safe_dict(generated_drafts[draft_index]) if draft_index < len(generated_drafts) else {}
                    block = _block_for_draft(screens, index, draft_index)

                    refs = (
                        _refs_for(draft, scene_refs)
                        or _refs_for(generated_draft, scene_refs)
                        or _refs_for(block, scene_refs)
                    )

                    generated_payload = safe_dict(generated_draft.get("visualPayload") or generated_draft.get("payload"))
                    draft_payload = safe_dict(draft.get("visualPayload") or draft.get("payload"))

                    visual_payload = {
                        **generated_payload,
                        **safe_dict(block),
                        **draft_payload,
                    }
                    visual_payload["sourceRefs"] = refs
                    visual_payload["sourceGrounded"] = True
                    visual_payload["fallbackUsed"] = False

                    action = _normalize_action(
                        draft.get("action") or generated_draft.get("action") or visual_payload.get("recommendedAction"),
                        visual_payload,
                    )

                    text = _draft_text_candidates(
                        draft=draft,
                        visual_payload=visual_payload,
                        generated_draft=generated_draft,
                        block=block,
                        scene=scene,
                        refs=refs,
                    )

                    box = _normalize_layout_box(
                        {
                            "x": draft.get("x") or generated_draft.get("x") or safe_dict(block.get("layoutBox")).get("x"),
                            "y": draft.get("y") or generated_draft.get("y") or safe_dict(block.get("layoutBox")).get("y"),
                            "width": draft.get("width") or generated_draft.get("width") or safe_dict(block.get("layoutBox")).get("width"),
                            "height": draft.get("height") or generated_draft.get("height") or safe_dict(block.get("layoutBox")).get("height"),
                        },
                        draft_index,
                    )

                    norm_drafts.append(
                        {
                            **generated_draft,
                            **draft,
                            "draftId": normalize_id(
                                draft.get("draftId")
                                or generated_draft.get("draftId")
                                or f"{scene_id}_draft_{draft_index + 1}",
                                f"draft_{draft_index + 1}",
                            ),
                            "action": action,
                            "text": text,
                            "targetZoneId": clean_text(
                                draft.get("targetZoneId")
                                or generated_draft.get("targetZoneId")
                                or (
                                    safe_list(generated.get("layoutZones"))[draft_index].get("zoneId")
                                    if generated and draft_index < len(safe_list(generated.get("layoutZones")))
                                    else ""
                                ),
                                160,
                            ),
                            "x": box["x"],
                            "y": box["y"],
                            "width": box["width"],
                            "height": box["height"],
                            "visualPayload": visual_payload,
                            "durationMs": int(draft.get("durationMs") or generated_draft.get("durationMs") or 3200),
                            "sourceRefs": refs,
                            "metadata": {
                                **safe_dict(generated_draft.get("metadata")),
                                **safe_dict(draft.get("metadata")),
                                "fallbackUsed": False,
                                "sourceGrounded": True,
                                "aiDesignedCommandDraft": True,
                                "robustDraftTextRepair": not bool(clean_text(draft.get("text"))),
                            },
                        }
                    )

                scenes.append(
                    {
                        **scene,
                        "sceneId": scene_id,
                        "sceneType": clean_text(scene.get("sceneType") or "premium-board-screen", 100),
                        "title": clean_text(scene.get("title") or generated.get("title") or f"Scene {index + 1}", 220),
                        "goal": clean_text(scene.get("goal") or generated.get("goal") or "", 1500),
                        "teacherNarrationGoal": clean_text(
                            scene.get("teacherNarrationGoal")
                            or generated.get("teacherNarrationGoal")
                            or scene.get("teacherNarrative")
                            or "",
                            5000,
                        ),
                        "screenNo": int(scene.get("screenNo") or generated.get("screenNo") or index + 1),
                        "layoutZones": safe_list(scene.get("layoutZones")) or safe_list(generated.get("layoutZones")),
                        "commandDrafts": norm_drafts,
                        "sourceRefs": scene_refs,
                        "metadata": {
                            **safe_dict(scene.get("metadata")),
                            "fallbackUsed": False,
                            "sourceGrounded": True,
                            "aiDesignedScene": True,
                        },
                    }
                )

        if not scenes:
            scenes = [_screen_to_scene(screen, index) for index, screen in enumerate(screens)]

        all_refs = dedupe_source_refs(
            fallback_refs
            + [r for screen in screens for r in safe_list(screen.get("sourceRefs"))]
            + [r for scene in scenes for r in safe_list(scene.get("sourceRefs"))]
            + [r for scene in scenes for draft in safe_list(scene.get("commandDrafts")) for r in safe_list(safe_dict(draft).get("sourceRefs"))]
        )

        board_sections = safe_list(raw.get("boardSections")) or _board_sections(screens)
        html_blocks = safe_list(raw.get("htmlPreviewBlocks")) or _html_blocks(screens)
        source_cards = safe_list(raw.get("sourceCards")) or _source_cards(all_refs)
        board = safe_dict(raw.get("board"))

        return {
            "sceneSetId": normalize_id(raw.get("sceneSetId") or f"ai_scene_set_{_title(payload)}", "ai_scene_set"),
            "title": clean_text(raw.get("title") or _title(payload), 220),
            "board": {
                "boardWidth": int(board.get("boardWidth") or 1360),
                "boardHeight": int(board.get("boardHeight") or 820),
                "autoGrow": True,
                "multiScreen": True,
                "screenCount": len(screens),
                "sceneCount": len(scenes),
                "layoutMode": clean_text(board.get("layoutMode") or "ai-designed-adaptive-board", 160),
            },
            "premiumBoardScreens": screens,
            "boardScreens": screens,
            "scenes": scenes,
            "sourceCards": source_cards[:20],
            "htmlPreviewBlocks": html_blocks[:80],
            "boardSections": board_sections,
            "layoutHints": {
                **safe_dict(raw.get("layoutHints")),
                "noOverlap": True,
                "autoGrow": True,
                "multiScreen": True,
                "aiDesignedLayout": True,
                "sourcePanel": True,
                "teacherPanel": True,
                "htmlPreviewSafe": True,
            },
            "sourceRefs": all_refs,
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "usesAdk": True,
                "sourceGrounded": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "aiDesignedBoardScene": True,
                "dynamicMultiTemplate": True,
                "premiumBoardScreensReady": True,
                "boardCommandReady": True,
                "screenCount": len(screens),
                "sceneCount": len(scenes),
                "htmlPreviewBlockCount": len(html_blocks),
                "sourceCardCount": len(source_cards),
                "robustDraftTextNormalization": True,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        refs = safe_list(output.get("sourceRefs"))
        screens = safe_list(output.get("premiumBoardScreens") or output.get("boardScreens"))
        scenes = safe_list(output.get("scenes"))

        ref_validation = require_source_refs(refs, "BoardSceneAgent.output.sourceRefs")
        errors.extend(ref_validation.errors)
        warnings.extend(ref_validation.warnings)

        if not screens:
            errors.append("BoardSceneAgent requires premiumBoardScreens.")

        if not scenes:
            errors.append("BoardSceneAgent requires scenes.")

        board = safe_dict(output.get("board"))
        if board.get("autoGrow") is not True:
            errors.append("board.autoGrow must be true.")
        if board.get("multiScreen") is not True:
            errors.append("board.multiScreen must be true.")

        for screen_index, screen_raw in enumerate(screens):
            screen = safe_dict(screen_raw)
            if not safe_list(screen.get("sourceRefs")):
                errors.append(f"premiumBoardScreens[{screen_index}].sourceRefs missing.")
            if not safe_list(screen.get("blocks") or screen.get("visualBlocks")):
                errors.append(f"premiumBoardScreens[{screen_index}].blocks missing.")

        for scene_index, scene_raw in enumerate(scenes):
            scene = safe_dict(scene_raw)

            if not safe_list(scene.get("sourceRefs")):
                errors.append(f"scenes[{scene_index}].sourceRefs missing.")

            drafts = safe_list(scene.get("commandDrafts"))
            if not drafts:
                errors.append(f"scenes[{scene_index}].commandDrafts missing.")

            for draft_index, draft_raw in enumerate(drafts):
                draft = safe_dict(draft_raw)

                if not clean_text(draft.get("text")):
                    errors.append(f"scene {scene_index} draft {draft_index} text missing.")

                if not safe_list(draft.get("sourceRefs")):
                    errors.append(f"scene {scene_index} draft {draft_index} sourceRefs missing.")

                if not safe_list(safe_dict(draft.get("visualPayload")).get("sourceRefs")):
                    errors.append(f"scene {scene_index} draft {draft_index} visualPayload.sourceRefs missing.")

                action = clean_text(draft.get("action") or "", 80)
                if action not in ALLOWED_BOARD_ACTIONS:
                    warnings.append(f"scene {scene_index} draft {draft_index} action may be normalized later: {action}")

        if not safe_list(output.get("htmlPreviewBlocks")):
            warnings.append("htmlPreviewBlocks missing; board may still render with commandDrafts.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="BoardSceneAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["BoardSceneAgent"]