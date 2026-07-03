"""
google_agent/planning/teachers/teacher_context.py
===============================================================================
SHARED TEACHER CONTEXT — the reading material + helpers every teacher sub-agent
needs, in ONE place (so the LessonArchitect, the SegmentArchitect, the critic,
and the orchestrator all render the same source-grounded view of a node).

This is the "context layer" of the multi-agent Teacher subsystem:
  - image_bytes(payload)         → real PDF page PNG bytes (multimodal input)
  - level_range(payload)         → adaptive lesson size for the student level
  - region_catalog(payload)      → every real visionIndex region (id→page/type/title)
  - region_ids(payload)          → flat list of real regionIds (for grounding checks)
  - pages_list(payload)          → page numbers in scope
  - vision_pages_text(payload)   → EXHAUSTIVE per-page vision reading (the truth)
  - vision_pages_text_for(...)   → the same, scoped to ONE segment's pages/regions
  - evidence_text(payload)       → PDF text evidence (no slicing of sources)

No model calls here — pure rendering. Keeping it separate means each agent file
stays small and there is exactly one definition of "what the teacher sees".
===============================================================================
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

try:
    from ...live_tutor_agents.contracts import (
        JsonDict, clean_text, safe_dict, safe_list,
    )
    from ...source.vision_safety_net import _load_image_bytes
except ImportError:  # pragma: no cover
    from google_agent.live_tutor_agents.contracts import (  # type: ignore
        JsonDict, clean_text, safe_dict, safe_list,
    )
    from google_agent.source.vision_safety_net import _load_image_bytes  # type: ignore


# ─────────────────────────────────────────────────────────────────────────────
# Adaptive lesson size (one definition, shared)
# ─────────────────────────────────────────────────────────────────────────────

LEVEL_RANGE = {
    "beginner":     {"minMinutes": 45, "maxMinutes": 120, "screensMin": 90, "screensMax": 160},
    "intermediate": {"minMinutes": 35, "maxMinutes": 80,  "screensMin": 50, "screensMax": 95},
    "advanced":     {"minMinutes": 30, "maxMinutes": 55,  "screensMin": 30, "screensMax": 55},
}


def level_range(payload: JsonDict) -> Dict[str, Any]:
    payload = safe_dict(payload)
    level = clean_text(payload.get("studentLevel") or "beginner", 20).lower()
    r = LEVEL_RANGE.get(level, LEVEL_RANGE["beginner"])
    evidence = len(safe_list(payload.get("selectedEvidence") or payload.get("chunks")))
    bias = min(1.0, evidence / 30.0)
    minutes = int(r["minMinutes"] + (r["maxMinutes"] - r["minMinutes"]) * bias)
    return {**r, "level": level, "targetMinutes": minutes}


# ─────────────────────────────────────────────────────────────────────────────
# Multimodal input — the real PDF page PNG bytes
# ─────────────────────────────────────────────────────────────────────────────

def image_bytes(payload: JsonDict, pages: Optional[List[int]] = None) -> List[bytes]:
    """Load the real PDF page PNG bytes. If `pages` is given, only those pages."""
    want = set(int(p) for p in pages) if pages else None
    out: List[bytes] = []
    for img in safe_list(safe_dict(payload).get("pageImages")):
        img = safe_dict(img)
        if want is not None:
            try:
                if int(img.get("page")) not in want:
                    continue
            except (TypeError, ValueError):
                continue
        data = _load_image_bytes(img)
        if data is not None:
            out.append(data)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Region / page catalogs (so a sub-agent can be given a focused scope)
# ─────────────────────────────────────────────────────────────────────────────

def region_catalog(payload: JsonDict) -> List[Dict[str, Any]]:
    """Every real region the teacher may point at: id → page, type, title."""
    payload = safe_dict(payload)
    cat: List[Dict[str, Any]] = []
    # prefer the rich per-page regions (carry page + richer fields)
    pages = safe_list(payload.get("visionPages"))
    if pages:
        for pg in pages:
            pg = safe_dict(pg)
            page = pg.get("page")
            for r in safe_list(pg.get("regions")):
                r = safe_dict(r)
                if r.get("regionId"):
                    cat.append({"regionId": r.get("regionId"), "page": page,
                                "type": r.get("type"), "title": clean_text(r.get("title"), 120)})
        return cat
    for r in safe_list(payload.get("visionIndex")):
        r = safe_dict(r)
        if r.get("regionId"):
            cat.append({"regionId": r.get("regionId"), "page": r.get("page"),
                        "type": r.get("type"), "title": clean_text(r.get("title"), 120)})
    return cat


def region_ids(payload: JsonDict) -> List[str]:
    return [r["regionId"] for r in region_catalog(payload) if r.get("regionId")]


def pages_list(payload: JsonDict) -> List[int]:
    payload = safe_dict(payload)
    node = safe_dict(payload.get("selectedNode"))
    refs = safe_list(node.get("pageRefs"))
    out: List[int] = []
    for p in refs:
        try:
            out.append(int(p))
        except (TypeError, ValueError):
            continue
    if out:
        return sorted(set(out))
    # fall back to whatever pages we actually have images / vision for
    for img in safe_list(payload.get("pageImages")):
        try:
            out.append(int(safe_dict(img).get("page")))
        except (TypeError, ValueError):
            continue
    return sorted(set(out))


def region_catalog_text(payload: JsonDict, pages: Optional[List[int]] = None) -> str:
    want = set(int(p) for p in pages) if pages else None
    lines: List[str] = []
    for r in region_catalog(payload):
        if want is not None and r.get("page") not in want:
            continue
        lines.append(f"  [{r.get('regionId')}] page={r.get('page')} "
                     f"type={r.get('type')} — {r.get('title')}")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# The exhaustive per-page vision reading (the truth the teacher explains)
# ─────────────────────────────────────────────────────────────────────────────

def _render_page(pg: JsonDict) -> List[str]:
    pg = safe_dict(pg)
    out: List[str] = []
    out.append(f"\n=== PAGE {pg.get('page')} — {clean_text(pg.get('pageTitle'), 160)} ===")
    out.append(f"SUMMARY: {clean_text(pg.get('pageSummary'), 1400)}")
    concepts = safe_list(pg.get("conceptsCovered"))
    if concepts:
        out.append("CONCEPTS: " + ", ".join(clean_text(c, 80) for c in concepts))
    narr = safe_list(pg.get("teachingNarrative"))
    if narr:
        out.append("TEACHING NARRATIVE:")
        for i, s in enumerate(narr, 1):
            out.append(f"  {i}. {clean_text(s, 600)}")
    out.append("REGIONS:")
    for r in safe_list(pg.get("regions")):
        r = safe_dict(r)
        out.append(f"  [{r.get('regionId')}] ({r.get('type')}) {clean_text(r.get('title'), 120)}")
        out.append(f"      content: {clean_text(r.get('content') or r.get('exactContent'), 1400)}")
        if r.get("conceptExplanation"):
            out.append(f"      concept: {clean_text(r.get('conceptExplanation'), 700)}")
        for s in safe_list(r.get("stepByStepExplanation"))[:40]:
            out.append(f"      step: {clean_text(s, 600)}")
        rels = safe_list(r.get("relationships"))
        if rels:
            out.append("      relationships: " + "; ".join(clean_text(x, 160) for x in rels[:12]))
    return out


def vision_pages_text(payload: JsonDict, pages: Optional[List[int]] = None) -> str:
    """Exhaustive per-page vision reading. If `pages` given, only those pages."""
    payload = safe_dict(payload)
    want = set(int(p) for p in pages) if pages else None
    pgs = safe_list(payload.get("visionPages"))
    if not pgs:
        return _vision_index_text(payload, want)
    out: List[str] = []
    for pg in pgs:
        pg = safe_dict(pg)
        if want is not None:
            try:
                if int(pg.get("page")) not in want:
                    continue
            except (TypeError, ValueError):
                continue
        out.extend(_render_page(pg))
    return "\n".join(out)


def _vision_index_text(payload: JsonDict, want: Optional[set] = None) -> str:
    lines: List[str] = []
    for r in safe_list(safe_dict(payload).get("visionIndex")):
        r = safe_dict(r)
        if want is not None and r.get("page") not in want:
            continue
        lines.append(
            f"  [{r.get('regionId')}] page={r.get('page')} type={r.get('type')} "
            f"| {clean_text(r.get('description'), 200)} | content: {clean_text(r.get('content'), 400)}"
        )
    return "\n".join(lines)


def evidence_text(payload: JsonDict, pages: Optional[List[int]] = None, limit: int = 40) -> str:
    """PDF text evidence. Sources are NOT sliced away; `limit` is a render cap only."""
    payload = safe_dict(payload)
    want = set(int(p) for p in pages) if pages else None
    chunks = safe_list(payload.get("selectedEvidence") or payload.get("chunks"))
    lines: List[str] = []
    for c in chunks:
        c = safe_dict(c)
        if want is not None:
            try:
                if int(c.get("page")) not in want:
                    continue
            except (TypeError, ValueError):
                continue
        lines.append(f"  [p.{c.get('page','?')}] "
                     f"{clean_text(c.get('text') or c.get('textPreview'), 300)}")
        if len(lines) >= limit:
            break
    return "\n".join(lines)
