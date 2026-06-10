"""
citation_builder.py — builds human-readable citation strings for board badges and lesson books.
Format: [Page N]: "exact quote" — used in voice script, board source badges, lesson book.
"""
from __future__ import annotations
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text


def build_citation(ref: JsonDict, max_quote: int = 120) -> str:
    r     = safe_dict(ref)
    page  = int(r.get("page") or 1)
    cid   = clean_text(r.get("chunkId") or "", 60)
    quote = clean_text(r.get("quote") or r.get("text") or r.get("textPreview") or "", max_quote)
    chunk_part = f", §{cid.split('_c')[-1]}" if "_c" in cid else ""
    return f'[Page {page}{chunk_part}]: "{quote}"' if quote else f"[Page {page}{chunk_part}]"


def build_citation_list(refs: List[JsonDict], max_refs: int = 8) -> List[str]:
    seen, out = set(), []
    for ref in safe_list(refs)[:max_refs * 2]:
        c = build_citation(ref)
        if c not in seen:
            seen.add(c)
            out.append(c)
        if len(out) >= max_refs:
            break
    return out


def build_source_badge(refs: List[JsonDict]) -> JsonDict:
    pages     = sorted({int(safe_dict(r).get("page") or 1) for r in safe_list(refs)})
    citations = build_citation_list(refs, max_refs=4)
    return {
        "pages":     pages,
        "citations": citations,
        "label":     "Source: p." + ", p.".join(str(p) for p in pages[:3]),
        "count":     len(pages),
    }


def build_lesson_bibliography(all_refs: List[JsonDict]) -> str:
    seen, lines = set(), ["## Sources\n"]
    for ref in safe_list(all_refs):
        c = build_citation(ref, max_quote=200)
        if c not in seen:
            seen.add(c)
            lines.append(f"- {c}")
    return "\n".join(lines)
