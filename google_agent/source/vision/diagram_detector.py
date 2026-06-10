"""
diagram_detector.py — detects diagrams from visual analysis and page text.
Returns structured: type, nodes, edges, area — for board drawing commands.
"""
from __future__ import annotations
import re
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

DIAGRAM_TYPES = {"flowchart", "mindmap", "er", "sequence", "arrow_diagram", "star_schema", "tree", "timeline"}

_FLOW_ARROW  = re.compile(r"([A-Za-z0-9 ]{2,40})\s*(?:→|->|=>|-->)\s*([A-Za-z0-9 ]{2,40})")
_STEP_NUM    = re.compile(r"(?:^|\n)\s*(\d+)[.)]\s+(.{5,80})", re.M)


def detect_from_visual_analysis(visual_analysis: JsonDict, page_num: int) -> List[JsonDict]:
    va   = safe_dict(visual_analysis)
    diags = []
    if not va.get("hasDiagram") and not va.get("hasFlowchart"):
        return diags
    area = safe_dict(va.get("diagramArea") or {})
    dtype = "flowchart" if va.get("hasFlowchart") else "diagram"
    hints = safe_list(va.get("coreVisualFacts") or [])
    diags.append({
        "page":   page_num,
        "type":   dtype,
        "nodes":  [],
        "edges":  [],
        "area":   area,
        "hints":  hints[:6],
        "source": "vision",
    })
    return diags


def detect_from_text(page_text: str, page_num: int) -> List[JsonDict]:
    diags = []
    text  = clean_text(page_text, 10000)

    # Flowchart: detect A → B → C patterns
    arrows = _FLOW_ARROW.findall(text)
    if len(arrows) >= 2:
        nodes = list({n.strip() for pair in arrows for n in pair})
        edges = [{"from": a.strip(), "to": b.strip()} for a, b in arrows]
        diags.append({"page": page_num, "type": "flowchart", "nodes": nodes[:12], "edges": edges[:12], "area": {}, "source": "text"})

    # Numbered steps: detect 1. Step A, 2. Step B
    steps = _STEP_NUM.findall(text)
    if len(steps) >= 3 and not diags:
        nodes = [f"Step {n}: {s.strip()[:40]}" for n, s in steps[:8]]
        edges = [{"from": nodes[i], "to": nodes[i+1]} for i in range(len(nodes)-1)]
        diags.append({"page": page_num, "type": "flowchart", "nodes": nodes, "edges": edges, "area": {}, "source": "text_steps"})

    return diags


def merge_detected_diagrams(vision_diags: List[JsonDict], text_diags: List[JsonDict]) -> List[JsonDict]:
    # Vision diagrams take priority; text fills gaps
    all_diags     = list(vision_diags)
    vision_pages  = {d["page"] for d in vision_diags}
    for d in text_diags:
        if d["page"] not in vision_pages:
            all_diags.append(d)
    return all_diags[:6]
