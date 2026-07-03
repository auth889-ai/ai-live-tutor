"""
google_agent/planning/teachers/lesson_architect.py
===============================================================================
LESSON ARCHITECT — sub-agent 1 of the multi-agent Teacher subsystem.

Runs as a REAL Google ADK LlmAgent (through the ADK Runner), multimodal: it SEES
the real PDF page images + the exhaustive vision reading, and produces ONLY the
lesson SKELETON — NOT the screens. That decomposition is the whole point: the old
teacher tried to emit the entire LessonContract in one giant call (fragile,
truncates). The architect instead plans the spine:

  - teachingThesis, learningGoals, prerequisites
  - sourceUsePlan (primary pages / regionIds / sourceRefs)
  - externalSearchQueries (for the WebResourceAgent)
  - a SEGMENT OUTLINE: an ordered list of segments, each OWNING a slice of the
    node's pages + regions, with a clear focus, target minutes, and board-mode mix.

Each outlined segment is later expanded — in parallel, one focused call each — by
SegmentArchitectAgent, and quality-looped by the LangGraph teacher_graph.

HARD GUARANTEE (validated, no fake fallback): every real page and every real
region is assigned to at least one segment. Nothing on the pages is dropped.
===============================================================================
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List

try:
    from ...live_tutor_agents.contracts import (
        JsonDict, ValidationResult, clean_text, safe_dict, safe_list,
    )
    from ...pipeline.gemini_structured import PRO_MODEL
    from ...pipeline.adk_runtime import run_adk_agent, adk_available, AdkRuntimeError
    from . import teacher_context as tc
except ImportError:  # pragma: no cover
    from google_agent.live_tutor_agents.contracts import (  # type: ignore
        JsonDict, ValidationResult, clean_text, safe_dict, safe_list,
    )
    from google_agent.pipeline.gemini_structured import PRO_MODEL  # type: ignore
    from google_agent.pipeline.adk_runtime import (  # type: ignore
        run_adk_agent, adk_available, AdkRuntimeError,
    )
    from google_agent.planning.teachers import teacher_context as tc  # type: ignore


# ─────────────────────────────────────────────────────────────────────────────
# Skeleton schema (the architect's output)
# ─────────────────────────────────────────────────────────────────────────────

_SEGMENT_OUTLINE = {
    "type": "object",
    "properties": {
        "segmentId":    {"type": "string"},
        "title":        {"type": "string"},
        "learningGoal": {"type": "string", "description": "the ONE thing a student can do after this segment"},
        "focus":        {"type": "string", "description": "what this segment teaches, concretely"},
        "targetMinutes":{"type": "number"},
        "pages":        {"type": "array", "items": {"type": "number"},
                         "description": "the real PDF page numbers this segment teaches from"},
        "regionIds":    {"type": "array", "items": {"type": "string"},
                         "description": "the real vision regionIds this segment explains (its scope)"},
        "mustCover":    {"type": "array", "items": {"type": "string"},
                         "description": "the specific facts/diagrams/examples this segment MUST explain"},
        "modeMix":      {"type": "object", "properties": {
                            "prebuiltScreenPercent":  {"type": "number"},
                            "realtimeWritingPercent": {"type": "number"}}},
        "estScreens":   {"type": "number", "description": "rough number of board screens this segment needs"},
    },
    "required": ["segmentId", "title", "learningGoal", "focus", "pages", "regionIds", "mustCover"],
}

ARCHITECT_SCHEMA: JsonDict = {
    "type": "object",
    "properties": {
        "teachingThesis": {"type": "string", "description": "the big idea the whole lesson proves"},
        "learningGoals":  {"type": "array", "items": {"type": "string"}},
        "prerequisites":  {"type": "array", "items": {"type": "string"}},
        "sourceUsePlan":  {"type": "object", "properties": {
                              "primaryPages":      {"type": "array", "items": {"type": "number"}},
                              "primaryRegionIds":  {"type": "array", "items": {"type": "string"}},
                              "mustUseSourceRefs": {"type": "array", "items": {"type": "string"}}}},
        "externalSearchQueries": {"type": "array", "items": {"type": "string"},
                              "description": "queries (you write these) for famous-university questions, "
                                             "reference sites, and YouTube on this exact concept"},
        "segmentOutline": {"type": "array", "items": _SEGMENT_OUTLINE,
                              "description": "ordered segments; together they cover EVERY page and EVERY region"},
        "coverageProof":  {"type": "object", "properties": {
                              "everyPageAssigned":   {"type": "boolean"},
                              "everyRegionAssigned": {"type": "boolean"}}},
    },
    "required": ["teachingThesis", "learningGoals", "segmentOutline"],
}


_ARCHITECT_PROMPT = """You are the LESSON ARCHITECT for a world-class AI board tutor.

You are NOT writing screens or voice lines yet. You are planning the SPINE of a large,
deep lesson that another agent will expand segment by segment. Get the structure right.

WHAT YOU SEE:
- The ACTUAL PDF page images of the concept the student clicked (attached). These come
  FROM the PDF — never generated.
- A detailed VISION READING of every page (titles, summaries, step-by-step narrative, and
  every region with verbatim content + diagram relationships).
- The PDF text evidence, full summary, and full outline.

YOUR JOB — produce the lesson skeleton:
1. teachingThesis: the single big idea the whole lesson proves.
2. learningGoals: what the student can DO afterwards (concrete, measurable).
3. prerequisites: what they must already know.
4. sourceUsePlan: the primary pages, the primary regionIds, the must-use sourceRefs.
5. externalSearchQueries: your own queries so a later agent can fetch famous-university
   questions, reference sites, and YouTube videos on THIS concept.
6. segmentOutline: an ordered list of segments that, TOGETHER, teach EVERYTHING on these
   pages — a 30+ minute lesson, so plan ENOUGH segments (typically 4-8). For EACH segment give:
     - a clear title, learningGoal, and focus
     - targetMinutes and a rough estScreens
     - the exact real `pages` it teaches from and the exact real `regionIds` it explains
       (its scope — drawn from the region catalog below)
     - mustCover: the specific facts / diagrams / formulas / code / examples it must explain
     - modeMix: how much PREBUILT_SCREEN (point/highlight a region) vs REALTIME_WRITING
       (write/draw live) this segment needs

HARD RULES (validated — do not break):
- EVERY page in scope must be assigned to at least one segment.
- EVERY regionId in the catalog must be assigned to at least one segment. Do not drop a
  single region — nothing on the pages may be skipped.
- Use ONLY real regionIds from the catalog and real page numbers in scope.
- Sequence segments pedagogically: hook/overview → build understanding → worked depth →
  practice/assessment → recap. Heavier pages get more segments.
- Do NOT write screens, voice lines, or content here. Outline only.

OUTPUT: a single valid JSON object matching the schema. No prose, no markdown.
"""


class LessonArchitectAgent:
    agent_name = "LessonArchitectAgent"
    agent_group = "planning"

    def __init__(self, *, domain: str = "general", teaching_sequence: List[str] | None = None,
                 hook_opening: str = "", domain_addon_prompt: str = "",
                 model: str | None = None) -> None:
        self.domain = domain
        self.teaching_sequence = teaching_sequence or []
        self.hook_opening = hook_opening
        self.domain_addon_prompt = domain_addon_prompt
        self.model = model or PRO_MODEL

    @property
    def instruction(self) -> str:
        return (
            f"You are the lesson architect for a world-class {self.domain} board tutor. "
            "You see the real PDF pages and their vision reading and design the lesson SKELETON: "
            "thesis, goals, source-use plan, and an ordered segment outline that assigns every page "
            "and every region to a segment. Output only valid JSON matching the schema."
        )

    def build_prompt(self, payload: JsonDict) -> str:
        node = safe_dict(payload.get("selectedNode"))
        node_title = clean_text(node.get("title") or payload.get("nodeTitle"), 120)
        node_id = clean_text(node.get("nodeId") or payload.get("nodeId"), 120)
        lr = tc.level_range(payload)
        pages = tc.pages_list(payload)
        summary = clean_text(payload.get("fullPdfSummary"), 2500)
        outline = clean_text(payload.get("fullPdfOutline"), 2500)

        return f"""{_ARCHITECT_PROMPT}

{self.domain_addon_prompt}

────────────────────────── LESSON CONTEXT ──────────────────────────
DOMAIN: {self.domain}
NODE: {node_title}  (nodeId={node_id})
STUDENT LEVEL: {lr['level']}  → target ~{lr['targetMinutes']} minutes total
PAGES IN SCOPE: {pages}
TEACHING SEQUENCE FOR THIS DOMAIN: {' → '.join(self.teaching_sequence)}
HOOK STYLE: {self.hook_opening}

──────────────────── REGION CATALOG (assign EVERY one) ────────────────────
{tc.region_catalog_text(payload)}

──────────────────── VISION READING OF EVERY PAGE ────────────────────
(You also SEE the page images themselves, attached above.)
{tc.vision_pages_text(payload)}

────────────────────────── PDF TEXT EVIDENCE ──────────────────────────
{tc.evidence_text(payload)}

────────────────────────── FULL PDF SUMMARY ──────────────────────────
{summary}

────────────────────────── FULL PDF OUTLINE ──────────────────────────
{outline}

Now produce the lesson SKELETON JSON for a LARGE, DEEP ~{lr['targetMinutes']}+ minute lesson.
Plan enough segments to cover every page and every region. Assign each region to a segment.
Outline only — no screens, no voice lines. Output JSON only."""

    # ── validate (no fake fallback) ──────────────────────────────────────────
    def validate(self, skeleton: JsonDict, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []
        segments = safe_list(skeleton.get("segmentOutline"))
        if len(segments) < 3:
            errors.append(f"segmentOutline has {len(segments)} — a 30+ min lesson needs at least 3 segments")
        if not safe_list(skeleton.get("learningGoals")):
            errors.append("learningGoals missing")
        if not clean_text(skeleton.get("teachingThesis"), 10):
            errors.append("teachingThesis missing")

        all_regions = set(tc.region_ids(payload))
        all_pages = set(tc.pages_list(payload))
        assigned_regions: set = set()
        assigned_pages: set = set()
        for seg in segments:
            seg = safe_dict(seg)
            if not clean_text(seg.get("learningGoal"), 5):
                errors.append(f"segment '{seg.get('segmentId')}' missing learningGoal")
            segrs = [str(r) for r in safe_list(seg.get("regionIds"))]
            bad = [r for r in segrs if all_regions and r not in all_regions]
            if bad:
                warnings.append(f"segment '{seg.get('segmentId')}' has unknown regionIds: {bad[:5]}")
            assigned_regions.update(r for r in segrs if r in all_regions)
            for p in safe_list(seg.get("pages")):
                try:
                    assigned_pages.add(int(p))
                except (TypeError, ValueError):
                    continue

        missing_regions = all_regions - assigned_regions
        if missing_regions:
            errors.append(f"{len(missing_regions)} region(s) not assigned to any segment "
                          f"(nothing may be dropped): {sorted(missing_regions)[:8]}")
        missing_pages = all_pages - assigned_pages
        if missing_pages:
            errors.append(f"page(s) not assigned to any segment: {sorted(missing_pages)}")

        return ValidationResult(ok=not errors, errors=errors, warnings=warnings,
                                validator=f"{self.agent_name}.skeleton", fallbackUsed=False)

    # ── run (real ADK Runner, one repair, no fake fallback) ──────────────────
    async def run(self, payload: JsonDict) -> JsonDict:
        payload = safe_dict(payload)
        if not adk_available():
            raise AdkRuntimeError(f"{self.agent_name} requires Google ADK (real agent, no fallback)")

        images = tc.image_bytes(payload)
        if not images:
            raise AdkRuntimeError(f"{self.agent_name} requires real PDF page images")

        prompt = self.build_prompt(payload)
        out = await run_adk_agent(
            name=self.agent_name, instruction=self.instruction, prompt=prompt,
            model=self.model, images=images, output_schema=ARCHITECT_SCHEMA,
            temperature=0.3, max_output_tokens=65536, retries=1,
        )
        skeleton = safe_dict(out.get("result"))
        vr = self.validate(skeleton, payload)

        if not vr.ok:
            repair = prompt + (
                "\n\n────────── REPAIR ──────────\n"
                "Your previous skeleton failed these checks. Fix EXACTLY these and return the "
                "full corrected skeleton JSON:\n- " + "\n- ".join(vr.errors)
            )
            out = await run_adk_agent(
                name=self.agent_name, instruction=self.instruction, prompt=repair,
                model=self.model, images=images, output_schema=ARCHITECT_SCHEMA,
                temperature=0.2, max_output_tokens=65536, retries=1,
            )
            skeleton = safe_dict(out.get("result"))
            vr = self.validate(skeleton, payload)

        if not vr.ok:
            raise AdkRuntimeError(f"{self.agent_name} could not build a valid skeleton: {vr.errors}")

        n_segs = len(safe_list(skeleton.get("segmentOutline")))
        print(f"[{self.agent_name}] skeleton: {n_segs} segments, "
              f"ranThroughAdkRunner={out.get('ranThroughAdkRunner')}, "
              f"events={out.get('adkEvents')}", file=sys.stderr)
        skeleton["_adk"] = {
            "ranThroughAdkRunner": out.get("ranThroughAdkRunner"),
            "adkEvents": out.get("adkEvents"),
            "model": self.model,
        }
        return skeleton
