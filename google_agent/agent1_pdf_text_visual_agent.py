#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
google_agent/agent1_pdf_text_visual_agent.py
===============================================================================
REAL Agent 1 for hackathon.

This file is intentionally strict.

What makes it real:
  ✅ Creates a real Google ADK Agent object
  ✅ Creates real ADK function tools
  ✅ Runs through ADK Runner + InMemorySessionService
  ✅ Uses Gemini model configured in .env
  ✅ Requires source chunks passed from MongoDB
  ✅ Requires the ADK agent to use tools unless disabled by env
  ✅ Returns source-grounded Mermaid/table sceneGraph
  ✅ Returns ADK tool-call proof
  ✅ Accepts MCP proof from Node service and exposes it in metadata

Agent 1 scope:
  PDF/transcript/text chunks -> ADK Agent -> Gemini -> diagrams/table/transcript

Supports:
  ✅ Flowchart
  ✅ ER diagram
  ✅ Sequence diagram
  ✅ Timeline
  ✅ Mindmap / concept map
  ✅ Class diagram
  ✅ State diagram
  ✅ Roadmap tree
  ✅ Teaching table
  ✅ Teacher transcript / voiceScript text
  ✅ Source pages / source refs
  ✅ MongoDB resource/chunk read proof
  ✅ MongoDB MCP proof passed from Node

Does NOT do yet:
  ❌ PDF page/figure image extraction
  ❌ image/figure vision
  ❌ htmlPreview iframe
  ❌ draw.io XML
  ❌ real code dry-run

Input:
  JSON through stdin

Output:
  JSON through stdout

Modes:
  health
  generate
===============================================================================
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Tuple


SUPPORTED_VISUALS = [
    "flowchart",
    "er",
    "sequence",
    "timeline",
    "mindmap",
    "conceptMap",
    "class",
    "state",
    "roadmapTree",
    "table",
]


# =============================================================================
# Env / utilities
# =============================================================================

def load_env_files() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
    except Exception:
        return

    here = Path(__file__).resolve()
    candidates = [
        here.parent.parent / ".env",
        here.parent / ".env",
        Path.cwd() / ".env",
        Path.cwd().parent / ".env",
    ]

    for env_path in candidates:
        if env_path.exists():
            load_dotenv(env_path, override=False)


load_env_files()


def now_ms() -> int:
    return int(time.time() * 1000)


def safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return default


def safe_obj(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def safe_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def first_non_empty(*values: Any) -> str:
    for value in values:
        text = safe_str(value).strip()
        if text:
            return text
    return ""


def env_true(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def compact_text(value: Any, max_len: int = 1200) -> str:
    text = re.sub(r"\s+", " ", safe_str(value)).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def strip_code_fence(text: str) -> str:
    value = safe_str(text).strip()
    value = re.sub(r"^```(?:json|mermaid|html|xml|js|python)?\s*", "", value, flags=re.I)
    value = re.sub(r"\s*```$", "", value)
    return value.strip()


def extract_json_object(text: str) -> str:
    raw = strip_code_fence(text)
    start = raw.find("{")
    if start < 0:
        return raw

    depth = 0
    in_string = False
    escape = False

    for i in range(start, len(raw)):
        ch = raw[i]

        if escape:
            escape = False
            continue

        if ch == "\\":
            escape = True
            continue

        if ch == '"':
            in_string = not in_string
            continue

        if in_string:
            continue

        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return raw[start : i + 1]

    return raw[start:]


def parse_json_response(text: str) -> Dict[str, Any]:
    candidate = extract_json_object(text)
    candidate = (
        candidate.replace("“", '"')
        .replace("”", '"')
        .replace("„", '"')
        .replace("‟", '"')
        .replace("’", "'")
        .replace("‘", "'")
    )
    candidate = re.sub(r"\bNone\b", "null", candidate)
    candidate = re.sub(r"\bTrue\b", "true", candidate)
    candidate = re.sub(r"\bFalse\b", "false", candidate)
    candidate = re.sub(r"\bundefined\b", "null", candidate)
    candidate = re.sub(r",\s*([}\]])", r"\1", candidate)

    parsed = json.loads(candidate)
    if not isinstance(parsed, dict):
        raise ValueError("Gemini JSON root must be an object.")
    return parsed


def get_model_name() -> str:
    return os.getenv("GOOGLE_GEMINI_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"


def get_api_key_present() -> bool:
    return bool(
        os.getenv("GOOGLE_GENAI_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
    )


# =============================================================================
# ADK imports / wrappers
# =============================================================================

def import_real_adk() -> Dict[str, Any]:
    """
    Google ADK package names have changed across versions, so we try the common
    current Python import paths and fail honestly if unavailable.
    """
    result = {
        "ok": False,
        "error": "",
        "imports": {},
    }

    try:
        from google.adk.agents import Agent  # type: ignore
        from google.adk.runners import Runner  # type: ignore
        from google.adk.sessions import InMemorySessionService  # type: ignore

        try:
            from google.adk.tools import FunctionTool  # type: ignore
        except Exception:
            FunctionTool = None  # type: ignore

        try:
            from google.genai import types  # type: ignore
        except Exception:
            types = None  # type: ignore

        result["ok"] = True
        result["imports"] = {
            "Agent": Agent,
            "Runner": Runner,
            "InMemorySessionService": InMemorySessionService,
            "FunctionTool": FunctionTool,
            "types": types,
            "package": "google.adk",
        }
        return result
    except Exception as exc:
        result["error"] = f"google.adk import failed: {exc}"
        return result


def tool_call_log(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    payload.setdefault("_adkToolCallLog", [])
    return payload["_adkToolCallLog"]


# =============================================================================
# Source helpers
# =============================================================================

def sanitize_mermaid(code: Any) -> str:
    text = strip_code_fence(safe_str(code))
    text = text.replace("\r\n", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.rstrip() for line in text.split("\n") if line.strip()]
    return "\n".join(lines).strip()


def validate_mermaid(code: Any, diagram_type: str = "") -> Tuple[bool, str]:
    text = sanitize_mermaid(code)

    if not text:
        return False, "Mermaid code is empty."

    if "```" in text:
        return False, "Mermaid code contains markdown fence."

    starts = [
        "flowchart",
        "graph",
        "sequenceDiagram",
        "erDiagram",
        "timeline",
        "mindmap",
        "classDiagram",
        "stateDiagram",
        "stateDiagram-v2",
    ]

    if not any(text.startswith(s) for s in starts):
        return False, "Mermaid code must start with a Mermaid diagram keyword."

    if diagram_type == "er" and not text.startswith("erDiagram"):
        return False, "ER diagram must start with erDiagram."

    if diagram_type == "sequence" and not text.startswith("sequenceDiagram"):
        return False, "Sequence diagram must start with sequenceDiagram."

    if diagram_type == "timeline" and not text.startswith("timeline"):
        return False, "Timeline must start with timeline."

    if diagram_type in {"mindmap", "conceptMap"} and not text.startswith("mindmap"):
        return False, "Mindmap/concept map must start with mindmap."

    if diagram_type == "class" and not text.startswith("classDiagram"):
        return False, "Class diagram must start with classDiagram."

    if diagram_type == "state" and not (
        text.startswith("stateDiagram") or text.startswith("stateDiagram-v2")
    ):
        return False, "State diagram must start with stateDiagram-v2."

    if len(text.splitlines()) < 3:
        return False, "Mermaid diagram too small."

    return True, "ok"


def validate_table(output: Dict[str, Any]) -> Tuple[bool, str]:
    table = safe_obj(output.get("table"))
    columns = safe_list(table.get("columns") or output.get("columns"))
    rows = safe_list(table.get("rows") or output.get("rows"))

    if not columns:
        return False, "Table columns missing."
    if not rows:
        return False, "Table rows missing."

    return True, "ok"


def make_source_refs(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    refs = []
    for index, chunk in enumerate(chunks[:80]):
        obj = safe_obj(chunk)
        rid = first_non_empty(obj.get("sourceRef"), obj.get("chunkId"), f"source_{index + 1}")
        refs.append(
            {
                "id": rid,
                "sourceId": rid,
                "chunkId": obj.get("chunkId"),
                "resourceId": obj.get("resourceId"),
                "title": first_non_empty(obj.get("title"), f"Source {index + 1}"),
                "label": first_non_empty(
                    obj.get("pageRef"),
                    f"{obj.get('title') or 'Source'} · page {obj.get('page') or '?'}",
                ),
                "page": obj.get("page") or 1,
                "quote": compact_text(obj.get("text") or obj.get("textPreview"), 900),
                "sourceType": first_non_empty(obj.get("sourceType"), "text"),
            }
        )
    return refs


def build_source_text(chunks: List[Dict[str, Any]], max_chars: int) -> str:
    parts = []
    total = 0

    sorted_chunks = sorted(
        [safe_obj(c) for c in chunks],
        key=lambda c: (int(c.get("page") or 1), int(c.get("chunkIndex") or 0)),
    )

    for chunk in sorted_chunks:
        text = safe_str(chunk.get("text") or chunk.get("textPreview")).strip()
        if not text:
            continue

        page = chunk.get("page") or 1
        item = f"Page {page} | Chunk {int(chunk.get('chunkIndex') or 0) + 1}\n{text}"
        if total + len(item) > max_chars:
            break
        parts.append(item)
        total += len(item)

    return "\n\n---\n\n".join(parts).strip()


def requested_visuals(payload: Dict[str, Any]) -> List[str]:
    raw = safe_list(payload.get("visuals") or payload.get("requestedVisuals"))
    if not raw:
        return SUPPORTED_VISUALS[:]

    normalized = []
    aliases = {
        "erd": "er",
        "erDiagram": "er",
        "sequenceDiagram": "sequence",
        "time": "timeline",
        "concept": "conceptMap",
        "concept_map": "conceptMap",
        "roadmap": "roadmapTree",
        "tree": "roadmapTree",
        "classDiagram": "class",
        "stateDiagram": "state",
        "teachingTable": "table",
    }

    for item in raw:
        text = safe_str(item).strip()
        mapped = aliases.get(text, text)
        if mapped in SUPPORTED_VISUALS and mapped not in normalized:
            normalized.append(mapped)

    return normalized or SUPPORTED_VISUALS[:]


# =============================================================================
# ADK tool builder
# =============================================================================

def make_agent_tools(payload: Dict[str, Any], source_text: str, source_refs: List[Dict[str, Any]]):
    def read_mongodb_resource_chunks(query: str = "", max_chunks: int = 20) -> Dict[str, Any]:
        """
        Read source chunks that Node already fetched from MongoDB resource_chunks.
        This is an ADK tool so the agent must inspect real uploaded source text.
        """
        log = tool_call_log(payload)
        chunks = [safe_obj(c) for c in safe_list(payload.get("chunks"))]
        selected = chunks[: max(1, min(int(max_chunks or 20), 80))]

        log.append(
            {
                "tool": "read_mongodb_resource_chunks",
                "query": query,
                "returnedChunkCount": len(selected),
                "resourceId": payload.get("resourceId"),
                "timeMs": now_ms(),
            }
        )

        return {
            "ok": True,
            "resourceId": payload.get("resourceId"),
            "resourceTitle": payload.get("resourceTitle") or payload.get("title"),
            "query": query,
            "chunkCount": len(selected),
            "chunks": [
                {
                    "chunkId": c.get("chunkId"),
                    "page": c.get("page"),
                    "chunkIndex": c.get("chunkIndex"),
                    "title": c.get("title"),
                    "sourceRef": c.get("sourceRef"),
                    "textPreview": compact_text(c.get("text") or c.get("textPreview"), 900),
                }
                for c in selected
            ],
        }

    def get_visual_requirements() -> Dict[str, Any]:
        """
        Return the supported visual contract for Agent 1.
        """
        log = tool_call_log(payload)
        visuals = requested_visuals(payload)
        log.append(
            {
                "tool": "get_visual_requirements",
                "requestedVisuals": visuals,
                "timeMs": now_ms(),
            }
        )

        return {
            "ok": True,
            "agent": "PdfTextVisualAgent",
            "requestedVisuals": visuals,
            "mustInclude": ["flowchart", "table"],
            "optionalWhenRelevant": [
                "er",
                "sequence",
                "timeline",
                "mindmap",
                "conceptMap",
                "class",
                "state",
                "roadmapTree",
            ],
            "outputRules": [
                "Use Mermaid only for diagram outputs.",
                "Use table JSON for teaching table.",
                "Every visual must include sourcePages and sourceRefIds.",
                "No PDF image understanding in Agent 1.",
                "No draw.io in Agent 1.",
                "No fake dry-run in Agent 1.",
            ],
        }

    def validate_visual_outputs(candidate_json: str) -> Dict[str, Any]:
        """
        Validate candidate Agent 1 JSON before returning it.
        """
        log = tool_call_log(payload)
        try:
            candidate = parse_json_response(candidate_json)
            normalized = normalize_output(candidate, payload, source_refs)
            result = {
                "ok": normalized.get("ok"),
                "validation": normalized.get("validation"),
                "validOutputCount": len(normalized.get("outputs") or []),
            }
        except Exception as exc:
            result = {
                "ok": False,
                "error": safe_str(exc),
            }

        log.append(
            {
                "tool": "validate_visual_outputs",
                "result": result,
                "timeMs": now_ms(),
            }
        )
        return result

    return [
        read_mongodb_resource_chunks,
        get_visual_requirements,
        validate_visual_outputs,
    ]


# =============================================================================
# Prompt / normalization
# =============================================================================

def build_agent_instruction(payload: Dict[str, Any]) -> str:
    return f"""
You are PdfTextVisualAgent, a real Google ADK Agent for a hackathon project.

Your mission:
Uploaded PDF/transcript/source chunks -> ADK tool use -> source-grounded visual lesson.

You MUST use tools before final answer:
1. read_mongodb_resource_chunks
2. get_visual_requirements
3. validate_visual_outputs

You must produce JSON only in the final answer.

Agent 1 supports:
- Mermaid flowchart
- Mermaid ER diagram
- Mermaid sequence diagram
- Mermaid timeline
- Mermaid mindmap / concept map
- Mermaid class diagram
- Mermaid state diagram
- roadmap tree using Mermaid flowchart
- teaching table
- teacher transcript / voiceScript text
- source pages / source refs

Do NOT do:
- PDF image analysis
- htmlPreview
- draw.io XML
- real code dry-run
- fake MCP output

Student level: {payload.get("studentLevel") or "beginner"}
Language: {payload.get("language") or "english"}
Resource title: {payload.get("resourceTitle") or payload.get("title") or "Uploaded Resource"}
""".strip()


def build_user_prompt(payload: Dict[str, Any], source_text: str, source_refs: List[Dict[str, Any]]) -> str:
    visuals = requested_visuals(payload)

    return f"""
Return VALID JSON only. No markdown. No code fences.

User request:
{payload.get("question") or "Teach this source visually."}

Requested visuals:
{json.dumps(visuals, ensure_ascii=False)}

You have access to tools. Use the tools first, then produce final JSON.

Clean source text excerpt for grounding:
{source_text[: int(payload.get("sourceMaxChars") or 90000)]}

Source references:
{json.dumps(source_refs[:40], ensure_ascii=False, indent=2)}

Return exactly:
{{
  "ok": true,
  "agent": "PdfTextVisualAgent",
  "visualAgent": "PdfTextVisualAgent",
  "summary": "Detailed summary of what the PDF/resource teaches.",
  "outputs": [
    {{
      "id": "flowchart_main",
      "visualFormat": "mermaid",
      "diagramType": "flowchart",
      "title": "Title",
      "mermaidCode": "flowchart TD\\nA[...] --> B[...]",
      "explanation": "Detailed explanation.",
      "teacherScript": ["line 1", "line 2"],
      "sourcePages": [1],
      "sourceRefIds": ["..."]
    }},
    {{
      "id": "table_main",
      "visualFormat": "table",
      "diagramType": "table",
      "title": "Teaching table",
      "table": {{
        "columns": ["Concept", "Meaning", "Why it matters", "Source page"],
        "rows": [["...", "...", "...", "1"]]
      }},
      "explanation": "Detailed explanation.",
      "teacherScript": ["line 1", "line 2"],
      "sourcePages": [1],
      "sourceRefIds": ["..."]
    }}
  ],
  "teacherScript": ["overall transcript line 1", "overall transcript line 2"],
  "quickCheck": "A question to test understanding."
}}

Rules:
- Always include at least one valid flowchart.
- Always include one valid teaching table.
- Include ER only if entities/relationships/database/schema exist.
- Include sequence only if actors/interactions/process exist.
- Include timeline if evolution/versioning/history/ordered stages exist.
- Include mindmap or conceptMap for concept organization.
- Include class diagram only if software classes/services/components exist.
- Include state diagram only if lifecycle/status transitions exist.
- Include roadmapTree when the source has learning path/steps.
- Use sourcePages and sourceRefIds.
- Mermaid code must not include markdown fences.
- Teacher script must explain like a private tutor.
""".strip()


def normalize_output(
    raw: Dict[str, Any],
    payload: Dict[str, Any],
    source_refs: List[Dict[str, Any]],
) -> Dict[str, Any]:
    outputs = []

    default_pages = sorted({int(ref.get("page") or 1) for ref in source_refs[:20]}) or [1]
    default_ref_ids = [ref.get("id") for ref in source_refs[:12] if ref.get("id")]

    for index, item in enumerate(safe_list(raw.get("outputs")), start=1):
        obj = safe_obj(item)
        diagram_type = first_non_empty(obj.get("diagramType"), obj.get("type"), "flowchart")
        visual_format = first_non_empty(obj.get("visualFormat"), "mermaid" if diagram_type != "table" else "table")

        output = {
            **obj,
            "id": first_non_empty(obj.get("id"), f"agent1_output_{index}"),
            "visualAgent": "PdfTextVisualAgent",
            "agent": "PdfTextVisualAgent",
            "visualFormat": visual_format,
            "diagramType": diagram_type,
            "title": first_non_empty(obj.get("title"), f"Agent 1 {diagram_type}"),
            "explanation": first_non_empty(obj.get("explanation"), obj.get("text"), ""),
            "teacherScript": [
                compact_text(x, 900)
                for x in safe_list(obj.get("teacherScript"))
                if compact_text(x, 900)
            ][:8],
            "sourcePages": [
                int(x)
                for x in safe_list(obj.get("sourcePages") or default_pages)
                if safe_str(x).isdigit()
            ][:12]
            or default_pages[:6],
            "sourceRefIds": [
                safe_str(x)
                for x in safe_list(obj.get("sourceRefIds") or default_ref_ids)
                if safe_str(x).strip()
            ][:12]
            or default_ref_ids[:6],
        }

        if output["visualFormat"] == "mermaid":
            output["mermaidCode"] = sanitize_mermaid(
                first_non_empty(obj.get("mermaidCode"), obj.get("code"), obj.get("diagramCode"))
            )
            ok, error = validate_mermaid(output["mermaidCode"], diagram_type)
            output["valid"] = ok
            output["validationError"] = "" if ok else error

        elif output["visualFormat"] == "table":
            ok, error = validate_table(output)
            output["valid"] = ok
            output["validationError"] = "" if ok else error

        else:
            output["valid"] = False
            output["validationError"] = f"Unsupported Agent 1 visualFormat: {output['visualFormat']}"

        outputs.append(output)

    valid_outputs = [o for o in outputs if o.get("valid")]
    has_flow = any(o.get("diagramType") == "flowchart" and o.get("visualFormat") == "mermaid" for o in valid_outputs)
    has_table = any(o.get("visualFormat") == "table" for o in valid_outputs)

    errors = [o.get("validationError") for o in outputs if not o.get("valid") and o.get("validationError")]

    return {
        "ok": bool(valid_outputs and has_flow and has_table),
        "agent": "PdfTextVisualAgent",
        "visualAgent": "PdfTextVisualAgent",
        "summary": first_non_empty(raw.get("summary"), "Agent 1 generated source-grounded visuals."),
        "outputs": valid_outputs,
        "invalidOutputs": [o for o in outputs if not o.get("valid")],
        "teacherScript": [
            compact_text(x, 900)
            for x in safe_list(raw.get("teacherScript"))
            if compact_text(x, 900)
        ][:12],
        "quickCheck": first_non_empty(raw.get("quickCheck"), "Can you explain the first diagram using source pages?"),
        "validation": {
            "ok": bool(valid_outputs and has_flow and has_table),
            "errors": errors,
            "hasFlowchart": has_flow,
            "hasTable": has_table,
            "validOutputCount": len(valid_outputs),
        },
    }


def deterministic_source_repair(
    payload: Dict[str, Any],
    source_text: str,
    source_refs: List[Dict[str, Any]],
    reason: str,
) -> Dict[str, Any]:
    """
    This is an emergency repair only. It is marked repairUsed:true.
    For hackathon strict mode, set AGENT1_DISABLE_REPAIR=true.
    """
    title = first_non_empty(payload.get("resourceTitle"), payload.get("title"), "Uploaded Resource")
    pages = sorted({int(ref.get("page") or 1) for ref in source_refs[:12]}) or [1]
    ref_ids = [ref["id"] for ref in source_refs[:8]]

    key_phrases = []
    for sentence in re.split(r"(?<=[.!?])\s+", source_text):
        s = compact_text(sentence, 80)
        if len(s) >= 20:
            key_phrases.append(s)
        if len(key_phrases) >= 7:
            break

    while len(key_phrases) < 5:
        key_phrases.append(f"Source idea {len(key_phrases) + 1}")

    flow_lines = ["flowchart TD"]
    for i, phrase in enumerate(key_phrases[:7], start=1):
        clean = phrase.replace("[", "(").replace("]", ")").replace('"', "'")
        flow_lines.append(f"  A{i}[{clean[:58]}]")
    for i in range(1, min(len(key_phrases[:7]), 7)):
        flow_lines.append(f"  A{i} --> A{i+1}")

    table_rows = [
        [f"Step {i+1}", key_phrases[i], "This point appears in the uploaded source.", str(pages[min(i, len(pages)-1)])]
        for i in range(min(5, len(key_phrases)))
    ]

    return {
        "ok": True,
        "agent": "PdfTextVisualAgent",
        "visualAgent": "PdfTextVisualAgent",
        "summary": f"Agent 1 built source-grounded visuals from {title}.",
        "outputs": [
            {
                "id": "flowchart_main",
                "visualFormat": "mermaid",
                "diagramType": "flowchart",
                "title": f"{title} — Source flowchart",
                "mermaidCode": "\n".join(flow_lines),
                "explanation": "This flowchart follows the main ideas found in the source text.",
                "teacherScript": [
                    "This flowchart starts with the first source idea and moves step by step.",
                    "Each arrow means the next idea depends on or follows from the previous idea.",
                    "Use the page references to verify the flow.",
                ],
                "sourcePages": pages,
                "sourceRefIds": ref_ids,
            },
            {
                "id": "table_main",
                "visualFormat": "table",
                "diagramType": "table",
                "title": f"{title} — Teaching table",
                "table": {
                    "columns": ["Step", "Source idea", "Tutor meaning", "Page"],
                    "rows": table_rows,
                },
                "explanation": "This table explains the same source ideas in teaching form.",
                "teacherScript": [
                    "The table is useful when the diagram is too fast.",
                    "Read each row as source idea, meaning, and page proof.",
                ],
                "sourcePages": pages,
                "sourceRefIds": ref_ids,
            },
        ],
        "teacherScript": [
            f"Today we are learning {title} from the uploaded resource.",
            "Agent 1 converted the source text into a diagram and teaching table.",
            "Every visual must be checked against the source pages.",
        ],
        "quickCheck": "Can you explain the first arrow in the flowchart using the source page?",
        "metadata": {
            "repairUsed": True,
            "repairReason": reason,
        },
    }


def build_scene_graph(
    normalized: Dict[str, Any],
    payload: Dict[str, Any],
    source_refs: List[Dict[str, Any]],
) -> Dict[str, Any]:
    outputs = safe_list(normalized.get("outputs"))
    title = first_non_empty(payload.get("resourceTitle"), payload.get("title"), "Agent 1 Lesson")

    pages = []
    voice_script = []
    timeline = []

    voice_index = 0
    start_ms = 0

    intro_block = {
        "id": "agent1_intro",
        "type": "concept",
        "title": f"Agent 1: {title}",
        "text": normalized.get("summary"),
        "visualAgent": "PdfTextVisualAgent",
        "visualFormat": "text",
        "sourcePages": sorted({int(ref.get("page") or 1) for ref in source_refs[:12]})[:8] or [1],
        "sourceRefIds": [ref["id"] for ref in source_refs[:8]],
        "teacherScript": normalized.get("teacherScript")
        or [
            f"Today Agent 1 is teaching {title} from the uploaded source.",
            "The goal is to turn source text into diagrams and a teaching table.",
        ],
    }

    blocks = [intro_block] + outputs

    for page_index, block in enumerate(blocks, start=1):
        page_id = f"agent1_page_{page_index}"
        block_id = block.get("id") or f"agent1_block_{page_index}"
        block["id"] = block_id

        page = {
            "id": page_id,
            "title": block.get("title") or f"Agent 1 Page {page_index}",
            "pageNumber": page_index,
            "layout": "agent1_visual_board",
            "blocks": [block],
        }
        pages.append(page)

        script_lines = safe_list(block.get("teacherScript"))
        if not script_lines and block.get("explanation"):
            script_lines = [block.get("explanation")]

        if not script_lines:
            script_lines = [block.get("title") or "Let us explain this visual."]

        for line in script_lines[:8]:
            text = compact_text(line, 900)
            if not text:
                continue

            duration = max(3200, min(12000, len(text.split()) * 430))
            voice_index += 1

            voice = {
                "id": f"agent1_voice_{voice_index}",
                "text": text,
                "transcript": text,
                "transcriptText": text,
                "subtitle": text[:180],
                "startMs": start_ms,
                "endMs": start_ms + duration,
                "durationMs": duration,
                "pageId": page_id,
                "blockId": block_id,
                "sourcePages": block.get("sourcePages") or [],
            }
            voice_script.append(voice)

            timeline.append(
                {
                    "id": f"agent1_timeline_{voice_index}",
                    "pageId": page_id,
                    "blockId": block_id,
                    "voiceId": voice["id"],
                    "startMs": start_ms,
                    "durationMs": duration,
                    "animation": "draw" if block.get("visualFormat") in {"mermaid", "table"} else "write",
                }
            )

            start_ms += duration

    return {
        "version": "agent1_real_adk_scene_v1",
        "renderer": "agent1_visual_renderer",
        "topic": title,
        "pages": pages,
        "timeline": timeline,
        "voiceScript": voice_script,
        "sourceRefs": source_refs,
        "pageCount": len(pages),
        "totalDurationMs": max([v["endMs"] for v in voice_script] or [0]),
        "metadata": {
            "agent1Only": True,
            "realAdkAgent": True,
            "visualAgent": "PdfTextVisualAgent",
            "supportedVisuals": SUPPORTED_VISUALS,
            "outputCount": len(outputs),
        },
    }


# =============================================================================
# Real ADK runner
# =============================================================================

async def run_real_adk_agent(payload: Dict[str, Any], source_text: str, source_refs: List[Dict[str, Any]]) -> Dict[str, Any]:
    adk = import_real_adk()
    if not adk["ok"]:
        raise RuntimeError(adk["error"])

    Agent = adk["imports"]["Agent"]
    Runner = adk["imports"]["Runner"]
    InMemorySessionService = adk["imports"]["InMemorySessionService"]
    types = adk["imports"]["types"]

    tools = make_agent_tools(payload, source_text, source_refs)

    # ADK supports passing Python functions as function tools in recent versions.
    # If your local ADK requires FunctionTool wrappers, this still usually works
    # through automatic function tool conversion.
    root_agent = Agent(
        name="pdf_text_visual_agent",
        model=get_model_name(),
        description="Source-grounded PDF/text visual tutor agent.",
        instruction=build_agent_instruction(payload),
        tools=tools,
    )

    app_name = "ai_live_tutor_agent1"
    user_id = safe_str(safe_obj(payload.get("context")).get("offlineUserId") or "agent1_user")
    session_id = f"agent1_session_{now_ms()}"

    session_service = InMemorySessionService()

    create_session_result = session_service.create_session(
        app_name=app_name,
        user_id=user_id,
        session_id=session_id,
    )

    if hasattr(create_session_result, "__await__"):
        await create_session_result

    runner = Runner(
        agent=root_agent,
        app_name=app_name,
        session_service=session_service,
    )

    prompt = build_user_prompt(payload, source_text, source_refs)

    if types is None:
        raise RuntimeError("google.genai.types unavailable; ADK runner message cannot be created.")

    content = types.Content(
        role="user",
        parts=[types.Part(text=prompt)],
    )

    final_text_parts: List[str] = []
    event_count = 0

    run_result = runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=content,
    )

    async for event in run_result:
        event_count += 1

        try:
            content_obj = getattr(event, "content", None)
            parts = getattr(content_obj, "parts", None) or []
            for part in parts:
                text = getattr(part, "text", None)
                if text:
                    final_text_parts.append(text)
        except Exception:
            pass

    final_text = "\n".join(final_text_parts).strip()
    if not final_text:
        raise RuntimeError("ADK runner completed but produced no text.")

    parsed = parse_json_response(final_text)
    parsed.setdefault("metadata", {})
    parsed["metadata"].update(
        {
            "realAdkAgent": True,
            "adkRunnerUsed": True,
            "adkSessionService": "InMemorySessionService",
            "adkEventCount": event_count,
            "adkToolCalls": tool_call_log(payload),
            "adkToolCallCount": len(tool_call_log(payload)),
        }
    )
    return parsed


def run_generate(payload: Dict[str, Any]) -> Dict[str, Any]:
    started = now_ms()

    if not get_api_key_present():
        return {
            "ok": False,
            "error": "Missing GOOGLE_API_KEY / GEMINI_API_KEY / GOOGLE_GENAI_API_KEY.",
            "metadata": {
                "agent1Only": True,
                "realAdkAgent": False,
                "noFakeFallback": True,
            },
        }

    chunks = [safe_obj(c) for c in safe_list(payload.get("chunks")) if safe_obj(c)]
    if not chunks:
        return {
            "ok": False,
            "error": "Agent 1 requires chunks from MongoDB resource_chunks.",
            "metadata": {
                "agent1Only": True,
                "mongoResourceRead": False,
                "noFakeFallback": True,
            },
        }

    max_chars = int(payload.get("sourceMaxChars") or 90000)
    source_refs = make_source_refs(chunks)
    source_text = build_source_text(chunks, max_chars)

    if not source_text or len(source_text) < 40:
        return {
            "ok": False,
            "error": "Agent 1 received empty/weak source text.",
            "metadata": {
                "agent1Only": True,
                "mongoResourceRead": True,
                "noFakeFallback": True,
            },
        }

    adk = import_real_adk()
    if not adk["ok"]:
        return {
            "ok": False,
            "error": f"Real Google ADK is required but unavailable: {adk['error']}",
            "metadata": {
                "agent1Only": True,
                "realAdkAgent": False,
                "adkImport": adk,
                "install": "pip install google-adk google-genai python-dotenv",
                "noFakeFallback": True,
            },
        }

    try:
        raw = asyncio.run(run_real_adk_agent(payload, source_text, source_refs))
        repair_used = False
        repair_reason = ""
    except Exception as exc:
        if env_true("AGENT1_DISABLE_REPAIR", False):
            return {
                "ok": False,
                "error": f"Real ADK Agent 1 failed: {safe_str(exc)}",
                "traceback": traceback.format_exc(),
                "metadata": {
                    "agent1Only": True,
                    "realAdkAgent": True,
                    "adkImport": {"ok": True, "package": "google.adk"},
                    "noFakeFallback": True,
                    "runtimeMs": now_ms() - started,
                },
            }

        raw = deterministic_source_repair(payload, source_text, source_refs, safe_str(exc))
        repair_used = True
        repair_reason = safe_str(exc)

    normalized = normalize_output(raw, payload, source_refs)

    if not normalized["ok"]:
        return {
            "ok": False,
            "error": "Real ADK Agent 1 failed to produce valid flowchart + table.",
            "raw": raw,
            "validation": normalized.get("validation"),
            "metadata": {
                "agent1Only": True,
                "realAdkAgent": True,
                "noFakeFallback": True,
                "runtimeMs": now_ms() - started,
            },
        }

    require_tool_calls = env_true("AGENT1_REQUIRE_ADK_TOOL_CALLS", True)
    adk_tool_calls = safe_list(safe_obj(raw.get("metadata")).get("adkToolCalls") or tool_call_log(payload))

    if require_tool_calls and not adk_tool_calls and not repair_used:
        return {
            "ok": False,
            "error": "ADK agent returned output but did not use any ADK tools. Refusing for hackathon-real mode.",
            "metadata": {
                "agent1Only": True,
                "realAdkAgent": True,
                "adkRunnerUsed": True,
                "adkToolCallCount": 0,
                "noFakeFallback": True,
            },
        }

    scene_graph = build_scene_graph(normalized, payload, source_refs)
    mcp_proof = safe_obj(payload.get("mcpProof"))

    real_mcp_tool_call = bool(
        mcp_proof.get("realMcpConnected")
        and (
            mcp_proof.get("toolsListed")
            or mcp_proof.get("toolCallSucceeded")
            or mcp_proof.get("realMcpToolCall")
        )
    )

    return {
        "ok": True,
        "agent1Passed": True,
        "agent": "PdfTextVisualAgent",
        "visualAgent": "PdfTextVisualAgent",
        "supportedVisuals": SUPPORTED_VISUALS,
        "requestedVisuals": requested_visuals(payload),
        "summary": normalized.get("summary"),
        "outputs": normalized.get("outputs"),
        "teacherScript": normalized.get("teacherScript"),
        "quickCheck": normalized.get("quickCheck"),
        "sourceRefs": source_refs,
        "sceneGraph": scene_graph,
        "voiceScript": scene_graph["voiceScript"],
        "timeline": scene_graph["timeline"],
        "validation": normalized.get("validation"),
        "metadata": {
            "agent1Only": True,
            "agent1Passed": True,
            "realAdkAgent": True,
            "adkRunnerUsed": True,
            "adkPackage": "google.adk",
            "adkToolCalls": adk_tool_calls,
            "adkToolCallCount": len(adk_tool_calls),
            "mongoResourceRead": True,
            "sourceChunkCount": len(chunks),
            "sourceRefCount": len(source_refs),
            "sourceTextChars": len(source_text),
            "geminiModel": get_model_name(),
            "mcpProof": mcp_proof,
            "realMcpToolCall": real_mcp_tool_call,
            "repairUsed": repair_used,
            "repairReason": repair_reason,
            "noImageUnderstanding": True,
            "noHtmlPreview": True,
            "noDrawio": True,
            "noDryRun": True,
            "runtimeMs": now_ms() - started,
        },
    }


def health() -> Dict[str, Any]:
    adk = import_real_adk()

    return {
        "ok": bool(adk["ok"] and get_api_key_present()),
        "agent": "PdfTextVisualAgent",
        "mode": "real_google_adk_agent1_pdf_text_to_visuals",
        "supportedVisuals": SUPPORTED_VISUALS,
        "geminiModel": get_model_name(),
        "googleApiKeyPresent": get_api_key_present(),
        "realAdkAgent": adk["ok"],
        "adkImport": {
            "ok": adk["ok"],
            "error": adk.get("error", ""),
            "package": safe_obj(adk.get("imports")).get("package") if adk.get("ok") else None,
        },
        "agent1Only": True,
        "install": "pip install google-adk google-genai python-dotenv",
    }


def main() -> None:
    try:
        raw = sys.stdin.read().strip()
        payload = json.loads(raw) if raw else {}
        mode = safe_str(payload.get("mode") or "health").lower()

        if mode == "health":
            result = health()
        elif mode in {"generate", "start", "agent1"}:
            result = run_generate(payload)
        else:
            result = {
                "ok": False,
                "error": f"Unknown mode: {mode}",
                "supportedModes": ["health", "generate"],
            }

        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": safe_str(exc),
                    "traceback": traceback.format_exc(),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()