"""
google_agent/live_tutor_agents/source/knowledge_graph_agent.py
===============================================================================
Knowledge Graph Agent.

Separate strong agent responsibility:
- Convert extracted concepts into a concept tree / knowledge graph.
- Produce parent-child, prerequisite, related, causes, contrasts, example-of edges.
- Every node must have sourceRefs.
- Every edge should have sourceRefs when possible.
- Output feeds React Flow concept tree and board click explanation.
===============================================================================
"""

from __future__ import annotations

from typing import List

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
    AgentContext,
    JsonDict,
    ValidationResult,
    clean_text,
    dedupe_source_refs,
    normalize_id,
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
}


class KnowledgeGraphAgent(BaseLiveTutorAgent):
    agent_name = "KnowledgeGraphAgent"
    agent_group = "source"
    default_mode = "build_knowledge_graph"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the Knowledge Graph Agent for the human-like Live Tutor.

Your job:
- Build a source-grounded concept tree/knowledge graph from extracted concepts.
- Make the structure teachable: easy -> medium -> advanced.
- Use parent-child edges for tree structure and relation edges for dependencies.
- Every node MUST have sourceRefs.
- Do not invent nodes not supported by concepts/source chunks.
- Output ONLY JSON.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        concepts = safe_list(payload.get("concepts") or safe_dict(payload.get("conceptExtraction")).get("concepts"))

        if not concepts:
            errors.append("KnowledgeGraphAgent requires concepts from ConceptExtractionAgent.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="KnowledgeGraphAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        concepts = safe_list(payload.get("concepts") or safe_dict(payload.get("conceptExtraction")).get("concepts"))
        chunks_text = self.compact_chunks_for_prompt(safe_list(payload.get("chunks")), max_chars=50000)

        return f"""
Build a source-grounded knowledge graph / concept tree for the Live Tutor board.

Student level: {context.studentLevel}
Language: {context.language}

Return JSON exactly:
{{
  "title": "Concept Tree",
  "rootNodeId": "root_id",
  "nodes": [
    {{
      "nodeId": "stable_snake_case",
      "label": "short label",
      "summary": "teachable summary",
      "nodeType": "root|module|concept|definition|process|example|warning|question|unknown",
      "level": 0,
      "order": 0,
      "importance": 0.8,
      "sourceRefs": [],
      "visualHints": ["tree", "flowchart"],
      "metadata": {{}}
    }}
  ],
  "edges": [
    {{
      "edgeId": "edge_a_b",
      "from": "node_a",
      "to": "node_b",
      "type": "parent-child|prerequisite|related|causes|contrasts|example-of",
      "label": "",
      "sourceRefs": [],
      "metadata": {{}}
    }}
  ],
  "metadata": {{
    "fallbackUsed": false
  }}
}}

Extracted concepts:
{concepts}

Source chunks for proof:
{chunks_text}
"""

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        nodes: List[JsonDict] = []
        edges: List[JsonDict] = []

        for index, raw_node in enumerate(safe_list(raw.get("nodes"))):
            node = safe_dict(raw_node)
            label = clean_text(node.get("label") or node.get("title") or node.get("name"), 120)
            node_id = normalize_id(node.get("nodeId") or node.get("id") or label, f"node_{index + 1}")

            nodes.append(
                {
                    "nodeId": node_id,
                    "label": label,
                    "summary": clean_text(node.get("summary") or node.get("definition") or "", 700),
                    "nodeType": clean_text(node.get("nodeType") or ("root" if index == 0 else "concept"), 80),
                    "level": int(node.get("level") or (0 if index == 0 else 1)),
                    "order": int(node.get("order") or index),
                    "importance": max(0.0, min(1.0, float(node.get("importance") or 0.5))),
                    "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(node.get("sourceRefs"))]),
                    "visualHints": [clean_text(x, 80) for x in safe_list(node.get("visualHints"))],
                    "metadata": safe_dict(node.get("metadata")),
                }
            )

        node_ids = {node["nodeId"] for node in nodes}

        for index, raw_edge in enumerate(safe_list(raw.get("edges"))):
            edge = safe_dict(raw_edge)
            from_id = normalize_id(edge.get("from") or edge.get("source"), "")
            to_id = normalize_id(edge.get("to") or edge.get("target"), "")
            edge_type = clean_text(edge.get("type") or "related", 80)
            if edge_type not in VALID_EDGE_TYPES:
                edge_type = "related"

            edges.append(
                {
                    "edgeId": clean_text(edge.get("edgeId") or edge.get("id") or f"edge_{from_id}_{to_id}_{index + 1}", 160),
                    "from": from_id,
                    "to": to_id,
                    "type": edge_type,
                    "label": clean_text(edge.get("label") or "", 120),
                    "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(edge.get("sourceRefs"))]),
                    "metadata": safe_dict(edge.get("metadata")),
                }
            )

        root_node_id = normalize_id(raw.get("rootNodeId") or (nodes[0]["nodeId"] if nodes else ""), "")
        if root_node_id not in node_ids and nodes:
            root_node_id = nodes[0]["nodeId"]

        all_refs: List[JsonDict] = []
        for node in nodes:
            all_refs.extend(safe_list(node.get("sourceRefs")))
        for edge in edges:
            all_refs.extend(safe_list(edge.get("sourceRefs")))

        return {
            "title": clean_text(raw.get("title") or "Concept Tree", 180),
            "rootNodeId": root_node_id,
            "nodes": nodes,
            "edges": edges,
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "sourceRefs": dedupe_source_refs(all_refs),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        nodes = safe_list(output.get("nodes"))
        edges = safe_list(output.get("edges"))

        if not nodes:
            errors.append("KnowledgeGraphAgent output must include nodes.")
        if len(nodes) > 1 and not edges:
            errors.append("KnowledgeGraphAgent output with multiple nodes must include edges.")

        node_ids = set()
        for index, node_raw in enumerate(nodes):
            node = safe_dict(node_raw)
            node_id = clean_text(node.get("nodeId"), 120)

            if not node_id:
                errors.append(f"nodes[{index}].nodeId is required.")
            if node_id in node_ids:
                errors.append(f"Duplicate nodeId: {node_id}")
            node_ids.add(node_id)

            if not clean_text(node.get("label")):
                errors.append(f"nodes[{index}].label is required.")

            ref_validation = require_source_refs(
                safe_list(node.get("sourceRefs")),
                f"KnowledgeGraphAgent.nodes[{index}].sourceRefs",
            )
            errors.extend(ref_validation.errors)

        for index, edge_raw in enumerate(edges):
            edge = safe_dict(edge_raw)
            from_id = clean_text(edge.get("from"), 120)
            to_id = clean_text(edge.get("to"), 120)

            if from_id not in node_ids:
                errors.append(f"edges[{index}].from not found in nodes: {from_id}")
            if to_id not in node_ids:
                errors.append(f"edges[{index}].to not found in nodes: {to_id}")
            if edge.get("type") not in VALID_EDGE_TYPES:
                errors.append(f"edges[{index}].type invalid: {edge.get('type')}")
            if not safe_list(edge.get("sourceRefs")):
                warnings.append(f"edges[{index}] has no sourceRefs; allowed but weaker.")

        if output.get("rootNodeId") and output.get("rootNodeId") not in node_ids:
            errors.append("rootNodeId must exist in nodes.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="KnowledgeGraphAgent.validate_output",
            fallbackUsed=False,
        )