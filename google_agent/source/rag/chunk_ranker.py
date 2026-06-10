"""
chunk_ranker.py — ranks chunks by relevance to segment type + node.
Per-segment: definition evidence ≠ warning evidence ≠ diagram evidence.
"""
from __future__ import annotations
import re
from typing import Dict, List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

SEGMENT_SIGNALS: Dict[str, List[str]] = {
    "intro":        ["introduction", "overview", "what is", "purpose", "concept", "begin"],
    "definition":   ["definition", "means", "is a", "refers to", "defined as", "called"],
    "source_proof": ["source", "proof", "states", "according", "evidence", "shows"],
    "pdf_diagram":  ["diagram", "figure", "table", "chart", "schema", "workflow", "flow"],
    "example":      ["example", "e.g.", "case", "scenario", "instance", "such as"],
    "warning":      ["warning", "mistake", "risk", "avoid", "caution", "problem", "never"],
    "quiz":         ["quiz", "question", "test", "check", "assessment", "exercise"],
    "comparison":   ["vs", "versus", "compare", "difference", "contrast", "whereas"],
    "code_dryrun":  ["sql", "code", "alter", "create", "insert", "select", "query"],
    "recap":        ["summary", "recap", "conclusion", "key points", "remember"],
}

_STOP = {"the","a","an","is","it","to","of","in","and","or","for","with","this","that","are","was","be"}


def _tokens(text: str) -> set:
    return {w for w in re.findall(r"[a-z0-9]{3,}", text.lower()) if w not in _STOP}


def rank_chunks(chunks: List[JsonDict], node_title: str, segment_type: str, page_nums: List[int]) -> List[JsonDict]:
    title_tokens = _tokens(node_title)
    seg_signals  = set(SEGMENT_SIGNALS.get(segment_type, []))
    ranked       = []

    for chunk in safe_list(chunks):
        c    = safe_dict(chunk)
        text = clean_text(c.get("text") or c.get("textPreview") or "", 8000)
        low  = text.lower()
        page = int(c.get("page") or 1)

        title_score = len(title_tokens & _tokens(text)) * 3
        seg_score   = sum(2 for sig in seg_signals if sig in low)
        page_score  = 10 if page in page_nums else (5 if any(abs(page - p) <= 2 for p in page_nums) else 0)
        conf_score  = float(c.get("confidence") or 0.7) * 2
        total       = title_score + seg_score + page_score + conf_score

        ranked.append({**c, "_score": round(total, 3), "_segmentType": segment_type})

    return sorted(ranked, key=lambda x: x["_score"], reverse=True)
