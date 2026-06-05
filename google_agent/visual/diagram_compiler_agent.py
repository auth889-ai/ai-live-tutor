"""
google_agent/visual/diagram_compiler_agent.py
===============================================================================
FULL REPLACEMENT FOR VERSION 5

Text2Diagram-powered source-grounded DiagramCompilerAgent.

Uses Text2Diagram.zip ideas:
- source/evidence -> diagram intent -> Mermaid
- renderable Mermaid code
- HTML preview/code-block style debugging
- no keyword-only diagrams

This agent is conditional:
- schema/database concept -> schema diagram
- process/steps -> flowchart
- comparison -> table/flow visual
- timeline -> timeline
- interaction -> sequence diagram
- simple definition -> concept/evidence visual only if VisualPlanner requested it

No fake fallback. If it cannot create a source-grounded diagram, it fails loudly.
===============================================================================
"""

from __future__ import annotations

from typing import List

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
    from .text2diagram_style import (
        build_mermaid,
        collect_source_refs,
        evidence_rows,
        excalidraw_elements,
        get_grounded_refs,
        html_preview,
        is_keyword_only,
        normalize_diagram_type,
        react_flow,
        source_concepts,
        text2diagram_prompt,
        title_from_payload,
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
    from google_agent.visual.text2diagram_style import (
        build_mermaid,
        collect_source_refs,
        evidence_rows,
        excalidraw_elements,
        get_grounded_refs,
        html_preview,
        is_keyword_only,
        normalize_diagram_type,
        react_flow,
        source_concepts,
        text2diagram_prompt,
        title_from_payload,
    )


def _screen_blocks(plan: JsonDict) -> List[JsonDict]:
    blocks: List[JsonDict] = []

    for screen in safe_list(plan.get("premiumBoardScreens") or plan.get("boardScreens")):
        s = safe_dict(screen)
        for block in safe_list(s.get("blocks")):
            b = safe_dict(block)
            if b:
                blocks.append(b)

    return blocks


def _visuals(payload: JsonDict) -> List[JsonDict]:
    plan = safe_dict(payload.get("visualPlan"))
    visuals = [safe_dict(v) for v in safe_list(payload.get("visuals") or plan.get("visuals")) if safe_dict(v)]

    if visuals:
        return visuals

    out: List[JsonDict] = []
    for block in _screen_blocks(plan):
        btype = clean_text(block.get("type"), 80)

        if btype in {"diagramPanel", "miniConceptTree", "mappingTable", "workflowStrip", "sourceEvidenceCard", "sourcePagePreview"}:
            body = block.get("body")
            body_dict = safe_dict(body)

            out.append({
                "visualId": clean_text(block.get("blockId") or f"visual_{len(out) + 1}", 160),
                "title": clean_text(block.get("title") or title_from_payload(payload), 180),
                "diagramType": clean_text(block.get("diagramType") or body_dict.get("diagramType") or btype, 80),
                "body": body,
                "sourceRefs": safe_list(block.get("sourceRefs")),
                "concepts": safe_list(body_dict.get("concepts")) if isinstance(body, dict) else [],
                "evidenceRows": safe_list(body_dict.get("evidenceRows") or body_dict.get("rows")) if isinstance(body, dict) else [],
                "text2Diagram": True,
            })

    return out


def _compile_visual(visual: JsonDict, payload: JsonDict, index: int) -> JsonDict:
    visual = safe_dict(visual)
    title = clean_text(visual.get("title") or title_from_payload(payload, visual), 180)
    refs = dedupe_source_refs(safe_list(visual.get("sourceRefs")) + get_grounded_refs(payload) + collect_source_refs(visual))

    if not refs:
        raise ValueError(f"Diagram rejected because it has no sourceRefs: {title}")

    rows = evidence_rows(payload, visual, limit=12)
    if not rows:
        raise ValueError(f"Diagram rejected because it has no evidenceRows: {title}")

    concepts = source_concepts(payload, visual, limit=12)
    if is_keyword_only(concepts, title):
        raise ValueError(f"Diagram rejected because it is keyword-only for title '{title}'.")

    kind = normalize_diagram_type(
        visual.get("diagramType") or visual.get("type"),
        clean_text({"visual": visual, "payload": payload}, 70000),
    )

    mermaid = build_mermaid(kind, title, concepts, rows)
    rf = react_flow(kind, title, concepts)
    html = html_preview(kind, title, concepts, rows)
    elements = excalidraw_elements(concepts)
    prompt = text2diagram_prompt(title, kind, concepts, rows)
    cid = clean_text(visual.get("visualId") or f"diagram_{index}_{normalize_id(title, 'topic')}", 180)

    return {
        "compiledDiagramId": cid,
        "visualId": visual.get("visualId") or cid,
        "title": title,
        "diagramType": kind,
        "sourceRefs": refs[:12],
        "concepts": concepts,
        "evidenceRows": rows,
        "mermaid": mermaid,
        "mermaidCode": mermaid,
        "reactFlow": rf,
        "htmlPreview": html,
        "excalidrawElements": elements,
        "text2DiagramPrompt": prompt,
        "renderHints": {
            "preferredRenderer": "mermaid",
            "fallbackRenderer": "reactFlow",
            "showSourceBadges": True,
            "showCopyCode": True,
            "sourceGrounded": True,
        },
        "metadata": {
            "fallbackUsed": False,
            "sourceGrounded": True,
            "text2DiagramStyle": True,
            "text2DiagramZipIdeaUsed": True,
            "keywordOnlyRejected": False,
            "conceptCount": len(concepts),
            "evidenceRowCount": len(rows),
            "sourceRefCount": len(refs),
        },
    }


def _attach_to_screens(plan: JsonDict, compiled: List[JsonDict]) -> List[JsonDict]:
    screens: List[JsonDict] = []
    diagrams = list(compiled)
    first = diagrams[0] if diagrams else {}

    for screen in safe_list(plan.get("premiumBoardScreens") or plan.get("boardScreens")):
        s = dict(safe_dict(screen))
        blocks: List[JsonDict] = []

        for block in safe_list(s.get("blocks")):
            b = dict(safe_dict(block))
            btype = clean_text(b.get("type"), 80)

            if btype in {"diagramPanel", "miniConceptTree", "mappingTable", "workflowStrip", "sourceEvidenceCard"} and first:
                b["compiledDiagramId"] = first.get("compiledDiagramId")
                b["compiledDiagram"] = first
                b["mermaid"] = first.get("mermaid")
                b["htmlPreview"] = first.get("htmlPreview")
                b["reactFlow"] = first.get("reactFlow")

            blocks.append(b)

        s["blocks"] = blocks
        screens.append(s)

    return screens


class DiagramCompilerAgent(BaseLiveTutorAgent):
    agent_name = "DiagramCompilerAgent"
    agent_group = "visual"
    default_mode = "compile_diagrams"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return "Compile Text2Diagram-style source-grounded Mermaid/ReactFlow/HTML diagrams. Reject keyword-only diagrams."

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        if not get_grounded_refs(payload):
            errors.append("DiagramCompilerAgent requires sourceRefs or source-grounded chunks.")

        if not safe_dict(payload.get("visualPlan")) and not safe_list(payload.get("visuals")):
            errors.append("DiagramCompilerAgent requires visualPlan or visuals.")

        if not safe_list(payload.get("chunks") or payload.get("retrievedChunks")):
            warnings.append("No chunks supplied; compiler will rely on sourceRefs/evidenceRows only.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="DiagramCompilerAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        visuals = _visuals(payload)

        if not visuals:
            raise RuntimeError("DiagramCompilerAgent received no visual intents.")

        compiled: List[JsonDict] = []
        rejected: List[str] = []

        for index, visual in enumerate(visuals, start=1):
            try:
                compiled.append(_compile_visual(visual, payload, index))
            except Exception as exc:
                rejected.append(str(exc))

        if not compiled:
            raise RuntimeError("No source-grounded diagrams compiled. " + "; ".join(rejected[:5]))

        plan = safe_dict(payload.get("visualPlan"))
        screens = _attach_to_screens(plan, compiled)
        refs = get_grounded_refs(payload)

        return {
            "diagramSetId": payload.get("diagramSetId") or f"diagram_set_{normalize_id(title_from_payload(payload), 'topic')}",
            "title": title_from_payload(payload),
            "compiledDiagrams": compiled,
            "premiumBoardScreens": screens,
            "boardScreens": screens,
            "sourceRefs": refs,
            "errorsRejected": rejected,
            "metadata": {
                "fallbackUsed": False,
                "sourceGrounded": True,
                "text2DiagramStyle": True,
                "text2DiagramZipIdeaUsed": True,
                "compiledDiagramCount": len(compiled),
                "rejectedWeakDiagramCount": len(rejected),
                "rejectKeywordOnlyDiagram": True,
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return safe_dict(raw)

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []
        diagrams = safe_list(output.get("compiledDiagrams"))

        if not diagrams:
            errors.append("DiagramCompilerAgent must output compiledDiagrams.")

        for i, diagram in enumerate(diagrams):
            d = safe_dict(diagram)

            if not clean_text(d.get("mermaid") or d.get("mermaidCode")):
                errors.append(f"compiledDiagrams[{i}] missing Mermaid code.")

            if not safe_list(d.get("sourceRefs")):
                errors.append(f"compiledDiagrams[{i}] missing sourceRefs.")

            if not safe_list(d.get("evidenceRows")):
                errors.append(f"compiledDiagrams[{i}] missing evidenceRows.")

            if is_keyword_only(safe_list(d.get("concepts")), d.get("title") or title_from_payload(payload)):
                errors.append(f"compiledDiagrams[{i}] is keyword-only.")

            if safe_dict(d.get("metadata")).get("fallbackUsed") is True:
                errors.append(f"compiledDiagrams[{i}] uses fallback; not allowed.")

        if safe_list(output.get("errorsRejected")):
            warnings.append("Weak visual intents rejected: " + "; ".join(safe_list(output.get("errorsRejected"))[:2]))

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="DiagramCompilerAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["DiagramCompilerAgent"]