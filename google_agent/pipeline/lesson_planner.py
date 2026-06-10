"""
lesson_planner.py — adaptive lesson plan based on node complexity + student level + lesson mode.
Masterclass = 2+ hours, 40 segments, 150 screens. Quick = 5 min, 3 segments.
"""
from __future__ import annotations
import time, uuid
from typing import List

try:
    from ..live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

SEGMENT_ORDER = {
    "quick":       ["intro","definition","quiz"],
    "standard":    ["intro","definition","source_proof","example","warning","quiz","recap"],
    "deep":        ["intro","definition","source_proof","pdf_diagram","example","warning","comparison","quiz","recap"],
    "masterclass": ["intro","definition","source_proof","pdf_diagram","premium_board","example",
                    "warning","comparison","code_dryrun","deep_dive","quiz","recap"],
}

DURATION_MS = {
    "quick": 300_000, "standard": 900_000, "deep": 1_800_000, "masterclass": 7_200_000
}


def plan_lesson(node: JsonDict, student_level: str = "beginner", lesson_mode: str = "masterclass") -> JsonDict:
    n       = safe_dict(node)
    comp    = n.get("complexity") or "medium"
    has_diag = bool(n.get("hasDiagram") or n.get("hasPageImages"))
    has_code = bool(n.get("hasCodeExample"))
    has_cmp  = bool(n.get("hasComparison"))
    pages    = len(safe_list(n.get("pageRefs") or []))

    base_segs = list(SEGMENT_ORDER.get(lesson_mode) or SEGMENT_ORDER["standard"])

    # Remove irrelevant segments
    if not has_diag:    base_segs = [s for s in base_segs if s != "pdf_diagram"]
    if not has_code:    base_segs = [s for s in base_segs if s != "code_dryrun"]
    if not has_cmp:     base_segs = [s for s in base_segs if s != "comparison"]

    # Add extra depth for complex nodes in masterclass
    if lesson_mode == "masterclass" and comp in ("hard", "advanced"):
        for seg in ["source_proof", "example", "warning"]:
            if seg in base_segs:
                base_segs.insert(base_segs.index(seg)+1, seg)

    # More pages = more segments
    if pages >= 6 and lesson_mode in ("deep","masterclass"):
        if "pdf_diagram" not in base_segs:
            base_segs.insert(3, "pdf_diagram")

    segments = [_make_seg(stype, i, n) for i, stype in enumerate(base_segs)]
    total_ms = DURATION_MS.get(lesson_mode, 1_800_000)
    per_seg  = total_ms // max(len(segments), 1)

    for seg in segments:
        seg["estimatedMs"] = per_seg

    return {
        "lessonId":       f"lesson_{int(time.time()*1000)}_{uuid.uuid4().hex[:4]}",
        "nodeId":         n.get("nodeId") or n.get("id") or "",
        "nodeTitle":      n.get("title") or n.get("label") or "",
        "studentLevel":   student_level,
        "lessonMode":     lesson_mode,
        "complexity":     comp,
        "totalSegments":  len(segments),
        "estimatedMs":    total_ms,
        "segments":       segments,
        "metadata":       {"fallbackUsed": False, "hasDiagram": has_diag, "hasCode": has_code},
    }


def _make_seg(stype: str, idx: int, node: JsonDict) -> JsonDict:
    return {
        "segmentId":    f"seg_{idx+1:02d}_{stype}_{uuid.uuid4().hex[:4]}",
        "segmentIndex": idx + 1,
        "segmentType":  stype,
        "title":        f"{stype.replace('_',' ').title()}: {clean_text(node.get('title') or '', 40)}",
        "estimatedMs":  0,
        "screenCount":  0,
        "generated":    False,
    }
