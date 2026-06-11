"""
google_agent/source/vision_safety_net.py
===============================================================================
VISION SAFETY NET — POWERFUL_WORKFLOW Phase 2 Step 2.7 (Golden Rule #7).

Scans EVERY node page image REGARDLESS of sourceRefs. If text extraction
missed a diagram / table / formula / handwritten note — Vision catches it.

Output: visionIndex — the bbox map everything downstream depends on:
  BoardCommandAgent (W3) targets these regions,
  TeacherPointerOverlay (W4) animates to these coordinates,
  showPdfCrop / full-page focus screens use these boxes.

Contract:
  visionIndex: [
    {
      regionId,
      page,
      type,
      description,
      content,
      contains,
      bbox:{x,y,w,h} fractions 0.0-1.0,
      teachingValue
    }
  ]

Golden rule:
  - NEVER invent regions.
  - Per-page failure -> warn + continue.
  - Zero pages resolvable -> ok:false with clear error.
  - BBox must be page-image fractions with top-left origin.
  - For connected diagrams, bbox must contain the FULL connected diagram group.
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

VISION_INDEX_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "regions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "regionId": {
                        "type": "string",
                        "description": "Short stable id like r1, r2. The system will prefix page number.",
                    },
                    "type": {
                        "type": "string",
                        "enum": VISION_REGION_TYPES,
                    },
                    "description": {
                        "type": "string",
                        "description": "What this region shows, specific enough to teach from.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Actual text/values inside, or precise visual description.",
                    },
                    "contains": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "For diagrams/tables/charts/code: key visible labels/entities "
                            "included in this region."
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
                    "teachingValue": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                },
                "required": [
                    "regionId",
                    "type",
                    "description",
                    "content",
                    "bbox",
                    "teachingValue",
                ],
            },
        },
    },
    "required": ["regions"],
}


_PAGE_SCAN_PROMPT = """You are mapping a PDF page for an AI teacher.

Identify EVERY visually distinct teaching element on this page image:
tables, diagrams, formulas, charts, code blocks, figures, headings, text blocks,
lists, handwriting, screenshots, timelines.

For each region return:

- regionId:
  short stable id like "r1", "r2". I will prefix the page number.

- type:
  closest matching type from the schema.

- description:
  what it shows, specific enough that a teacher could point at it and explain it.
  Good: "star schema diagram: central Sales fact table linked to Customer,
  Product, Store, and Date dimension tables by foreign-key arrows"
  Bad: "a diagram"

- content:
  the actual text/values inside, or a precise visual description.

- contains:
  for diagrams/tables/charts/code blocks, list the key visible labels/entities
  inside the region.
  Example: ["Product", "Sale", "Invoice", "Customer", "Category", "Rating"]

- bbox:
  position as FRACTIONS of the PAGE IMAGE, 0.0-1.0.
  x,y = top-left corner. w,h = width/height.

  The bbox must FULLY CONTAIN the visible element.
  Nothing important may be cut off.
  When unsure, extend the box slightly.

  IMPORTANT FOR CONNECTED DIAGRAMS:
  If an element is part of one connected visual diagram, return ONE region for
  the FULL connected diagram group. The bbox must include all connected boxes,
  arrows, labels, relationship lines, and nearby labels needed to understand it.
  Do NOT return only one internal box of a larger diagram.

  Example good diagram region:
  "full schema diagram: Product, Sale, Invoice, Customer, Category, Rating,
  and their connecting arrows"

  Example bad diagram region:
  "Product box inside the diagram"

  Do not include unrelated neighboring paragraphs unless they are visually part
  of the same diagram/table/code block.

  A pointer, highlight, zoom camera, and optional crop will use these exact
  coordinates.

- teachingValue:
  high = central to teaching this page
  medium = supporting
  low = decoration/page furniture

Do NOT invent regions.
Only return what is actually visible on the page.
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


def _normalize_bbox(raw: Dict[str, Any]) -> Dict[str, float]:
    """
    Normalize bbox as top-left page-image fractions.

    We clamp into [0,1] and enforce tiny positive w/h so downstream pointer/crop
    never receives zero-size rectangles.
    """
    x = _clamp(raw.get("x", 0.0), 0.0, 1.0, 0.0)
    y = _clamp(raw.get("y", 0.0), 0.0, 1.0, 0.0)

    max_w = max(0.001, 1.0 - x)
    max_h = max(0.001, 1.0 - y)

    w = _clamp(raw.get("w", 0.001), 0.001, max_w, 0.001)
    h = _clamp(raw.get("h", 0.001), 0.001, max_h, 0.001)

    return {
        "x": round(x, 4),
        "y": round(y, 4),
        "w": round(w, 4),
        "h": round(h, 4),
    }


def _region_quality_warning(region: Dict[str, Any]) -> Optional[str]:
    """
    Soft warning only. Do not mutate bbox randomly here because random expansion
    can include unrelated PDF text. The prompt should produce the full connected
    bbox; this warning helps forensics.
    """
    rtype = str(region.get("type") or "").lower()
    bbox = region.get("bbox") or {}
    w = _safe_float(bbox.get("w"), 0.0)
    h = _safe_float(bbox.get("h"), 0.0)

    if rtype in {"diagram", "chart", "figure", "image"} and (w < 0.18 or h < 0.12):
        return (
            f"{region.get('regionId')}: tiny {rtype} bbox "
            f"w={w:.4f}, h={h:.4f}; may be an internal element instead of full connected group"
        )

    if rtype == "table" and (w < 0.20 or h < 0.08):
        return (
            f"{region.get('regionId')}: tiny table bbox "
            f"w={w:.4f}, h={h:.4f}; may cut columns/rows"
        )

    return None


def _load_image_bytes(image: Dict[str, Any]) -> Optional[bytes]:
    """
    Resolve a payload pageImage entry to raw PNG bytes.
    Prefer local path. Fall back to base64.
    """
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


# ─────────────────────────────────────────────────────────────────────────────
# Vision scan
# ─────────────────────────────────────────────────────────────────────────────

async def scan_page_image(
    page: int,
    image_bytes: bytes,
    *,
    model: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    One structured Gemini Vision call for one page.

    Returns normalized regions with required bbox.
    """
    if not _GENAI_OK:
        raise GeminiStructuredError("google.genai not available for vision scan")

    contents = [
        genai_types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
        _PAGE_SCAN_PROMPT,
    ]

    result = await generate_structured_async(
        prompt="",
        schema=VISION_INDEX_SCHEMA,
        model=model,
        temperature=0.2,
        contents=contents,
    )

    regions = (result or {}).get("regions") or []
    normalized: List[Dict[str, Any]] = []

    for i, region in enumerate(regions):
        if not isinstance(region, dict):
            continue

        raw_region_id = str(region.get("regionId") or f"r{i + 1}").strip()
        raw_region_id = raw_region_id.replace(" ", "_")[:80] or f"r{i + 1}"
        full_region_id = f"p{page}_{raw_region_id}"

        rtype = _normalize_region_type(region.get("type"))
        bbox = _normalize_bbox(region.get("bbox") or {})

        normalized_region = {
            "regionId": full_region_id,
            "page": page,
            "type": rtype,
            "description": str(region.get("description") or "").strip(),
            "content": str(region.get("content") or "").strip(),
            "contains": _normalize_contains(region.get("contains") or []),
            "bbox": bbox,
            "teachingValue": _normalize_teaching_value(region.get("teachingValue")),
        }

        warning = _region_quality_warning(normalized_region)
        if warning:
            normalized_region["warning"] = warning

        normalized.append(normalized_region)

    return normalized


async def build_vision_index(
    payload: Dict[str, Any],
    *,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    THE SAFETY NET.

    Scans ALL page images in the payload. sourceRefs are never a fence.

    Returns:
      {
        ok,
        visionIndex,
        pagesScanned,
        pagesFailed,
        visionEvidence,
        warnings
      }
    """
    images = payload.get("pageImages") or []
    selected_node_pages = _selected_pages_from_payload(payload, images)

    if not images:
        return {
            "ok": False,
            "step": "step3_gemini_vision",
            "visionIndex": [],
            "regions": [],
            "regionCount": 0,
            "pagesScanned": 0,
            "selectedNodePages": selected_node_pages,
            "pagesFailed": 0,
            "visionEvidence": [],
            "allRegionsHaveBbox": False,
            "fallbackUsed": False,
            "warnings": ["no pageImages in payload — vision safety net skipped"],
        }

    vision_index: List[Dict[str, Any]] = []
    warnings: List[str] = []
    scanned = 0
    failed = 0
    seen_pages: set[int] = set()

    for image in images:
        try:
            page = int(image.get("page") or image.get("pageNum") or image.get("pageNumber") or 0)
        except Exception:
            page = 0

        if page <= 0:
            failed += 1
            warnings.append("page image entry missing valid page number")
            continue

        if page in seen_pages:
            continue
        seen_pages.add(page)

        image_bytes = _load_image_bytes(image)
        if image_bytes is None:
            failed += 1
            warnings.append(f"page {page}: image not resolvable (path/base64 both failed)")
            continue

        try:
            regions = await scan_page_image(page, image_bytes, model=model)
            vision_index.extend(regions)

            for region in regions:
                if region.get("warning"):
                    warnings.append(f"page {page}: {region['warning']}")

            scanned += 1
            print(f"[vision_safety_net] page {page}: {len(regions)} regions", file=sys.stderr)

        except Exception as exc:
            failed += 1
            msg = str(exc)[:200]
            warnings.append(f"page {page}: vision scan failed — {msg}")
            print(f"[vision_safety_net] page {page} FAILED: {msg}", file=sys.stderr)

    vision_evidence = [
        {
            "chunkId": f"vision_{region['regionId']}",
            "page": region["page"],
            "text": (
                f"[{str(region['type']).upper()} on page {region['page']}] "
                f"{region['description']}. {region['content']}"
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
        warnings.append(
            "Gemini Vision scanned page image(s) but returned no usable bbox regions"
        )
    if vision_index and not all_have_bbox:
        warnings.append("Gemini Vision returned at least one region without a complete bbox")

    return {
        "ok": scanned > 0 and len(vision_index) > 0 and all_have_bbox,
        "step": "step3_gemini_vision",
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
