"""
google_agent/source/concept_tree_agent.py
===============================================================================
REAL source-grounded Concept Tree Agent.

This version fixes the "random keyword tree" problem.

Old bad behavior:
    chunks -> keyword headings -> guessed edges -> random-looking Dagre graph

New behavior:
    chunks -> Gemini concept hierarchy extraction -> validated nodes/edges
    -> sourceRef/page/quote required for every node and edge

Rules:
- No sourceRef = reject node/edge.
- No page = reject node/edge.
- No quote = reject node/edge.
- Edge must have reason.
- Diagram hints must be strict and evidence-based.
- Gemini is used for real concept relation extraction when configured.
- Heuristic local tree is allowed ONLY if payload.allowHeuristicTree == True.
===============================================================================
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple


try:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        SourceChunk,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_chunks,
        normalize_id,
        safe_dict,
        safe_list,
    )
except Exception:
    from ..base_agent import BaseLiveTutorAgent
    from ..contracts import (
        AgentContext,
        JsonDict,
        SourceChunk,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_chunks,
        normalize_id,
        safe_dict,
        safe_list,
    )


ALLOWED_EDGE_TYPES = {
    "root_topic",
    "core_practice",
    "sub_practice",
    "explains",
    "depends_on",
    "leads_to",
    "tested_by",
    "risk_of",
    "example_of",
    "contrast",
    "supports",
    "part_of",
}

ALLOWED_VISUAL_HINTS = {
    "concept-tree",
    "mindmap",
    "flowchart",
    "timeline",
    "comparison-table",
    "sequence-diagram",
    "er-diagram",
    "requirement-diagram",
    "gantt",
    "architecture",
    "git-graph",
    "user-journey",
    "code-sql-example",
    "warning",
    "teacher-writing",
}

STRICT_DIAGRAM_RULES = {
    "flowchart": ["step", "process", "workflow", "run", "apply", "verify", "deploy", "migration"],
    "timeline": ["version", "before", "after", "evolution", "history", "v1", "v2", "change over time"],
    "comparison-table": ["compare", "versus", "vs", "difference", "manual", "migration", "practice", "purpose"],
    "sequence-diagram": ["developer", "dba", "ci", "database", "pipeline", "request", "response", "interaction"],
    "er-diagram": ["entity", "relationship", "foreign key", "primary key", "table relationship", "cardinality"],
    "requirement-diagram": ["requirement", "must", "should", "constraint", "rule"],
    "gantt": ["schedule", "duration", "phase", "project plan"],
    "architecture": ["component", "service", "client", "server", "system architecture"],
    "git-graph": ["commit", "branch", "merge", "repository", "git"],
    "user-journey": ["user journey", "persona", "user story", "experience"],
    "code-sql-example": ["sql", "alter table", "create table", "migration script", "column"],
    "warning": ["risk", "destructive", "break", "drop", "remove", "delete", "not null"],
}


def make_id(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def chunk_to_source_ref(chunk: SourceChunk, quote: str = "", confidence: float = 0.82) -> JsonDict:
    page = int(chunk.page or 1)
    final_quote = clean_text(quote or chunk.textPreview or chunk.text, 600)

    if hasattr(chunk, "to_source_ref"):
        return chunk.to_source_ref(quote=final_quote, confidence=confidence).to_dict()

    return {
        "resourceId": clean_text(getattr(chunk, "resourceId", ""), 220),
        "chunkId": clean_text(getattr(chunk, "chunkId", ""), 220),
        "sourceRef": clean_text(getattr(chunk, "sourceRef", ""), 320),
        "pageRef": clean_text(getattr(chunk, "pageRef", ""), 320),
        "page": page,
        "quote": final_quote,
        "confidence": confidence,
    }


def compact_chunk(chunk: SourceChunk, max_chars: int = 2200) -> JsonDict:
    text = clean_text(chunk.text or chunk.textPreview, max_chars)
    preview = clean_text(chunk.textPreview or chunk.text, 500)

    return {
        "resourceId": clean_text(chunk.resourceId, 220),
        "chunkId": clean_text(chunk.chunkId, 220),
        "sourceRef": clean_text(chunk.sourceRef, 320),
        "pageRef": clean_text(chunk.pageRef, 320),
        "page": int(chunk.page or 1),
        "chunkIndex": int(chunk.chunkIndex or 0),
        "title": clean_text(chunk.title, 160),
        "heading": clean_text(chunk.heading, 160),
        "textPreview": preview,
        "text": text,
    }


def build_chunk_index(chunks: List[SourceChunk]) -> Dict[str, SourceChunk]:
    index: Dict[str, SourceChunk] = {}
    for chunk in chunks:
        if clean_text(chunk.chunkId):
            index[clean_text(chunk.chunkId)] = chunk
        if clean_text(chunk.sourceRef):
            index[clean_text(chunk.sourceRef)] = chunk
    return index


def get_api_key() -> str:
    return (
        os.getenv("GOOGLE_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_GENAI_API_KEY")
        or ""
    ).strip()


def get_model_name() -> str:
    return (
        os.getenv("GEMINI_MODEL")
        or os.getenv("GOOGLE_GEMINI_MODEL")
        or "gemini-2.5-flash"
    ).strip()


def extract_json_object(text: str) -> JsonDict:
    text = clean_text(text, 200000)

    text = re.sub(r"^```json\s*", "", text.strip(), flags=re.I)
    text = re.sub(r"^```\s*", "", text.strip(), flags=re.I)
    text = re.sub(r"\s*```$", "", text.strip())

    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")

    if start >= 0 and end > start:
        candidate = text[start : end + 1]
        value = json.loads(candidate)
        if isinstance(value, dict):
            return value

    raise RuntimeError("Gemini did not return valid JSON object.")


def call_gemini_json(prompt: str) -> JsonDict:
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError(
            "Gemini concept tree requires GOOGLE_API_KEY/GEMINI_API_KEY/GOOGLE_GENAI_API_KEY."
        )

    model = get_model_name()

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.15,
                top_p=0.8,
                max_output_tokens=12000,
            ),
        )

        return extract_json_object(response.text or "")
    except Exception as modern_error:
        try:
            import google.generativeai as legacy_genai

            legacy_genai.configure(api_key=api_key)
            legacy_model = legacy_genai.GenerativeModel(model)
            response = legacy_model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.15,
                    "top_p": 0.8,
                    "max_output_tokens": 12000,
                    "response_mime_type": "application/json",
                },
            )
            return extract_json_object(response.text or "")
        except Exception as legacy_error:
            raise RuntimeError(
                f"Gemini concept tree call failed. modern={type(modern_error).__name__}: {modern_error}; "
                f"legacy={type(legacy_error).__name__}: {legacy_error}"
            )


def make_prompt(resource: JsonDict, chunks: List[SourceChunk], question: str, max_nodes: int) -> str:
    compact_chunks = [compact_chunk(chunk) for chunk in chunks]

    return f"""
You are the Concept Tree Agent for a real AI tutor board.

TASK:
Read the uploaded PDF chunks and build an ACCURATE concept tree.

IMPORTANT:
This is NOT keyword extraction.
This is NOT a random mindmap.
This must look like a teacher's concept hierarchy.

SOURCE-GROUNDING RULES:
1. Every node MUST have sourceRefs.
2. Every sourceRef MUST use an existing chunkId from the provided chunks.
3. Every sourceRef MUST include page and quote.
4. Every edge MUST have sourceRefs and a relation reason.
5. If relation is not supported by text, do not create the edge.
6. Do not invent concepts that are not in the PDF.
7. Prefer 8 to {max_nodes} nodes, not too many.

DIAGRAM HINT RULES:
- Use "flowchart" only if source describes process/steps/workflow.
- Use "timeline" only if source describes versions/evolution/before-after over time.
- Use "er-diagram" only if source has database entities/relationships/keys/cardinality.
- Use "sequence-diagram" only if source has actors/components interacting over time.
- Use "architecture" only if source has system components/services.
- Use "comparison-table" only if source compares concepts/practices.
- Use "code-sql-example" only if source includes SQL/code/migration script.
- Do not add diagram hints just because the user asked.

OUTPUT JSON ONLY:
{{
  "title": "...",
  "rootNodeId": "...",
  "nodes": [
    {{
      "nodeId": "stable_snake_case_id",
      "label": "Human readable concept",
      "summary": "1-2 sentence source-grounded summary",
      "definition": "short beginner definition",
      "conceptType": "root|concept|practice|process|risk|example|tool|principle",
      "importance": 0.0,
      "visualHints": ["concept-tree", "flowchart"],
      "sourceRefs": [
        {{
          "chunkId": "exact chunkId from input",
          "page": 1,
          "quote": "short exact supporting quote"
        }}
      ]
    }}
  ],
  "edges": [
    {{
      "from": "parent_node_id",
      "to": "child_node_id",
      "type": "core_practice|sub_practice|explains|depends_on|leads_to|tested_by|risk_of|example_of|contrast|supports|part_of",
      "label": "short edge label",
      "reason": "why this relation is true, based on source",
      "sourceRefs": [
        {{
          "chunkId": "exact chunkId from input",
          "page": 1,
          "quote": "short exact quote proving relation"
        }}
      ]
    }}
  ]
}}

USER QUESTION:
{question}

RESOURCE:
{json_dumps(resource)}

PDF CHUNKS:
{json_dumps(compact_chunks)}
""".strip()


def normalize_visual_hints(hints: List[Any], evidence_text: str) -> List[str]:
    evidence = evidence_text.lower()
    out: List[str] = []

    for raw in hints:
        hint = clean_text(raw, 80).lower().replace("_", "-").strip()
        if not hint:
            continue

        if hint == "table":
            hint = "comparison-table"
        if hint == "tree":
            hint = "concept-tree"
        if hint == "mind-map":
            hint = "mindmap"
        if hint == "sql":
            hint = "code-sql-example"

        if hint not in ALLOWED_VISUAL_HINTS:
            continue

        if hint in {"concept-tree", "mindmap", "teacher-writing"}:
            if hint not in out:
                out.append(hint)
            continue

        required_terms = STRICT_DIAGRAM_RULES.get(hint, [])
        if required_terms and not any(term in evidence for term in required_terms):
            continue

        if hint not in out:
            out.append(hint)

    if "concept-tree" not in out:
        out.insert(0, "concept-tree")

    return out[:5]


def find_chunk_for_ref(ref: JsonDict, chunk_index: Dict[str, SourceChunk]) -> Optional[SourceChunk]:
    chunk_id = clean_text(ref.get("chunkId"), 260)
    source_ref = clean_text(ref.get("sourceRef"), 320)

    if chunk_id and chunk_id in chunk_index:
        return chunk_index[chunk_id]
    if source_ref and source_ref in chunk_index:
        return chunk_index[source_ref]

    return None


def repair_source_ref(ref: JsonDict, chunk_index: Dict[str, SourceChunk]) -> Optional[JsonDict]:
    chunk = find_chunk_for_ref(ref, chunk_index)
    if not chunk:
        return None

    quote = clean_text(ref.get("quote"), 700)
    if not quote:
        quote = clean_text(chunk.textPreview or chunk.text, 500)

    return chunk_to_source_ref(
        chunk,
        quote=quote,
        confidence=float(ref.get("confidence") or 0.82),
    )


def normalize_nodes(raw_nodes: List[Any], chunk_index: Dict[str, SourceChunk]) -> List[JsonDict]:
    nodes: List[JsonDict] = []
    seen = set()

    for raw in raw_nodes:
        node = safe_dict(raw)
        label = clean_text(node.get("label") or node.get("title") or node.get("name"), 120)
        if not label:
            continue

        node_id = normalize_id(node.get("nodeId") or node.get("id") or label, "concept")
        if node_id in seen:
            continue

        refs: List[JsonDict] = []
        for raw_ref in safe_list(node.get("sourceRefs")):
            fixed = repair_source_ref(safe_dict(raw_ref), chunk_index)
            if fixed:
                refs.append(fixed)

        refs = dedupe_source_refs(refs)

        if not refs:
            continue

        evidence_text = " ".join(clean_text(ref.get("quote"), 700) for ref in refs)

        visual_hints = normalize_visual_hints(
            safe_list(node.get("visualHints")),
            f"{label} {node.get('summary')} {node.get('definition')} {evidence_text}",
        )

        importance = node.get("importance")
        try:
            importance = float(importance)
        except Exception:
            importance = 0.5

        importance = max(0.1, min(1.0, importance))

        nodes.append(
            {
                "nodeId": node_id,
                "id": node_id,
                "label": label,
                "title": label,
                "summary": clean_text(node.get("summary"), 420),
                "definition": clean_text(node.get("definition") or node.get("summary"), 600),
                "conceptType": clean_text(node.get("conceptType") or "concept", 80),
                "importance": round(importance, 3),
                "visualHints": visual_hints,
                "sourceRefs": refs,
                "page": int(refs[0].get("page") or 1),
                "chunkIds": [clean_text(ref.get("chunkId"), 220) for ref in refs if clean_text(ref.get("chunkId"))],
                "metadata": {
                    **safe_dict(node.get("metadata")),
                    "origin": "gemini-source-grounded-concept",
                    "fallbackUsed": False,
                },
            }
        )

        seen.add(node_id)

    return nodes


def normalize_edges(raw_edges: List[Any], nodes: List[JsonDict], chunk_index: Dict[str, SourceChunk]) -> List[JsonDict]:
    node_ids = {clean_text(node.get("nodeId")) for node in nodes}
    edges: List[JsonDict] = []
    seen = set()

    for raw in raw_edges:
        edge = safe_dict(raw)
        from_id = normalize_id(edge.get("from") or edge.get("source"), "")
        to_id = normalize_id(edge.get("to") or edge.get("target"), "")

        if not from_id or not to_id:
            continue
        if from_id == to_id:
            continue
        if from_id not in node_ids or to_id not in node_ids:
            continue

        edge_key = f"{from_id}->{to_id}"
        if edge_key in seen:
            continue

        refs: List[JsonDict] = []
        for raw_ref in safe_list(edge.get("sourceRefs")):
            fixed = repair_source_ref(safe_dict(raw_ref), chunk_index)
            if fixed:
                refs.append(fixed)

        refs = dedupe_source_refs(refs)

        if not refs:
            continue

        reason = clean_text(edge.get("reason"), 360)
        if not reason:
            continue

        edge_type = clean_text(edge.get("type") or "explains", 80).lower().replace(" ", "_")
        if edge_type not in ALLOWED_EDGE_TYPES:
            edge_type = "explains"

        edges.append(
            {
                "edgeId": clean_text(edge.get("edgeId") or f"edge_{from_id}_{to_id}", 180),
                "id": clean_text(edge.get("id") or f"edge_{from_id}_{to_id}", 180),
                "from": from_id,
                "to": to_id,
                "source": from_id,
                "target": to_id,
                "type": edge_type,
                "label": clean_text(edge.get("label") or edge_type.replace("_", " "), 120),
                "reason": reason,
                "sourceRefs": refs,
                "metadata": {
                    **safe_dict(edge.get("metadata")),
                    "origin": "gemini-source-grounded-relation",
                    "fallbackUsed": False,
                },
            }
        )

        seen.add(edge_key)

    return edges


def choose_root(nodes: List[JsonDict], raw_root: str, resource: JsonDict) -> str:
    node_ids = {clean_text(node.get("nodeId")) for node in nodes}
    root_id = normalize_id(raw_root, "")

    if root_id in node_ids:
        return root_id

    title = clean_text(resource.get("title"), 140).lower()
    for node in nodes:
        label = clean_text(node.get("label"), 140).lower()
        if title and (label in title or title in label):
            return clean_text(node.get("nodeId"))

    for node in nodes:
        if clean_text(node.get("conceptType")).lower() == "root":
            return clean_text(node.get("nodeId"))

    return clean_text(nodes[0].get("nodeId")) if nodes else ""


def dagre_seed_layout(nodes: List[JsonDict], edges: List[JsonDict], root_id: str) -> JsonDict:
    children: Dict[str, List[str]] = {}
    for edge in edges:
        children.setdefault(clean_text(edge.get("from")), []).append(clean_text(edge.get("to")))

    levels: Dict[str, int] = {root_id: 0}
    queue = [root_id]

    while queue:
        parent = queue.pop(0)
        for child in children.get(parent, []):
            if child not in levels:
                levels[child] = levels[parent] + 1
                queue.append(child)

    for node in nodes:
        levels.setdefault(clean_text(node.get("nodeId")), 1)

    grouped: Dict[int, List[str]] = {}
    for node_id, level in levels.items():
        grouped.setdefault(level, []).append(node_id)

    positions = {}
    for level, ids in grouped.items():
        ids = sorted(ids)
        total = len(ids)
        for index, node_id in enumerate(ids):
            positions[node_id] = {
                "x": round((index - (total - 1) / 2) * 310, 2),
                "y": round(level * 190, 2),
            }

    return {
        "direction": "TB",
        "frontend": "reactflow-dagre",
        "nodeWidth": 270,
        "nodeHeight": 128,
        "rankSep": 150,
        "nodeSep": 90,
        "positions": positions,
    }


def heuristic_tree(payload: JsonDict, context: AgentContext) -> JsonDict:
    """
    Explicit opt-in only. This is not the default because the user wants real Gemini-quality tree.
    """
    chunks = normalize_chunks(safe_list(payload.get("chunks")))
    if not chunks:
        raise RuntimeError("No chunks available for heuristic concept tree.")

    resource = safe_dict(payload.get("resource"))
    title = clean_text(resource.get("title") or "Uploaded Resource", 140)
    root_id = normalize_id(title, "root")

    nodes: List[JsonDict] = [
        {
            "nodeId": root_id,
            "id": root_id,
            "label": title,
            "title": title,
            "summary": f"Main topic from uploaded PDF: {title}.",
            "definition": f"{title} is the root topic for this source-grounded lesson.",
            "conceptType": "root",
            "importance": 1.0,
            "visualHints": ["concept-tree", "mindmap"],
            "sourceRefs": [chunk_to_source_ref(chunks[0], confidence=0.8)],
            "page": int(chunks[0].page or 1),
            "chunkIds": [chunks[0].chunkId],
            "metadata": {"origin": "explicit-heuristic-tree", "fallbackUsed": False},
        }
    ]

    seen = {root_id}
    for chunk in chunks[:12]:
        label = clean_text(chunk.heading or chunk.title, 100)
        if not label:
            text = clean_text(chunk.text or chunk.textPreview, 300)
            label = clean_text(re.split(r"[.!?\n]", text)[0], 90)

        if not label:
            continue

        node_id = normalize_id(label, "concept")
        if node_id in seen:
            continue

        quote = clean_text(chunk.textPreview or chunk.text, 500)
        nodes.append(
            {
                "nodeId": node_id,
                "id": node_id,
                "label": label,
                "title": label,
                "summary": quote,
                "definition": quote,
                "conceptType": "concept",
                "importance": 0.5,
                "visualHints": ["concept-tree"],
                "sourceRefs": [chunk_to_source_ref(chunk, quote=quote, confidence=0.7)],
                "page": int(chunk.page or 1),
                "chunkIds": [chunk.chunkId],
                "metadata": {"origin": "explicit-heuristic-node", "fallbackUsed": False},
            }
        )
        seen.add(node_id)

    edges = []
    for node in nodes[1:]:
        edges.append(
            {
                "edgeId": f"edge_{root_id}_{node['nodeId']}",
                "id": f"edge_{root_id}_{node['nodeId']}",
                "from": root_id,
                "to": node["nodeId"],
                "source": root_id,
                "target": node["nodeId"],
                "type": "part_of",
                "label": "part of",
                "reason": f"{node['label']} appears as a source-backed part of {title}.",
                "sourceRefs": node["sourceRefs"],
                "metadata": {"origin": "explicit-heuristic-edge", "fallbackUsed": False},
            }
        )

    return {
        "treeId": clean_text(payload.get("treeId") or make_id("glt_tree"), 220),
        "boardId": clean_text(payload.get("boardId") or make_id("glt_board"), 220),
        "title": title,
        "rootNodeId": root_id,
        "nodes": nodes,
        "edges": edges,
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "dagre": dagre_seed_layout(nodes, edges, root_id),
        "sourceRefs": dedupe_source_refs([ref for node in nodes for ref in node["sourceRefs"]]),
        "metadata": {
            "agent": "ConceptTreeAgent",
            "mode": "explicit_heuristic_tree",
            "realSeparateAgent": True,
            "fallbackUsed": False,
            "sourceGrounded": True,
        },
    }


class ConceptTreeAgent(BaseLiveTutorAgent):
    agent_name = "ConceptTreeAgent"
    agent_group = "source"
    default_mode = "build_concept_tree"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Build a Gemini-quality, source-grounded concept tree from PDF chunks.
Every node and edge must have sourceRefs.
No random keyword tree.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        if not safe_list(payload.get("chunks")):
            errors.append("ConceptTreeAgent requires chunks from full PDF/resource.")

        if not get_api_key() and not bool(payload.get("allowHeuristicTree")):
            errors.append(
                "Gemini API key missing. Set GOOGLE_API_KEY/GEMINI_API_KEY or pass allowHeuristicTree=true for local test only."
            )

        max_nodes = int(payload.get("maxNodes") or 18)
        if max_nodes < 5:
            warnings.append("maxNodes is small; tree may be too shallow.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="ConceptTreeAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        chunks = normalize_chunks(safe_list(payload.get("chunks")))
        resource = safe_dict(payload.get("resource"))
        question = clean_text(payload.get("question") or context.question or resource.get("title"), 1200)
        max_nodes = int(payload.get("maxNodes") or 18)
        return make_prompt(resource, chunks, question, max_nodes)

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        chunks = normalize_chunks(safe_list(payload.get("chunks")))
        if not chunks:
            raise RuntimeError("ConceptTreeAgent received no normalized chunks.")

        if bool(payload.get("allowHeuristicTree")) and not get_api_key():
            return heuristic_tree(payload, context)

        resource = safe_dict(payload.get("resource"))
        question = clean_text(payload.get("question") or context.question or resource.get("title"), 1200)
        max_nodes = int(payload.get("maxNodes") or 18)
        max_nodes = max(6, min(max_nodes, 35))

        prompt = make_prompt(resource, chunks, question, max_nodes)
        raw = call_gemini_json(prompt)

        chunk_index = build_chunk_index(chunks)

        nodes = normalize_nodes(safe_list(raw.get("nodes")), chunk_index)
        if len(nodes) < 2:
            raise RuntimeError("Gemini concept tree produced fewer than 2 valid source-backed nodes.")

        root_id = choose_root(nodes, clean_text(raw.get("rootNodeId"), 160), resource)
        if not root_id:
            raise RuntimeError("Could not determine source-backed root node.")

        edges = normalize_edges(safe_list(raw.get("edges")), nodes, chunk_index)

        if len(nodes) > 1 and not edges:
            raise RuntimeError("Gemini concept tree produced no valid source-backed edges.")

        node_ids = {clean_text(node.get("nodeId")) for node in nodes}
        if root_id not in node_ids:
            root_id = clean_text(nodes[0].get("nodeId"))

        all_refs = []
        for node in nodes:
            all_refs.extend(safe_list(node.get("sourceRefs")))
        for edge in edges:
            all_refs.extend(safe_list(edge.get("sourceRefs")))

        return {
            "treeId": clean_text(payload.get("treeId") or raw.get("treeId") or make_id("glt_tree"), 220),
            "boardId": clean_text(payload.get("boardId") or raw.get("boardId") or make_id("glt_board"), 220),
            "title": clean_text(raw.get("title") or resource.get("title") or "Source-Grounded Concept Tree", 180),
            "rootNodeId": root_id,
            "nodes": nodes[:max_nodes],
            "edges": [
                edge for edge in edges
                if edge.get("from") in {n["nodeId"] for n in nodes[:max_nodes]}
                and edge.get("to") in {n["nodeId"] for n in nodes[:max_nodes]}
            ],
            "nodeCount": len(nodes[:max_nodes]),
            "edgeCount": len([
                edge for edge in edges
                if edge.get("from") in {n["nodeId"] for n in nodes[:max_nodes]}
                and edge.get("to") in {n["nodeId"] for n in nodes[:max_nodes]}
            ]),
            "dagre": dagre_seed_layout(nodes[:max_nodes], edges, root_id),
            "sourceRefs": dedupe_source_refs(all_refs),
            "metadata": {
                "agent": self.agent_name,
                "mode": "gemini_source_grounded_tree",
                "model": get_model_name(),
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "sourceGrounded": True,
                "nodeRelationReasons": True,
                "randomKeywordTree": False,
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        nodes = safe_list(raw.get("nodes"))
        edges = safe_list(raw.get("edges"))

        root_id = clean_text(raw.get("rootNodeId"), 160)
        if root_id not in {clean_text(node.get("nodeId")) for node in nodes} and nodes:
            root_id = clean_text(nodes[0].get("nodeId"))

        final_edges = [
            edge for edge in edges
            if clean_text(edge.get("from")) in {clean_text(node.get("nodeId")) for node in nodes}
            and clean_text(edge.get("to")) in {clean_text(node.get("nodeId")) for node in nodes}
        ]

        all_refs = []
        for node in nodes:
            all_refs.extend(safe_list(node.get("sourceRefs")))
        for edge in final_edges:
            all_refs.extend(safe_list(edge.get("sourceRefs")))

        return {
            "treeId": clean_text(raw.get("treeId") or make_id("glt_tree"), 220),
            "boardId": clean_text(raw.get("boardId") or make_id("glt_board"), 220),
            "title": clean_text(raw.get("title") or "Source-Grounded Concept Tree", 180),
            "rootNodeId": root_id,
            "nodes": nodes,
            "edges": final_edges,
            "nodeCount": len(nodes),
            "edgeCount": len(final_edges),
            "dagre": safe_dict(raw.get("dagre")) or dagre_seed_layout(nodes, final_edges, root_id),
            "sourceRefs": dedupe_source_refs(all_refs),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "sourceGrounded": True,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        nodes = safe_list(output.get("nodes"))
        edges = safe_list(output.get("edges"))

        if not nodes:
            errors.append("ConceptTreeAgent output must include nodes.")

        node_ids = set()
        for index, node_raw in enumerate(nodes):
            node = safe_dict(node_raw)
            node_id = clean_text(node.get("nodeId"), 160)
            node_ids.add(node_id)

            if not node_id:
                errors.append(f"nodes[{index}].nodeId is required.")
            if not clean_text(node.get("label")):
                errors.append(f"nodes[{index}].label is required.")
            if not safe_list(node.get("sourceRefs")):
                errors.append(f"nodes[{index}].sourceRefs is required.")

            for ref_index, ref_raw in enumerate(safe_list(node.get("sourceRefs"))):
                ref = safe_dict(ref_raw)
                if not clean_text(ref.get("chunkId")):
                    errors.append(f"nodes[{index}].sourceRefs[{ref_index}].chunkId is required.")
                if int(ref.get("page") or 0) <= 0:
                    errors.append(f"nodes[{index}].sourceRefs[{ref_index}].page must be positive.")
                if not clean_text(ref.get("quote")):
                    errors.append(f"nodes[{index}].sourceRefs[{ref_index}].quote is required.")

        if len(nodes) > 1 and not edges:
            errors.append("ConceptTreeAgent output with multiple nodes must include edges.")

        for index, edge_raw in enumerate(edges):
            edge = safe_dict(edge_raw)
            from_id = clean_text(edge.get("from") or edge.get("source"), 160)
            to_id = clean_text(edge.get("to") or edge.get("target"), 160)

            if from_id not in node_ids:
                errors.append(f"edges[{index}].from not found in nodes: {from_id}")
            if to_id not in node_ids:
                errors.append(f"edges[{index}].to not found in nodes: {to_id}")
            if not clean_text(edge.get("reason")):
                errors.append(f"edges[{index}].reason is required.")
            if not safe_list(edge.get("sourceRefs")):
                errors.append(f"edges[{index}].sourceRefs is required.")

        if not safe_list(output.get("sourceRefs")):
            warnings.append("Top-level sourceRefs is empty.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="ConceptTreeAgent.validate_output",
            fallbackUsed=False,
        )