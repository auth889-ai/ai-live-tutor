"""
google_agent/planning/pedagogy_planner_agent.py
===============================================================================
PEDAGOGY PLANNER ★ THE WORLD-CLASS LAYER ★ — Phase 2 Step 2.10 (W2.4).

Golden Rule #9: PEDAGOGY BEFORE PIXELS.
No screen is generated until the Lesson Design Contract exists.

Gemini 2.5 Pro + THINKING MODE reasons step-by-step about THIS student and
THIS material, then emits the contract a master teacher would write:
  objectives → hook → prior knowledge → MODEL → GUIDED → check/repair →
  MODEL 2 → INDEPENDENT → mistakes → assessment → closure/book save

Replaces 5 legacy agents: TeachingStrategy, CoursePlanner, SegmentPlanner,
ConceptExtraction, KnowledgeGraph (their jobs live inside this contract).

Everything dynamic: screenCountTarget computed from level + evidence volume
+ content assets — clamped to the level's range, never hardcoded.
===============================================================================
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional

try:
    from ..pipeline.gemini_structured import generate_structured_async, PRO_MODEL
    from ..registry.lesson_registries import COMMAND_TYPES
except ImportError:  # pragma: no cover
    from google_agent.pipeline.gemini_structured import (  # type: ignore
        generate_structured_async, PRO_MODEL,
    )
    from google_agent.registry.lesson_registries import COMMAND_TYPES  # type: ignore


# ── Adaptive depth ranges (POWERFUL_WORKFLOW "ADAPTIVE DEPTH") ────────────────

LEVEL_RANGES = {
    "beginner":     {"min": 80, "max": 140, "hours": "2.5-3.5"},
    "intermediate": {"min": 40, "max": 70,  "hours": "1-1.5"},
    "advanced":     {"min": 20, "max": 35,  "hours": "0.75-1"},
}


def screen_range_for(level: str, evidence_count: int) -> Dict[str, int]:
    """Dynamic bounds: level range, biased by how much real material exists."""
    r = LEVEL_RANGES.get((level or "beginner").lower(), LEVEL_RANGES["beginner"])
    # More evidence → upper half of the range; thin evidence → lower half.
    span = r["max"] - r["min"]
    bias = min(1.0, evidence_count / 30.0)
    suggested = int(r["min"] + span * bias)
    return {"min": r["min"], "max": r["max"], "suggested": suggested}


# ── The Lesson Design Contract schema (response_schema-enforced) ─────────────

_PHASES = ["hook", "prior_knowledge", "teacher_model_1", "guided_practice",
           "check_repair", "teacher_model_2", "independent_practice",
           "common_mistakes", "assessment", "closure_book"]

LESSON_CONTRACT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "learningObjectives": {
            "type": "array", "items": {"type": "string"},
            "description": "What the student WILL be able to do — measurable",
        },
        "standardsAlignment": {"type": "array", "items": {"type": "string"}},
        "materialsAndResources": {
            "type": "array", "items": {"type": "string"},
            "description": "Which PDF pages/regions/tables this lesson uses",
        },
        "lessonIntroduction": {
            "type": "object",
            "properties": {
                "hook": {"type": "string"},
                "context": {"type": "string"},
                "whyThisMatters": {"type": "string"},
            },
            "required": ["hook", "context", "whyThisMatters"],
        },
        "preInstructionalActivities": {"type": "array", "items": {"type": "string"}},
        "instructionalProcedures": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "phase": {"type": "string", "enum": _PHASES},
                    "minutes": {"type": "integer"},
                    "description": {"type": "string"},
                    "useRegionIds": {
                        "type": "array", "items": {"type": "string"},
                        "description": "visionIndex regionIds to show/point at in this phase",
                    },
                    "studentActivity": {"type": "string"},
                },
                "required": ["phase", "minutes", "description", "studentActivity"],
            },
        },
        "differentiationStrategies": {
            "type": "object",
            "properties": {
                "thisStudent": {
                    "type": "array", "items": {"type": "string"},
                    "description": "Concrete adaptations for THIS student's level",
                },
                "accessibilitySupports": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["thisStudent"],
        },
        "studentEngagementPlan": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "afterPhase": {"type": "string", "enum": _PHASES},
                    "activity": {"type": "string"},
                },
                "required": ["afterPhase", "activity"],
            },
        },
        "assessmentPlan": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "checkpoint": {"type": "string"},
                    "focus": {"type": "string"},
                    "questionCount": {"type": "integer"},
                },
                "required": ["checkpoint", "focus", "questionCount"],
            },
        },
        "closureAndReflection": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "reflectionPrompts": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["summary", "reflectionPrompts"],
        },
        "followUpActivities": {"type": "array", "items": {"type": "string"}},
        "smartBoardInteractionPlan": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "phase": {"type": "string", "enum": _PHASES},
                    "commandTypes": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["phase", "commandTypes"],
            },
        },
        "screenCountTarget": {"type": "integer"},
        "screenMix": {
            "type": "object",
            "properties": {
                "sourceGrounded": {"type": "integer"},
                "explanation": {"type": "integer"},
                "visualModel": {"type": "integer"},
                "workedExample": {"type": "integer"},
                "quizCheck": {"type": "integer"},
                "mistakeRepair": {"type": "integer"},
                "summaryBook": {"type": "integer"},
                "decoration": {"type": "integer"},
            },
            "required": ["sourceGrounded", "explanation", "visualModel",
                         "workedExample", "quizCheck", "mistakeRepair",
                         "summaryBook", "decoration"],
        },
        "keyConcepts": {
            "type": "array", "items": {"type": "string"},
            "description": "The concepts this node must teach (absorbs ConceptExtraction)",
        },
        "conceptRelations": {
            "type": "array", "items": {"type": "string"},
            "description": "How concepts relate, e.g. 'FactTable CONNECTS_TO DimensionTable via FK' (absorbs KnowledgeGraph)",
        },
        "misconceptions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["learningObjectives", "lessonIntroduction",
                 "instructionalProcedures", "differentiationStrategies",
                 "assessmentPlan", "closureAndReflection",
                 "smartBoardInteractionPlan", "screenCountTarget", "screenMix",
                 "keyConcepts", "misconceptions"],
}


def _evidence_block(payload: Dict[str, Any], limit: int = 20) -> str:
    chunks = (payload.get("selectedEvidence") or payload.get("chunks") or [])[:limit]
    lines = []
    for c in chunks:
        text = (c.get("text") or c.get("textPreview") or "")[:300]
        if text:
            lines.append(f"[p.{c.get('page', '?')}|{c.get('chunkId', '')[:24]}] {text}")
    return "\n".join(lines) or "(no evidence)"


def _vision_block(payload: Dict[str, Any], limit: int = 25) -> str:
    regions = (payload.get("visionIndex") or [])[:limit]
    if not regions:
        return "(no vision regions)"
    return "\n".join(
        f"- {r.get('regionId')} [{r.get('type')}|{r.get('teachingValue')}] "
        f"{(r.get('description') or '')[:140]}"
        for r in regions
    )


async def plan_pedagogy(
    payload: Dict[str, Any],
    domain_profile: Optional[Dict[str, Any]] = None,
    *,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    THE contract generator. Pro + Thinking. Returns LessonDesignContract.
    Raises on real failure (Golden Rule #5) — downstream must not render
    without a contract.
    """
    node_title = (payload.get("nodeTitle")
                  or (payload.get("selectedNode") or {}).get("title")
                  or "unknown topic")
    level = (payload.get("studentLevel") or "beginner").lower()
    student = payload.get("studentProfile") or {}
    domain_profile = domain_profile or {}
    evidence_count = len(payload.get("selectedEvidence") or payload.get("chunks") or [])
    bounds = screen_range_for(level, evidence_count)

    prompt = f"""You are a master teacher designing a complete lesson. Think hard
about THIS student and THIS material before writing the plan.

TOPIC: {node_title}
DOMAIN: {domain_profile.get('domain', 'general')}
STUDENT LEVEL: {level}
STUDENT WEAK POINTS: {student.get('weakPoints') or '(none known)'}
ALREADY COMPLETED: {student.get('completedNodes') or '(first lesson)'}

DOCUMENT CONTEXT:
{(payload.get('fullPdfSummary') or {}).get('overview', '')[:500]}

VISUAL REGIONS AVAILABLE ON THE REAL PDF PAGES (point at these!):
{_vision_block(payload)}

SOURCE EVIDENCE (real chunks — every claim must trace here):
{_evidence_block(payload)}

DESIGN RULES:
- Follow the teaching craft: hook → prior knowledge → MODEL 1 → GUIDED
  practice → check/repair → MODEL 2 (harder) → INDEPENDENT practice →
  common mistakes → assessment → closure with book save.
- {level.upper()} student: {"analogy before every new term, every concept explained 3 ways, check understanding every ~8 screens" if level == "beginner" else "build on prior knowledge, focus on nuance" if level == "intermediate" else "skip basics, focus on tradeoffs and edge cases"}
- screenCountTarget MUST be between {bounds['min']} and {bounds['max']}
  (suggested ≈{bounds['suggested']} given {evidence_count} evidence chunks).
  screenMix numbers must sum to screenCountTarget.
- In instructionalProcedures, reference REAL regionIds from the vision list
  when a phase should show/point at the PDF.
- Board command types available: {', '.join(COMMAND_TYPES)}.
- Misconceptions: real ones for this topic, addressed in check_repair phase.
- NEVER invent content not supported by the evidence."""

    contract = await generate_structured_async(
        prompt,
        LESSON_CONTRACT_SCHEMA,
        model=model or PRO_MODEL,
        temperature=0.4,
        thinking=True,
        max_output_tokens=32768,
    )

    # Post-validation: clamp dynamic counts to the level's honest range.
    target = int(contract.get("screenCountTarget") or bounds["suggested"])
    contract["screenCountTarget"] = max(bounds["min"], min(bounds["max"], target))
    contract["studentLevel"] = level
    contract["screenRangeApplied"] = bounds

    phases = [p.get("phase") for p in contract.get("instructionalProcedures") or []]
    print(f"[pedagogy_planner] level={level} screens={contract['screenCountTarget']} "
          f"phases={phases}", file=sys.stderr)
    return contract
