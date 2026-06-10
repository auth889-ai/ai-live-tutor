"""
google_agent/pipeline/context_loader.py
Loads and validates the Stage2 pipeline context from the incoming payload.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List

try:
    from ..live_tutor_agents.contracts import clean_text, safe_dict, safe_list, JsonDict
except ImportError:
    from google_agent.live_tutor_agents.contracts import clean_text, safe_dict, safe_list, JsonDict


@dataclass
class PipelineContext:
    payload: JsonDict = field(default_factory=dict)
    selected_node: JsonDict = field(default_factory=dict)
    selected_node_title: str = ""
    selected_evidence: List[JsonDict] = field(default_factory=list)
    selected_page_full_text: str = ""
    same_page_chunks: List[JsonDict] = field(default_factory=list)
    previous_page_chunks: List[JsonDict] = field(default_factory=list)
    next_page_chunks: List[JsonDict] = field(default_factory=list)
    page_images: List[JsonDict] = field(default_factory=list)
    full_pdf_summary: JsonDict = field(default_factory=dict)
    full_pdf_outline: JsonDict = field(default_factory=dict)
    roadmap_modules: List[JsonDict] = field(default_factory=list)
    source_refs: List[JsonDict] = field(default_factory=list)
    owner_key: str = ""
    resource_id: str = ""
    session_id: str = ""
    language: str = "english"
    student_level: str = "beginner"


def load_context(payload: JsonDict) -> PipelineContext:
    p = safe_dict(payload)
    node = safe_dict(p.get("selectedNode") or p.get("node") or {})
    title = clean_text(
        node.get("title") or node.get("label") or p.get("selectedNodeTitle") or "", 360
    )
    rsp = safe_dict(node.get("richSourcePack") or node.get("metadata", {}).get("richSourcePack") or {})
    evidence = safe_list(
        p.get("selectedEvidence") or p.get("evidence") or rsp.get("selectedEvidence") or []
    )
    return PipelineContext(
        payload=p,
        selected_node=node,
        selected_node_title=title,
        selected_evidence=evidence[:16],
        selected_page_full_text=clean_text(p.get("selectedPageFullText") or rsp.get("selectedPageFullText") or "", 24000),
        same_page_chunks=safe_list(p.get("samePageChunks") or p.get("samePageEvidence") or [])[:10],
        previous_page_chunks=safe_list(p.get("previousPageChunks") or p.get("prevPageEvidence") or [])[:8],
        next_page_chunks=safe_list(p.get("nextPageChunks") or p.get("nextPageEvidence") or [])[:8],
        page_images=safe_list(p.get("pageImages") or [])[:8],
        full_pdf_summary=safe_dict(p.get("fullPdfSummary") or p.get("pdfSummary") or {}),
        full_pdf_outline=safe_dict(p.get("fullPdfOutline") or {}),
        roadmap_modules=safe_list(p.get("roadmapModules") or [])[:20],
        source_refs=safe_list(p.get("sourceRefs") or [])[:60],
        owner_key=clean_text(p.get("ownerKey") or p.get("offlineUserId") or "", 160),
        resource_id=clean_text(p.get("resourceId") or "", 220),
        session_id=clean_text(p.get("sessionId") or "", 220),
        language=clean_text(p.get("language") or "english", 80),
        student_level=clean_text(p.get("studentLevel") or "beginner", 80),
    )


def validate_context(ctx: PipelineContext) -> List[str]:
    errors: List[str] = []
    if not ctx.selected_node_title:
        errors.append("selectedNode.title is required.")
    if not ctx.selected_evidence and not ctx.selected_page_full_text:
        errors.append("selectedEvidence or selectedPageFullText is required.")
    if not ctx.source_refs and not ctx.selected_evidence:
        errors.append("sourceRefs is required — no ungrounded teaching allowed.")
    return errors
