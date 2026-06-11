"""
google_agent/generation/segment_critic.py
===============================================================================
SEGMENT CRITIC — quality-stack stage 6 (W3).

An INDEPENDENT judge (thinking mode) — the generator never grades its own
homework. Scores each segment against the 12-item evidence-based rubric
(Rosenshine / Cognitive Load / Dual Coding / Feynman — teaching_principles.py)
and returns NAMED, ACTIONABLE defects.

critique_and_repair() runs the full loop:
  verify (hard checks) + critique (rubric) → pass? ship
  → fail? regenerate WITH the named defects in the prompt (×2 max)
  → still failing? return best attempt with honest quality flags.
===============================================================================
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional

try:
    from ..pipeline.gemini_structured import generate_structured_async, FLASH_MODEL
    from .teaching_principles import CRITIC_RUBRIC, rubric_prompt_block
    from .grounding_verifier import verify_segment
except ImportError:  # pragma: no cover
    from google_agent.pipeline.gemini_structured import (  # type: ignore
        generate_structured_async, FLASH_MODEL)
    from google_agent.generation.teaching_principles import (  # type: ignore
        CRITIC_RUBRIC, rubric_prompt_block)
    from google_agent.generation.grounding_verifier import verify_segment  # type: ignore

PASS_SCORE = 7.0

CRITIQUE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "itemScores": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rubricId": {"type": "string"},
                    "score": {"type": "integer", "description": "0-10"},
                    "evidence": {"type": "string",
                                 "description": "What in the segment justifies this score"},
                },
                "required": ["rubricId", "score", "evidence"],
            },
        },
        "overallScore": {"type": "number"},
        "topDefects": {
            "type": "array",
            "items": {"type": "string"},
            "description": "The 1-4 most damaging, SPECIFIC, FIXABLE problems "
                           "(name the screenId and exactly what to change)",
        },
        "strengths": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["itemScores", "overallScore", "topDefects"],
}


def _segment_digest(segment: Dict[str, Any], max_chars: int = 30000) -> str:
    """Compact but faithful representation for the critic."""
    import json
    lines: List[str] = []
    for s in segment.get("screens") or []:
        lines.append(f"## {s.get('screenId')} [{s.get('screenType')}] {s.get('title')}")
        for b in s.get("blocks") or []:
            lines.append(f"  block[{b.get('type')}|{b.get('emphasis')}]: "
                         f"{(b.get('content') or '')[:220]}")
        for step in s.get("dryRun") or []:
            lines.append(f"  dryRun{step.get('step')}: {step.get('codeLine')} -> "
                         f"{(step.get('whatHappens') or '')[:120]}")
        actions = [f"{a.get('atMs')}ms:{a.get('action')}->{a.get('targetElementId')}"
                   for a in s.get("boardActions") or []]
        lines.append(f"  actions: {', '.join(actions[:10])}")
        lines.append(f"  voice: {(s.get('voiceover') or '')[:350]}")
        lines.append(f"  check: {s.get('checkQuestion')}")
        lines.append(f"  source: p.{(s.get('sourceRef') or {}).get('page')} "
                     f"\"{((s.get('sourceRef') or {}).get('quote') or '')[:90]}\"")
    return "\n".join(lines)[:max_chars]


async def critique_segment(
    segment: Dict[str, Any],
    contract: Dict[str, Any],
    phase: Dict[str, Any],
    *,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Independent rubric judgment. Returns CRITIQUE_SCHEMA-shaped dict."""
    prompt = f"""You are a strict instructional-quality examiner. Judge this lesson
segment against the evidence-based rubric. You did NOT write it — be honest.

SEGMENT PHASE: {phase.get('phase')} — plan was: {phase.get('description')}
STUDENT LEVEL: {contract.get('studentLevel')}
LESSON OBJECTIVES: {contract.get('learningObjectives')}
MISCONCEPTIONS THE LESSON MUST ADDRESS: {contract.get('misconceptions')}

THE SEGMENT:
{_segment_digest(segment)}

RUBRIC — score each item 0-10 with evidence:
{rubric_prompt_block()}

overallScore = your weighted judgment (accuracy and source_fidelity weigh
double — a wrong fact ruins a beautiful lesson).
topDefects: the few SPECIFIC fixes that would most raise the score —
name the screenId and exactly what to change. Empty if genuinely excellent."""

    result = await generate_structured_async(
        prompt, CRITIQUE_SCHEMA,
        model=model or FLASH_MODEL,
        temperature=0.2,
        thinking=True,
    )
    score = float(result.get("overallScore") or 0)
    print(f"[segment_critic] {phase.get('phase')}: score={score:.1f} "
          f"defects={len(result.get('topDefects') or [])}", file=sys.stderr)
    return result


async def critique_and_repair(
    generate_fn,
    payload: Dict[str, Any],
    contract: Dict[str, Any],
    phase: Dict[str, Any],
    segment_index: int,
    *,
    screens_target: int,
    previous_summaries: Optional[List[str]] = None,
    domain_profile: Optional[Dict[str, Any]] = None,
    max_repairs: int = 2,
) -> Dict[str, Any]:
    """
    Full quality loop for one segment:
      generate → verify(hard) + critique(rubric) → repair with named defects.
    Returns { segment, qualityScore, verified, critiques[], attempts }.
    generate_fn = segment_generator.generate_segment (injected for testability).
    """
    critiques: List[Dict[str, Any]] = []
    best: Optional[Dict[str, Any]] = None
    best_score = -1.0
    defect_feedback = ""

    for attempt in range(max_repairs + 1):
        segment = await generate_fn(
            payload, contract, phase, segment_index,
            screens_target=screens_target,
            previous_summaries=previous_summaries,
            domain_profile=domain_profile,
            extra_instructions=defect_feedback,
        )

        verification = verify_segment(segment, payload)
        critique = await critique_segment(segment, contract, phase)
        critiques.append(critique)
        score = float(critique.get("overallScore") or 0)
        if verification["defects"]:
            score = min(score, 6.0)   # hard-check failures cap the score

        if score > best_score:
            best, best_score = segment, score

        if score >= PASS_SCORE and not verification["defects"]:
            return {"segment": segment, "qualityScore": score,
                    "verified": True, "critiques": critiques,
                    "attempts": attempt + 1}

        # Build NAMED defect feedback for the regeneration prompt
        named = (verification["defects"][:4]
                 + (critique.get("topDefects") or [])[:4])
        for d in named:   # visible in run logs — the flywheel needs eyes
            print(f"[segment_critic] DEFECT seg{segment_index}: {d[:180]}",
                  file=sys.stderr)
        defect_feedback = (
            "PREVIOUS ATTEMPT HAD THESE SPECIFIC DEFECTS — fix every one:\n"
            + "\n".join(f"  - {d}" for d in named))
        print(f"[segment_critic] seg{segment_index} attempt {attempt + 1} "
              f"scored {score:.1f} — repairing", file=sys.stderr)

    # Honest partial: best attempt, flagged (Golden Rule #5 — no silent garbage)
    return {"segment": best, "qualityScore": best_score,
            "verified": False, "critiques": critiques,
            "attempts": max_repairs + 1}
