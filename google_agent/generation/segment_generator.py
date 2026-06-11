"""
google_agent/generation/segment_generator.py
===============================================================================
SEGMENT GENERATOR — quality-stack stages 2-4.

OpenMAIC-style patch:
  - Real PDF source is rendered as a full pdf_page element.
  - Actions target regionId + parentElementId.
  - pdf_crop is optional/debug only.
  - Every visual teaching phrase must have a target.
===============================================================================
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional

try:
    from ..pipeline.gemini_structured import generate_structured_async, PRO_MODEL, FLASH_MODEL
    from ..registry.lesson_registries import screen_types_for_domain, CATEGORY_COMMAND_HINTS
    from .screen_schema import SEGMENT_SCHEMA
    from .gold_exemplars import pick_exemplar
    from .teaching_principles import EXPLANATION_PRINCIPLES
except ImportError:  # pragma: no cover
    from google_agent.pipeline.gemini_structured import (  # type: ignore
        generate_structured_async,
        PRO_MODEL,
        FLASH_MODEL,
    )
    from google_agent.registry.lesson_registries import (  # type: ignore
        screen_types_for_domain,
        CATEGORY_COMMAND_HINTS,
    )
    from google_agent.generation.screen_schema import SEGMENT_SCHEMA  # type: ignore
    from google_agent.generation.gold_exemplars import pick_exemplar  # type: ignore
    from google_agent.generation.teaching_principles import EXPLANATION_PRINCIPLES  # type: ignore


class SegmentGenerationError(RuntimeError):
    """Honest failure — never fake screens."""


def _ground_evidence(
    payload: Dict[str, Any],
    region_ids: List[str],
    max_chunks: int = 14,
) -> str:
    """
    Curate ONLY what this segment needs.
    Verbatim text — quotes will be verified downstream.
    """
    chunks = payload.get("selectedEvidence") or payload.get("chunks") or []
    regions = {r.get("regionId"): r for r in (payload.get("visionIndex") or [])}
    region_pages = {regions[rid]["page"] for rid in region_ids if rid in regions}

    prioritized = sorted(
        chunks,
        key=lambda c: (0 if c.get("page") in region_pages else 1, c.get("page", 0)),
    )[:max_chunks]

    return "\n".join(
        f"[p.{c.get('page', '?')}|{(c.get('chunkId') or '')[:28]}] "
        f"{(c.get('text') or c.get('textPreview') or '')[:500]}"
        for c in prioritized
        if (c.get("text") or c.get("textPreview"))
    ) or "(no evidence)"


def _ground_regions(payload: Dict[str, Any], region_ids: List[str]) -> str:
    """
    Vision regions this segment must point at.

    OpenMAIC-style rule:
      render FULL PDF page as pdf_page element,
      then use regionId + parentElementId for pointer/circle/highlight/zoom.
    """
    regions = {r.get("regionId"): r for r in (payload.get("visionIndex") or [])}
    lines = []

    for rid in region_ids:
        r = regions.get(rid)
        if not r:
            continue

        b = r.get("bbox") or {}
        contains = ", ".join((r.get("contains") or [])[:12])
        parent = f"pdf_page_{r.get('page')}"
        lines.append(
            f"- {rid} parentElementId={parent} "
            f"[page {r.get('page')}|{r.get('type')}] "
            f"bbox=({b.get('x')},{b.get('y')},{b.get('w')},{b.get('h')}) "
            f"contains=[{contains}] "
            f"{(r.get('description') or '')[:180]}"
        )

    return "\n".join(lines) or "(no regions assigned to this phase)"


def _level_style(level: str) -> str:
    return {
        "beginner": (
            "Analogy BEFORE every new term. Each concept explained 3 ways "
            "(definition, analogy, example). One cognitive step per screen. "
            "Never jump. Warm, patient voice that repeats key terms."
        ),
        "intermediate": (
            "Build on prior knowledge, brief bridges instead of full analogies, "
            "focus on nuance and edge cases."
        ),
        "advanced": (
            "Skip basics. Focus on tradeoffs, edge cases, comparisons with "
            "alternatives. Dense, precise voice."
        ),
    }.get((level or "beginner").lower(), "")


async def generate_segment(
    payload: Dict[str, Any],
    contract: Dict[str, Any],
    phase: Dict[str, Any],
    segment_index: int,
    *,
    screens_target: int,
    previous_summaries: Optional[List[str]] = None,
    domain_profile: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
    extra_instructions: str = "",
) -> Dict[str, Any]:
    """
    Generate ONE segment for ONE contract phase.
    Returns { segmentSummary, screens[] } matching SEGMENT_SCHEMA.
    """
    level = contract.get("studentLevel") or payload.get("studentLevel") or "beginner"
    domain = (domain_profile or {}).get("domain") or "general"
    region_ids = phase.get("useRegionIds") or []
    allowed_types = screen_types_for_domain(domain)
    node_title = (
        payload.get("nodeTitle")
        or (payload.get("selectedNode") or {}).get("title")
        or ""
    )

    continuity = ""
    if previous_summaries:
        continuity = (
            "WHAT PREVIOUS SEGMENTS ALREADY TAUGHT "
            "(do not re-explain, build on it):\n"
            + "\n".join(f"- {s}" for s in previous_summaries[-4:])
        )

    board_plan = next(
        (
            p.get("commandTypes")
            for p in contract.get("smartBoardInteractionPlan") or []
            if p.get("phase") == phase.get("phase")
        ),
        None,
    )

    exemplar = pick_exemplar(phase.get("phase", ""), allowed_types)

    prompt = f"""You are a world-best teacher producing board screens for ONE lesson segment.

LESSON: {node_title}   STUDENT LEVEL: {level}   DOMAIN: {domain}
SEGMENT {segment_index}: phase = {phase.get('phase')} ({phase.get('minutes')} minutes)

PHASE PLAN:
  {phase.get('description')}
  STUDENT ACTIVITY: {phase.get('studentActivity')}

LEARNING OBJECTIVES:
{chr(10).join('- ' + o for o in (contract.get('learningObjectives') or [])[:5])}

MISCONCEPTIONS:
{chr(10).join('- ' + m for m in (contract.get('misconceptions') or [])[:4])}

{continuity}

PDF REGIONS THIS PHASE MUST SHOW/POINT AT. Use their EXACT regionId.

OpenMAIC-style source focus contract:
- Render the FULL PDF page as kind="pdf_page" with elementId="pdf_page_<page>".
- Use pageNumber=<page> and sourceMode="full_page_with_focus".
- Board actions must target regionId + parentElementId.
- Example action:
  {{"action":"circleRegion", "regionId":"p6_r3", "parentElementId":"pdf_page_6"}}
- Use pdf_crop only as optional/debug thumbnail, NEVER as the main source visual.
- Do not invent source images. If a source visual is needed, use the real page image.

{_ground_regions(payload, region_ids)}

SOURCE EVIDENCE:
Every sourceRef.quote must be VERBATIM text from here. It will be machine-verified.

{_ground_evidence(payload, region_ids)}

LEVEL STYLE:
{_level_style(level)}

{('BOARD COMMAND PALETTE for this phase: ' + ', '.join(board_plan)) if board_plan else ''}

{EXPLANATION_PRINCIPLES}

GOLD EXEMPLAR:
Match this depth and shape. Your content must come from the evidence above.

{exemplar}

PRODUCE exactly {screens_target} screens for this segment.

Rules:
- screenType must be one of: {', '.join(allowed_types[:60])}
- One cognitive step per screen.
- Build realizations: safe case -> trap -> proof -> rule.
- Never produce shallow slide bullets.
- DENSITY MINIMUMS per content screen:
  at least 4 blocks AND at least 3 visualElements.
- table_drawing elements must contain REAL example rows.
- Labeled arrows must point at specific things.
- Add an annotation or teacher-note element near the bottom.
- Procedural content must have dryRun steps with whatHappens + stateAfter.
- boardActions must be timed with atMs ascending.
- For normal drawn elements, targetElementId must exist.
- For PDF/source regions, use regionId + parentElementId.
- 4-7 actions per screen.
- For every screen that uses PDF/source evidence, create:
    visualElement kind="pdf_page"
    elementId="pdf_page_<page>"
    pageNumber=<page>
    sourceMode="full_page_with_focus"
- Use pdf_crop ONLY for optional/debug thumbnail.
- Every phrase like "look at", "notice", "here", "this part" must have a matching boardAction target.
- voiceover must narrate the boardActions in order.
- Also include voiceLines when possible:
    lineId/startMs/endMs/text/actions.
  The frontend will run actions from audio.currentTime.
- segmentSummary must be 2-3 sentences.
- {extra_instructions}
"""

    use_pro = level == "beginner" and phase.get("phase") in (
        "teacher_model_1",
        "teacher_model_2",
        "check_repair",
    )
    chosen_model = model or (PRO_MODEL if use_pro else FLASH_MODEL)

    result = await generate_structured_async(
        prompt,
        SEGMENT_SCHEMA,
        model=chosen_model,
        temperature=0.5,
        max_output_tokens=65536,
    )

    screens = (result or {}).get("screens") or []
    if len(screens) < max(2, screens_target // 2):
        raise SegmentGenerationError(
            f"segment {segment_index} ({phase.get('phase')}): got {len(screens)} "
            f"screens, needed about {screens_target}. refusing to fake the rest."
        )

    print(
        f"[segment_generator] seg{segment_index} {phase.get('phase')}: "
        f"{len(screens)} screens via {chosen_model}",
        file=sys.stderr,
    )
    return result
