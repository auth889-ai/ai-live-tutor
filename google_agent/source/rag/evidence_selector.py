"""
evidence_selector.py — selects best evidence per segment with broad page coverage.
Per-segment: each segment type gets different evidence from different pages.
"""
from __future__ import annotations
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

try:
    from .chunk_ranker import rank_chunks
except ImportError:
    from google_agent.source.rag.chunk_ranker import rank_chunks


def select_evidence(
    chunks: List[JsonDict],
    node_title: str,
    segment_type: str,
    page_nums: List[int],
    max_items: int = 12,
) -> List[JsonDict]:
    ranked     = rank_chunks(chunks, node_title, segment_type, page_nums)
    selected: List[JsonDict] = []
    page_counts: dict = {}

    for chunk in ranked:
        if len(selected) >= max_items:
            break
        c    = safe_dict(chunk)
        page = int(c.get("page") or 1)
        # Primary pages: 2 slots; others: 1 slot for broad coverage
        limit = 2 if page in page_nums else 1
        if page_counts.get(page, 0) >= limit:
            continue
        text = clean_text(c.get("text") or c.get("textPreview") or "", 6000)
        if not text:
            continue
        page_counts[page] = page_counts.get(page, 0) + 1
        selected.append({
            "chunkId":     c.get("chunkId") or c.get("_id") or "",
            "page":        page,
            "text":        text,
            "textPreview": text[:300],
            "sourceRef":   c.get("sourceRef") or f"page:{page}",
            "confidence":  float(c.get("confidence") or 0.8),
            "score":       c.get("_score", 0),
            "segmentType": segment_type,
        })

    return selected


def select_evidence_for_all_segments(
    chunks: List[JsonDict],
    node_title: str,
    segment_types: List[str],
    page_nums: List[int],
) -> dict:
    """Returns { segmentType: [evidence...] } — different evidence per segment."""
    return {
        seg: select_evidence(chunks, node_title, seg, page_nums, max_items=10)
        for seg in segment_types
    }
