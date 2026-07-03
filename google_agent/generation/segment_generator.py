"""
google_agent/generation/segment_generator.py
===============================================================================
SEGMENT GENERATOR — Stage C (content). MULTIMODAL, fully dynamic, no hardcode.

The domain teacher produced a LessonContract (the PLAN). This agent turns ONE
segment of that plan into the ACTUAL detailed board content the student sees:

  - It SEES the real PDF page images for the segment (images come FROM the PDF).
  - It reads the exhaustive vision reading of those pages.
  - For EVERY planned screen it fills EVERY element with REAL content drawn from
    the page (actual bullets, real table rows, the real code, the dry-run plan,
    the source quote, the notes) — never a placeholder, never invented facts.
  - It writes the teacher's DETAILED, step-by-step spoken voice lines that
    explain everything on the pages, bound to the region being pointed at.
  - It generates MANY scenario-based Q&A WITH worked answers, grounded in the
    page text and images.

Nothing is hardcoded: elementType is whatever the AI chose in the plan, and the
content is generated dynamically from the real pages. The frontend renders any
element type via its renderer registry (with a generic fallback).

No fake fallback: if the model returns too little, we retry once without
thinking (more output budget) then raise honestly.
===============================================================================
"""

from __future__ import annotations

import asyncio
import re
import sys
from typing import Any, Dict, List, Optional

try:
    from ..pipeline.gemini_structured import (
        generate_structured_async, FLASH_MODEL, GeminiStructuredError,
    )
    from ..live_tutor_agents.contracts import clean_text, safe_dict, safe_list
    from ..source.vision_safety_net import _load_image_bytes
except ImportError:  # pragma: no cover
    from google_agent.pipeline.gemini_structured import (  # type: ignore
        generate_structured_async, FLASH_MODEL, GeminiStructuredError,
    )
    from google_agent.live_tutor_agents.contracts import clean_text, safe_dict, safe_list  # type: ignore
    from google_agent.source.vision_safety_net import _load_image_bytes  # type: ignore

try:
    from google.genai import types as genai_types
    _GENAI_OK = True
except ImportError:  # pragma: no cover
    genai_types = None
    _GENAI_OK = False

# Content stage = multi-agent ADK: ContentWriterAgent (ADK) + SandboxAgent (ADK + code_execution).
try:
    from ..pipeline.adk_runtime import run_adk_agent, adk_available, AdkRuntimeError
    from ..pipeline.gemini_structured import PRO_MODEL
    from ..planning.teachers import teacher_context as tc
except ImportError:  # pragma: no cover
    from google_agent.pipeline.adk_runtime import run_adk_agent, adk_available, AdkRuntimeError  # type: ignore
    from google_agent.pipeline.gemini_structured import PRO_MODEL  # type: ignore
    from google_agent.planning.teachers import teacher_context as tc  # type: ignore

try:
    from google.adk.code_executors import BuiltInCodeExecutor
    _CODE_EXEC_OK = True
except Exception:  # pragma: no cover
    BuiltInCodeExecutor = None  # type: ignore
    _CODE_EXEC_OK = False


class SegmentGenerationError(RuntimeError):
    """Honest failure — never fake content."""


# ─────────────────────────────────────────────────────────────────────────────
# Content schema (flexible container — the AI fills what each element needs).
# This is a DATA CONTRACT, not hardcoded content. elementType is dynamic.
# ─────────────────────────────────────────────────────────────────────────────

_ELEMENT_CONTENT = {
    "type": "object",
    "properties": {
        "elementId":   {"type": "string"},
        "elementType": {"type": "string", "description": "the element type from the plan (dynamic)"},
        "title":       {"type": "string"},
        "regionId":    {"type": "string", "description": "real PDF region this element shows/points at"},
        "pageNumber":  {"type": "number"},
        "sourceRef":   {"type": "string"},
        "body":        {"type": "string", "description": "the full, detailed written content of this element"},
        "bullets":     {"type": "array", "items": {"type": "string"}},
        "table":       {"type": "object", "properties": {
                            "columns": {"type": "array", "items": {"type": "string"}},
                            "rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}}},
        "code":        {"type": "object", "properties": {
                            "language": {"type": "string"}, "content": {"type": "string"}}},
        "dryRun":      {"type": "array", "items": {"type": "object", "properties": {
                            "step": {"type": "number"}, "action": {"type": "string"},
                            "result": {"type": "string"}}},
                        "description": "step-by-step execution plan; real trace produced by the sandbox in C+"},
        "diagramSpec": {"type": "string", "description": "text spec (e.g. mermaid) for a redrawn diagram"},
        "needsSandbox":{"type": "boolean"},
    },
    "required": ["elementId", "elementType"],
}

_VOICE_LINE = {
    "type": "object",
    "properties": {
        "lineId":          {"type": "string"},
        "text":            {"type": "string", "description": "the ACTUAL detailed spoken sentence (atomic, human)"},
        "targetRegionId":  {"type": "string"},
        "targetElementId": {"type": "string"},
        "boardActions":    {"type": "array", "items": {"type": "string"},
                            "description": "what the teacher does on the board as this is spoken (dynamic verbs)"},
    },
    "required": ["lineId", "text"],
}

_SCREEN_CONTENT = {
    "type": "object",
    "properties": {
        "screenId":   {"type": "string"},
        "mode":       {"type": "string"},
        "template":   {"type": "string"},
        "title":      {"type": "string"},
        "pages":      {"type": "array", "items": {"type": "number"},
                       "description": "PDF page numbers this screen shows"},
        "elements":   {"type": "array", "items": _ELEMENT_CONTENT},
        "voiceLines": {"type": "array", "items": _VOICE_LINE},
    },
    "required": ["screenId", "title", "elements", "voiceLines"],
}

SEGMENT_CONTENT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "segmentId": {"type": "string"},
        "title":     {"type": "string"},
        "summary":   {"type": "string"},
        "screens":   {"type": "array", "items": _SCREEN_CONTENT},
        "scenarioQuestions": {"type": "array", "items": {"type": "object", "properties": {
            "question":   {"type": "string"},
            "answer":     {"type": "string", "description": "the full worked answer"},
            "difficulty": {"type": "string"},
            "type":       {"type": "string", "description": "recall | apply | scenario | challenge"},
            "sourceRef":  {"type": "string"},
        }}, "description": "MANY scenario-based questions with worked answers, grounded in the pages"},
    },
    "required": ["segmentId", "screens", "scenarioQuestions"],
}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — which pages this segment uses, and their vision reading + images
# ─────────────────────────────────────────────────────────────────────────────

_PAGE_RE = re.compile(r"p(\d+)_")


def _pages_for_segment(segment: Dict[str, Any], payload: Dict[str, Any]) -> List[int]:
    pages: set[int] = set()
    for sc in safe_list(segment.get("screenPlan")):
        sc = safe_dict(sc)
        for rid in safe_list(sc.get("requiredRegionIds")):
            m = _PAGE_RE.match(str(rid))
            if m:
                pages.add(int(m.group(1)))
        for el in safe_list(sc.get("elements")):
            rid = safe_dict(el).get("regionId")
            m = _PAGE_RE.match(str(rid or ""))
            if m:
                pages.add(int(m.group(1)))
    # fall back to all node pages if the plan didn't bind regions
    if not pages:
        for pg in safe_list(payload.get("visionPages")):
            p = safe_dict(pg).get("page")
            if p:
                pages.add(int(p))
    return sorted(pages)


def _vision_reading_for(payload: Dict[str, Any], pages: List[int]) -> str:
    out: List[str] = []
    for pg in safe_list(payload.get("visionPages")):
        pg = safe_dict(pg)
        if int(pg.get("page") or 0) not in pages:
            continue
        out.append(f"\n=== PAGE {pg.get('page')} — {clean_text(pg.get('pageTitle'), 160)} ===")
        out.append(f"SUMMARY: {clean_text(pg.get('pageSummary'), 2000)}")
        narr = safe_list(pg.get("teachingNarrative"))
        if narr:
            out.append("TEACHING NARRATIVE:")
            for i, s in enumerate(narr, 1):
                out.append(f"  {i}. {clean_text(s, 900)}")
        out.append("REGIONS (use these regionIds; transcribe their content into elements):")
        for r in safe_list(pg.get("regions")):
            r = safe_dict(r)
            out.append(f"  [{r.get('regionId')}] ({r.get('type')}) {clean_text(r.get('title'), 120)}")
            out.append(f"      content: {clean_text(r.get('content') or r.get('exactContent'), 1800)}")
            if r.get("conceptExplanation"):
                out.append(f"      concept: {clean_text(r.get('conceptExplanation'), 900)}")
            for s in safe_list(r.get("stepByStepExplanation"))[:50]:
                out.append(f"      step: {clean_text(s, 700)}")
            rels = safe_list(r.get("relationships"))
            if rels:
                out.append("      relationships: " + "; ".join(clean_text(x, 200) for x in rels[:16]))
    return "\n".join(out) or "(no vision reading for these pages)"


def _image_parts(payload: Dict[str, Any], pages: List[int]) -> List[Any]:
    parts: List[Any] = []
    for img in safe_list(payload.get("pageImages")):
        img = safe_dict(img)
        try:
            p = int(img.get("page") or 0)
        except Exception:
            p = 0
        if pages and p not in pages:
            continue
        data = _load_image_bytes(img)
        if data is not None:
            parts.append(genai_types.Part.from_bytes(data=data, mime_type="image/png"))
    return parts


def _plan_text(segment: Dict[str, Any]) -> str:
    """Render this segment's plan (screens + their element briefs) so the generator fills them."""
    out: List[str] = []
    for sc in safe_list(segment.get("screenPlan")):
        sc = safe_dict(sc)
        out.append(f"\nSCREEN {sc.get('screenId')} — mode={sc.get('mode')} template={sc.get('template')}")
        out.append(f"  mainIdea: {clean_text(sc.get('mainIdea'), 300)}")
        out.append(f"  regions: {safe_list(sc.get('requiredRegionIds'))}")
        lc = safe_dict(sc.get("levelCoverage"))
        if lc:
            out.append(f"  levelCoverage: weak='{clean_text(lc.get('weak'),160)}' "
                       f"core='{clean_text(lc.get('core'),160)}' stretch='{clean_text(lc.get('stretch'),160)}'")
        out.append("  elements to fill with REAL content:")
        for el in safe_list(sc.get("elements")):
            el = safe_dict(el)
            sb = " [needsSandbox]" if el.get("needsSandbox") else ""
            out.append(f"    - {el.get('elementType')}{sb}: {clean_text(el.get('contentBrief'), 300)} "
                       f"(regionId={el.get('regionId') or ''})")
    return "\n".join(out)


_VISUAL_ONLY = ("pdf_page", "image", "spotlight", "pointer", "laser", "highlight_region", "zoom")


def _written_depth(result: Dict[str, Any]) -> tuple[int, int]:
    """
    Count how many EXPLANATORY elements carry detailed written content.
    Purely-visual elements (pdf page, spotlight, pointer) are excluded — they
    legitimately have little body. Returns (richCount, totalContentElements).
    """
    rich = total = 0
    for sc in safe_list(result.get("screens")):
        for el in safe_list(safe_dict(sc).get("elements")):
            el = safe_dict(el)
            etype = str(el.get("elementType") or "").lower()
            if any(v in etype for v in _VISUAL_ONLY):
                continue
            total += 1
            body = clean_text(el.get("body"), 100000)
            is_rich = (
                len(body) >= 140
                or len(safe_list(el.get("bullets"))) >= 3
                or bool(safe_dict(el.get("table")).get("rows"))
                or bool(safe_dict(el.get("code")).get("content"))
                or len(safe_list(el.get("dryRun"))) >= 2
                or len(clean_text(el.get("diagramSpec"), 100000)) >= 60
            )
            if is_rich:
                rich += 1
    return rich, total


# ─────────────────────────────────────────────────────────────────────────────
# The generator
# ─────────────────────────────────────────────────────────────────────────────

_PROMPT = """You are a WORLD-CLASS teacher writing the ACTUAL board content for ONE segment of a
lesson. You SEE the real PDF page images (attached) and a detailed vision reading of them.

Your job: produce the REAL, DETAILED content the student will see and hear — not a plan, not
placeholders. Explain EVERYTHING on these pages (every line of text AND every diagram/table/
formula/code), step by step, so a weak, average, AND strong student all fully understand.

NODE: {node_title}
SEGMENT: {seg_title}   (goal: {goal})
STUDENT LEVEL: {level}
PAGES IN THIS SEGMENT: {pages}

THE PLAN FOR THIS SEGMENT (fill every screen and every element with real content):
{plan}

VISION READING OF THESE PAGES (transcribe this into the elements — it is the truth):
{vision}

THE TWO THINGS THAT MUST BOTH BE DETAILED:
  (1) THE WRITTEN LESSON ON THE BOARD (what the student SEES) — and
  (2) THE TEACHER'S VOICE (what the student HEARS).
A student who only READS the board (no audio) must still fully learn the concept. So the
written content is NOT labels or one-liners — it is a complete, detailed, step-by-step
written lesson, like a master teacher's filled board + notes.

HOW TO PRODUCE THE WRITTEN CONTENT (fill EVERY element with DEEP real content):
- Every explanatory element MUST have a rich, multi-sentence `body` that fully explains its
  point step by step (definition in simple words, then precise meaning, then why it matters,
  with a concrete example from the page). Do NOT leave `body` short or empty for content
  elements. Aim for several sentences per element — a real written explanation, not a caption.
- key_points / checklist -> real `bullets` (each bullet a full, clear statement, not 2 words).
- table / comparison_table -> real `table.columns` + `table.rows` with actual values from the page.
- code / sql -> the real `code.content` (+ language); if it should run, set needsSandbox=true and
  give a `dryRun` step plan (the sandbox produces the real trace).
- diagram redraw -> a `diagramSpec` (e.g. mermaid) AND a pdf_page_image element pointing at the
  real diagram regionId; in `body`, explain the diagram part by part.
- source_quote_highlight -> the EXACT sentence + a `body` that explains what it means.
- notes_panel / teacher_redraw / any HANDWRITTEN element -> the `body` is the FULL text the
  teacher writes on the board, detailed and step by step (this is the handwriting — it must be
  detailed, not a heading).
- Bind every visual element to its real regionId. Images come FROM the PDF — never generate them.

TEACHER VOICE (also detailed):
- voiceLines: detailed, step-by-step, ATOMIC spoken sentences that NARRATE and EXPAND the written
  content on screen. Each voice line names what the teacher does (boardActions) and the
  region/element it targets. Go slow; cover every point on the board; repeat key terms.
- Serve all students: weak-student scaffold, the core, and a stretch where planned.

STABLE IDs (needed for the timeline/playback step):
- Every screen has a stable `screenId`, every element a stable `elementId`, every voice line a
  stable `lineId`. Make them descriptive and unique (e.g. "s2_e3_factTable_definition",
  "s2_vl4"). Voice lines reference the elementId/regionId they point at.

PRACTICE — A LOT, scenario-based:
- Produce MANY scenarioQuestions (6+ for this segment) WITH full worked answers, grounded in this
  segment's pages: recall, apply, scenario, challenge. Give the complete answer, not just a key.

HARD RULES:
- Ground everything in the real pages (you see the images + the vision reading). Never invent
  facts. Use the exact names/numbers/labels from the pages.
- Be LARGE and detailed in BOTH the written board content and the voice. Do not be terse.
- Output ONLY valid JSON matching the schema. No markdown, no prose outside JSON.
"""


# ─────────────────────────────────────────────────────────────────────────────
# SandboxAgent — a REAL ADK agent (code_execution) that EXECUTES code/SQL → real trace
# ─────────────────────────────────────────────────────────────────────────────

async def _sandbox_one(code: str, language: str, model: Optional[str]) -> Dict[str, Any]:
    lang = (language or "python").lower()
    if "sql" in lang:
        prompt = ("You are a SQL sandbox. Using Python sqlite3, create small sample tables + rows, "
                  "ACTUALLY RUN this SQL, and print the real result table:\n\n" + code)
    else:
        prompt = (f"Run this {lang} code with the code execution tool and print the REAL output:\n\n" + code)
    out = await run_adk_agent(
        name="SandboxAgent",
        instruction="Execute the code with the code execution tool and report the REAL executed output only.",
        prompt=prompt, code_executor=BuiltInCodeExecutor(),
        model=model or FLASH_MODEL, temperature=0.1, max_output_tokens=6000, retries=1,
    )
    return {"output": clean_text(out.get("rawText"), 4000), "toolCalls": out.get("adkToolCalls") or 0}


async def _run_sandbox(result: Dict[str, Any], model: Optional[str]) -> Dict[str, Any]:
    """For every element flagged needsSandbox with code, run it for real → attach the executed trace."""
    if not _CODE_EXEC_OK:
        return result
    targets: List[Dict[str, Any]] = []
    tasks = []
    for s in safe_list(result.get("screens")):
        for e in safe_list(safe_dict(s).get("elements")):
            e = safe_dict(e)
            code = safe_dict(e.get("code")).get("content")
            if e.get("needsSandbox") and code:
                targets.append(e)
                tasks.append(_sandbox_one(code, safe_dict(e.get("code")).get("language"), model))
    if not tasks:
        return result
    outs = await asyncio.gather(*tasks, return_exceptions=True)
    verified = 0
    for e, o in zip(targets, outs):
        if isinstance(o, Exception):
            e["sandboxError"] = str(o)[:200]
        else:
            e["sandboxOutput"] = o["output"]          # the REAL executed result shown on the board
            e["sandboxVerified"] = bool(o["toolCalls"])
            if o["toolCalls"]:
                verified += 1
    print(f"[segment_generator] SandboxAgent: {verified}/{len(targets)} code elements EXECUTED "
          f"(real code_execution)", file=sys.stderr)
    return result


async def generate_segment_content(
    payload: Dict[str, Any],
    segment: Dict[str, Any],
    *,
    contract: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Turn ONE LessonContract segment into the actual detailed board content.
    Multimodal: sees the segment's PDF page images. No fake fallback.
    """
    if not _GENAI_OK:
        raise SegmentGenerationError("google.genai not available for multimodal content generation")

    payload = safe_dict(payload)
    segment = safe_dict(segment)
    contract = safe_dict(contract)

    node_title = clean_text(
        safe_dict(payload.get("selectedNode")).get("title") or payload.get("nodeTitle")
        or contract.get("title"), 160)
    level = clean_text(contract.get("studentLevel") or payload.get("studentLevel") or "beginner", 20)
    pages = _pages_for_segment(segment, payload)

    prompt = _PROMPT.format(
        node_title=node_title,
        seg_title=clean_text(segment.get("title"), 160),
        goal=clean_text(segment.get("learningGoal"), 300),
        level=level,
        pages=pages,
        plan=_plan_text(segment),
        vision=_vision_reading_for(payload, pages),
    )

    if not adk_available():
        raise SegmentGenerationError("Google ADK not available for ContentWriterAgent (no fallback)")

    instruction = (
        "You are a world-class teacher writing the ACTUAL detailed board content for ONE lesson "
        "segment. You see the real PDF page images. Output only valid JSON matching the schema."
    )
    seg_images = tc.image_bytes(payload, pages=pages)

    async def _call(extra: str, thinking: bool = False) -> Dict[str, Any]:
        # ContentWriterAgent — a REAL ADK agent (LlmAgent + Runner), multimodal.
        out = await run_adk_agent(
            name="ContentWriterAgent",
            instruction=instruction,
            prompt=prompt + extra,
            images=seg_images,
            output_schema=SEGMENT_CONTENT_SCHEMA,
            model=model or PRO_MODEL,
            temperature=0.4,
            max_output_tokens=65536,
            retries=1,
        )
        r = safe_dict(out.get("result"))
        r["_adk"] = {"ranThroughAdkRunner": out.get("ranThroughAdkRunner"),
                     "adkEvents": out.get("adkEvents"), "agent": "ContentWriterAgent"}
        return r

    try:
        result = await _call("", False)
    except (GeminiStructuredError, AdkRuntimeError) as exc:
        # retry once (transient/truncation) — still honest, no fake content
        print(f"[segment_generator] {segment.get('segmentId')}: {str(exc)[:100]} — retrying",
              file=sys.stderr)
        result = await _call("", False)

    # DEPTH GATE: the WRITTEN board content must be detailed (a student reading the
    # board alone must learn it). If too many content elements are thin, re-prompt
    # ONCE to deepen the writing. No fake fallback — we ask the model to do better.
    rich, total = _written_depth(result)
    if total and rich / total < 0.6:
        print(f"[segment_generator] {segment.get('segmentId')}: written content thin "
              f"({rich}/{total} rich) — re-prompting to deepen", file=sys.stderr)
        deepen = (
            "\n\n────────── DEEPEN ──────────\n"
            "Your written board content was too thin. Rewrite the FULL segment so that EVERY "
            "explanatory element's `body` is a detailed, multi-sentence, step-by-step written "
            "explanation (definition → meaning → why it matters → concrete example from the page). "
            "Handwritten/notes elements must contain the full detailed text the teacher writes. "
            "Keep the same screens/elements/ids; only make the written content much deeper. "
            "A student reading the board with no audio must fully learn the concept."
        )
        try:
            deeper = await _call(deepen, False)
            if _written_depth(deeper)[0] >= rich and safe_list(deeper.get("screens")):
                result = deeper
        except (GeminiStructuredError, AdkRuntimeError):
            pass

    # SandboxAgent (ADK + code_execution): run any code/SQL element for real → attach the trace.
    result = await _run_sandbox(result, model)

    result.setdefault("segmentId", segment.get("segmentId"))
    result.setdefault("title", segment.get("title"))

    screens = safe_list(result.get("screens"))
    if not screens:
        raise SegmentGenerationError(
            f"segment {segment.get('segmentId')}: model produced no screens — refusing to fake content")

    n_elements = sum(len(safe_list(safe_dict(s).get("elements"))) for s in screens)
    n_voice = sum(len(safe_list(safe_dict(s).get("voiceLines"))) for s in screens)
    n_qa = len(safe_list(result.get("scenarioQuestions")))
    print(f"[segment_generator] {segment.get('segmentId')}: {len(screens)} screens, "
          f"{n_elements} elements, {n_voice} voice lines, {n_qa} scenario Q&A "
          f"(pages {pages})", file=sys.stderr)
    return result


# ── back-compat shim so segment_graph imports keep working ───────────────────
async def generate_segment(payload: Dict[str, Any], *args, **kwargs) -> Dict[str, Any]:
    """Legacy entry point. The current LangGraph wiring is being migrated to
    generate_segment_content; this adapts a payload carrying currentPhasePlan."""
    segment = safe_dict(payload.get("currentPhasePlan") or payload.get("segment"))
    return await generate_segment_content(payload, segment, model=kwargs.get("model"))
