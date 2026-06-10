"""
vision_packet_builder.py — combines all visual analysis into one VisionPacket.
Passed to VisualPlannerAgent so it knows what diagrams/tables are on each page.
"""
from __future__ import annotations
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

try:
    from .table_detector   import detect_tables_from_analysis, detect_tables_from_text, merge_detected_tables
    from .diagram_detector import detect_from_visual_analysis, detect_from_text, merge_detected_diagrams
except ImportError:
    from google_agent.source.vision.table_detector   import detect_tables_from_analysis, detect_tables_from_text, merge_detected_tables
    from google_agent.source.vision.diagram_detector import detect_from_visual_analysis, detect_from_text, merge_detected_diagrams


def build_vision_packet(
    page_analyses: List[JsonDict],
    page_texts: dict,
    resource_id: str,
    node_title: str = "",
) -> JsonDict:
    all_tables, all_diagrams = [], []
    core_facts, board_hints, mark_hints = [], [], []

    for analysis in safe_list(page_analyses):
        va   = safe_dict(analysis)
        page = int(va.get("page") or 1)
        text = clean_text(page_texts.get(page) or "", 8000)

        # Tables
        v_tables = detect_tables_from_analysis(va, page)
        t_tables = detect_tables_from_text(text, page)
        all_tables.extend(merge_detected_tables(v_tables, t_tables))

        # Diagrams
        v_diags = detect_from_visual_analysis(va, page)
        t_diags = detect_from_text(text, page)
        all_diagrams.extend(merge_detected_diagrams(v_diags, t_diags))

        core_facts.extend(safe_list(va.get("coreVisualFacts") or []))
        board_hints.extend(safe_list(va.get("teacherMarkingHints") or []))
        mark_hints.extend([h for h in safe_list(va.get("textRegions") or []) if safe_dict(h).get("text")])

    return {
        "resourceId":          resource_id,
        "nodeTitle":           node_title,
        "pageImageAnalyses":   page_analyses,
        "detectedTables":      all_tables[:8],
        "detectedDiagrams":    all_diagrams[:6],
        "coreVisualFacts":     list(dict.fromkeys(clean_text(f, 200) for f in core_facts if f))[:20],
        "boardRedrawHints":    list(dict.fromkeys(clean_text(h, 200) for h in board_hints if h))[:15],
        "teacherMarkingHints": mark_hints[:20],
        "hasRealDiagram":      bool(all_diagrams),
        "hasRealTable":        bool(all_tables),
        "pageCount":           len(page_analyses),
        "metadata":            {"fallbackUsed": False, "source": "vision_packet_builder"},
    }
