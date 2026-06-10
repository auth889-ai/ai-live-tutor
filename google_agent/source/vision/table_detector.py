"""
table_detector.py — extracts tables from visual analysis + page text.
Used to render comparison tables on the board row by row.
"""
from __future__ import annotations
import re
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text


def detect_tables_from_analysis(visual_analysis: JsonDict, page_num: int) -> List[JsonDict]:
    va     = safe_dict(visual_analysis)
    tables = []
    if not va.get("hasTable"):
        return tables
    area = safe_dict(va.get("tableArea") or {})
    tables.append({
        "page":     page_num,
        "area":     area,
        "headers":  [],
        "rows":     [],
        "caption":  "",
        "source":   "vision_detected",
    })
    return tables


def detect_tables_from_text(page_text: str, page_num: int) -> List[JsonDict]:
    """Finds markdown-style or delimiter-separated tables in raw text."""
    tables  = []
    lines   = [l.strip() for l in page_text.splitlines() if l.strip()]
    i       = 0
    while i < len(lines):
        line = lines[i]
        # Detect: line with multiple | separators
        if line.count("|") >= 2:
            header_parts = [c.strip() for c in line.split("|") if c.strip()]
            rows         = []
            j            = i + 1
            # Skip separator line (---|---|---)
            if j < len(lines) and re.match(r"[\s\-|:]+$", lines[j]):
                j += 1
            while j < len(lines) and lines[j].count("|") >= 2:
                row_parts = [c.strip() for c in lines[j].split("|") if c.strip()]
                rows.append(row_parts)
                j += 1
            if header_parts and rows:
                tables.append({
                    "page":     page_num,
                    "headers":  header_parts,
                    "rows":     rows[:12],
                    "caption":  "",
                    "source":   "text_detected",
                })
            i = j
        else:
            i += 1
    return tables


def merge_detected_tables(vision_tables: List[JsonDict], text_tables: List[JsonDict]) -> List[JsonDict]:
    all_tables = []
    seen_pages_vision = {t["page"] for t in vision_tables}
    all_tables.extend(vision_tables)
    for t in text_tables:
        if t["page"] not in seen_pages_vision:
            all_tables.append(t)
    return all_tables[:8]
