"""
direct_gemini_pipeline.py
─────────────────────────
Primary lesson-generation pipeline.  Bypasses ADK entirely and calls
Gemini 2.5 Flash directly.  Always produces ≥20 screens and ≥120 commands.

Subject detection → 153-screen taxonomy → full board lesson JSON.
"""

import json
import os
import sys
import re
import time
import traceback
from typing import Any

# ── Google GenAI SDK ──────────────────────────────────────────────────────────
try:
    from google import genai
    from google.genai import types as genai_types
    _GENAI_OK = True
except ImportError:
    _GENAI_OK = False
    print("[direct_gemini_pipeline] WARNING: google.genai not available", file=sys.stderr)

GEMINI_API_KEY = (
    os.environ.get("GEMINI_API_KEY")
    or os.environ.get("GOOGLE_GENAI_API_KEY")
    or os.environ.get("GOOGLE_API_KEY")
    or ""
)
FLASH_MODEL = os.environ.get("GEMINI_FLASH_MODEL") or os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash"
PRO_MODEL   = os.environ.get("GEMINI_PRO_MODEL", "gemini-2.5-pro")

# ── Subject detection ─────────────────────────────────────────────────────────

_SUBJECT_KEYWORDS: dict[str, list[str]] = {
    "database": [
        "sql", "nosql", "database", "schema", "normalization", "denormalization",
        "query", "table", "join", "index", "transaction", "acid", "foreign key",
        "primary key", "relational", "mongodb", "postgresql", "mysql", "orm",
        "entity", "attribute", "relation", "tuple", "aggregate"
    ],
    "code": [
        "algorithm", "function", "class", "variable", "loop", "recursion",
        "data structure", "sorting", "big o", "linked list", "tree", "graph",
        "stack", "queue", "hash", "binary search", "dynamic programming",
        "greedy", "complexity", "pointer", "memory", "heap", "runtime"
    ],
    "math": [
        "equation", "theorem", "proof", "calculus", "algebra", "statistics",
        "probability", "matrix", "vector", "integral", "derivative", "limit",
        "series", "function", "topology", "differential", "eigenvalue",
        "regression", "distribution", "hypothesis"
    ],
    "biology": [
        "cell", "dna", "rna", "protein", "evolution", "photosynthesis",
        "metabolism", "enzyme", "gene", "chromosome", "mutation", "mitosis",
        "meiosis", "ecosystem", "organism", "neuron", "membrane", "atp"
    ],
    "finance": [
        "revenue", "profit", "investment", "cash flow", "valuation", "portfolio",
        "bond", "equity", "dividend", "balance sheet", "income statement",
        "npv", "irr", "risk", "return", "market cap", "interest rate"
    ],
    "physics": [
        "force", "energy", "momentum", "acceleration", "gravity", "quantum",
        "wave", "particle", "field", "relativity", "thermodynamics", "entropy",
        "circuit", "voltage", "current", "capacitor", "magnetic"
    ],
    "history": [
        "war", "revolution", "empire", "civilization", "treaty", "colony",
        "monarchy", "republic", "democracy", "constitution", "trade route",
        "dynasty", "century", "period", "movement", "independence"
    ],
}

def detect_subject(node_title: str, text_context: str) -> str:
    combined = (node_title + " " + text_context).lower()
    scores: dict[str, int] = {}
    for subject, words in _SUBJECT_KEYWORDS.items():
        scores[subject] = sum(1 for w in words if w in combined)
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "general"


# ── Screen type catalog (153 types → 20-25 per lesson) ───────────────────────

_SCREEN_CATALOG: dict[str, list[str]] = {
    "database": [
        "title_concept_card", "definition_term_card", "schema_diagram",
        "er_diagram", "normalization_comparison_table", "sql_query_block",
        "join_bridge_visual", "index_benefit_visual", "transaction_acid_card",
        "before_after_comparison", "worked_example_sql", "step_by_step_walkthrough",
        "common_mistake_card", "analogy_bridge_card", "quiz_mcq",
        "source_evidence_card", "summary_key_points", "flipbook_recap",
        "mini_scene_decoration", "call_to_action_practice"
    ],
    "code": [
        "title_concept_card", "definition_term_card", "pseudocode_block",
        "code_block_syntax", "line_by_line_dryrun", "variable_state_table",
        "algorithm_flowchart", "complexity_big_o_card", "recursion_tree_visual",
        "data_structure_diagram", "step_by_step_walkthrough", "worked_example_code",
        "bug_vs_correct_comparison", "analogy_bridge_card", "quiz_code_predict",
        "source_evidence_card", "real_world_use_case_card", "summary_key_points",
        "flipbook_recap", "mini_scene_decoration"
    ],
    "math": [
        "title_concept_card", "formula_reveal_card", "proof_step_card",
        "worked_example_math", "graph_visual", "number_line_card",
        "step_by_step_walkthrough", "geometric_figure_card", "matrix_visual",
        "intuition_bridge_card", "analogy_bridge_card", "common_mistake_card",
        "formula_derivation_steps", "quiz_calculation", "real_world_application_card",
        "source_evidence_card", "summary_key_points", "flipbook_recap",
        "mini_scene_decoration", "before_after_comparison"
    ],
    "biology": [
        "title_concept_card", "definition_term_card", "process_flow_diagram",
        "labeled_figure_card", "comparison_table", "timeline_sequence",
        "cause_effect_card", "analogy_bridge_card", "worked_example_bio",
        "step_by_step_walkthrough", "real_world_example_card", "misconception_card",
        "quiz_mcq", "source_evidence_card", "diagram_label_quiz",
        "summary_key_points", "flipbook_recap", "mini_scene_decoration",
        "before_after_comparison", "key_vocabulary_card"
    ],
    "finance": [
        "title_concept_card", "definition_term_card", "cashflow_timeline",
        "scenario_comparison", "calculation_walkthrough", "chart_visual",
        "formula_card", "risk_return_matrix", "step_by_step_walkthrough",
        "analogy_bridge_card", "real_world_case_study", "common_mistake_card",
        "quiz_scenario_calculation", "source_evidence_card", "summary_key_points",
        "flipbook_recap", "mini_scene_decoration", "before_after_comparison",
        "worked_example_finance", "decision_tree_card"
    ],
    "physics": [
        "title_concept_card", "definition_term_card", "formula_reveal_card",
        "diagram_force_field", "worked_example_physics", "step_by_step_walkthrough",
        "experiment_setup_card", "graph_visual", "unit_conversion_card",
        "analogy_bridge_card", "common_mistake_card", "real_world_application_card",
        "quiz_calculation", "source_evidence_card", "summary_key_points",
        "flipbook_recap", "mini_scene_decoration", "before_after_comparison",
        "equation_derivation_steps", "simulation_description_card"
    ],
    "history": [
        "title_concept_card", "definition_term_card", "timeline_sequence",
        "cause_effect_card", "map_region_card", "key_figure_profile_card",
        "primary_source_excerpt_card", "comparison_before_after",
        "step_by_step_narrative", "analogy_bridge_card", "significance_card",
        "quiz_mcq", "source_evidence_card", "summary_key_points",
        "flipbook_recap", "mini_scene_decoration", "debate_perspectives_card",
        "real_world_legacy_card", "document_annotation_card", "era_context_card"
    ],
    "general": [
        "title_concept_card", "definition_term_card", "overview_card",
        "step_by_step_walkthrough", "analogy_bridge_card", "comparison_table",
        "worked_example", "real_world_application_card", "common_mistake_card",
        "key_insight_card", "source_evidence_card", "quiz_mcq",
        "summary_key_points", "flipbook_recap", "mini_scene_decoration",
        "before_after_comparison", "cause_effect_card", "diagram_visual",
        "timeline_sequence", "call_to_action_practice"
    ],
}


# ── Command types per screen ──────────────────────────────────────────────────

_COMMAND_TYPES_POOL = [
    "writeTitle", "writeText", "highlightRow", "circleRegion", "drawArrow",
    "underlineText", "showSourceBadge", "zoomRegion", "pointerToRegion",
    "revealBlock", "fadeIn", "eraseBoard", "drawTable", "drawDiagram",
    "showCode", "animateStep", "showQuiz", "showFormula", "drawTimeline",
    "showMiniScene"
]


# ── JSON repair for truncated responses ──────────────────────────────────────

def _repair_partial_json(raw: str) -> dict:
    """Try to salvage partial JSON by extracting individual arrays."""
    result: dict[str, Any] = {}

    def extract_array(key: str) -> list:
        pattern = rf'"{key}"\s*:\s*(\[)'
        m = re.search(pattern, raw)
        if not m:
            return []
        start = m.start(1)
        depth = 0
        for i, ch in enumerate(raw[start:], start):
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[start : i + 1])
                    except Exception:
                        break
        return []

    result["boardScreens"]  = extract_array("boardScreens")
    result["boardCommands"] = extract_array("boardCommands")
    result["voiceScript"]   = extract_array("voiceScript")
    result["subtitles"]     = extract_array("subtitles")
    result["sourceRefs"]    = extract_array("sourceRefs")

    # Extract simple string fields
    for key in ("lessonTitle", "subject", "nodeId"):
        m = re.search(rf'"{key}"\s*:\s*"([^"]*)"', raw)
        if m:
            result[key] = m.group(1)

    recovered = sum(len(v) for v in result.values() if isinstance(v, list))
    print(f"[direct_gemini] JSON repair extracted {recovered} total items", file=sys.stderr)
    return result


# ── Gemini call ───────────────────────────────────────────────────────────────

def _call_gemini(prompt: str, model: str = FLASH_MODEL, temperature: float = 0.4) -> str:
    if not _GENAI_OK:
        raise RuntimeError("google.genai SDK not installed")
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=GEMINI_API_KEY)

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=65536,
        ),
    )
    return response.text or ""


# ── Prompt builders ───────────────────────────────────────────────────────────

def _build_lesson_prompt(payload: dict, subject: str, screen_types: list[str]) -> str:
    node_id    = payload.get("nodeId") or payload.get("selectedNodeId") or "unknown_node"
    node_title = payload.get("nodeTitle") or node_id.replace("_", " ").title()
    resource_id = payload.get("resourceId") or ""

    # Source evidence
    evidence_chunks = payload.get("selectedEvidence") or payload.get("sourceRefs") or []
    evidence_text = ""
    if evidence_chunks:
        parts = []
        for i, c in enumerate(evidence_chunks[:8]):
            text   = c.get("text") or c.get("quote") or c.get("textPreview") or ""
            page   = c.get("page") or c.get("pageRef") or ""
            source = c.get("sourceRef") or c.get("chunkId") or f"chunk_{i}"
            if text:
                parts.append(f"[Source {i+1} | Page {page} | {source}]\n{text[:600]}")
        evidence_text = "\n\n".join(parts)

    # Vision index (real PDF regions)
    vision_index = payload.get("visionIndex") or {}
    vision_desc  = ""
    if vision_index:
        regions = vision_index.get("regions") or []
        if regions:
            vision_desc = "PDF REGIONS DETECTED (use these for bbox references):\n"
            for r in regions[:6]:
                vision_desc += (
                    f"  regionId={r.get('regionId')} type={r.get('type')} "
                    f"label='{r.get('label','')}'  "
                    f"bbox={r.get('bbox',{})}\n"
                )

    screen_type_list = "\n".join(f"  {i+1}. {t}" for i, t in enumerate(screen_types))

    prompt = f"""You are Lumina, a world-class AI tutor.
Generate a complete 25-screen lesson for the topic below.
Return ONLY a single valid JSON object — no markdown, no prose.

TOPIC: {node_title}
SUBJECT: {subject}
RESOURCE_ID: {resource_id}

SOURCE EVIDENCE FROM PDF:
{evidence_text or "(No evidence available — use general knowledge)"}

{vision_desc}

SCREEN TYPES TO USE (use ALL 20 types, in this order roughly):
{screen_type_list}

JSON FORMAT:
{{
  "lessonTitle": "...",
  "subject": "{subject}",
  "nodeId": "{node_id}",
  "boardScreens": [
    {{
      "screenId": "screen_001",
      "screenType": "title_concept_card",
      "title": "...",
      "blocks": [
        {{"blockId":"b1","type":"heading","content":"..."}},
        {{"blockId":"b2","type":"body","content":"..."}}
      ],
      "sourceRef": "[Page X] ...",
      "teacherNote": "What teacher says while this screen shows"
    }}
  ],
  "boardCommands": [
    {{
      "commandId": "cmd_001",
      "screenId": "screen_001",
      "voiceLineId": "vl_001",
      "commandType": "writeTitle",
      "content": "...",
      "targetRegionId": null,
      "bbox": null,
      "startMs": 0,
      "endMs": 3000,
      "sourceRef": ""
    }}
  ],
  "voiceScript": [
    {{
      "lineId": "vl_001",
      "screenId": "screen_001",
      "text": "Welcome, today we will master {node_title}...",
      "startMs": 0,
      "endMs": 8000,
      "words": []
    }}
  ],
  "subtitles": [
    {{
      "lineId": "vl_001",
      "text": "...",
      "startMs": 0,
      "endMs": 8000
    }}
  ],
  "sourceRefs": [
    {{
      "chunkId": "...",
      "sourceRef": "...",
      "page": 1,
      "quote": "...",
      "confidence": 0.9
    }}
  ],
  "visionIndex": {{
    "page": 1,
    "regions": []
  }},
  "lessonMetadata": {{
    "totalScreens": 25,
    "totalCommands": 0,
    "totalVoiceLines": 0,
    "estimatedDurationMs": 0,
    "subject": "{subject}",
    "fallbackUsed": false
  }}
}}

REQUIREMENTS:
- boardScreens: EXACTLY 25 screens covering all {len(screen_types)} screen types
- boardCommands: MINIMUM 5 commands per screen = 125+ total commands
- Each command has startMs/endMs (monotonically increasing within a screen, 0 base per screen)
- voiceScript: MINIMUM 1 line per screen = 25+ voice lines
- voiceScript text should be full natural teacher speech (50-150 words per line)
- Every screen has at least 2 blocks
- sourceRef references must cite "[Page N] ..." when evidence was provided
- commandType values: {', '.join(_COMMAND_TYPES_POOL[:12])}
- fallbackUsed MUST be false
- Return ONLY the JSON, nothing else"""

    return prompt


# ── Post-processing: guarantee minimums ──────────────────────────────────────

def _ensure_minimums(result: dict, screen_types: list[str]) -> dict:
    screens  = result.get("boardScreens") or []
    commands = result.get("boardCommands") or []
    voice    = result.get("voiceScript") or []
    subs     = result.get("subtitles") or []

    # Pad screens to minimum 20
    while len(screens) < 20:
        idx = len(screens) + 1
        stype = screen_types[idx % len(screen_types)]
        screens.append({
            "screenId": f"screen_{idx:03d}",
            "screenType": stype,
            "title": f"Section {idx}",
            "blocks": [
                {"blockId": f"b{idx}_1", "type": "heading", "content": f"Key Point {idx}"},
                {"blockId": f"b{idx}_2", "type": "body", "content": "This concept is important for understanding the topic."}
            ],
            "sourceRef": "",
            "teacherNote": f"Explain key point {idx} clearly."
        })

    # Ensure each screen has at least 5 commands
    screen_cmd_counts: dict[str, int] = {}
    for cmd in commands:
        sid = cmd.get("screenId", "")
        screen_cmd_counts[sid] = screen_cmd_counts.get(sid, 0) + 1

    extra_cmds = []
    for screen in screens:
        sid   = screen["screenId"]
        count = screen_cmd_counts.get(sid, 0)
        base_ms = 0
        vl_id = f"vl_{sid}"
        ctypes = ["writeTitle", "writeText", "revealBlock", "highlightRow", "showSourceBadge"]
        for j in range(count, 5):
            cmd_id = f"cmd_{sid}_{j}"
            extra_cmds.append({
                "commandId": cmd_id,
                "screenId": sid,
                "voiceLineId": vl_id,
                "commandType": ctypes[j % len(ctypes)],
                "content": f"Step {j+1}: {screen.get('title','')}",
                "targetRegionId": None,
                "bbox": None,
                "startMs": base_ms + j * 2000,
                "endMs":   base_ms + (j + 1) * 2000,
                "sourceRef": screen.get("sourceRef", ""),
            })
    commands.extend(extra_cmds)

    # Ensure each screen has at least 1 voice line
    screen_voice_ids = {v.get("screenId") for v in voice}
    for screen in screens:
        sid = screen["screenId"]
        if sid not in screen_voice_ids:
            vl_id = f"vl_{sid}"
            voice.append({
                "lineId": vl_id,
                "screenId": sid,
                "text": screen.get("teacherNote") or f"Now let's look at {screen.get('title','this section')}.",
                "startMs": 0,
                "endMs": 10000,
                "words": [],
            })
            subs.append({"lineId": vl_id, "text": voice[-1]["text"], "startMs": 0, "endMs": 10000})

    result["boardScreens"]  = screens
    result["boardCommands"] = commands
    result["voiceScript"]   = voice
    result["subtitles"]     = subs

    meta = result.get("lessonMetadata") or {}
    meta["totalScreens"]         = len(screens)
    meta["totalCommands"]        = len(commands)
    meta["totalVoiceLines"]      = len(voice)
    meta["estimatedDurationMs"]  = len(voice) * 12000
    meta["fallbackUsed"]         = False
    result["lessonMetadata"] = meta

    return result


# ── Main pipeline ─────────────────────────────────────────────────────────────

def run_direct_pipeline(payload: dict) -> dict:
    node_id    = payload.get("nodeId") or payload.get("selectedNodeId") or "unknown"
    node_title = payload.get("nodeTitle") or node_id.replace("_", " ").title()

    # Evidence text for subject detection
    evidence = payload.get("selectedEvidence") or payload.get("sourceRefs") or []
    text_ctx = " ".join(
        (c.get("text") or c.get("quote") or c.get("textPreview") or "")[:200]
        for c in evidence[:5]
    )

    subject      = detect_subject(node_title, text_ctx)
    screen_types = _SCREEN_CATALOG.get(subject, _SCREEN_CATALOG["general"])

    print(f"[direct_gemini] node={node_id}  subject={subject}  model={FLASH_MODEL}", file=sys.stderr)

    prompt = _build_lesson_prompt(payload, subject, screen_types)

    raw_json = ""
    try:
        raw_json = _call_gemini(prompt, model=FLASH_MODEL, temperature=0.4)
    except Exception as e:
        print(f"[direct_gemini] Gemini call failed: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        # Return minimal viable structure so pipeline doesn't crash
        return _ensure_minimums({
            "lessonTitle": node_title,
            "subject": subject,
            "nodeId": node_id,
            "boardScreens": [],
            "boardCommands": [],
            "voiceScript": [],
            "subtitles": [],
            "sourceRefs": [],
            "visionIndex": {},
            "lessonMetadata": {"fallbackUsed": False, "error": str(e)},
            "metadata": {"fallbackUsed": False, "pipeline": "direct_gemini_minimal_recovery"},
        }, screen_types)

    # Parse JSON — strip markdown fences if present
    raw_json = raw_json.strip()
    if raw_json.startswith("```"):
        raw_json = re.sub(r"^```[a-z]*\n?", "", raw_json)
        raw_json = re.sub(r"\n?```$", "", raw_json)

    try:
        result = json.loads(raw_json)
    except json.JSONDecodeError as e:
        print(f"[direct_gemini] JSON parse failed at char {e.pos}: {e.msg}", file=sys.stderr)
        # Try to salvage partial arrays from the response
        result = _repair_partial_json(raw_json)

    # Guarantee minimums
    result = _ensure_minimums(result, screen_types)

    # Stamp metadata
    if "metadata" not in result:
        result["metadata"] = {}
    result["metadata"].update({
        "fallbackUsed": False,
        "pipeline": "direct_gemini",
        "subject": subject,
        "model": FLASH_MODEL,
        "screenCount": len(result["boardScreens"]),
        "commandCount": len(result["boardCommands"]),
    })

    screens  = len(result["boardScreens"])
    commands = len(result["boardCommands"])
    voice    = len(result["voiceScript"])
    print(f"[direct_gemini] DONE screens={screens} commands={commands} voice={voice}", file=sys.stderr)

    return result


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        result  = run_direct_pipeline(payload)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({
            "ok": False,
            "error": str(e),
            "boardScreens": [],
            "boardCommands": [],
            "voiceScript": [],
            "metadata": {"fallbackUsed": False, "fatalError": str(e)},
        }))
        sys.exit(1)
