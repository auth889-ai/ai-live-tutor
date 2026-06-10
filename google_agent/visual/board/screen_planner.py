"""
screen_planner.py — decides screens per segment dynamically.
Complex node → more screens. Diagram → pdf_image screen. Code → dry-run screen.
"""
from __future__ import annotations
import uuid, time
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

SCREEN_DURATION_MS = {
    "hook":          15000, "overview":       20000, "definition":    25000,
    "source_proof":  30000, "pdf_diagram":    45000, "workflow":      40000,
    "example":       35000, "warning":        25000, "comparison":    35000,
    "code_dryrun":   50000, "quiz":           30000, "recap":         20000,
    "repair":        30000, "deep_dive":      45000, "analogy":       25000,
}

def _sid() -> str:
    return f"scr_{int(time.time()*1000)}_{uuid.uuid4().hex[:4]}"


def plan_screens_for_segment(
    segment_type: str,
    node: JsonDict,
    vision_packet: JsonDict,
    student_level: str = "beginner",
    lesson_mode: str = "masterclass",
) -> List[JsonDict]:
    n    = safe_dict(node)
    vp   = safe_dict(vision_packet)
    comp = n.get("complexity") or "medium"
    has_diag  = vp.get("hasRealDiagram") or n.get("hasDiagram")
    has_table = vp.get("hasRealTable")   or n.get("hasComparison")
    has_code  = n.get("hasCodeExample")

    screens = []
    def add(stype: str, purpose: str, intent: str = ""):
        screens.append({
            "screenId":      _sid(),
            "segmentId":     "",            # filled by segment pipeline
            "screenType":    stype,
            "purpose":       purpose,
            "teacherIntent": intent or f"teach_{stype}",
            "durationMs":    SCREEN_DURATION_MS.get(stype, 25000),
            "revealOrder":   len(screens) + 1,
            "boardCommands": [],
            "voiceLineIds":  [],
            "sourceRefs":    [],
        })

    if segment_type == "intro":
        add("hook",     "Create curiosity, show why this matters",     "hook_student")
        add("overview", "Big picture: what we will cover today",       "set_agenda")
        if lesson_mode in ("deep", "masterclass"): add("analogy", "Relatable analogy to make it click", "build_analogy")

    elif segment_type == "definition":
        add("definition",   "Precise definition from PDF",             "define_term")
        add("source_proof", "Show real PDF page with the definition",  "prove_with_source")
        if has_diag: add("pdf_diagram", "Show diagram from PDF page",  "point_at_diagram")

    elif segment_type == "pdf_diagram":
        add("pdf_diagram",  "Full PDF page image displayed",           "show_real_page")
        add("pdf_diagram",  "Pointer moves to key diagram element",    "point_explain")
        add("workflow",     "Step-by-step explanation of diagram",     "walk_through_diagram")

    elif segment_type == "example":
        add("example",      "Concrete example from PDF",               "show_real_example")
        if has_code: add("code_dryrun", "Live code execution",          "run_code")

    elif segment_type == "warning":
        add("warning",      "Common mistake from PDF evidence",        "show_mistake")
        add("definition",   "The correct approach",                    "show_correct")

    elif segment_type == "comparison":
        add("comparison",   "Side-by-side table, row by row",          "build_comparison")
        if has_diag: add("pdf_diagram", "Visual comparison from PDF",  "show_visual_comparison")

    elif segment_type == "quiz":
        add("quiz",         "Check student understanding",             "test_understanding")

    elif segment_type == "recap":
        add("recap",        "Key points summary with sources",         "summarize_lesson")

    else:
        add("overview", f"Teaching: {segment_type}", "generic_teach")

    # Add more screens for masterclass
    if lesson_mode == "masterclass" and comp in ("hard", "advanced") and segment_type not in ("quiz", "recap"):
        add("deep_dive", "Deep dive with additional evidence", "deepen_understanding")

    return screens
