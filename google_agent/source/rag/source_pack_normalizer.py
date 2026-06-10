"""
source_pack_normalizer.py — normalizes sourceRef format across all agents.
Consistent shape: chunkId + page + quote + sourceRef + confidence + resourceId.
"""
from __future__ import annotations
from typing import Any, List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text


def normalize_ref(raw: Any, resource_id: str = "") -> JsonDict:
    r    = safe_dict(raw)
    page = max(1, int(r.get("page") or r.get("pageNumber") or r.get("pageNum") or 1))
    rid  = clean_text(r.get("resourceId") or r.get("resource_id") or resource_id, 160)
    cid  = clean_text(
        r.get("chunkId") or r.get("chunk_id") or r.get("id") or r.get("_id") or
        (f"{rid}_p{page}_c0" if rid else ""), 220
    )
    src  = clean_text(
        r.get("sourceRef") or r.get("source_ref") or
        (f"{rid}:page:{page}" if rid else f"page:{page}"), 300
    )
    quote = clean_text(r.get("quote") or r.get("text") or r.get("textPreview") or "", 500)
    return {
        "chunkId":    cid,
        "page":       page,
        "sourceRef":  src,
        "quote":      quote,
        "confidence": max(0.0, min(1.0, float(r.get("confidence") or 0.8))),
        "resourceId": rid,
    }


def normalize_refs(refs: Any, resource_id: str = "") -> List[JsonDict]:
    seen, out = set(), []
    for ref in safe_list(refs):
        n   = normalize_ref(ref, resource_id)
        key = f"{n['chunkId']}|{n['page']}"
        if key in seen or not n["chunkId"]:
            continue
        seen.add(key)
        out.append(n)
    return out


def merge_refs(*ref_lists: Any, resource_id: str = "") -> List[JsonDict]:
    combined = []
    for lst in ref_lists:
        combined.extend(safe_list(lst))
    return normalize_refs(combined, resource_id)
