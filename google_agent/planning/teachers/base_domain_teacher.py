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

SERVE ALL STUDENTS: for important screens fill levelCoverage — a weak-student scaffold (extra
simple), the core explanation, and a stretch for strong students.

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
5. Plan BOTH board modes (use the right one per screen):
   - PREBUILT_SCREEN: page + notes already visible; teacher points/spotlights/highlights a
     regionId and explains. Use for overview, source-focus, diagram explain, comparison, recap, quiz.
   - REALTIME_WRITING: board starts blank/partial; teacher WRITES/DRAWS live while speaking.
     Use for derivations, code/SQL walk-throughs, formulas, process build-up, mistake repair.
6. Voice lines are ATOMIC — one idea each, natural spoken language, no huge paragraphs.
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
                out.append(f"      content: {clean_text(r.get('content') or r.get('exactContent'), 700)}")
                if r.get("conceptExplanation"):
                    out.append(f"      concept: {clean_text(r.get('conceptExplanation'), 500)}")
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

        return ValidationResult(ok=not errors, errors=errors, warnings=warnings,
                                validator=f"{self.agent_name}.output", fallbackUsed=False)

    # ── run (multimodal, no fake fallback, one repair) ───────────────────────
    async def _generate(self, payload: JsonDict, prompt: str, thinking: bool) -> JsonDict:
        contents = self._contents(payload, prompt)
        result = await generate_structured_async(
            prompt="",
            schema=self.response_schema,
            model=self.model,
            temperature=0.3,
            max_output_tokens=65536,
            system_instruction=self.instruction,
            thinking=thinking,
            contents=contents,
        )
        return safe_dict(result)

    async def run(self, payload: JsonDict) -> AgentResult:
        payload = safe_dict(payload)
        context = AgentContext.from_payload(payload)

        iv = self.validate_input(payload)
        if not iv.ok:
            return AgentResult(ok=False, agentName=self.agent_name, mode="teach",
                               result={}, validation=iv, errors=iv.errors, warnings=iv.warnings,
                               metadata={"agentGroup": self.agent_group, "fallbackUsed": False})

        if not _GENAI_OK:
            return AgentResult(ok=False, agentName=self.agent_name, mode="teach", result={},
                               errors=["google.genai not available for multimodal teacher"],
                               metadata={"fallbackUsed": False})

        prompt = self.build_prompt(payload, context)

        # generate (retry once without thinking if the JSON truncates on a big contract)
        try:
            raw = await self._generate(payload, prompt, self.use_thinking)
        except GeminiStructuredError as exc:
            if self.use_thinking:
                print(f"[{self.agent_name}] contract truncated/invalid ({str(exc)[:80]}); "
                      f"retrying without thinking", file=sys.stderr)
                raw = await self._generate(payload, prompt, False)
            else:
                raise

        normalized = self.normalize_output(raw, payload, context)
        ov = self.validate_output(normalized, payload, context)

        # one honest repair pass (no fake fallback)
        if not ov.ok:
            repair = prompt + (
                "\n\n────────── REPAIR ──────────\n"
                "Your previous LessonContract failed validation. Fix EXACTLY these errors and "
                "return the full corrected LessonContract JSON:\n- "
                + "\n- ".join(ov.errors)
            )
            try:
                raw = await self._generate(payload, repair, False)
                normalized = self.normalize_output(raw, payload, context)
                ov = self.validate_output(normalized, payload, context)
            except GeminiStructuredError:
                pass

        if ov.ok:
            n_segs = len(safe_list(normalized.get("segments")))
            n_screens = sum(len(safe_list(safe_dict(s).get("screenPlan"))) for s in safe_list(normalized.get("segments")))
            print(f"[{self.agent_name}] LessonContract: {n_segs} segments, {n_screens} screens", file=sys.stderr)

        return AgentResult(
            ok=ov.ok, agentName=self.agent_name, mode="teach",
            result=normalized if ov.ok else {},
            validation=ov, errors=ov.errors, warnings=ov.warnings,
            metadata={"agentGroup": self.agent_group, "model": self.model,
                      "realSeparateAgent": True, "multimodal": True, "fallbackUsed": False},
        )


async def teach_node(teacher: "BaseDomainTeacher", payload: JsonDict) -> JsonDict:
    """Convenience: run a domain teacher, raise on failure (no fake fallback)."""
    result = await teacher.run(payload)
    if not result.ok:
        raise RuntimeError(f"{teacher.agent_name} failed: {result.errors}")
    return result.result
