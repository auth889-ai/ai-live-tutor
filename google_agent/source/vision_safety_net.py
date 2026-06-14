"""
google_agent/source/vision_safety_net.py
===============================================================================
VISION (Step 3) — the BRAIN's eyes.  POWERFUL_WORKFLOW Phase 2.

Every downstream agent is BLIND until this runs. It scans EVERY node page image
REGARDLESS of sourceRefs (Golden Rule #7) and now produces a DEEP, teacher-grade
understanding of the page — not a shallow "ERD on page 1" map.

For each page (one focused multimodal Gemini call per page) it returns:

  PAGE LEVEL  — pageTitle, pageSummary, conceptsCovered, prerequisiteConcepts,
                a STEP-BY-STEP teachingNarrative of the whole page, readingOrder.
  REGION LEVEL — for every diagram / table / formula / code / text block:
                title, description, exact content (verbatim), the CONCEPT/MEANING
                behind it, how it RELATES to other regions (every arrow / FK /
                dependency), bbox, teachingValue, how to teach it, common
                misconception, and suggested board actions.

A teacher AI then uses ONLY these notes (plus the image) to build the lesson,
write on the board, point at the right thing while speaking, and answer
questions. Shallow vision = shallow lesson. So this is deep, exact, complete.

Public contract (kept stable — adk_pipeline_runner + debug_vision_scan rely on it):
  build_vision_index(payload) -> {
    ok, step:"step3_gemini_vision",
    pages:[ VisualPageAnalysis ],         # NEW rich per-page understanding
    visionIndex:[ VisionRegion ],         # flat, backward-compatible + rich
    regions, regionCount, pagesScanned, selectedNodePages, pagesFailed,
    visionEvidence, allRegionsHaveBbox, fallbackUsed, warnings
  }
  scan_page_image(page, bytes) -> [VisionRegion]   # back-compat wrapper
  analyze_page_image(page, bytes, ...) -> VisualPageAnalysis  # rich worker

Golden rules (NEVER violate):
  - One focused Gemini call PER PAGE. Never one giant call for all pages.
  - Multimodal: send the actual PNG bytes — the model must SEE the page.
  - NEVER invent regions/content. Only what is actually visible.
  - bbox = page-image fractions, top-left origin, FULL connected diagram group.
  - No fake fallback. Per-page failure -> warn + continue. Zero usable -> ok:false.
===============================================================================
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from ..pipeline.gemini_structured import generate_structured_async, GeminiStructuredError
except ImportError:  # pragma: no cover
    from google_agent.pipeline.gemini_structured import (  # type: ignore
        generate_structured_async,
        GeminiStructuredError,
    )

try:
    from .selected_page_vision_agent import resolve_local_image_path
except ImportError:  # pragma: no cover
    from google_agent.source.selected_page_vision_agent import resolve_local_image_path  # type: ignore

try:
    from ..live_tutor_agents.contracts import clean_text, safe_dict, safe_list, ValidationResult
except ImportError:  # pragma: no cover
    from google_agent.live_tutor_agents.contracts import (  # type: ignore
        clean_text,
        safe_dict,
        safe_list,
        ValidationResult,
    )

try:
    from google.genai import types as genai_types
    _GENAI_OK = True
except ImportError:  # pragma: no cover
    genai_types = None
    _GENAI_OK = False


# ─────────────────────────────────────────────────────────────────────────────
# Vision contract
# ─────────────────────────────────────────────────────────────────────────────

VISION_REGION_TYPES = [
    "table",
    "diagram",
    "formula",
    "text_block",
    "code",
    "figure",
    "chart",
    "timeline",
    "image",
    "handwriting",
    "title",
    "list",
]

SUGGESTED_ACTION_TYPES = [
    "movePointer",
    "circle",
    "highlight",
    "underline",
    "zoomRegion",
    "drawArrow",
    "boxRegion",
    "traceConnection",
]

_REGION_ITEM_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "regionId": {
            "type": "string",
            "description": "Short stable id like r1, r2. The system prefixes the page number.",
        },
        "type": {"type": "string", "enum": VISION_REGION_TYPES},
        "title": {
            "type": "string",
            "description": "Short human label, e.g. 'Photo–Album foreign-key relationship'.",
        },
        "description": {
            "type": "string",
            "description": "Detailed description of what is visible — specific enough to teach from.",
        },
        "content": {
            "type": "string",
            "description": "The VERBATIM text/values/labels inside this region, read off the image.",
        },
        "contains": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Key visible labels/entities (table names, columns, variables, terms).",
        },
        "conceptExplanation": {
            "type": "string",
            "description": (
                "The MEANING behind this region — the concept it represents and WHY it matters. "
                "Your understanding as a teacher, not a visual description."
            ),
        },
        "relationships": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "How this region connects to other regions/concepts. For diagrams list EVERY "
                "arrow with direction + cardinality (e.g. 'Photo.album_id -> Album.id, many-to-one'). "
                "For formulas, where each variable comes from. For code, what calls what."
            ),
        },
        "bbox": {
            "type": "object",
            "properties": {
                "x": {"type": "number"},
                "y": {"type": "number"},
                "w": {"type": "number"},
                "h": {"type": "number"},
            },
            "required": ["x", "y", "w", "h"],
        },
        "teachingValue": {"type": "string", "enum": ["high", "medium", "low"]},
        "teachingNote": {
            "type": "string",
            "description": (
                "How a world-class teacher teaches FROM this region: what to point at first, "
                "what to reveal step by step, what analogy makes it click."
            ),
        },
        "suggestedActions": {
            "type": "array",
            "items": {"type": "string", "enum": SUGGESTED_ACTION_TYPES},
            "description": "Board actions that best explain this region, in teaching order.",
        },
        "commonMisconception": {
            "type": "string",
            "description": "What students typically get wrong here (empty string if none).",
        },
    },
    "required": [
        "regionId",
        "type",
        "title",
        "description",
        "content",
        "conceptExplanation",
        "bbox",
        "teachingValue",
        "teachingNote",
    ],
}

# Top-level schema = ONE PAGE: deep page understanding + every region.
VISION_INDEX_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "pageTitle": {"type": "string", "description": "The single topic/heading this page is about."},
        "pageSummary": {
            "type": "string",
            "description": (
                "A detailed paragraph: what concept(s) this page teaches and how its elements fit "
                "together, written as a teacher who has fully understood the page."
            ),
        },
        "conceptsCovered": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Every distinct concept taught or shown on this page.",
        },
        "prerequisiteConcepts": {
            "type": "array",
            "items": {"type": "string"},
            "description": "What a student must already know to understand this page.",
        },
        "teachingNarrative": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "A STEP-BY-STEP walkthrough of the entire page, in the order a great teacher would "
                "explain it. Each item is one teaching step. Be thorough — do not skip."
            ),
        },
        "readingOrder": {
            "type": "array",
            "items": {"type": "string"},
            "description": "regionIds in the order they should be taught.",
        },
        "regions": {"type": "array", "items": _REGION_ITEM_SCHEMA},
    },
    "required": [
        "pageTitle",
        "pageSummary",
        "conceptsCovered",
        "teachingNarrative",
        "regions",
    ],
}


_PAGE_SCAN_PROMPT = """You are the VISION agent for an AI tutor that teaches like a world-class
professor. You are looking at ONE real page from the student's source material.

Your job: UNDERSTAND this page completely and write teacher-grade notes on EVERYTHING on it.
Another AI teacher will use ONLY your notes (plus this image) to build a full lesson, write on a
board, point at the right thing while speaking, and answer questions. If you are shallow, the whole
lesson is shallow. So be deep, exact, and complete.

CONTEXT (the document this page belongs to):
PAGE NUMBER: {page}
DOCUMENT SUMMARY: {pdf_summary}
DOCUMENT OUTLINE: {pdf_outline}
KNOWN TEXT ON THIS PAGE (may be incomplete — trust the IMAGE over this):
{page_text}

STEP 1 — UNDERSTAND THE WHOLE PAGE FIRST:
- pageTitle: the one topic this page is about.
- pageSummary: a rich paragraph explaining what this page teaches and how its parts connect.
- conceptsCovered: every concept shown.
- prerequisiteConcepts: what the student must already know.
- teachingNarrative: a STEP-BY-STEP walkthrough of the page, in the exact order a master teacher
  would explain it. Each step is one clear teaching move. Be thorough — do not skip anything.
- readingOrder: the regionIds in teaching order.

STEP 2 — ANALYZE EVERY VISUALLY DISTINCT REGION (tables, diagrams, formulas, code blocks, charts,
figures, headings, text blocks, lists, handwriting). For EACH region:
- regionId: short stable id "r1","r2"... (I prefix the page number).
- type: closest type.
- title: a short human label.
- description: detailed — what is actually visible. Specific, not "a diagram".
- content: READ the region and transcribe its real text/values/labels VERBATIM. For a table, the
  columns and key rows. For code, the actual lines. For a formula, the actual symbols. For a
  diagram, every box label and every arrow label.
- contains: the key entities/labels (table names, columns, variables, terms).
- conceptExplanation: the MEANING behind this region — the concept it represents and WHY it matters
  to the topic. Your understanding as a teacher, not a visual description.
- relationships: how this region connects to the rest. For diagrams list EVERY connection with
  direction and cardinality, e.g. "Photo.album_id -> Album.id (many photos to one album)". For
  formulas, where each variable comes from. For code, what calls/depends on what.
- bbox: position as FRACTIONS of the PAGE IMAGE (0.0-1.0). x,y = top-left, w,h = size. The box must
  FULLY CONTAIN the element. For a connected diagram return ONE region for the WHOLE connected group
  (all boxes + arrows + labels), never just one inner box.
- teachingValue: high / medium / low.
- teachingNote: how a world-class teacher teaches FROM this region — what to point at first, what to
  reveal step by step, what analogy makes it click.
- suggestedActions: the board actions that best explain it, in order (movePointer, circle, highlight,
  underline, zoomRegion, drawArrow, boxRegion, traceConnection).
- commonMisconception: what students usually get wrong here (empty string "" if none).

HARD RULES — COMPLETENESS (do not skip ANYTHING):
- Transcribe EVERY line of text on the page, word for word, into the relevant region's "content".
  Do not summarize or paraphrase the text — copy it. Every bullet, every label, every caption,
  every line of code, every cell of a table, every number. If a line is on the page, it must
  appear in some region's content. Never skip a single line.
- For EVERY diagram / figure / chart you see: describe it in full — every box and its label, every
  arrow (direction + what it connects + its label), every grouping, every annotation, the layout,
  and what the diagram means. A reader who cannot see the image must be able to redraw it from your
  description alone.
- For tables: list all columns and all rows. For formulas: write the exact symbols and define each.
- Trust the IMAGE. NEVER invent content that is not visible. Be exact with numbers/names/symbols.
- Cover the page TOP TO BOTTOM. Do not stop at the first 2-3 regions. Walk the whole page.
- pageSummary + teachingNarrative must together account for everything on the page.
- bbox must be the FULL connected element, nothing important cut off.
"""


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        if f != f:  # NaN guard
            return default
        return f
    except Exception:
        return default


def _clamp(value: Any, lo: float, hi: float, default: float = 0.0) -> float:
    f = _safe_float(value, default)
    return max(lo, min(hi, f))


def _normalize_region_type(raw: Any) -> str:
    rtype = str(raw or "text_block").strip().lower()
    return rtype if rtype in VISION_REGION_TYPES else "text_block"


def _normalize_teaching_value(raw: Any) -> str:
    tv = str(raw or "medium").strip().lower()
    return tv if tv in {"high", "medium", "low"} else "medium"


def _normalize_contains(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    for item in raw:
        s = str(item or "").strip()
        if s:
            out.append(s[:120])
    return out[:40]


def _normalize_str_list(raw: Any, limit_each: int, max_items: int) -> List[str]:
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    for item in raw:
        s = clean_text(item, limit_each)
        if s:
            out.append(s)
    return out[:max_items]


def _normalize_suggested_actions(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    for item in raw:
        s = str(item or "").strip()
        if s in SUGGESTED_ACTION_TYPES and s not in out:
            out.append(s)
    return out


def _normalize_bbox(raw: Dict[str, Any]) -> Dict[str, float]:
    """
    Normalize bbox as top-left page-image fractions. Clamp into [0,1] and enforce
    tiny positive w/h so downstream pointer/crop never receives a zero-size box.
    """
    x = _clamp(raw.get("x", 0.0), 0.0, 1.0, 0.0)
    y = _clamp(raw.get("y", 0.0), 0.0, 1.0, 0.0)

    max_w = max(0.001, 1.0 - x)
    max_h = max(0.001, 1.0 - y)

    w = _clamp(raw.get("w", 0.001), 0.001, max_w, 0.001)
    h = _clamp(raw.get("h", 0.001), 0.001, max_h, 0.001)

    return {"x": round(x, 4), "y": round(y, 4), "w": round(w, 4), "h": round(h, 4)}


def _region_quality_warning(region: Dict[str, Any]) -> Optional[str]:
    """Soft warning only. Do not mutate bbox here (random expansion grabs unrelated text)."""
    rtype = str(region.get("type") or "").lower()
    bbox = region.get("bbox") or {}
    w = _safe_float(bbox.get("w"), 0.0)
    h = _safe_float(bbox.get("h"), 0.0)

    if rtype in {"diagram", "chart", "figure", "image"} and (w < 0.18 or h < 0.12):
        return (
            f"{region.get('regionId')}: tiny {rtype} bbox w={w:.4f}, h={h:.4f}; "
            f"may be an internal element instead of full connected group"
        )
    if rtype == "table" and (w < 0.20 or h < 0.08):
        return f"{region.get('regionId')}: tiny table bbox w={w:.4f}, h={h:.4f}; may cut columns/rows"
    return None


def _load_image_bytes(image: Dict[str, Any]) -> Optional[bytes]:
    """Resolve a payload pageImage entry to raw PNG bytes. Prefer local path, fall back to base64."""
    path = resolve_local_image_path(
        str(image.get("imagePath") or image.get("pageImagePath") or image.get("path") or ""),
        str(image.get("imageUrl") or image.get("pageImageUrl") or image.get("url") or ""),
    )

    if path:
        try:
            return Path(path).read_bytes()
        except Exception:
            pass

    b64 = image.get("base64") or ""
    if b64:
        try:
            if "," in b64 and b64.strip().startswith("data:"):
                b64 = b64.split(",", 1)[1]
            return base64.b64decode(b64)
        except Exception:
            pass
    return None


def _selected_pages_from_payload(payload: Dict[str, Any], images: List[Any]) -> List[int]:
    selected_node = payload.get("selectedNode") or payload.get("node") or {}
    if not isinstance(selected_node, dict):
        selected_node = {}

    raw_pages: List[Any] = []
    for key in ("pageRefs", "pages", "selectedPages"):
        value = selected_node.get(key) or payload.get(key)
        if isinstance(value, list):
            raw_pages.extend(value)

    for ref in selected_node.get("sourceRefs") or payload.get("sourceRefs") or []:
        if isinstance(ref, dict):
            raw_pages.append(ref.get("page") or ref.get("pageNum") or ref.get("pageNumber"))

    if not raw_pages:
        for image in images:
            if isinstance(image, dict):
                raw_pages.append(image.get("page") or image.get("pageNum") or image.get("pageNumber"))

    pages: List[int] = []
    for raw in raw_pages:
        try:
            page = int(raw)
        except Exception:
            continue
        if page > 0 and page not in pages:
            pages.append(page)
    return sorted(pages)


def _all_regions_have_bbox(regions: List[Dict[str, Any]]) -> bool:
    for region in regions:
        bbox = region.get("bbox")
        if not isinstance(bbox, dict):
            return False
        for key in ("x", "y", "w", "h"):
            if key not in bbox:
                return False
            try:
                float(bbox[key])
            except Exception:
                return False
    return True


_PAGE_TEXT_CAP = 60000  # per-page text helper — large so no line is dropped


def _page_text_for(payload: Dict[str, Any], image: Dict[str, Any], page: int) -> str:
    """Best-effort per-page text from the SourceTruthPacket for richer grounding."""
    for key in ("pageText", "text", "fullText", "ocrText"):
        val = clean_text(image.get(key), _PAGE_TEXT_CAP)
        if val:
            return val

    page_texts = payload.get("pageTexts") or payload.get("selectedPageTexts")
    if isinstance(page_texts, dict):
        val = clean_text(page_texts.get(str(page)) or page_texts.get(page), _PAGE_TEXT_CAP)
        if val:
            return val
    if isinstance(page_texts, list):
        for entry in page_texts:
            e = safe_dict(entry)
            try:
                if int(e.get("page") or e.get("pageNumber") or 0) == page:
                    return clean_text(e.get("text") or e.get("fullText"), _PAGE_TEXT_CAP)
            except Exception:
                continue

    parts: List[str] = []
    for chunk in safe_list(payload.get("selectedEvidence")) + safe_list(payload.get("chunks")):
        c = safe_dict(chunk)
        try:
            if int(c.get("page") or c.get("pageNumber") or 0) == page:
                t = clean_text(c.get("text") or c.get("textPreview"), 6000)
                if t:
                    parts.append(t)
        except Exception:
            continue
        if sum(len(p) for p in parts) > _PAGE_TEXT_CAP:
            break
    return "\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Normalization
# ─────────────────────────────────────────────────────────────────────────────

def _normalize_region(page: int, index: int, region: Dict[str, Any]) -> Dict[str, Any]:
    raw_id = str(region.get("regionId") or f"r{index + 1}").strip().replace(" ", "_")[:80]
    raw_id = raw_id or f"r{index + 1}"
    # Don't double-prefix if a mock/upstream already produced "p{page}_..."
    full_id = raw_id if raw_id.startswith(f"p{page}_") else f"p{page}_{raw_id}"

    # Large caps so the model's exhaustive, verbatim transcription is never cut.
    content = clean_text(region.get("content") or region.get("exactContent"), 30000)
    normalized = {
        # backward-compatible keys (old visionIndex shape)
        "regionId": full_id,
        "page": page,
        "type": _normalize_region_type(region.get("type")),
        "description": clean_text(region.get("description"), 8000),
        "content": content,
        "contains": _normalize_contains(region.get("contains") or []),
        "bbox": _normalize_bbox(region.get("bbox") or {}),
        "teachingValue": _normalize_teaching_value(region.get("teachingValue")),
        # rich keys (new)
        "title": clean_text(region.get("title"), 240),
        "exactContent": content,
        "conceptExplanation": clean_text(region.get("conceptExplanation"), 8000),
        "relationships": _normalize_str_list(region.get("relationships"), 600, 80),
        "teachingNote": clean_text(region.get("teachingNote"), 4000),
        "suggestedActions": _normalize_suggested_actions(region.get("suggestedActions")),
        "commonMisconception": clean_text(region.get("commonMisconception"), 800),
    }

    warning = _region_quality_warning(normalized)
    if warning:
        normalized["warning"] = warning
    return normalized


def _normalize_page_analysis(page: int, raw: Dict[str, Any]) -> Dict[str, Any]:
    raw = safe_dict(raw)
    regions: List[Dict[str, Any]] = []
    for i, r in enumerate(safe_list(raw.get("regions"))):
        if isinstance(r, dict):
            regions.append(_normalize_region(page, i, r))

    valid_ids = {r["regionId"] for r in regions}
    reading_order: List[str] = []
    for rid in _normalize_str_list(raw.get("readingOrder"), 80, 80):
        candidate = rid if rid in valid_ids else f"p{page}_{rid}"
        if candidate in valid_ids and candidate not in reading_order:
            reading_order.append(candidate)

    return {
        "page": page,
        "pageTitle": clean_text(raw.get("pageTitle"), 240),
        "pageSummary": clean_text(raw.get("pageSummary"), 10000),
        "conceptsCovered": _normalize_str_list(raw.get("conceptsCovered"), 300, 80),
        "prerequisiteConcepts": _normalize_str_list(raw.get("prerequisiteConcepts"), 300, 60),
        "teachingNarrative": _normalize_str_list(raw.get("teachingNarrative"), 2000, 120),
        "readingOrder": reading_order,
        "regions": regions,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Per-page vision (one focused multimodal call)
# ─────────────────────────────────────────────────────────────────────────────

async def analyze_page_image(
    page: int,
    image_bytes: bytes,
    *,
    page_text: str = "",
    pdf_summary: str = "",
    pdf_outline: str = "",
    model: Optional[str] = None,
    use_thinking: bool = True,
) -> Dict[str, Any]:
    """
    ONE structured multimodal Gemini call for ONE page.
    Returns a normalized VisualPageAnalysis dict (page-level understanding + regions).
    Raises GeminiStructuredError on genuine failure (no fake fallback).
    """
    if not _GENAI_OK:
        raise GeminiStructuredError("google.genai not available for vision scan")

    prompt = _PAGE_SCAN_PROMPT.format(
        page=page,
        pdf_summary=clean_text(pdf_summary, 12000) or "(not provided)",
        pdf_outline=clean_text(pdf_outline, 12000) or "(not provided)",
        page_text=clean_text(page_text, _PAGE_TEXT_CAP) or "(no extracted text — read the image)",
    )

    contents = [
        genai_types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
        prompt,
    ]

    async def _call(thinking: bool) -> Dict[str, Any]:
        return await generate_structured_async(
            prompt="",
            schema=VISION_INDEX_SCHEMA,
            model=model,
            temperature=0.2,
            max_output_tokens=65536,
            thinking=thinking,
            contents=contents,
        )

    try:
        result = await _call(use_thinking)
    except GeminiStructuredError as exc:
        # Dense pages can truncate the JSON when the thinking budget eats into the
        # output cap. Retry once WITHOUT thinking so the full 65536 tokens go to
        # the answer — recovers the page instead of dropping it. No fake fallback.
        if use_thinking:
            print(f"[vision] page {page}: response truncated/invalid ({str(exc)[:80]}); "
                  f"retrying without thinking for full output budget", file=sys.stderr)
            result = await _call(False)
        else:
            raise

    return _normalize_page_analysis(page, result or {})


async def scan_page_image(
    page: int,
    image_bytes: bytes,
    *,
    model: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Backward-compatible wrapper: returns just the regions list for one page.
    Prefer analyze_page_image() when you also want the page-level understanding.
    """
    analysis = await analyze_page_image(page, image_bytes, model=model)
    return analysis["regions"]


# ─────────────────────────────────────────────────────────────────────────────
# Aggregate over all node pages
# ─────────────────────────────────────────────────────────────────────────────

async def build_vision_index(
    payload: Dict[str, Any],
    *,
    model: Optional[str] = None,
    use_thinking: bool = True,
) -> Dict[str, Any]:
    """
    THE vision pass. Scans ALL page images in the payload (sourceRefs never fence it).
    Produces deep per-page understanding + a flat, backward-compatible visionIndex.
    """
    payload = safe_dict(payload)
    images = safe_list(payload.get("pageImages"))
    selected_node_pages = _selected_pages_from_payload(payload, images)
    pdf_summary = clean_text(payload.get("fullPdfSummary") or payload.get("pdfSummary"), 12000)
    pdf_outline = clean_text(payload.get("fullPdfOutline") or payload.get("pdfOutline"), 12000)

    if not images:
        return {
            "ok": False,
            "step": "step3_gemini_vision",
            "pages": [],
            "visionIndex": [],
            "regions": [],
            "regionCount": 0,
            "pagesScanned": 0,
            "selectedNodePages": selected_node_pages,
            "pagesFailed": 0,
            "visionEvidence": [],
            "allRegionsHaveBbox": False,
            "fallbackUsed": False,
            "warnings": ["no pageImages in payload — vision skipped"],
        }

    pages: List[Dict[str, Any]] = []
    vision_index: List[Dict[str, Any]] = []
    warnings: List[str] = []
    scanned = 0
    failed = 0
    seen_pages: set[int] = set()

    for image in images:
        img = safe_dict(image)
        try:
            page = int(img.get("page") or img.get("pageNum") or img.get("pageNumber") or 0)
        except Exception:
            page = 0

        if page <= 0:
            failed += 1
            warnings.append("page image entry missing valid page number")
            continue
        if page in seen_pages:
            continue
        seen_pages.add(page)

        image_bytes = _load_image_bytes(img)
        if image_bytes is None:
            failed += 1
            warnings.append(f"page {page}: image not resolvable (path/base64 both failed)")
            continue

        try:
            analysis = await analyze_page_image(
                page,
                image_bytes,
                page_text=_page_text_for(payload, img, page),
                pdf_summary=pdf_summary,
                pdf_outline=pdf_outline,
                model=model,
                use_thinking=use_thinking,
            )
            pages.append(analysis)
            vision_index.extend(analysis["regions"])

            for region in analysis["regions"]:
                if region.get("warning"):
                    warnings.append(f"page {page}: {region['warning']}")

            scanned += 1
            print(
                f"[vision] page {page}: {len(analysis['regions'])} regions, "
                f"{len(analysis['teachingNarrative'])} teaching steps",
                file=sys.stderr,
            )
        except Exception as exc:
            failed += 1
            msg = str(exc)[:200]
            warnings.append(f"page {page}: vision scan failed — {msg}")
            print(f"[vision] page {page} FAILED: {msg}", file=sys.stderr)

    vision_evidence = [
        {
            "chunkId": f"vision_{region['regionId']}",
            "page": region["page"],
            "text": (
                f"[{str(region['type']).upper()} on page {region['page']}] "
                f"{region.get('title') or ''}. {region['description']} "
                f"Concept: {region.get('conceptExplanation') or ''}. "
                f"Content: {region.get('content') or ''}"
            ).strip(),
            "sourceRef": f"vision:{region['regionId']}",
            "visionDiscovered": True,
            "regionId": region["regionId"],
            "bbox": region["bbox"],
            "contains": region.get("contains") or [],
            "confidence": 0.85,
        }
        for region in vision_index
        if region.get("teachingValue") in ("high", "medium")
        and (region.get("content") or region.get("description"))
    ]

    all_have_bbox = _all_regions_have_bbox(vision_index)
    if scanned > 0 and not vision_index:
        warnings.append("Vision scanned page image(s) but returned no usable bbox regions")
    if vision_index and not all_have_bbox:
        warnings.append("Vision returned at least one region without a complete bbox")

    return {
        "ok": scanned > 0 and len(vision_index) > 0 and all_have_bbox,
        "step": "step3_gemini_vision",
        "pages": pages,
        "visionIndex": vision_index,
        "regions": vision_index,
        "regionCount": len(vision_index),
        "pagesScanned": scanned,
        "selectedNodePages": selected_node_pages,
        "pagesFailed": failed,
        "visionEvidence": vision_evidence,
        "allRegionsHaveBbox": all_have_bbox,
        "fallbackUsed": False,
        "warnings": warnings,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Agent wrapper (identity + validation, no fake fallback)
# ─────────────────────────────────────────────────────────────────────────────

class VisionAgent:
    """
    Real, independently-runnable Step-3 agent.

    Multimodal calls need `contents=` (image bytes), which the text-only
    BaseLiveTutorAgent.run() path does not pass — so this agent owns its own
    multimodal run loop while keeping validate-in / no-fallback discipline.
    """

    agent_name = "VisionAgent"
    agent_group = "source"

    def __init__(self, model: Optional[str] = None, *, use_thinking: bool = True) -> None:
        self.model = model
        self.use_thinking = use_thinking

    def validate_input(self, payload: Dict[str, Any]) -> ValidationResult:
        errors: List[str] = []
        if not safe_list(safe_dict(payload).get("pageImages")):
            errors.append("pageImages is required — the vision agent must SEE the node pages.")
        return ValidationResult(
            ok=not errors, errors=errors, warnings=[],
            validator=f"{self.agent_name}.validate_input", fallbackUsed=False,
        )

    async def run(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        validation = self.validate_input(payload)
        if not validation.ok:
            return {
                "ok": False,
                "agentName": self.agent_name,
                "step": "step3_gemini_vision",
                "errors": validation.errors,
                "warnings": [],
                "result": {},
            }

        result = await build_vision_index(
            payload, model=self.model, use_thinking=self.use_thinking
        )
        return {
            "ok": result["ok"],
            "agentName": self.agent_name,
            "step": "step3_gemini_vision",
            "errors": [] if result["ok"] else result.get("warnings", []),
            "warnings": result.get("warnings", []),
            "result": result,
        }
