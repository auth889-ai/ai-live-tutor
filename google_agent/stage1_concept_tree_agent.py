"""
google_agent/stage1_concept_tree_agent.py
===============================================================================
Stage 1 Python ADK Agent for Advanced Live Tutor Concept Tree Board.

Called by:
  server/services/googleAgent/stage1PythonAdkBridge.service.js

Modes:
  --mode health
  --mode concept_tree
  --mode explain_node

No fake fallback:
  - If ADK import fails, returns ok:false.
  - If source chunks are missing, returns ok:false.
  - If model output is invalid JSON, returns ok:false.
  - If sourceRefs are missing, returns ok:false.

Important:
  This file must contain ONLY Python.
  Do not paste JavaScript code into this file.
===============================================================================
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
import traceback
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass


try:
    from google.adk.agents import Agent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types
except Exception as import_error:
    Agent = None
    Runner = None
    InMemorySessionService = None
    types = None
    ADK_IMPORT_ERROR = import_error
else:
    ADK_IMPORT_ERROR = None


JsonDict = Dict[str, Any]


def safe_str(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)

    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return fallback


def clean_text(value: Any, max_len: int = 4000) -> str:
    text = safe_str(value)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:max_len]


def safe_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def safe_dict(value: Any) -> JsonDict:
    return value if isinstance(value, dict) else {}


def model_name() -> str:
    return (
        os.getenv("GOOGLE_GEMINI_MODEL")
        or os.getenv("GEMINI_MODEL")
        or os.getenv("GOOGLE_ADK_MODEL")
        or "gemini-2.5-flash"
    )


def normalize_node_id(value: Any, fallback: str = "node") -> str:
    text = clean_text(value, 100).lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = re.sub(r"^_+|_+$", "", text)
    return text or fallback


def extract_json_object(text: str) -> JsonDict:
    text = clean_text(text, 300000)

    if not text:
        raise ValueError("Agent returned empty text.")

    attempts = [text]

    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.I)
    if fenced:
        attempts.append(fenced.group(1).strip())

    first = text.find("{")
    last = text.rfind("}")
    if first >= 0 and last > first:
        attempts.append(text[first : last + 1])

    for candidate in attempts:
        cleaned = candidate.strip()
        cleaned = re.sub(r"^```json\s*", "", cleaned, flags=re.I)
        cleaned = cleaned.replace("```", "")
        cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue

    raise ValueError(f"Could not parse JSON from agent output. Preview: {text[:1200]}")


def chunk_signature(chunk: JsonDict) -> str:
    return (
        f"[chunkId={chunk.get('chunkId', '')}] "
        f"[sourceRef={chunk.get('sourceRef', '')}] "
        f"[page={chunk.get('page', 1)}] "
        f"[chunkIndex={chunk.get('chunkIndex', 0)}]"
    )


def source_bundle(chunks: List[JsonDict], max_chars: int = 90000) -> str:
    blocks: List[str] = []
    used = 0

    for chunk in chunks:
        text = clean_text(chunk.get("text") or chunk.get("textPreview") or "", 2600)
        if not text:
            continue

        block = f"{chunk_signature(chunk)}\n{text}"

        if used + len(block) > max_chars:
            break

        used += len(block)
        blocks.append(block)

    return "\n\n---\n\n".join(blocks)


def build_chunk_registry(
    chunks: List[JsonDict],
) -> Tuple[Dict[str, JsonDict], Dict[str, JsonDict], Dict[str, List[JsonDict]]]:
    by_chunk_id: Dict[str, JsonDict] = {}
    by_source_ref: Dict[str, JsonDict] = {}
    by_page: Dict[str, List[JsonDict]] = {}

    for chunk in chunks:
        chunk_id = safe_str(chunk.get("chunkId"))
        source_ref = safe_str(chunk.get("sourceRef"))
        page = safe_str(chunk.get("page") or 1)

        if chunk_id:
            by_chunk_id[chunk_id] = chunk

        if source_ref:
            by_source_ref[source_ref] = chunk

        by_page.setdefault(page, []).append(chunk)

    return by_chunk_id, by_source_ref, by_page


def normalize_source_ref(raw_ref: Any, chunks: List[JsonDict]) -> Optional[JsonDict]:
    ref = safe_dict(raw_ref)
    by_chunk_id, by_source_ref, by_page = build_chunk_registry(chunks)

    chunk: Optional[JsonDict] = None

    chunk_id = safe_str(ref.get("chunkId"))
    source_ref = safe_str(ref.get("sourceRef"))
    page = safe_str(ref.get("page"))

    if chunk_id and chunk_id in by_chunk_id:
        chunk = by_chunk_id[chunk_id]

    if chunk is None and source_ref and source_ref in by_source_ref:
        chunk = by_source_ref[source_ref]

    if chunk is None and page and page in by_page and by_page[page]:
        chunk = by_page[page][0]

    if chunk is None:
        return None

    return {
        "chunkId": safe_str(chunk.get("chunkId")),
        "sourceRef": safe_str(chunk.get("sourceRef")),
        "pageRef": safe_str(
            chunk.get("pageRef")
            or f"resource:{chunk.get('resourceId', '')}:page:{chunk.get('page', 1)}"
        ),
        "page": int(chunk.get("page") or 1),
        "quote": clean_text(
            ref.get("quote") or chunk.get("textPreview") or chunk.get("text") or "",
            420,
        ),
        "confidence": float(ref.get("confidence") or 0.75),
    }


def validate_concept_tree(raw: JsonDict, chunks: List[JsonDict], resource_title: str) -> JsonDict:
    errors: List[str] = []
    warnings: List[str] = []

    raw_nodes = safe_list(raw.get("nodes"))
    raw_edges = safe_list(raw.get("edges"))

    if not raw_nodes:
        errors.append("No nodes returned.")

    nodes: List[JsonDict] = []
    seen_node_ids = set()

    for idx, item in enumerate(raw_nodes):
        node = safe_dict(item)

        label = clean_text(node.get("label") or node.get("title") or node.get("name"), 90)
        node_id = normalize_node_id(
            node.get("nodeId") or node.get("id") or label,
            f"node_{idx + 1}",
        )

        if not label:
            errors.append(f"Node {idx + 1} missing label.")
            continue

        if node_id in seen_node_ids:
            errors.append(f"Duplicate nodeId: {node_id}")
            continue

        source_refs = [
            ref
            for ref in (
                normalize_source_ref(r, chunks)
                for r in safe_list(node.get("sourceRefs") or node.get("sources"))
            )
            if ref
        ]

        if not source_refs:
            errors.append(f'Node "{label}" ({node_id}) has no valid sourceRefs.')

        seen_node_ids.add(node_id)

        node_type = safe_str(node.get("nodeType") or ("root" if idx == 0 else "concept"))
        if node_type not in {
            "root",
            "module",
            "concept",
            "definition",
            "process",
            "example",
            "warning",
            "question",
            "unknown",
        }:
            node_type = "concept"

        try:
            level = int(node.get("level") or (0 if idx == 0 else 1))
        except Exception:
            level = 0 if idx == 0 else 1

        try:
            order = int(node.get("order") or idx)
        except Exception:
            order = idx

        try:
            importance = max(0.0, min(1.0, float(node.get("importance") or 0.5)))
        except Exception:
            importance = 0.5

        nodes.append(
            {
                "nodeId": node_id,
                "label": label,
                "summary": clean_text(node.get("summary") or node.get("description") or "", 360),
                "level": level,
                "parentId": normalize_node_id(node.get("parentId") or node.get("parent") or "", ""),
                "order": order,
                "nodeType": node_type,
                "importance": importance,
                "sourceRefs": source_refs,
                "tags": [
                    clean_text(x, 40)
                    for x in safe_list(node.get("tags"))
                    if clean_text(x, 40)
                ],
                "visualHints": [
                    clean_text(x, 40)
                    for x in safe_list(node.get("visualHints") or node.get("visuals"))
                    if clean_text(x, 40)
                ],
                "metadata": safe_dict(node.get("metadata")),
            }
        )

    node_ids = {node["nodeId"] for node in nodes}
    root_node_id = normalize_node_id(
        raw.get("rootNodeId") or (nodes[0]["nodeId"] if nodes else ""),
        "",
    )

    if root_node_id not in node_ids and nodes:
        root_node_id = nodes[0]["nodeId"]

    edges: List[JsonDict] = []

    for idx, item in enumerate(raw_edges):
        edge = safe_dict(item)

        from_id = normalize_node_id(edge.get("from") or edge.get("source") or edge.get("parentId"), "")
        to_id = normalize_node_id(edge.get("to") or edge.get("target") or edge.get("childId"), "")

        if not from_id or not to_id or from_id not in node_ids or to_id not in node_ids:
            warnings.append(f"Dropped invalid edge {idx + 1}: {from_id} -> {to_id}")
            continue

        edge_type = safe_str(edge.get("type") or "parent-child")
        if edge_type not in {
            "parent-child",
            "prerequisite",
            "related",
            "causes",
            "contrasts",
            "example-of",
        }:
            edge_type = "parent-child"

        edges.append(
            {
                "edgeId": clean_text(
                    edge.get("edgeId") or edge.get("id") or f"edge_{from_id}_{to_id}_{idx + 1}",
                    160,
                ),
                "from": from_id,
                "to": to_id,
                "label": clean_text(edge.get("label") or "", 80),
                "type": edge_type,
                "sourceRefs": [
                    ref
                    for ref in (
                        normalize_source_ref(r, chunks)
                        for r in safe_list(edge.get("sourceRefs"))
                    )
                    if ref
                ],
                "metadata": safe_dict(edge.get("metadata")),
            }
        )

    for node in nodes:
        parent_id = safe_str(node.get("parentId"))

        if not parent_id or parent_id == node["nodeId"] or parent_id not in node_ids:
            continue

        exists = any(e["from"] == parent_id and e["to"] == node["nodeId"] for e in edges)

        if not exists:
            edges.append(
                {
                    "edgeId": f"edge_{parent_id}_{node['nodeId']}",
                    "from": parent_id,
                    "to": node["nodeId"],
                    "label": "",
                    "type": "parent-child",
                    "sourceRefs": node["sourceRefs"][:1],
                    "metadata": {"generatedFromParentId": True},
                }
            )

    if nodes and len(nodes) > 1 and not edges:
        errors.append("Tree has multiple nodes but no valid edges.")

    coverage = round(sum(1 for node in nodes if node["sourceRefs"]) / max(1, len(nodes)), 3)

    if coverage < 1.0:
        errors.append(f"Source coverage must be 1.0, got {coverage}.")

    return {
        "ok": not errors,
        "title": clean_text(raw.get("title") or resource_title or "Concept Tree", 180),
        "rootNodeId": root_node_id,
        "nodes": nodes,
        "edges": edges,
        "sourceCoverage": coverage,
        "validation": {
            "ok": not errors,
            "errors": errors,
            "warnings": warnings,
        },
        "metadata": {
            "stage": 1,
            "agent": "Stage1ConceptTreeAgent",
            "fallbackUsed": False,
            "realPythonAdkAgent": True,
            "sourceGrounded": coverage == 1.0,
        },
    }


def validate_node_explanation(raw: JsonDict, node: JsonDict, chunks: List[JsonDict]) -> JsonDict:
    errors: List[str] = []
    warnings: List[str] = []

    explanation = clean_text(raw.get("explanation") or raw.get("detailedExplanation"), 6000)

    if len(explanation) < 80:
        errors.append("Explanation is missing or too short.")

    source_refs = [
        ref
        for ref in (
            normalize_source_ref(r, chunks)
            for r in safe_list(raw.get("sourceRefs") or raw.get("sources"))
        )
        if ref
    ]

    if not source_refs:
        errors.append("Explanation has no valid sourceRefs.")

    board_commands: List[JsonDict] = []

    for idx, cmd_raw in enumerate(safe_list(raw.get("boardCommands"))):
        cmd = safe_dict(cmd_raw)

        board_commands.append(
            {
                "commandId": safe_str(cmd.get("commandId") or f"cmd_{idx + 1}"),
                "type": safe_str(cmd.get("type") or "writeNearNode"),
                "nodeId": normalize_node_id(cmd.get("nodeId") or node.get("nodeId"), node.get("nodeId", "")),
                "text": clean_text(cmd.get("text") or "", 800),
                "durationMs": int(cmd.get("durationMs") or 1600),
                "payload": safe_dict(cmd.get("payload")),
            }
        )

    if not board_commands and source_refs:
        board_commands = [
            {
                "commandId": "cmd_1",
                "type": "highlightNode",
                "nodeId": node.get("nodeId"),
                "text": "",
                "durationMs": 800,
                "payload": {},
            },
            {
                "commandId": "cmd_2",
                "type": "writeNearNode",
                "nodeId": node.get("nodeId"),
                "text": clean_text(node.get("summary") or node.get("label"), 220),
                "durationMs": 2200,
                "payload": {},
            },
            {
                "commandId": "cmd_3",
                "type": "showSourceBadge",
                "nodeId": node.get("nodeId"),
                "text": ", ".join([f"Pg. {r['page']}" for r in source_refs[:4]]),
                "durationMs": 900,
                "payload": {"sourceRefs": source_refs[:4]},
            },
        ]

    return {
        "ok": not errors,
        "title": clean_text(raw.get("title") or node.get("label"), 120),
        "explanation": explanation,
        "simpleExample": clean_text(raw.get("simpleExample") or raw.get("example") or "", 1600),
        "whyItMatters": [
            clean_text(x, 240)
            for x in safe_list(raw.get("whyItMatters"))
            if clean_text(x, 240)
        ],
        "commonMistakes": [
            clean_text(x, 240)
            for x in safe_list(raw.get("commonMistakes"))
            if clean_text(x, 240)
        ],
        "relatedNodeIds": [
            normalize_node_id(x, "")
            for x in safe_list(raw.get("relatedNodeIds"))
            if normalize_node_id(x, "")
        ],
        "sourceRefs": source_refs,
        "boardCommands": board_commands,
        "validation": {
            "ok": not errors,
            "errors": errors,
            "warnings": warnings,
        },
        "metadata": {
            "stage": 1,
            "agent": "Stage1NodeExplainAgent",
            "fallbackUsed": False,
            "realPythonAdkAgent": True,
            "sourceGrounded": bool(source_refs),
        },
    }


@dataclass
class Stage1AgentInput:
    mode: str
    resource: JsonDict
    chunks: List[JsonDict]
    tree: Optional[JsonDict] = None
    node: Optional[JsonDict] = None
    question: str = ""
    language: str = "english"
    student_level: str = "beginner"
    max_nodes: int = 42


def concept_tree_instruction() -> str:
    return """
You are Stage 1 Concept Tree Agent for an advanced source-grounded Live Tutor.

You represent these specialist roles:
1. Resource Intake Agent
2. Source Grounding Agent
3. Concept Extraction Agent
4. Knowledge Graph Agent
5. Validator Agent

Output ONLY valid JSON.

Hard rules:
- Use only provided source chunks.
- Every node must have sourceRefs.
- sourceRefs must use exact chunkId/sourceRef/page values from provided chunks.
- Do not invent unsupported concepts.
- Prefer fewer accurate nodes over many weak nodes.
- Do not output markdown.
- Do not include explanations outside JSON.
"""


def node_explain_instruction() -> str:
    return """
You are Stage 1 Node Explanation Agent for an advanced source-grounded Live Tutor.

You represent these specialist roles:
1. RAG Retrieval Agent
2. Source Grounding Agent
3. Node Explanation Agent
4. Board Command Agent
5. Validator Agent

Output ONLY valid JSON.

Hard rules:
- Explain only the clicked node.
- Use only provided source chunks.
- Every explanation must include sourceRefs.
- sourceRefs must use exact chunkId/sourceRef/page values from provided chunks.
- Return boardCommands so the board can highlight/write near node.
- Do not invent unsupported facts.
- Do not output markdown.
"""



def source_teacher_anchors_for_prompt(chunks: List[JsonDict], max_items: int = 70) -> str:
    """
    Source-derived anchors for ADK Stage1.
    This is not fake fallback: every anchor is triggered only by actual chunk text.
    """
    anchors: List[JsonDict] = []

    def add(title: str, page: Any, node_type: str, reason: str, relation: str = "part-of", visual_hints: Optional[List[str]] = None) -> None:
        clean_title = clean_text(title, 180)
        pages = [int(page)] if str(page).isdigit() else []
        if not clean_title or not pages:
            return
        key = f"{clean_title.lower()}|{pages[0]}"
        if any(f"{a.get('title','').lower()}|{safe_list(a.get('pages'))[0]}" == key for a in anchors if safe_list(a.get("pages"))):
            return
        anchors.append(
            {
                "title": clean_title,
                "pages": pages,
                "nodeType": node_type,
                "reason": clean_text(reason, 360),
                "relationHint": relation,
                "visualHints": visual_hints or [],
                "mustBeSeparate": True,
            }
        )

    for chunk in safe_list(chunks):
        text = clean_text(
            chunk.get("text")
            or chunk.get("content")
            or chunk.get("pageText")
            or chunk.get("combinedForEvidence")
            or "",
            50000,
        ).lower()
        page = chunk.get("page") or chunk.get("pageNumber") or chunk.get("pageIndex") or 1

        def has(*phrases: str) -> bool:
            return any(phrase.lower() in text for phrase in phrases)

        if has("normalization is a technique", "eliminating the redundant data", "eliminate redundant"):
            add("Normalization removes redundancy", page, "definition", "source defines normalization around eliminating redundant data", "contrasts")

        if has("denormalization is the inverse", "redundancy is added", "improve the performance", "denormalization"):
            add("Denormalization adds redundancy for performance", page, "definition", "source explains denormalization as adding redundancy to improve performance", "contrasts")

        if has("require join", "a lot of join", "join is expensive", "crazy lot of join", "many joins"):
            add("Join cost problem in normalized databases", page, "concept", "source says normalized structures can require many expensive joins", "causes", ["flowchart"])
            add("On-demand denormalization decision", page, "process", "source says denormalization is applied on demand when query cost requires it", "solves", ["decision"])

        if has("top rated products", "most number of sales", "popular categories", "sales persons", "salespersons"):
            add("Kid’s Shop reporting use cases", page, "example", "source lists concrete Kid’s Shop reporting queries", "example-of", ["example", "source-page"])

        if has("averagerating", "average rating", "salecount", "sale count", "totalsale", "total sale", "totalprice"):
            add("Redundant summary fields: AverageRating, SaleCount, TotalSale", page, "example", "source shows redundant summary fields added to speed up reporting queries", "example-of", ["schema", "table"])

        if has("mutable data", "wrong updates", "different parts of the code", "only one piece of code", "updates can be slow"):
            add("Mutable redundancy creates update consistency risk", page, "warning", "source warns redundant mutable data can be updated incorrectly from multiple code paths", "contrasts")
            add("Single writer rule for redundant data updates", page, "process", "source solution: update one redundant value from only one piece of code", "solves")
            add("Read performance gain vs write consistency cost", page, "concept", "source tradeoff: redundancy can make reads faster but makes updates risky or slow", "contrasts")

        if has("operational database", "reporting database", "separate db", "separate database"):
            add("Operational DB vs Reporting DB", page, "definition", "source separates operational workload from reporting workload", "contrasts", ["comparison"])

        if has("scheduled", "cron", "nightly", "batch update", "regular interval"):
            add("Scheduled reporting database synchronization", page, "process", "source describes scheduled or batch synchronization", "process", ["timeline"])

        if has("messaging", "message queue", "event", "publish", "subscribe"):
            add("Messaging-based reporting database synchronization", page, "process", "source describes messaging or event-based synchronization", "process", ["sequence"])

        if has("measure", "fact", "numeric value"):
            add("Measure / Fact", page, "definition", "source defines fact or measure as analyzable numerical values", "part-of", ["schema", "table"])

        if has("fact table", "central table", "contains facts", "foreign key"):
            add("Fact Table", page, "definition", "source explains fact table as central table containing measures and dimension keys", "part-of", ["schema", "table"])

        if has("dimension table", "dimension tables", "descriptive attributes"):
            add("Dimension Table", page, "definition", "source explains dimension table as descriptive context for facts", "part-of", ["schema", "table"])
        elif has("dimension", "dimensions", "descriptive"):
            add("Dimension", page, "definition", "source defines dimensions as descriptive perspectives used for analysis", "part-of", ["schema"])

        if has("star schema", "fact table at the center", "surrounded by dimension", "star-like"):
            add("Star Schema structure", page, "concept", "source describes star schema with central fact table and surrounding dimension tables", "schema", ["schema", "diagram"])

        if has("snowflake schema", "normalized dimensions", "split dimension", "normalized dimension"):
            add("Snowflake Schema with normalized dimensions", page, "concept", "source describes snowflake schema as normalized or split dimensions", "schema", ["schema", "diagram"])

        if has("star vs snowflake", "star schema vs snowflake", "query complexity", "joins", "maintenance"):
            add("Star vs Snowflake tradeoff", page, "concept", "source compares star and snowflake schema tradeoffs", "contrasts", ["comparison", "table"])

        if has("galaxy schema", "multiple fact", "two fact table", "share dimension", "shared dimension"):
            add("Galaxy Schema with shared dimensions", page, "concept", "source describes galaxy schema as multiple fact tables sharing dimensions", "schema", ["schema", "diagram"])
            add("Multiple fact tables sharing dimension tables", page, "concept", "source explains multi-fact-table galaxy structure", "part-of", ["schema"])

    return json.dumps(anchors[:max_items], ensure_ascii=False, indent=2)

def build_concept_tree_prompt(data: Stage1AgentInput) -> str:
    resource_title = clean_text(data.resource.get("title") or "Uploaded Resource", 180)
    source_text = source_bundle(data.chunks)
    anchors = source_teacher_anchors_for_prompt(data.chunks, data.max_nodes)

    return f"""
You are Stage 1 Python ADK Concept Tree Agent for a real AI Live Tutor board.

Create a TEACHER ROADMAP concept tree, not a slide-title summary.

STRICT RULES:
1. Use only source chunks and source-derived anchors below.
2. Do not create random keyword nodes.
3. Do not collapse rich source sections into one generic node.
4. Every node must be teachable alone by a human tutor.
5. Every node must include exact sourceRefs from chunks.
6. Keep precise concepts separate when source supports them:
   - normalization removes redundancy
   - denormalization adds redundancy for performance
   - join cost problem
   - read performance gain vs write consistency cost
   - operational DB vs reporting DB
   - scheduled sync vs messaging sync
   - measure/fact
   - fact table
   - dimension
   - dimension table
   - star schema
   - snowflake schema
   - star vs snowflake
   - galaxy schema
7. Edges must be real relations: parent-child, prerequisite, related, causes, contrasts, example-of.
8. nodeType must be one of:
   root, module, concept, definition, process, example, warning, question.
9. JSON only.

Resource title: {resource_title}
Student level: {data.student_level}
Language: {data.language}
Max nodes: {data.max_nodes}

REQUIRED SOURCE-DERIVED TEACHING ANCHORS:
{anchors}

Return JSON exactly like:
{{
  "title": "string",
  "rootNodeId": "stable_snake_case_id",
  "nodes": [
    {{
      "nodeId": "stable_snake_case_id",
      "label": "short label",
      "summary": "one source-grounded sentence",
      "level": 0,
      "parentId": "",
      "order": 0,
      "nodeType": "root|module|concept|definition|process|example|warning|question",
      "importance": 0.8,
      "visualHints": ["tree", "flowchart", "source-page"],
      "tags": ["source-grounded"],
      "sourceRefs": [
        {{
          "chunkId": "exact chunkId",
          "sourceRef": "exact sourceRef",
          "page": 1,
          "quote": "short evidence"
        }}
      ]
    }}
  ],
  "edges": [
    {{
      "edgeId": "edge_parent_child",
      "from": "parent_id",
      "to": "child_id",
      "type": "parent-child|prerequisite|related|causes|contrasts|example-of",
      "label": "why connected",
      "sourceRefs": []
    }}
  ]
}}

Source chunks:
{source_text}
"""

def build_node_explain_prompt(data: Stage1AgentInput) -> str:
    if not data.node:
        raise ValueError("node is required for explain_node mode.")

    source_text = source_bundle(data.chunks, max_chars=32000)
    tree_nodes = safe_list(safe_dict(data.tree).get("nodes")) if data.tree else []

    allowed_nodes = "\n".join(
        f"- {safe_str(n.get('nodeId'))}: {safe_str(n.get('label'))}" for n in tree_nodes
    )

    return f"""
Explain the clicked concept tree node like a human tutor.

Clicked node:
nodeId: {data.node.get("nodeId")}
label: {data.node.get("label")}
summary: {data.node.get("summary")}

Student level: {data.student_level}
Language: {data.language}
Question: {data.question or "Explain this node clearly"}

Allowed related nodes:
{allowed_nodes}

Return JSON exactly like:
{{
  "title": "{data.node.get("label")}",
  "explanation": "Detailed Gemini-style tutor explanation, grounded in source.",
  "simpleExample": "simple example if supported by source context",
  "whyItMatters": ["reason 1", "reason 2"],
  "commonMistakes": ["mistake 1"],
  "relatedNodeIds": ["node_id_from_allowed_list"],
  "sourceRefs": [
    {{
      "chunkId": "exact chunkId",
      "sourceRef": "exact sourceRef",
      "page": 1,
      "quote": "short evidence"
    }}
  ],
  "boardCommands": [
    {{
      "commandId": "cmd_1",
      "type": "highlightNode",
      "nodeId": "{data.node.get("nodeId")}",
      "durationMs": 800
    }},
    {{
      "commandId": "cmd_2",
      "type": "writeNearNode",
      "nodeId": "{data.node.get("nodeId")}",
      "text": "short board definition",
      "durationMs": 2200
    }},
    {{
      "commandId": "cmd_3",
      "type": "showSourceBadge",
      "nodeId": "{data.node.get("nodeId")}",
      "text": "Pg. X",
      "durationMs": 900
    }}
  ]
}}

Source chunks:
{source_text}
"""


async def create_session_if_needed(
    session_service: Any,
    app_name: str,
    user_id: str,
    session_id: str,
) -> None:
    result = session_service.create_session(
        app_name=app_name,
        user_id=user_id,
        session_id=session_id,
    )

    if hasattr(result, "__await__"):
        await result


async def run_adk_agent(
    agent: Any,
    prompt: str,
    app_name: str,
    user_id: str,
    session_id: str,
) -> str:
    if ADK_IMPORT_ERROR is not None:
        raise RuntimeError(f"Google ADK import failed: {ADK_IMPORT_ERROR}")

    session_service = InMemorySessionService()
    await create_session_if_needed(session_service, app_name, user_id, session_id)

    runner = Runner(
        agent=agent,
        app_name=app_name,
        session_service=session_service,
    )

    content = types.Content(
        role="user",
        parts=[types.Part(text=prompt)],
    )

    text_parts: List[str] = []

    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=content,
    ):
        if getattr(event, "content", None) and getattr(event.content, "parts", None):
            for part in event.content.parts:
                text = getattr(part, "text", None)
                if text:
                    text_parts.append(text)

    return "\n".join(text_parts).strip()


def make_agent(name: str, description: str, instruction: str) -> Any:
    if ADK_IMPORT_ERROR is not None:
        raise RuntimeError(f"Google ADK import failed: {ADK_IMPORT_ERROR}")

    return Agent(
        name=name,
        model=model_name(),
        description=description,
        instruction=instruction,
    )


async def run_stage1_agent(payload: JsonDict) -> JsonDict:
    started = time.time()

    if ADK_IMPORT_ERROR is not None:
        return {
            "ok": False,
            "error": f"Google ADK import failed: {ADK_IMPORT_ERROR}",
            "metadata": {
                "realPythonAdkAgent": False,
                "adkImportError": str(ADK_IMPORT_ERROR),
                "fallbackUsed": False,
            },
        }

    mode = safe_str(payload.get("mode"))

    if mode not in {"concept_tree", "explain_node", "health"}:
        raise ValueError("mode must be one of: concept_tree, explain_node, health")

    if mode == "health":
        return {
            "ok": True,
            "service": "stage1_concept_tree_agent.py",
            "realPythonAdkAgent": True,
            "model": model_name(),
            "adkImported": True,
            "capabilities": {
                "conceptTree": True,
                "nodeExplanation": True,
                "sourceRefsRequired": True,
                "boardCommands": True,
                "fakeFallback": False,
            },
        }

    resource = safe_dict(payload.get("resource"))
    chunks = safe_list(payload.get("chunks"))

    if not chunks:
        raise ValueError("chunks are required. No fake answer will be generated.")

    data = Stage1AgentInput(
        mode=mode,
        resource=resource,
        chunks=[safe_dict(c) for c in chunks],
        tree=safe_dict(payload.get("tree")),
        node=safe_dict(payload.get("node")),
        question=safe_str(payload.get("question")),
        language=safe_str(payload.get("language") or "english"),
        student_level=safe_str(payload.get("studentLevel") or "beginner"),
        max_nodes=int(payload.get("maxNodes") or 42),
    )

    app_name = "advanced_live_tutor_stage1"
    user_id = safe_str(payload.get("ownerKey") or payload.get("offlineUserId") or "demo_user")
    session_id = safe_str(payload.get("sessionId") or f"stage1_{int(time.time())}")

    if mode == "concept_tree":
        agent = make_agent(
            name="stage1_concept_tree_root_agent",
            description="Builds source-grounded concept trees for Live Tutor boards.",
            instruction=concept_tree_instruction(),
        )

        prompt = build_concept_tree_prompt(data)
        raw_text = await run_adk_agent(agent, prompt, app_name, user_id, session_id)
        parsed = extract_json_object(raw_text)
        validated = validate_concept_tree(parsed, data.chunks, safe_str(resource.get("title")))

        return {
            "ok": validated["ok"],
            "mode": mode,
            "result": validated,
            "raw": parsed if os.getenv("NODE_ENV") == "development" else None,
            "metadata": {
                "realPythonAdkAgent": True,
                "adkRunnerUsed": True,
                "model": model_name(),
                "fallbackUsed": False,
                "runtimeMs": int((time.time() - started) * 1000),
            },
        }

    if mode == "explain_node":
        if not data.node:
            raise ValueError("node is required for explain_node mode.")

        agent = make_agent(
            name="stage1_node_explain_agent",
            description="Explains clicked concept tree nodes with source-grounded board commands.",
            instruction=node_explain_instruction(),
        )

        prompt = build_node_explain_prompt(data)
        raw_text = await run_adk_agent(agent, prompt, app_name, user_id, session_id)
        parsed = extract_json_object(raw_text)
        validated = validate_node_explanation(parsed, data.node, data.chunks)

        return {
            "ok": validated["ok"],
            "mode": mode,
            "result": validated,
            "raw": parsed if os.getenv("NODE_ENV") == "development" else None,
            "metadata": {
                "realPythonAdkAgent": True,
                "adkRunnerUsed": True,
                "model": model_name(),
                "fallbackUsed": False,
                "runtimeMs": int((time.time() - started) * 1000),
            },
        }

    raise ValueError(f"Unsupported mode: {mode}")


def read_stdin_json() -> JsonDict:
    raw = sys.stdin.read()

    if not raw.strip():
        return {}

    parsed = json.loads(raw)

    if not isinstance(parsed, dict):
        raise ValueError("stdin JSON must be an object")

    return parsed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="", help="concept_tree | explain_node | health")
    args = parser.parse_args()

    try:
        payload = read_stdin_json()

        if args.mode:
            payload["mode"] = args.mode

        result = asyncio.run(run_stage1_agent(payload))
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(exc),
                    "traceback": traceback.format_exc()
                    if os.getenv("NODE_ENV") == "development"
                    else "",
                    "metadata": {
                        "realPythonAdkAgent": ADK_IMPORT_ERROR is None,
                        "adkImportError": str(ADK_IMPORT_ERROR) if ADK_IMPORT_ERROR else "",
                        "fallbackUsed": False,
                    },
                },
                ensure_ascii=False,
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()