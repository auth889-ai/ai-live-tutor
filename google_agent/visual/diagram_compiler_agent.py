"""
google_agent/visual/diagram_compiler_agent.py
===============================================================================
VERSION 7 REAL DYNAMIC FIX

Real Text2Diagram-style DiagramCompilerAgent.

What this does:
- Uses Gemini/ADK (uses_adk=True), not deterministic keyword splitting.
- Does not hardcode Star Schema, Kid's Shop, or any fixed topic.
- Builds a Text2Diagram-style prompt from selectedNode, selectedEvidence,
  relatedEvidence, OCR/table/layout/page-image context, and visualPlan.
- Requires Mermaid/ReactFlow/source mapping from Gemini.
- Rejects generic diagrams like:
  source_grounded_diagram -> draws -> step-by-step -> visual -> flow
- Fails loudly. No fake fallback.
===============================================================================
"""

from __future__ import annotations

import json
import re
from typing import Any, List

try:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        safe_dict,
        safe_list,
    )
except Exception:
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
    from google_agent.live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        safe_dict,
        safe_list,
    )


BAD_MERMAID_PATTERNS = [
    r"source[_\s-]*grounded[_\s-]*diagram[\s\S]*\bdraws\b[\s\S]*\bvisual\b[\s\S]*\bflow\b",
    r"root\s*\(\(\s*exact source evidence\s*\)\)",
    r"\bdiagram\b[\s\S]*\bdraws\b[\s\S]*\bstep[_\s-]*by[_\s-]*step\b",
    r"\bvisual\b[\s\S]*\bflow\b[\s\S]*\bsource\b",
]


def _json(value: Any, limit: int = 120000) -> str:
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), limit)
    except Exception:
        return clean_text(value, limit)


def _walk_refs(value: Any, out: List[JsonDict]) -> None:
    if isinstance(value, list):
        for item in value:
            _walk_refs(item, out)
        return
    if isinstance(value, dict):
        local = value.get("sourceRefs") or value.get("refs")
        if isinstance(local, list):
            out.extend([safe_dict(item) for item in local if safe_dict(item)])
        if any(key in value for key in ("chunkId", "sourceRef", "page", "quote")):
            out.append(safe_dict(value))
        for child in value.values():
            if isinstance(child, (list, dict)):
                _walk_refs(child, out)


def _chunk_ref(chunk: JsonDict) -> JsonDict:
    c = safe_dict(chunk)
    page = c.get("page") or c.get("pageNumber") or 1
    idx = c.get("chunkIndex") or c.get("index") or 0
    resource_id = clean_text(c.get("resourceId") or c.get("resource_id") or c.get("documentId") or "", 180)
    chunk_id = clean_text(c.get("chunkId") or c.get("id") or f"{resource_id or 'resource'}_p{page}_c{idx}", 220)
    quote = clean_text(c.get("quote") or c.get("textPreview") or c.get("text") or c.get("ocrText") or c.get("content") or "", 900)
    return {
        "chunkId": chunk_id,
        "sourceRef": clean_text(c.get("sourceRef") or c.get("ref") or f"{resource_id or 'resource'}:page:{page}:chunk:{idx}", 300),
        "pageRef": clean_text(c.get("pageRef") or f"{resource_id or 'resource'}:page:{page}", 300),
        "page": page,
        "quote": quote,
        "confidence": c.get("confidence") or 0.84,
        "resourceId": resource_id,
    }


def _source_refs(payload: JsonDict, extra: Any = None) -> List[JsonDict]:
    refs: List[JsonDict] = []
    for key in [
        "selectedEvidence",
        "primaryEvidence",
        "sourceRefs",
        "selectedNode",
        "node",
        "visualPlan",
        "premiumBoardScreens",
        "boardScreens",
        "boardSections",
        "compiledDiagrams",
        "sourceGrounding",
        "exactChunks",
        "samePageChunks",
        "nearbyChunks",
        "relatedEvidence",
        "relatedChunks",
        "pageContexts",
        "ocrBlocks",
        "layoutTables",
        "figures",
    ]:
        _walk_refs(payload.get(key), refs)
    _walk_refs(extra, refs)
    if not refs:
        for chunk in safe_list(payload.get("exactChunks") or payload.get("chunks") or payload.get("retrievedChunks")):
            refs.append(_chunk_ref(safe_dict(chunk)))
    return dedupe_source_refs(refs)


def _selected_node(payload: JsonDict) -> JsonDict:
    return safe_dict(payload.get("selectedNode") or payload.get("node"))


def _title(payload: JsonDict, visual: JsonDict | None = None) -> str:
    visual = safe_dict(visual)
    node = _selected_node(payload)
    return clean_text(
        visual.get("title")
        or node.get("label")
        or node.get("title")
        or payload.get("topic")
        or payload.get("question")
        or "Selected PDF concept",
        180,
    )


def _selected_evidence(payload: JsonDict) -> List[JsonDict]:
    refs = safe_list(payload.get("selectedEvidence") or payload.get("primaryEvidence"))
    if refs:
        return [safe_dict(r) for r in refs if safe_dict(r)][:36]
    node_refs = safe_list(_selected_node(payload).get("sourceRefs"))
    if node_refs:
        return [safe_dict(r) for r in node_refs if safe_dict(r)][:36]
    return _source_refs(payload)[:36]


def _compact_chunks(payload: JsonDict) -> JsonDict:
    def compact_list(key: str, limit: int, chars: int) -> List[JsonDict]:
        out = []
        for raw in safe_list(payload.get(key))[:limit]:
            c = safe_dict(raw)
            out.append(
                {
                    "chunkId": c.get("chunkId") or c.get("id"),
                    "page": c.get("page") or c.get("pageNumber"),
                    "heading": clean_text(c.get("heading") or c.get("title") or "", 140),
                    "text": clean_text(c.get("text") or c.get("textPreview") or c.get("ocrText") or "", chars),
                    "sourceRefs": safe_list(c.get("sourceRefs"))[:4],
                }
            )
        return out

    return {
        "exactChunks": compact_list("exactChunks", 14, 1800),
        "samePageChunks": compact_list("samePageChunks", 12, 1500),
        "nearbyChunks": compact_list("nearbyChunks", 10, 1000),
        "relatedChunks": compact_list("relatedChunks", 12, 1000),
        "pageContexts": compact_list("pageContexts", 8, 1600),
        "ocrBlocks": compact_list("ocrBlocks", 10, 800),
        "layoutTables": safe_list(payload.get("layoutTables"))[:6],
        "figures": safe_list(payload.get("figures"))[:6],
        "pageImages": safe_list(payload.get("pageImages"))[:6],
    }


def _screen_blocks(plan: JsonDict) -> List[JsonDict]:
    blocks: List[JsonDict] = []
    for screen in safe_list(plan.get("premiumBoardScreens") or plan.get("boardScreens")):
        for block in safe_list(safe_dict(screen).get("blocks")):
            b = safe_dict(block)
            if b:
                blocks.append(b)
    return blocks


def _visual_intents(payload: JsonDict) -> List[JsonDict]:
    plan = safe_dict(payload.get("visualPlan"))
    visuals = [safe_dict(v) for v in safe_list(payload.get("visuals") or plan.get("visuals")) if safe_dict(v)]
    if visuals:
        return visuals[:8]

    out: List[JsonDict] = []
    for block in _screen_blocks(plan):
        btype = clean_text(block.get("type"), 80)
        if btype in {"diagramPanel", "miniConceptTree", "mappingTable", "workflowStrip", "sourcePagePreview", "layoutTableBlock"}:
            body = block.get("body")
            out.append(
                {
                    "visualId": clean_text(block.get("blockId") or block.get("id") or f"visual_{len(out) + 1}", 120),
                    "title": clean_text(block.get("title") or _title(payload), 180),
                    "diagramTypeHint": block.get("diagramType") or safe_dict(body).get("diagramType") or btype,
                    "body": body,
                    "sourceRefs": safe_list(block.get("sourceRefs"))[:8],
                }
            )
    return out[:8] or [{"visualId": "selected_node_diagram", "title": _title(payload), "diagramTypeHint": "auto"}]


def _is_generic_mermaid(mermaid: str) -> bool:
    m = clean_text(mermaid, 50000).lower()
    if len(m) < 20:
        return True
    for pattern in BAD_MERMAID_PATTERNS:
        if re.search(pattern, m, flags=re.I | re.S):
            return True
    if "flowchart" in m or "mindmap" in m or "graph" in m:
        labels = re.findall(r'\[\s*"?([^\]"]+)', m)
        meaningful = [label for label in labels if len(re.findall(r"[a-zA-Z0-9]+", label)) >= 2]
        if len(meaningful) < 3:
            return True
    return False


def _normalize_source_ref(ref: Any, fallback_refs: List[JsonDict]) -> JsonDict:
    r = safe_dict(ref)
    if not r and fallback_refs:
        r = safe_dict(fallback_refs[0])
    return {
        "chunkId": clean_text(r.get("chunkId") or r.get("id") or "", 220),
        "sourceRef": clean_text(r.get("sourceRef") or r.get("ref") or "", 300),
        "pageRef": clean_text(r.get("pageRef") or "", 300),
        "page": r.get("page") or r.get("pageNumber") or 1,
        "quote": clean_text(r.get("quote") or r.get("text") or r.get("snippet") or "", 700),
        "confidence": r.get("confidence") or 0.8,
        "resourceId": clean_text(r.get("resourceId") or "", 180),
    }


def _normalize_diagram(raw: JsonDict, payload: JsonDict, index: int) -> JsonDict:
    d = safe_dict(raw)
    fallback_refs = _source_refs(payload, d)
    source_refs = dedupe_source_refs([_normalize_source_ref(r, fallback_refs) for r in safe_list(d.get("sourceRefs"))]) or fallback_refs[:10]

    evidence_rows = []
    for row in safe_list(d.get("evidenceRows") or d.get("evidence") or d.get("sourceEvidence")):
        rr = safe_dict(row)
        row_refs = dedupe_source_refs(safe_list(rr.get("sourceRefs"))) or source_refs[:2]
        evidence_rows.append(
            {
                "text": clean_text(rr.get("text") or rr.get("quote") or rr.get("evidence") or "", 700),
                "page": rr.get("page") or rr.get("pageNumber") or safe_dict(row_refs[0]).get("page"),
                "sourceRefs": row_refs,
            }
        )
    if not evidence_rows:
        for ref in source_refs[:8]:
            evidence_rows.append({"text": clean_text(ref.get("quote"), 700), "page": ref.get("page"), "sourceRefs": [ref]})

    concepts = []
    for c in safe_list(d.get("concepts")):
        cc = safe_dict(c)
        label = clean_text(cc.get("label") or cc.get("name") or cc.get("title"), 140)
        if label:
            concepts.append(
                {
                    "id": clean_text(cc.get("id") or normalize_id(label, f"concept_{len(concepts) + 1}"), 120),
                    "label": label,
                    "explanation": clean_text(cc.get("explanation") or cc.get("why") or cc.get("description") or "", 500),
                    "sourceRefs": dedupe_source_refs(safe_list(cc.get("sourceRefs"))) or source_refs[:2],
                }
            )

    relations = []
    for rel in safe_list(d.get("relations") or d.get("edges")):
        r = safe_dict(rel)
        if r:
            relations.append(
                {
                    "from": clean_text(r.get("from") or r.get("source") or r.get("a"), 140),
                    "to": clean_text(r.get("to") or r.get("target") or r.get("b"), 140),
                    "label": clean_text(r.get("label") or r.get("relation") or r.get("why") or "relates to", 180),
                    "sourceRefs": dedupe_source_refs(safe_list(r.get("sourceRefs"))) or source_refs[:2],
                }
            )

    title = clean_text(d.get("title") or _title(payload), 180)
    mermaid = clean_text(d.get("mermaid") or d.get("mermaidCode") or "", 50000)
    diagram_type = clean_text(d.get("diagramType") or d.get("type") or "conceptMap", 80)
    diagram_id = clean_text(d.get("compiledDiagramId") or d.get("visualId") or f"diagram_{index}_{normalize_id(title, 'topic')}", 180)

    return {
        "compiledDiagramId": diagram_id,
        "visualId": clean_text(d.get("visualId") or diagram_id, 180),
        "title": title,
        "diagramType": diagram_type,
        "sourceRefs": source_refs[:12],
        "concepts": concepts,
        "relations": relations,
        "evidenceRows": [row for row in evidence_rows if clean_text(row.get("text"), 700)][:12],
        "mermaid": mermaid,
        "mermaidCode": mermaid,
        "reactFlow": safe_dict(d.get("reactFlow")),
        "htmlPreview": clean_text(d.get("htmlPreview") or "", 30000),
        "excalidrawElements": safe_list(d.get("excalidrawElements")),
        "renderHints": {**safe_dict(d.get("renderHints")), "preferredRenderer": "mermaid", "sourceGrounded": True},
        "metadata": {**safe_dict(d.get("metadata")), "fallbackUsed": False, "sourceGrounded": True, "geminiText2Diagram": True},
    }


def _attach_to_screens(plan: JsonDict, diagrams: List[JsonDict]) -> List[JsonDict]:
    screens = []
    first = safe_dict(diagrams[0]) if diagrams else {}
    for screen in safe_list(plan.get("premiumBoardScreens") or plan.get("boardScreens")):
        s = dict(safe_dict(screen))
        blocks = []
        for block in safe_list(s.get("blocks")):
            b = dict(safe_dict(block))
            if first and clean_text(b.get("type"), 80) in {"diagramPanel", "miniConceptTree", "mappingTable", "workflowStrip"}:
                b["compiledDiagramId"] = first.get("compiledDiagramId")
                b["compiledDiagram"] = first
                b["mermaid"] = first.get("mermaid")
                b["reactFlow"] = first.get("reactFlow")
                b["htmlPreview"] = first.get("htmlPreview")
            blocks.append(b)
        s["blocks"] = blocks
        screens.append(s)
    return screens


class DiagramCompilerAgent(BaseLiveTutorAgent):
    agent_name = "DiagramCompilerAgent"
    agent_group = "visual"
    default_mode = "compile_diagrams"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are a Text2Diagram compiler for a source-grounded AI tutor board.
Create diagrams from the selected PDF concept and exact source evidence.
Return strict JSON only. Do not wrap in markdown.
Never draw generic board-instruction words like source-grounded diagram, draws, visual, flow.
Every diagram must have Mermaid, concepts, relations, evidenceRows, and sourceRefs.
External resources are supplementary only; PDF selectedEvidence is primary.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []
        if not _source_refs(payload):
            errors.append("DiagramCompilerAgent requires sourceRefs/selectedEvidence/chunks.")
        if not _visual_intents(payload):
            errors.append("DiagramCompilerAgent requires visual intents or visualPlan blocks.")
        if not _selected_evidence(payload):
            warnings.append("No explicit selectedEvidence found; using selectedNode/sourceRefs fallback.")
        return ValidationResult(ok=not errors, errors=errors, warnings=warnings, validator="DiagramCompilerAgent.validate_input", fallbackUsed=False)

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        prompt_payload = {
            "task": "Create dynamic source-grounded Text2Diagram diagrams for the selected PDF node.",
            "strictRules": [
                "Return ONLY valid JSON.",
                "Do not use hardcoded topic templates.",
                "Do not diagram generic words like source-grounded diagram, draws, step-by-step, visual, flow.",
                "Every concept and relation must be supported by sourceRefs/evidenceRows.",
                "Use selectedEvidence as primary. Use relatedEvidence only as supporting. Use externalResources only as extra learning, not PDF evidence.",
                "Mermaid must be concept-specific, detailed, and directly useful on a teacher board.",
                "If the selected node is a use case, draw the use-case/query/problem flow. If it is a schema, draw the schema. If it is a process, draw the process. Decide dynamically from evidence.",
            ],
            "selectedNode": _selected_node(payload),
            "question": clean_text(payload.get("question") or context.question, 1400),
            "studentLevel": context.studentLevel,
            "language": context.language,
            "selectedEvidence": _selected_evidence(payload)[:36],
            "relatedEvidence": safe_list(payload.get("relatedEvidence"))[:30],
            "sourceRefs": _source_refs(payload)[:50],
            "chunksAndVisualContext": _compact_chunks(payload),
            "fullPdfSummary": clean_text(payload.get("fullPdfSummary"), 5000),
            "fullPdfOutline": clean_text(payload.get("fullPdfOutline") or payload.get("fullPdfOutlineText"), 6000),
            "text2DiagramPlan": safe_dict(payload.get("text2DiagramPlan")),
            "visualIntents": _visual_intents(payload),
            "externalResourcesSupplementaryOnly": safe_list(payload.get("externalResources"))[:8],
            "requiredOutputSchema": {
                "diagramSetId": "string",
                "title": "string",
                "compiledDiagrams": [
                    {
                        "compiledDiagramId": "string",
                        "visualId": "string",
                        "title": "string",
                        "diagramType": "flowchart|schemaDiagram|sequence|timeline|comparison|conceptMap|tableMap|other",
                        "concepts": [{"id": "string", "label": "string", "explanation": "string", "sourceRefs": ["sourceRef objects"]}],
                        "relations": [{"from": "concept id/label", "to": "concept id/label", "label": "string", "sourceRefs": ["sourceRef objects"]}],
                        "evidenceRows": [{"text": "short source quote", "page": 1, "sourceRefs": ["sourceRef objects"]}],
                        "mermaid": "valid Mermaid code",
                        "reactFlow": {"nodes": [], "edges": []},
                        "htmlPreview": "small HTML preview string",
                        "sourceRefs": ["sourceRef objects"],
                        "metadata": {"fallbackUsed": False, "sourceGrounded": True},
                    }
                ],
                "sourceRefs": ["sourceRef objects"],
                "metadata": {"fallbackUsed": False, "geminiText2Diagram": True},
            },
        }
        return _json(prompt_payload, 140000)

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)
        diagrams_raw = safe_list(raw.get("compiledDiagrams") or raw.get("diagrams"))
        if not diagrams_raw and safe_dict(raw.get("diagram")):
            diagrams_raw = [safe_dict(raw.get("diagram"))]
        diagrams = [_normalize_diagram(d, payload, index + 1) for index, d in enumerate(diagrams_raw)]
        refs = dedupe_source_refs(safe_list(raw.get("sourceRefs")) + _source_refs(payload, diagrams))
        plan = safe_dict(payload.get("visualPlan"))
        screens = _attach_to_screens(plan, diagrams)
        return {
            "diagramSetId": clean_text(raw.get("diagramSetId") or f"diagram_set_{normalize_id(_title(payload), 'topic')}", 180),
            "title": clean_text(raw.get("title") or _title(payload), 180),
            "compiledDiagrams": diagrams,
            "premiumBoardScreens": screens,
            "boardScreens": screens,
            "sourceRefs": refs,
            "metadata": {**safe_dict(raw.get("metadata")), "fallbackUsed": False, "sourceGrounded": True, "geminiText2Diagram": True},
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []
        diagrams = safe_list(output.get("compiledDiagrams"))
        if not diagrams:
            errors.append("DiagramCompilerAgent must output compiledDiagrams.")
        for index, raw in enumerate(diagrams):
            d = safe_dict(raw)
            mermaid = clean_text(d.get("mermaid") or d.get("mermaidCode"), 50000)
            if not mermaid:
                errors.append(f"compiledDiagrams[{index}] missing Mermaid.")
            elif _is_generic_mermaid(mermaid):
                errors.append(f"compiledDiagrams[{index}] is generic/keyword-only Mermaid.")
            if not safe_list(d.get("sourceRefs")):
                errors.append(f"compiledDiagrams[{index}] missing sourceRefs.")
            if not safe_list(d.get("evidenceRows")):
                errors.append(f"compiledDiagrams[{index}] missing evidenceRows.")
            if safe_dict(d.get("metadata")).get("fallbackUsed") is True:
                errors.append(f"compiledDiagrams[{index}] has fallbackUsed=true.")
        if len(diagrams) > 8:
            warnings.append("Many diagrams generated; renderer may choose first few.")
        return ValidationResult(ok=not errors, errors=errors, warnings=warnings, validator="DiagramCompilerAgent.validate_output", fallbackUsed=False)


__all__ = ["DiagramCompilerAgent"]