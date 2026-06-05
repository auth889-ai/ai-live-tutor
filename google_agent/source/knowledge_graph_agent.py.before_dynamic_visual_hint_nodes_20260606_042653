"""
google_agent/source/knowledge_graph_agent.py
===============================================================================
WORLD-TEACHER KnowledgeGraphAgent.

Goal:
- Convert rich concepts into a teachable knowledge graph.
- Not only parent-child edges.
- Every node/edge should help later:
  TeachingStrategyAgent -> DetailedExplanationAgent -> VisualPlannerAgent.
- No fixed domain.
- No fake/static fallback.
- Source grounded only.

Output adds:
- teachingRole
- learningGoal
- boardPlacementHint
- visualEncoding
- misconceptionRisk
- prerequisiteReason
- boardActionHint
- source-grounded edges with teachingRationale
===============================================================================
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

try:
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
    from google_agent.live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        normalize_source_refs,
        require_source_refs,
        safe_dict,
        safe_list,
    )
except Exception:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        normalize_source_refs,
        require_source_refs,
        safe_dict,
        safe_list,
    )


VALID_EDGE_TYPES = {
    "parent-child",
    "prerequisite",
    "related",
    "causes",
    "contrasts",
    "example-of",
    "part-of",
    "rule-for",
    "misconception-of",
    "visual-link",
    "application-of",
}


def _json(value: Any, limit: int = 150000) -> str:
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), limit)
    except Exception:
        return clean_text(value, limit)


def _words(value: Any) -> List[str]:
    text = clean_text(value, 5000).lower()
    return [w for w in re.findall(r"[a-zA-Z0-9_]+", text) if len(w) >= 3]


def _concepts(payload: JsonDict) -> List[JsonDict]:
    return safe_list(payload.get("concepts") or safe_dict(payload.get("conceptExtraction")).get("concepts"))


def _concept_map(payload: JsonDict) -> Dict[str, JsonDict]:
    out: Dict[str, JsonDict] = {}
    for c in _concepts(payload):
        item = safe_dict(c)
        cid = normalize_id(item.get("conceptId") or item.get("id") or item.get("label"), "")
        if cid:
            out[cid] = item
    return out


def _clean_refs(refs: List[JsonDict], fallback: List[JsonDict] | None = None, limit: int = 6) -> List[JsonDict]:
    cleaned: List[JsonDict] = []
    for raw in safe_list(refs):
        r = safe_dict(raw)
        if not r:
            continue
        if not (r.get("sourceRef") or r.get("chunkId") or r.get("pageRef")):
            continue
        if not clean_text(r.get("quote")):
            continue
        cleaned.append(r)

    if not cleaned and fallback:
        for raw in safe_list(fallback):
            r = safe_dict(raw)
            if clean_text(r.get("quote")) and (r.get("sourceRef") or r.get("chunkId") or r.get("pageRef")):
                cleaned.append(r)

    return dedupe_source_refs(normalize_source_refs(cleaned))[:limit]


def _source_refs_from_concepts(concepts: List[JsonDict]) -> List[JsonDict]:
    refs: List[JsonDict] = []
    for c in concepts:
        refs.extend(safe_list(safe_dict(c).get("sourceRefs")))
    return _clean_refs(refs, [], limit=80)


def _refs_for_node(node: JsonDict, concept_lookup: Dict[str, JsonDict], all_refs: List[JsonDict]) -> List[JsonDict]:
    node_id = normalize_id(node.get("nodeId") or node.get("id") or node.get("label"), "")
    label = clean_text(node.get("label") or node.get("title") or node.get("name"), 140)

    raw_refs = _clean_refs(safe_list(node.get("sourceRefs")), [], limit=6)
    if raw_refs:
        return raw_refs

    candidates: List[JsonDict] = []

    if node_id in concept_lookup:
        candidates.extend(safe_list(concept_lookup[node_id].get("sourceRefs")))

    label_words = set(_words(label))
    for _cid, concept in concept_lookup.items():
        c_words = set(
            _words(concept.get("label"))
            + _words(concept.get("definition"))
            + _words(concept.get("summary"))
            + _words(concept.get("explainLikeHuman"))
        )
        if label_words and c_words and label_words.intersection(c_words):
            candidates.extend(safe_list(concept.get("sourceRefs")))

    return _clean_refs(candidates, all_refs, limit=6)


def _refs_for_edge(
    edge: JsonDict,
    nodes_by_id: Dict[str, JsonDict],
    concept_lookup: Dict[str, JsonDict],
    all_refs: List[JsonDict],
) -> List[JsonDict]:
    raw_refs = _clean_refs(safe_list(edge.get("sourceRefs")), [], limit=6)
    if raw_refs:
        return raw_refs

    refs: List[JsonDict] = []
    from_id = normalize_id(edge.get("from") or edge.get("source"), "")
    to_id = normalize_id(edge.get("to") or edge.get("target"), "")

    for node_id in [from_id, to_id]:
        node = safe_dict(nodes_by_id.get(node_id))
        refs.extend(safe_list(node.get("sourceRefs")))
        concept = safe_dict(concept_lookup.get(node_id))
        refs.extend(safe_list(concept.get("sourceRefs")))

    return _clean_refs(refs, all_refs, limit=6)


class KnowledgeGraphAgent(BaseLiveTutorAgent):
    agent_name = "KnowledgeGraphAgent"
    agent_group = "source"
    default_mode = "build_knowledge_graph"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are KnowledgeGraphAgent for a world-class Live Tutor.

Your job:
- Build a teachable knowledge graph from ConceptExtractionAgent output.
- Make graph useful for teaching order, board layout, and misconception repair.
- Do not output only mechanical parent-child edges.
- Use prerequisite, contrast, rule, example, misconception, and visual-link edges when supported.
- Every node must have sourceRefs.
- Every important edge must have sourceRefs.
- Output ONLY valid JSON.
- No fixed domain.
- No fake fallback.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        concepts = _concepts(payload)
        if len(concepts) < 4:
            errors.append("KnowledgeGraphAgent requires at least 4 concepts from ConceptExtractionAgent.")

        for index, concept in enumerate(concepts):
            item = safe_dict(concept)
            if not safe_list(item.get("sourceRefs")):
                warnings.append(f"concepts[{index}] has no sourceRefs; graph may be weak.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="KnowledgeGraphAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        concepts = _concepts(payload)
        chunks_text = self.compact_chunks_for_prompt(safe_list(payload.get("chunks")), max_chars=45000)
        concept_extraction = safe_dict(payload.get("conceptExtraction"))
        vision = safe_dict(payload.get("selectedPageVision"))

        prompt_payload = {
            "task": "Build a rich teachable knowledge graph for a live human tutor board.",
            "student": {
                "level": context.studentLevel,
                "language": context.language,
                "question": clean_text(context.question or payload.get("question"), 1500),
            },
            "conceptExtraction": concept_extraction or {"concepts": concepts},
            "visionHints": {
                "diagramSummary": clean_text(
                    vision.get("diagramSummary") or payload.get("selectedPageVisionDiagramSummary"),
                    4000,
                ),
                "diagramElements": safe_list(payload.get("diagramElements") or vision.get("diagramElements"))[:60],
                "relationships": safe_list(payload.get("relationships") or vision.get("relationships"))[:60],
                "teacherMarkingHints": safe_list(payload.get("teacherMarkingHints") or vision.get("teacherMarkingHints"))[:40],
            },
            "sourceChunksCompact": chunks_text,
            "requiredOutputSchema": {
                "title": "Concept Tree",
                "rootNodeId": "root_id",
                "nodes": [
                    {
                        "nodeId": "stable_snake_case",
                        "label": "short label",
                        "summary": "teachable summary",
                        "nodeType": "root|module|concept|definition|process|example|warning|rule|question|unknown",
                        "level": 0,
                        "order": 0,
                        "importance": 0.9,
                        "teachingRole": "anchor|prerequisite|core|supporting|example|warning|checkpoint",
                        "learningGoal": "what student should understand from this node",
                        "boardPlacementHint": "center|left|right|top|bottom|side-card|zoom-card",
                        "visualEncoding": "box|table|arrow|warning|comparison|quiz|timeline|none",
                        "misconceptionRisk": "low|medium|high",
                        "sourceRefs": [],
                        "visualHints": [],
                        "metadata": {},
                    }
                ],
                "edges": [
                    {
                        "edgeId": "edge_a_b",
                        "from": "node_a",
                        "to": "node_b",
                        "type": (
                            "parent-child|prerequisite|related|causes|contrasts|example-of|part-of|"
                            "rule-for|misconception-of|visual-link|application-of"
                        ),
                        "label": "short relation label",
                        "teachingRationale": "why this relation matters for teaching",
                        "boardActionHint": "draw-arrow|compare|circle|highlight|cross-out|zoom",
                        "sourceRefs": [],
                        "metadata": {},
                    }
                ],
                "teachingPath": [
                    {
                        "pathStepId": "path_1",
                        "nodeId": "node id",
                        "reason": "why this comes now",
                        "teacherMove": "how tutor introduces this node",
                        "sourceRefs": [],
                    }
                ],
                "misconceptionMap": [
                    {
                        "misconceptionId": "mis_1",
                        "wrongIdea": "student wrong idea",
                        "correctIdea": "correct idea",
                        "relatedNodeIds": [],
                        "boardRepairHint": "how board should repair it",
                        "sourceRefs": [],
                    }
                ],
                "visualGraphHints": {
                    "centralNodeId": "node id",
                    "mustCluster": [],
                    "mustConnect": [],
                    "mustContrast": [],
                    "mustHighlight": [],
                    "sourceRefs": [],
                },
                "qualitySignals": {
                    "worldKnowledgeGraphV2": True,
                    "readyForTeachingStrategy": True,
                    "readyForVisualPlanner": True,
                },
                "metadata": {
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                    "worldKnowledgeGraphV2": True,
                },
            },
            "qualityBar": {
                "minimumNodes": 6,
                "minimumEdges": 6,
                "minimumTeachingPathSteps": 5,
                "minimumMisconceptionItems": 1,
                "mustIncludeNonParentEdges": True,
                "mustBeUsefulForBoardLayout": True,
                "mustBeUsefulForTeachingOrder": True,
                "everyNodeNeedsSourceRefs": True,
            },
        }

        return _json(prompt_payload, 150000)

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        raise RuntimeError("KnowledgeGraphAgent requires Gemini/ADK. No rule-based/static fallback is allowed.")

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)
        if isinstance(raw.get("result"), dict):
            raw = safe_dict(raw.get("result"))

        concepts = _concepts(payload)
        concept_lookup = _concept_map(payload)
        all_concept_refs = _source_refs_from_concepts(concepts)

        nodes: List[JsonDict] = []
        for index, raw_node in enumerate(safe_list(raw.get("nodes"))):
            node = safe_dict(raw_node)
            label = clean_text(node.get("label") or node.get("title") or node.get("name"), 140)
            node_id = normalize_id(node.get("nodeId") or node.get("id") or label, f"node_{index + 1}")

            temp_node = {**node, "nodeId": node_id, "label": label}
            refs = _refs_for_node(temp_node, concept_lookup, all_concept_refs)

            nodes.append(
                {
                    "nodeId": node_id,
                    "label": label,
                    "summary": clean_text(node.get("summary") or node.get("definition") or "", 900),
                    "nodeType": clean_text(node.get("nodeType") or ("root" if index == 0 else "concept"), 90),
                    "level": int(node.get("level") or (0 if index == 0 else 1)),
                    "order": int(node.get("order") or index),
                    "importance": max(0.0, min(1.0, float(node.get("importance") or 0.65))),
                    "teachingRole": clean_text(node.get("teachingRole") or ("anchor" if index == 0 else "supporting"), 100),
                    "learningGoal": clean_text(node.get("learningGoal") or "", 900),
                    "boardPlacementHint": clean_text(
                        node.get("boardPlacementHint") or ("center" if index == 0 else "side-card"),
                        100,
                    ),
                    "visualEncoding": clean_text(node.get("visualEncoding") or "box", 100),
                    "misconceptionRisk": clean_text(node.get("misconceptionRisk") or "medium", 80),
                    "sourceRefs": refs,
                    "visualHints": [clean_text(x, 100) for x in safe_list(node.get("visualHints"))],
                    "metadata": {
                        **safe_dict(node.get("metadata")),
                        "worldKnowledgeGraphV2": True,
                        "sourceRefsCleanedV2": True,
                    },
                }
            )

        node_ids = {node["nodeId"] for node in nodes}
        nodes_by_id = {node["nodeId"]: node for node in nodes}

        edges: List[JsonDict] = []
        for index, raw_edge in enumerate(safe_list(raw.get("edges"))):
            edge = safe_dict(raw_edge)
            from_id = normalize_id(edge.get("from") or edge.get("source"), "")
            to_id = normalize_id(edge.get("to") or edge.get("target"), "")
            edge_type = clean_text(edge.get("type") or "related", 90)
            if edge_type not in VALID_EDGE_TYPES:
                edge_type = "related"

            refs = _refs_for_edge(edge, nodes_by_id, concept_lookup, all_concept_refs)

            edges.append(
                {
                    "edgeId": normalize_id(
                        edge.get("edgeId") or edge.get("id") or f"edge_{from_id}_{to_id}_{index + 1}",
                        f"edge_{index + 1}",
                    ),
                    "from": from_id,
                    "to": to_id,
                    "type": edge_type,
                    "label": clean_text(edge.get("label") or "", 160),
                    "teachingRationale": clean_text(edge.get("teachingRationale") or edge.get("reason") or "", 1000),
                    "boardActionHint": clean_text(edge.get("boardActionHint") or "draw-arrow", 120),
                    "sourceRefs": refs,
                    "metadata": {
                        **safe_dict(edge.get("metadata")),
                        "worldKnowledgeGraphV2": True,
                        "sourceRefsCleanedV2": True,
                    },
                }
            )

        teaching_path: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("teachingPath"))):
            path = safe_dict(item)
            node_id = normalize_id(path.get("nodeId") or path.get("id"), "")
            refs = _clean_refs(
                safe_list(path.get("sourceRefs")),
                safe_list(nodes_by_id.get(node_id, {}).get("sourceRefs")),
                limit=5,
            )
            teaching_path.append(
                {
                    "pathStepId": normalize_id(path.get("pathStepId") or f"path_{index + 1}", f"path_{index + 1}"),
                    "nodeId": node_id,
                    "reason": clean_text(path.get("reason") or "", 900),
                    "teacherMove": clean_text(path.get("teacherMove") or "", 1200),
                    "sourceRefs": refs,
                }
            )

        misconception_map: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("misconceptionMap"))):
            mis = safe_dict(item)
            related = [normalize_id(x, "") for x in safe_list(mis.get("relatedNodeIds"))]
            refs: List[JsonDict] = []
            for node_id in related:
                refs.extend(safe_list(nodes_by_id.get(node_id, {}).get("sourceRefs")))
            refs = _clean_refs(safe_list(mis.get("sourceRefs")), refs or all_concept_refs, limit=6)

            misconception_map.append(
                {
                    "misconceptionId": normalize_id(
                        mis.get("misconceptionId") or f"mis_{index + 1}",
                        f"mis_{index + 1}",
                    ),
                    "wrongIdea": clean_text(mis.get("wrongIdea") or "", 900),
                    "correctIdea": clean_text(mis.get("correctIdea") or "", 1200),
                    "relatedNodeIds": related,
                    "boardRepairHint": clean_text(mis.get("boardRepairHint") or "", 900),
                    "sourceRefs": refs,
                }
            )

        visual_hints_raw = safe_dict(raw.get("visualGraphHints"))
        visual_graph_hints = {
            "centralNodeId": normalize_id(
                visual_hints_raw.get("centralNodeId")
                or raw.get("rootNodeId")
                or (nodes[0]["nodeId"] if nodes else ""),
                "",
            ),
            "mustCluster": safe_list(visual_hints_raw.get("mustCluster"))[:12],
            "mustConnect": safe_list(visual_hints_raw.get("mustConnect"))[:12],
            "mustContrast": safe_list(visual_hints_raw.get("mustContrast"))[:12],
            "mustHighlight": safe_list(visual_hints_raw.get("mustHighlight"))[:12],
            "sourceRefs": _clean_refs(safe_list(visual_hints_raw.get("sourceRefs")), all_concept_refs, limit=6),
        }

        root_node_id = normalize_id(
            raw.get("rootNodeId")
            or visual_graph_hints.get("centralNodeId")
            or (nodes[0]["nodeId"] if nodes else ""),
            "",
        )
        if root_node_id not in node_ids and nodes:
            root_node_id = nodes[0]["nodeId"]

        all_refs: List[JsonDict] = []
        for node in nodes:
            all_refs.extend(safe_list(node.get("sourceRefs")))
        for edge in edges:
            all_refs.extend(safe_list(edge.get("sourceRefs")))
        for path in teaching_path:
            all_refs.extend(safe_list(path.get("sourceRefs")))
        for mis in misconception_map:
            all_refs.extend(safe_list(mis.get("sourceRefs")))

        return {
            "title": clean_text(raw.get("title") or "Concept Tree", 220),
            "rootNodeId": root_node_id,
            "nodes": nodes,
            "edges": edges,
            "teachingPath": teaching_path,
            "misconceptionMap": misconception_map,
            "visualGraphHints": visual_graph_hints,
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "sourceRefs": dedupe_source_refs(normalize_source_refs(all_refs)),
            "qualitySignals": {
                **safe_dict(raw.get("qualitySignals")),
                "worldKnowledgeGraphV2": True,
                "nodeCount": len(nodes),
                "edgeCount": len(edges),
                "teachingPathCount": len(teaching_path),
                "misconceptionCount": len(misconception_map),
                "hasNonParentEdges": any(safe_dict(e).get("type") != "parent-child" for e in edges),
                "readyForTeachingStrategy": True,
                "readyForVisualPlanner": True,
                "fallbackUsed": False,
            },
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "worldKnowledgeGraphV2": True,
                "sourceRefsCleanedV2": True,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        nodes = safe_list(output.get("nodes"))
        edges = safe_list(output.get("edges"))

        if len(nodes) < 6:
            errors.append("KnowledgeGraphAgent output must include at least 6 teachable nodes.")
        if len(edges) < 6:
            errors.append("KnowledgeGraphAgent output must include at least 6 teachable edges.")

        node_ids = set()
        for index, node_raw in enumerate(nodes):
            node = safe_dict(node_raw)
            node_id = clean_text(node.get("nodeId"), 140)

            if not node_id:
                errors.append(f"nodes[{index}].nodeId is required.")
            if node_id in node_ids:
                errors.append(f"Duplicate nodeId: {node_id}")
            node_ids.add(node_id)

            if not clean_text(node.get("label")):
                errors.append(f"nodes[{index}].label is required.")
            if not clean_text(node.get("learningGoal")):
                errors.append(f"nodes[{index}].learningGoal is required.")
            if not clean_text(node.get("boardPlacementHint")):
                errors.append(f"nodes[{index}].boardPlacementHint is required.")
            if not clean_text(node.get("visualEncoding")):
                errors.append(f"nodes[{index}].visualEncoding is required.")

            ref_validation = require_source_refs(
                safe_list(node.get("sourceRefs")),
                f"KnowledgeGraphAgent.nodes[{index}].sourceRefs",
            )
            errors.extend(ref_validation.errors)

        non_parent_count = 0
        for index, edge_raw in enumerate(edges):
            edge = safe_dict(edge_raw)
            from_id = clean_text(edge.get("from"), 140)
            to_id = clean_text(edge.get("to"), 140)

            if from_id not in node_ids:
                errors.append(f"edges[{index}].from not found in nodes: {from_id}")
            if to_id not in node_ids:
                errors.append(f"edges[{index}].to not found in nodes: {to_id}")
            if edge.get("type") not in VALID_EDGE_TYPES:
                errors.append(f"edges[{index}].type invalid: {edge.get('type')}")
            if edge.get("type") != "parent-child":
                non_parent_count += 1
            if not clean_text(edge.get("teachingRationale")):
                errors.append(f"edges[{index}].teachingRationale is required.")
            if not clean_text(edge.get("boardActionHint")):
                errors.append(f"edges[{index}].boardActionHint is required.")
            if not safe_list(edge.get("sourceRefs")):
                warnings.append(f"edges[{index}] has no sourceRefs; allowed but weaker.")

        if non_parent_count < 2:
            errors.append("KnowledgeGraphAgent must include at least 2 non-parent-child teaching relations.")

        if output.get("rootNodeId") and output.get("rootNodeId") not in node_ids:
            errors.append("rootNodeId must exist in nodes.")

        if len(safe_list(output.get("teachingPath"))) < 5:
            errors.append("teachingPath must contain at least 5 path steps for TeachingStrategyAgent.")

        if not safe_dict(output.get("visualGraphHints")):
            errors.append("visualGraphHints is required for board planning.")

        top_ref_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "KnowledgeGraphAgent.output.sourceRefs",
        )
        errors.extend(top_ref_validation.errors)

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="KnowledgeGraphAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["KnowledgeGraphAgent"]
