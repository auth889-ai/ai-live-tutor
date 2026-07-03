"""
google_agent/planning/teachers/base_domain_teacher.py
===============================================================================
BASE DOMAIN TEACHER — Gemini Pro + Thinking, MULTIMODAL (Step 5, Stage A).

This is the lesson ARCHITECT. It does NOT make final screens or 100 commands.
It SEES the real PDF page images + the rich vision reading of every page + all
sources, then produces a source-grounded LessonContract describing WHAT to teach,
in WHICH mode, against WHICH real regions — for a world-class board lesson where
the teacher speaks + writes + points at the right thing at the right time.

Key design (matches docs/TEACHER_BOARD_SYSTEM_DESIGN.md):
  - Multimodal: the teacher actually sees the page images (images come FROM the
    PDF, never generated). It also receives vision's exhaustive per-page reading.
  - Two modes per screen: PREBUILT_SCREEN (point/spotlight on the page + notes)
    and REALTIME_WRITING (draw/write live while speaking).
  - Every visual explanation binds to real regionIds; every fact to sourceRefs.
  - Output = LessonContract (consumed downstream by SegmentGenerator →
    BoardTimelineAgent → VoiceScript → frontend ActionEngine).
  - NO fake fallback. Validators fail or repair (one repair re-prompt), never
    inject placeholder content.

Each of the 8 domain teachers extends this and sets:
  - domain, agent_name
  - screen_families, teaching_sequence, hook_opening   (context for the prompt)
  - domain_addon_prompt                                (rich domain-specific rules)
===============================================================================
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any, Dict, List, Optional

try:
    from ...live_tutor_agents.contracts import (
        AgentContext, AgentResult, JsonDict, ValidationResult,
        clean_text, safe_dict, safe_list,
    )
    from ...pipeline.gemini_structured import (
        PRO_MODEL, generate_structured_async, GeminiStructuredError,
    )
    from ...source.vision_safety_net import _load_image_bytes
except ImportError:  # pragma: no cover
    from google_agent.live_tutor_agents.contracts import (  # type: ignore
        AgentContext, AgentResult, JsonDict, ValidationResult,
        clean_text, safe_dict, safe_list,
    )
    from google_agent.pipeline.gemini_structured import (  # type: ignore
        PRO_MODEL, generate_structured_async, GeminiStructuredError,
    )
    from google_agent.source.vision_safety_net import _load_image_bytes  # type: ignore

try:
    from google.genai import types as genai_types
    _GENAI_OK = True
except ImportError:  # pragma: no cover
    genai_types = None
    _GENAI_OK = False

# Multi-agent teacher (A3): real ADK runtime + proven architect + shared context.
try:
    from ...pipeline.adk_runtime import run_adk_agent, adk_available, AdkRuntimeError
    from .lesson_architect import LessonArchitectAgent
    from . import teacher_context as tc
except ImportError:  # pragma: no cover
    from google_agent.pipeline.adk_runtime import (  # type: ignore
        run_adk_agent, adk_available, AdkRuntimeError,
    )
    from google_agent.planning.teachers.lesson_architect import LessonArchitectAgent  # type: ignore
    from google_agent.planning.teachers import teacher_context as tc  # type: ignore


# ─────────────────────────────────────────────────────────────────────────────
# Adaptive lesson size
# ─────────────────────────────────────────────────────────────────────────────

# Every concept gets a substantial lesson — minimum 30 minutes, richer for beginners.
LEVEL_RANGE = {
    "beginner":     {"minMinutes": 45, "maxMinutes": 120, "screensMin": 90, "screensMax": 160},
    "intermediate": {"minMinutes": 35, "maxMinutes": 80,  "screensMin": 50, "screensMax": 95},
    "advanced":     {"minMinutes": 30, "maxMinutes": 55,  "screensMin": 30, "screensMax": 55},
}

BOARD_MODES = ["PREBUILT_SCREEN", "REALTIME_WRITING"]

TEMPLATES = [
    "source_focus", "definition_board", "workflow_explainer", "diagram_explainer",
    "code_example", "sql_code_example", "dry_run_table", "comparison_table",
    "formula_explainer", "graph_explainer", "step_solution", "process_flow",
    "timeline_board", "argument_map", "scenario_board", "mistake_repair",
    "practice_question", "recap_board",
]

VISUAL_ACTIONS = [
    "movePointer", "spotlight", "highlight", "circle", "underline", "zoomRegion",
    "writeText", "writeCode", "writeSQL", "writeFormula", "drawArrow", "drawBox",
    "drawTable", "drawChart", "drawGraph", "drawTimeline", "drawCycle", "drawLatex",
    "labelDiagram", "traceConnection",
]


# ─────────────────────────────────────────────────────────────────────────────
# LessonContract schema (OpenAPI subset)
# ─────────────────────────────────────────────────────────────────────────────

# A board element the AI designs DYNAMICALLY for THIS page's content.
# elementType is a free string the model chooses (pdf_page_image, source_quote_highlight,
# sql_dry_run, comparison_table, progressive_practice_set, ...) — never a fixed menu.
_ELEMENT = {
    "type": "object",
    "properties": {
        "elementType":  {"type": "string",
                         "description": "the kind of board element, chosen dynamically for this content "
                                        "(e.g. pdf_page_image, source_quote_highlight, key_points_card, "
                                        "table, code_block, sql_dry_run, worked_example, comparison_table, "
                                        "progressive_practice_set, common_mistake_box, notes_panel, ...)"},
        "contentBrief": {"type": "string",
                         "description": "exactly what this element will contain — concrete and detailed, "
                                        "drawn from the real page (Stage C fills the full content)"},
        "regionId":     {"type": "string", "description": "real PDF region this element shows/points at, if visual"},
        "sourceRef":    {"type": "string"},
        "needsSandbox": {"type": "boolean",
                         "description": "true if this element needs real code/SQL execution to show a dry-run trace"},
        "levelTier":    {"type": "string", "enum": ["weak", "core", "stretch", "all"],
                         "description": "which students this element is for"},
    },
    "required": ["elementType", "contentBrief"],
}

_SCREEN_PLAN = {
    "type": "object",
    "properties": {
        "screenId":          {"type": "string"},
        "mode":              {"type": "string", "enum": BOARD_MODES},
        "template":          {"type": "string"},
        "mainIdea":          {"type": "string", "description": "the ONE clear idea this screen teaches"},
        "elements":          {"type": "array", "items": _ELEMENT,
                              "description": "the rich board elements this screen is built from (dynamic)"},
        "requiredRegionIds": {"type": "array", "items": {"type": "string"},
                              "description": "real visionIndex regionIds this screen points at / explains"},
        "sourceRefs":        {"type": "array", "items": {"type": "string"},
                              "description": "page/chunk refs this screen is grounded in"},
        "teacherIntent":     {"type": "string"},
        "levelCoverage":     {"type": "object", "properties": {
                                  "weak":    {"type": "string", "description": "extra scaffold for weak students"},
                                  "core":    {"type": "string", "description": "the core explanation"},
                                  "stretch": {"type": "string", "description": "extension for strong students"}}},
        "visualActionsNeeded": {"type": "array", "items": {"type": "string", "enum": VISUAL_ACTIONS}},
        "studentBenefit":    {"type": "string"},
    },
    "required": ["screenId", "mode", "template", "mainIdea", "elements", "requiredRegionIds", "teacherIntent"],
}

_VOICE_PLAN = {
    "type": "object",
    "properties": {
        "voiceLineIntent": {"type": "string",
                            "enum": ["introduce", "point_source", "explain", "write",
                                     "draw", "example", "ask", "repair", "recap"]},
        "textGoal":        {"type": "string", "description": "what the teacher will SAY here (human, atomic, one idea)"},
        "targetRegionIds": {"type": "array", "items": {"type": "string"}},
        "targetElementIds":{"type": "array", "items": {"type": "string"}},
        "sourceRefs":      {"type": "array", "items": {"type": "string"}},
        "boardActions":    {"type": "array", "items": {"type": "string", "enum": VISUAL_ACTIONS}},
    },
    "required": ["voiceLineIntent", "textGoal"],
}

_SEGMENT = {
    "type": "object",
    "properties": {
        "segmentId":   {"type": "string"},
        "title":       {"type": "string"},
        "durationMs":  {"type": "number"},
        "learningGoal":{"type": "string"},
        "modeMix":     {"type": "object", "properties": {
                            "prebuiltScreenPercent": {"type": "number"},
                            "realtimeWritingPercent": {"type": "number"}}},
        "screenPlan":      {"type": "array", "items": _SCREEN_PLAN},
        "teacherVoicePlan":{"type": "array", "items": _VOICE_PLAN},
        "practicePlan":    {"type": "array", "items": {"type": "object", "properties": {
                                "question": {"type": "string"},
                                "answer":   {"type": "string"},
                                "sourceRefs": {"type": "array", "items": {"type": "string"}},
                                "fromWebSearch": {"type": "boolean"}}}},
        "misconceptions":  {"type": "array", "items": {"type": "string"}},
        "qualityChecks":   {"type": "array", "items": {"type": "string"}},
    },
    "required": ["segmentId", "title", "learningGoal", "screenPlan", "teacherVoicePlan"],
}

LESSON_CONTRACT_SCHEMA: JsonDict = {
    "type": "object",
    "properties": {
        "domain":         {"type": "string"},
        "nodeId":         {"type": "string"},
        "title":          {"type": "string"},
        "studentLevel":   {"type": "string"},
        "targetMinutes":  {"type": "number"},
        "teachingThesis": {"type": "string", "description": "the big idea the whole lesson proves"},
        "learningGoals":  {"type": "array", "items": {"type": "string"}},
        "prerequisites":  {"type": "array", "items": {"type": "string"}},
        "sourceUsePlan":  {"type": "object", "properties": {
                              "primaryPages":     {"type": "array", "items": {"type": "number"}},
                              "primaryRegionIds": {"type": "array", "items": {"type": "string"}},
                              "mustUseSourceRefs":{"type": "array", "items": {"type": "string"}}}},
        "segments":       {"type": "array", "items": _SEGMENT},
        "externalResources": {"type": "object", "properties": {
            "searchQueries": {"type": "array", "items": {"type": "string"},
                              "description": "search queries (you write these dynamically) to find famous-university "
                                             "questions, reference sites, and YouTube videos on this exact concept"},
            "practiceQuestions": {"type": "array", "items": {"type": "object", "properties": {
                "question": {"type": "string"}, "answer": {"type": "string"},
                "source": {"type": "string"}, "url": {"type": "string"},
                "difficulty": {"type": "string"}}},
                "description": "filled by the WebResourceAgent from real search results"},
            "referenceSites": {"type": "array", "items": {"type": "object", "properties": {
                "title": {"type": "string"}, "url": {"type": "string"}}}},
            "youtubeVideos": {"type": "array", "items": {"type": "object", "properties": {
                "title": {"type": "string"}, "url": {"type": "string"}, "channel": {"type": "string"}}}},
        }},
        "boardTimelineRequirements": {"type": "object", "properties": {
                              "everyVoiceLineNeedsSourceOrTeachingIntent": {"type": "boolean"},
                              "everyLookHereNeedsRegionId": {"type": "boolean"},
                              "everyCommandNeedsVoiceLineId": {"type": "boolean"},
                              "everyPointerNeedsRegionOrElement": {"type": "boolean"}}},
        "qualityProof":   {"type": "object", "properties": {
                              "usesVisionDom": {"type": "boolean"},
                              "usesSourceRefs": {"type": "boolean"},
                              "hasTwoModes": {"type": "boolean"},
                              "explainsEveryPage": {"type": "boolean"},
                              "noFakeFallback": {"type": "boolean"}}},
    },
    "required": ["domain", "nodeId", "title", "teachingThesis", "learningGoals", "segments"],
}


# ─────────────────────────────────────────────────────────────────────────────
# Base prompt (shared by every domain teacher)
# ─────────────────────────────────────────────────────────────────────────────

BASE_DOMAIN_TEACHER_PROMPT = """You are a WORLD-CLASS multimodal AI tutor and lesson architect.

You do NOT create random slides. You design a source-grounded LessonContract that will
later be converted into a live board lesson where ONE AI teacher SPEAKS, WRITES, and
POINTS at the right thing at the right time — like the best human teacher on a real board.

WHAT YOU ARE LOOKING AT:
- The ACTUAL PDF page images of the concept the student clicked (attached to this message).
  These images come FROM the PDF — they are never generated. Your lesson shows THESE pages
  on the board and the teacher points at parts of them.
- A detailed VISION READING of every page (titles, summaries, step-by-step teaching
  narrative, and every region with verbatim content + diagram relationships).
- The source evidence (selected chunks, same/nearby pages, RAG hits), full PDF summary,
  and full PDF outline.

YOUR MISSION:
Plan a LARGE, DEEP, world-class lesson (at least the target minutes — typically 30+ for one
concept) that EXPLAINS EVERYTHING ON THESE PAGES — every line of text AND every diagram /
table / formula / code — step by step, so a WEAK, an AVERAGE, AND a STRONG student all fully
understand. This is NOT chat-style text: it is a real board lesson built from rich ELEMENTS.

DEPTH (why it must be large): a 30+ minute lesson needs many segments, many screens, many
atomic voice lines, several worked examples, and LOTS of practice with answers. A thin plan
is wrong. Go slow, break every idea down, repeat in different ways, and practice until the
concept is totally clear.

BUILD EACH SCREEN FROM RICH ELEMENTS (design these dynamically for THIS page's content — you
choose the elementType that fits; you are not limited to a fixed menu). Examples of the kinds
of elements a great board uses (use the ones the real content calls for, and invent others
when useful):
  - pdf_page_image (show the real page) + pointer/zoom; source_quote_highlight (highlight the
    exact sentence); phrase_breakdown (explain a definition phrase by phrase)
  - key_points_card, definition_card, concept_map, flowchart, before_after, comparison_table,
    table, worked_example, notes_panel (growing teacher notes), teacher_redraw
  - code_block + a real dry-run trace (set needsSandbox=true so it is actually executed),
    sql_dry_run, result_table_build, variable_table, line_by_line_trace
  - common_mistake_box, fix_it_step, student_prediction
  - practice_qa, progressive_practice_set (easy→medium→hard), quiz_check
  - summary_card, recap_map, external_resource_card, lesson_book_page
Each element has a concrete contentBrief (what it will actually contain, from the real page);
Stage C fills the full content. Bind every visual element to its real regionId.

SERVE ALL STUDENTS (non-negotiable): teach like the WORLD'S BEST teacher who leaves NO student
behind. For EVERY important screen fill levelCoverage with three REAL explanations:
  - weak    → slowest, simplest, most concrete (assume zero prior knowledge; tiny everyday
              analogy; smallest possible steps).
  - core    → the clear standard explanation every student must walk away with.
  - stretch → deeper insight / edge case / "why it really works" for strong students.

DEPTH MANDATE — THE MOST IMPORTANT RULE:
The sample boards show element STYLE only (titled cards/panels) — they are brief mockups. Your
lesson must go FAR DEEPER. Using the rich vision reading, ADD a LARGE, RICH, step-by-step
explanation of EACH AND EVERYTHING on EVERY page — every line of text, every diagram, every
arrow, every table row, every line of code — explained part by part, nothing skipped, even
though the mockups show little text. A thin card is WRONG.
  • Each CONTENT element's contentBrief must be a LONG, specific explanation (the real teaching),
    not a label. Many detailed element cards per screen.
  • The VOICE is also large: each concept gets MANY substantive voice lines that together form a
    long, thorough spoken explanation (never one-word lines). Voice + on-screen content are BOTH
    detailed.
  • If vision found N step-by-step items for a region, walk through all N.
This depth is required in ALL THREE modes:
  (1) PREBUILT — voice + point: detailed cards already on the board; teacher speaks and points
      at each part. (2) WRITING — voice + point + writing: teacher writes/draws the same detailed
      explanation live while speaking. (3) BOTH — prebuilt cards plus live writing together.

UNIVERSAL ELEMENT VOCABULARY (use what the real content calls for; elementType is a free string,
invent fitting ones too): pdf_page_image (ONE source element for pointing — the lesson is NOT
"show the PDF"; teaching lives in the detailed cards), source_quote_highlight, phrase_breakdown,
key_points_card, definition_card, concept_map, flowchart, before_after, comparison_table,
notes_panel, teacher_redraw, common_mistake_box, fix_it_step, student_prediction, practice_qa,
progressive_practice_set, quiz_check, summary_card, recap_map, external_resource_card,
source_vs_external_split, lesson_book_page.
Images are FETCHED from the real PDF (never generated).

PRACTICE A LOT: include many practice questions WITH worked answers across the lesson — recall,
apply, and challenge. Use progressive_practice_set. Also write externalResources.searchQueries
(your own queries) so the WebResourceAgent can fetch famous-university questions, reference
sites, and YouTube videos on this concept — keep that external material clearly separate from
the PDF truth.

HARD RULES:
1. Never invent unsupported claims. Every explanation is grounded in sourceRefs or vision regions.
2. If a screen/voice/element says "look here", "this part", "this diagram", it MUST carry the
   real regionId(s) it refers to (from the vision reading).
3. Use real visionIndex regionIds + page numbers for pointing/highlighting. Images come FROM the
   PDF — never generated.
4. Do NOT output React/HTML or final pixel commands. Output a LessonContract ONLY.
5. Plan the THREE board modes (use the right one per screen):
   - PREBUILT (voice+point): detailed cards already on the board; teacher points/spotlights a
     regionId/elementId and explains. Overview, source-focus, diagram explain, comparison, recap, quiz.
   - WRITING (voice+point+writing): board starts blank/partial; teacher WRITES/DRAWS the detailed
     explanation LIVE WHILE SPEAKING. Derivations, code/SQL walk-throughs, formulas, build-up, mistakes.
   - BOTH: prebuilt cards PLUS live writing together.
6. ACTION & SYNC MODEL (the board later plays ordered, timed Actions — plan for it):
   - The visual focus (movePointer/spotlight/highlight) for a part comes JUST BEFORE the voice line
     about it. In WRITING mode the write/draw unfolds DURING the voice. Speech finishes before the
     next action (point → speak, or write-while-speaking).
   - EVERYTHING NEEDS A STABLE ID so actions can bind: every screen has a screenId, every element an
     id, every voice line a voiceLineId. Each voice line lists the regionIds/elementIds it points at
     or writes, plus its sourceRefs. (Downstream every Action = voiceLineId + regionId + bbox + sourceRef.)
7. Voice lines: each is one focused spoken beat synced to one pointed/written part — but give MANY
   per concept so the spoken explanation is long, thorough, and complete (detailed, never thin).
7. Cover EVERY page and EVERY important region. Do not collapse a rich page into one vague screen.
8. Make the final board feel like a master teacher's board: the real PDF page shown, key ideas
   written in a growing notes panel, the pointer moving to exactly what is being said, code
   dry-run on a sandbox, and plenty of practice.

OUTPUT: a single valid LessonContract JSON matching the provided schema. No prose, no markdown.
"""


# ─────────────────────────────────────────────────────────────────────────────
# Base teacher
# ─────────────────────────────────────────────────────────────────────────────

class BaseDomainTeacher:
    agent_name: str = "BaseDomainTeacher"
    agent_group: str = "planning"
    model: str = PRO_MODEL
    use_thinking: bool = True
    response_schema: JsonDict = LESSON_CONTRACT_SCHEMA

    # overridden per domain
    domain: str = "general"
    screen_families: List[str] = []
    teaching_sequence: List[str] = []
    hook_opening: str = ""
    domain_addon_prompt: str = ""

    def __init__(self, model: Optional[str] = None) -> None:
        if model:
            self.model = model

    # ── instruction ──────────────────────────────────────────────────────────
    @property
    def instruction(self) -> str:
        return (
            f"You are a world-class {self.domain} teacher and lesson architect. "
            "You see the real PDF page images and a detailed vision reading of them. "
            "Plan a source-grounded LessonContract that explains everything on the pages "
            "step by step, in two board modes, grounding every visual to real regionIds. "
            "Output only valid JSON matching the schema."
        )

    # ── level / size ─────────────────────────────────────────────────────────
    def _level_range(self, payload: JsonDict) -> Dict[str, Any]:
        level = clean_text(safe_dict(payload).get("studentLevel") or "beginner", 20).lower()
        r = LEVEL_RANGE.get(level, LEVEL_RANGE["beginner"])
        evidence = len(safe_list(payload.get("selectedEvidence") or payload.get("chunks")))
        bias = min(1.0, evidence / 30.0)
        minutes = int(r["minMinutes"] + (r["maxMinutes"] - r["minMinutes"]) * bias)
        return {**r, "level": level, "targetMinutes": minutes}

    # ── context rendering (the teacher's reading material) ───────────────────
    def _vision_pages_text(self, payload: JsonDict) -> str:
        """Render the EXHAUSTIVE per-page vision reading so the teacher has the full content."""
        pages = safe_list(payload.get("visionPages"))
        if not pages:
            # fall back to flat visionIndex grouping
            return self._vision_index_text(payload)
        out: List[str] = []
        for pg in pages:
            pg = safe_dict(pg)
            out.append(f"\n=== PAGE {pg.get('page')} — {clean_text(pg.get('pageTitle'), 160)} ===")
            out.append(f"SUMMARY: {clean_text(pg.get('pageSummary'), 1400)}")
            concepts = safe_list(pg.get("conceptsCovered"))
            if concepts:
                out.append("CONCEPTS: " + ", ".join(clean_text(c, 80) for c in concepts))
            narr = safe_list(pg.get("teachingNarrative"))
            if narr:
                out.append("TEACHING NARRATIVE:")
                for i, s in enumerate(narr, 1):
                    out.append(f"  {i}. {clean_text(s, 600)}")
            out.append("REGIONS:")
            for r in safe_list(pg.get("regions")):
                r = safe_dict(r)
                out.append(
                    f"  [{r.get('regionId')}] ({r.get('type')}) {clean_text(r.get('title'), 120)}"
                )
                out.append(f"      content: {clean_text(r.get('content') or r.get('exactContent'), 1400)}")
                if r.get("conceptExplanation"):
                    out.append(f"      concept: {clean_text(r.get('conceptExplanation'), 700)}")
                for s in safe_list(r.get("stepByStepExplanation"))[:40]:
                    out.append(f"      step: {clean_text(s, 600)}")
                rels = safe_list(r.get("relationships"))
                if rels:
                    out.append("      relationships: " + "; ".join(clean_text(x, 160) for x in rels[:12]))
        return "\n".join(out)

    def _vision_index_text(self, payload: JsonDict) -> str:
        lines = []
        for r in safe_list(payload.get("visionIndex")):
            r = safe_dict(r)
            lines.append(
                f"  [{r.get('regionId')}] page={r.get('page')} type={r.get('type')} "
                f"| {clean_text(r.get('description'), 200)} | content: {clean_text(r.get('content'), 400)}"
            )
        return "\n".join(lines)

    def _evidence_text(self, payload: JsonDict, limit: int = 30) -> str:
        chunks = safe_list(payload.get("selectedEvidence") or payload.get("chunks"))[:limit]
        return "\n".join(
            f"  [p.{c.get('page','?')}] {clean_text(c.get('text') or c.get('textPreview'), 300)}"
            for c in chunks if isinstance(c, dict)
        )

    def _region_ids(self, payload: JsonDict) -> List[str]:
        return [safe_dict(r).get("regionId", "") for r in safe_list(payload.get("visionIndex"))
                if safe_dict(r).get("regionId")]

    # ── prompt ───────────────────────────────────────────────────────────────
    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        node = safe_dict(payload.get("selectedNode"))
        node_title = clean_text(node.get("title") or payload.get("nodeTitle"), 120)
        node_id = clean_text(node.get("nodeId") or payload.get("nodeId"), 120)
        lr = self._level_range(payload)
        summary = clean_text(payload.get("fullPdfSummary"), 2500)
        outline = clean_text(payload.get("fullPdfOutline"), 2500)
        region_ids = self._region_ids(payload)

        return f"""{BASE_DOMAIN_TEACHER_PROMPT}

{self.domain_addon_prompt}

────────────────────────── LESSON CONTEXT ──────────────────────────
DOMAIN: {self.domain}
NODE: {node_title}  (nodeId={node_id})
STUDENT LEVEL: {lr['level']}  → target ~{lr['targetMinutes']} minutes
TEACHING SEQUENCE FOR THIS DOMAIN: {' → '.join(self.teaching_sequence)}
HOOK STYLE: {self.hook_opening}

REAL regionIds you may point at (from the page images):
{', '.join(region_ids)}

────────────────────── VISION READING OF EVERY PAGE ──────────────────────
(You also SEE the page images themselves, attached above. Explain EVERYTHING here.)
{self._vision_pages_text(payload)}

────────────────────────── PDF TEXT EVIDENCE ──────────────────────────
{self._evidence_text(payload)}

────────────────────────── FULL PDF SUMMARY ──────────────────────────
{summary}

────────────────────────── FULL PDF OUTLINE ──────────────────────────
{outline}

Now produce the LessonContract JSON for a LARGE, DEEP lesson (~{lr['targetMinutes']}+ minutes).
- Cover every page and every important region; do not collapse rich pages.
- Build each screen from rich, dynamic ELEMENTS (with concrete contentBriefs from the real page);
  use code/SQL dry-runs (needsSandbox=true) where there is code, tables where there is data.
- Fill levelCoverage (weak / core / stretch) on important screens.
- Include MANY practice questions with worked answers (use progressive_practice_set), and write
  externalResources.searchQueries for famous-university questions, sites, and YouTube videos.
- Plan both board modes. Output JSON only."""

    # ── multimodal contents ──────────────────────────────────────────────────
    def _contents(self, payload: JsonDict, prompt: str) -> List[Any]:
        parts: List[Any] = []
        for img in safe_list(payload.get("pageImages")):
            data = _load_image_bytes(safe_dict(img))
            if data is not None:
                parts.append(genai_types.Part.from_bytes(data=data, mime_type="image/png"))
        parts.append(prompt)
        return parts

    # ── normalize / validate ─────────────────────────────────────────────────
    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)
        node = safe_dict(payload.get("selectedNode"))
        lr = self._level_range(payload)
        raw["domain"] = self.domain
        raw.setdefault("nodeId", clean_text(node.get("nodeId") or payload.get("nodeId"), 120))
        raw.setdefault("title", clean_text(node.get("title") or payload.get("nodeTitle"), 160))
        raw.setdefault("studentLevel", lr["level"])
        if not raw.get("targetMinutes"):
            raw["targetMinutes"] = lr["targetMinutes"]
        raw["domainTeacher"] = self.agent_name
        return raw

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        payload = safe_dict(payload)
        errors: List[str] = []
        if not safe_list(payload.get("pageImages")):
            errors.append(f"{self.agent_name} requires pageImages (the teacher must SEE the pages)")
        if not (safe_list(payload.get("visionPages")) or safe_list(payload.get("visionIndex"))):
            errors.append(f"{self.agent_name} requires vision output (visionPages/visionIndex)")
        if not (safe_list(payload.get("selectedEvidence")) or safe_list(payload.get("chunks"))):
            errors.append(f"{self.agent_name} requires selectedEvidence")
        return ValidationResult(ok=not errors, errors=errors, warnings=[],
                                validator=f"{self.agent_name}.input", fallbackUsed=False)

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []
        segments = safe_list(output.get("segments"))
        if len(segments) < 2:
            errors.append(f"segments has {len(segments)} — need at least 2")

        valid_regions = set(self._region_ids(payload))
        total_screens = 0
        grounded_screens = 0
        screens_with_elements = 0
        total_elements = 0
        practice_count = 0
        modes_seen = set()
        for seg in segments:
            seg = safe_dict(seg)
            screens = safe_list(seg.get("screenPlan"))
            voices = safe_list(seg.get("teacherVoicePlan"))
            if not screens:
                errors.append(f"segment '{seg.get('segmentId')}' has no screenPlan")
            if not voices:
                errors.append(f"segment '{seg.get('segmentId')}' has no teacherVoicePlan")
            practice_count += len(safe_list(seg.get("practicePlan")))
            for sc in screens:
                sc = safe_dict(sc)
                total_screens += 1
                modes_seen.add(sc.get("mode"))
                els = safe_list(sc.get("elements"))
                total_elements += len(els)
                if els:
                    screens_with_elements += 1
                # practice elements count too
                practice_count += sum(
                    1 for e in els
                    if "practice" in str(safe_dict(e).get("elementType", "")).lower()
                    or "quiz" in str(safe_dict(e).get("elementType", "")).lower()
                )
                rids = safe_list(sc.get("requiredRegionIds"))
                if rids:
                    grounded_screens += 1
                    if valid_regions and not any(r in valid_regions for r in rids):
                        warnings.append(f"screen '{sc.get('screenId')}' regionIds not in visionIndex: {rids}")
                if sc.get("mode") == "REALTIME_WRITING":
                    acts = safe_list(sc.get("visualActionsNeeded"))
                    if not any(a in acts for a in ("writeText", "writeCode", "writeSQL",
                                                   "writeFormula", "drawArrow", "drawTable",
                                                   "drawGraph", "drawBox", "drawLatex")):
                        warnings.append(f"REALTIME_WRITING screen '{sc.get('screenId')}' has no write/draw action")

        if total_screens and grounded_screens == 0:
            errors.append("No screen is grounded to a real regionId — lesson is not vision-grounded")
        # richness: screens must be built from elements (not chat text)
        if total_screens and screens_with_elements < max(1, total_screens // 2):
            errors.append(f"Only {screens_with_elements}/{total_screens} screens have board elements — "
                          f"lesson is too thin (screens must be built from rich elements)")
        # depth: enough practice to make the concept clear
        if practice_count < 3:
            errors.append(f"Only {practice_count} practice items — a world-class lesson needs many "
                          f"practice questions with answers")
        if valid_regions and len(modes_seen - {None}) < 2:
            warnings.append("Lesson uses only one board mode — expected both PREBUILT_SCREEN and REALTIME_WRITING")
        if not safe_list(output.get("learningGoals")):
            errors.append("learningGoals missing")

        # ── DEPTH GATE — world-class detail is REQUIRED (no thin lessons) ──
        MIN_BRIEF = 180          # a content element's brief must be a real explanation, not a label
        thin_briefs = content_elems = voice_total = levelcov_screens = 0
        for seg in segments:
            seg = safe_dict(seg)
            voice_total += len(safe_list(seg.get("teacherVoicePlan")))
            for sc in safe_list(seg.get("screenPlan")):
                sc = safe_dict(sc)
                lc = safe_dict(sc.get("levelCoverage"))
                if lc.get("weak") and lc.get("core") and lc.get("stretch"):
                    levelcov_screens += 1
                for e in safe_list(sc.get("elements")):
                    e = safe_dict(e)
                    et = str(e.get("elementType", "")).lower()
                    if any(k in et for k in ("pdf_page_image", "image", "highlight", "spotlight")):
                        continue  # pure-visual/source elements are exempt from the length rule
                    content_elems += 1
                    if len(clean_text(e.get("contentBrief"), 6000)) < MIN_BRIEF:
                        thin_briefs += 1
        if content_elems and thin_briefs > content_elems // 3:
            errors.append(f"DEPTH: {thin_briefs}/{content_elems} content elements are thin "
                          f"(brief < {MIN_BRIEF} chars) — every explanation must be LARGE and detailed")
        if total_screens and voice_total < total_screens * 3:
            errors.append(f"DEPTH: only {voice_total} voice lines across {total_screens} screens — the "
                          f"spoken explanation must be long/thorough (many detailed lines per concept)")
        if total_screens and levelcov_screens < max(1, total_screens // 3):
            warnings.append(f"DEPTH: only {levelcov_screens}/{total_screens} screens have full "
                            f"weak/core/stretch levelCoverage — serve every category of student")

        return ValidationResult(ok=not errors, errors=errors, warnings=warnings,
                                validator=f"{self.agent_name}.output", fallbackUsed=False)

    # ── A3: multi-agent ADK teacher — architect + per-segment DEEP expansion ──
    def _segment_pages(self, outline: JsonDict, payload: JsonDict) -> List[int]:
        pages: List[int] = []
        for p in safe_list(outline.get("pages")):
            try:
                pages.append(int(p))
            except (TypeError, ValueError):
                continue
        return sorted(set(pages)) or tc.pages_list(payload)

    def build_segment_prompt(self, payload: JsonDict, outline: JsonDict, skeleton: JsonDict) -> str:
        pages = self._segment_pages(outline, payload)
        seg_regions = [str(r) for r in safe_list(outline.get("regionIds"))]
        must = safe_list(outline.get("mustCover"))
        est = max(6, int(outline.get("estScreens") or 8))
        thesis = clean_text(skeleton.get("teachingThesis"), 600)
        must_block = "\n".join("  - " + clean_text(m, 300) for m in must)
        return f"""{BASE_DOMAIN_TEACHER_PROMPT}

{self.domain_addon_prompt}

You are expanding ONE SEGMENT of a larger {self.domain} lesson into a DEEP, detailed stretch of
board teaching. Use ONLY this segment's pages and regions. GO BIG — many detailed screens, long
step-by-step briefs, lots of practice. You have the full token budget for this ONE segment.

LESSON THESIS: {thesis}
SEGMENT: {clean_text(outline.get('title'), 160)}  (id={clean_text(outline.get('segmentId'), 80)})
learningGoal: {clean_text(outline.get('learningGoal'), 400)}
focus: {clean_text(outline.get('focus'), 800)}
target minutes: {outline.get('targetMinutes')}    aim for >= {est} screens
point ONLY at these regionIds: {', '.join(seg_regions)}
MUST COVER every one (explain each in detail):
{must_block}

VISION READING (this segment's pages only):
{tc.vision_pages_text(payload, pages=pages)}

PDF TEXT EVIDENCE (these pages):
{tc.evidence_text(payload, pages=pages)}

PRODUCE THIS ONE SEGMENT as JSON (segment shape: segmentId, title, learningGoal, screenPlan[],
teacherVoicePlan[], practicePlan[], misconceptions[]). REQUIREMENTS (enforced):
- aim for >= {est} detailed screens — each a real teaching beat, not a label.
- each content element's contentBrief is a LONG step-by-step explanation.
- weak/core/stretch levelCoverage on every teaching screen.
- MANY voice lines (long, thorough spoken explanation), each bound to its region/element id.
- PRACTICE A LOT: several REAL-LIFE and SCENARIO-BASED questions on THIS concept, each with a full
  worked answer (use progressive_practice_set easy->hard + scenario practice_qa).
- use both modes where they fit (PREBUILT point; REALTIME writing while speaking). Never invent
  names or regionIds. Output JSON only."""

    def _segment_issues(self, seg: JsonDict, outline: JsonDict) -> List[str]:
        issues: List[str] = []
        screens = safe_list(seg.get("screenPlan"))
        need = max(4, int(outline.get("estScreens") or 6) // 2)
        if len(screens) < need:
            issues.append(f"only {len(screens)} screens — produce many more detailed screens (>= {need})")
        if len(safe_list(seg.get("teacherVoicePlan"))) < max(6, len(screens) * 2):
            issues.append("too few voice lines — the spoken explanation must be long and thorough")
        if len(safe_list(seg.get("practicePlan"))) < 2:
            issues.append("add several real-life + scenario-based practice questions WITH worked answers")
        thin = tot = 0
        for sc in screens:
            for e in safe_list(safe_dict(sc).get("elements")):
                et = str(safe_dict(e).get("elementType", "")).lower()
                if "image" in et or "highlight" in et:
                    continue
                tot += 1
                if len(clean_text(safe_dict(e).get("contentBrief"), 6000)) < 180:
                    thin += 1
        if tot and thin > tot // 3:
            issues.append(f"{thin}/{tot} element briefs are thin — make each a LONG step-by-step explanation")
        return issues

    async def _expand_segment(self, payload: JsonDict, outline: JsonDict, skeleton: JsonDict) -> JsonDict:
        outline = safe_dict(outline)
        pages = self._segment_pages(outline, payload)
        images = tc.image_bytes(payload, pages=pages)
        if not images:
            raise AdkRuntimeError(f"{self.agent_name}: no page images for segment pages {pages}")

        def _stamp(s: JsonDict) -> JsonDict:
            s = safe_dict(s)
            s.setdefault("segmentId", clean_text(outline.get("segmentId"), 80))
            s.setdefault("title", clean_text(outline.get("title"), 160))
            s.setdefault("learningGoal", clean_text(outline.get("learningGoal"), 400))
            return s

        prompt = self.build_segment_prompt(payload, outline, skeleton)
        out = await run_adk_agent(
            name=f"{self.agent_name}_segment", instruction=self.instruction, prompt=prompt,
            model=self.model, images=images, output_schema=_SEGMENT,
            temperature=0.3, max_output_tokens=65536, retries=1,
        )
        seg = _stamp(out.get("result"))

        # one honest depth repair (no fake fallback)
        issues = self._segment_issues(seg, outline)
        if issues:
            repair = prompt + ("\n\n────────── REPAIR (too thin) ──────────\n"
                               "Your segment was too thin/shallow. Fix EVERY issue and return the full, "
                               "DEEPER segment JSON:\n- " + "\n- ".join(issues))
            out = await run_adk_agent(
                name=f"{self.agent_name}_segment", instruction=self.instruction, prompt=repair,
                model=self.model, images=images, output_schema=_SEGMENT,
                temperature=0.2, max_output_tokens=65536, retries=1,
            )
            seg2 = _stamp(out.get("result"))
            if safe_list(seg2.get("screenPlan")):
                seg = seg2
        seg["_adk"] = {"ranThroughAdkRunner": out.get("ranThroughAdkRunner"),
                       "adkEvents": out.get("adkEvents")}
        return seg

    async def run(self, payload: JsonDict) -> AgentResult:
        """Multi-agent ADK teacher: architect → per-segment DEEP expansion (parallel) → assemble.
        No giant call. No fake fallback."""
        payload = safe_dict(payload)
        context = AgentContext.from_payload(payload)

        iv = self.validate_input(payload)
        if not iv.ok:
            return AgentResult(ok=False, agentName=self.agent_name, mode="teach", result={},
                               validation=iv, errors=iv.errors, warnings=iv.warnings,
                               metadata={"agentGroup": self.agent_group, "fallbackUsed": False})
        if not adk_available():
            return AgentResult(ok=False, agentName=self.agent_name, mode="teach", result={},
                               errors=["Google ADK not available (real agent required, no fallback)"],
                               metadata={"fallbackUsed": False})

        # 1) ARCHITECT → the segment spine (real ADK, multimodal)
        architect = LessonArchitectAgent(
            domain=self.domain, teaching_sequence=self.teaching_sequence,
            hook_opening=self.hook_opening, domain_addon_prompt=self.domain_addon_prompt,
            model=self.model)
        try:
            skeleton = await architect.run(payload)
        except AdkRuntimeError as exc:
            return AgentResult(ok=False, agentName=self.agent_name, mode="teach", result={},
                               errors=[f"architect failed: {str(exc)[:200]}"],
                               metadata={"fallbackUsed": False})
        outlines = safe_list(skeleton.get("segmentOutline"))

        # 2) EXPAND every segment IN PARALLEL — each its own deep ADK call
        results = await asyncio.gather(
            *[self._expand_segment(payload, o, skeleton) for o in outlines],
            return_exceptions=True)
        segments: List[JsonDict] = []
        seg_errors: List[str] = []
        for o, r in zip(outlines, results):
            if isinstance(r, Exception):
                seg_errors.append(f"segment '{safe_dict(o).get('segmentId')}': {str(r)[:160]}")
            else:
                segments.append(r)
        if not segments:
            return AgentResult(ok=False, agentName=self.agent_name, mode="teach", result={},
                               errors=["all segments failed: " + "; ".join(seg_errors)],
                               metadata={"fallbackUsed": False})

        # 3) ASSEMBLE the LessonContract
        lr = self._level_range(payload)
        node = safe_dict(payload.get("selectedNode"))
        contract: JsonDict = {
            "domain": self.domain,
            "nodeId": clean_text(node.get("nodeId") or payload.get("nodeId"), 120),
            "title": clean_text(node.get("title") or payload.get("nodeTitle"), 160),
            "studentLevel": lr["level"],
            "targetMinutes": skeleton.get("targetMinutes") or lr["targetMinutes"],
            "teachingThesis": skeleton.get("teachingThesis"),
            "learningGoals": skeleton.get("learningGoals"),
            "prerequisites": skeleton.get("prerequisites"),
            "sourceUsePlan": skeleton.get("sourceUsePlan"),
            "segments": segments,
            "externalResources": {"searchQueries": skeleton.get("externalSearchQueries") or []},
            "domainTeacher": self.agent_name,
            "_adk": {"multiAgentAdk": True, "architect": skeleton.get("_adk"),
                     "segmentCount": len(segments), "ranThroughAdkRunner": True},
        }
        ov = self.validate_output(contract, payload, context)
        if seg_errors:
            ov.warnings.append(f"{len(seg_errors)} segment(s) failed: {seg_errors}")

        n_screens = sum(len(safe_list(safe_dict(s).get("screenPlan"))) for s in segments)
        print(f"[{self.agent_name}] multi-agent LessonContract: {len(segments)} segments, "
              f"{n_screens} screens (per-segment ADK)", file=sys.stderr)
        return AgentResult(
            ok=ov.ok, agentName=self.agent_name, mode="teach",
            result=contract if ov.ok else {},
            validation=ov, errors=ov.errors, warnings=ov.warnings,
            metadata={"agentGroup": self.agent_group, "model": self.model,
                      "realSeparateAgent": True, "multimodal": True, "multiAgentAdk": True,
                      "fallbackUsed": False})


async def teach_node(teacher: "BaseDomainTeacher", payload: JsonDict) -> JsonDict:
    """Convenience: run a domain teacher, raise on failure (no fake fallback)."""
    result = await teacher.run(payload)
    if not result.ok:
        raise RuntimeError(f"{teacher.agent_name} failed: {result.errors}")
    return result.result
