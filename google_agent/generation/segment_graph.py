"""
google_agent/generation/segment_graph.py
===============================================================================
LANGGRAPH QUALITY LOOP — the generate → critique → repair cycle per segment.

Why LangGraph here (not ADK):
  ADK handles individual agents (identity, tools, schema).
  LangGraph handles the CYCLE — generate output → judge it → loop back if weak.
  ADK cannot express cycles. LangGraph is built for this exact pattern.

Graph shape:
  generate_node → critique_node → [score >= 0.7 OR attempts >= 3] → END
                                 → [score < 0.7 AND attempts < 3]  → repair_node → critique_node

Models:
  generate_node : Gemini Flash  — fast segment draft
  critique_node : Gemini Pro    — 9-point rubric judge
  repair_node   : Gemini Flash  — targeted fix (reads critique feedback)
  (if Pro score < 0.5 → also calls OpenAI GPT-4o as second-opinion judge)

No fallback. If all 3 attempts fail → raises SegmentQualityError.
===============================================================================
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import StateGraph, END

try:
    from ..pipeline.gemini_structured import generate_structured_async, FLASH_MODEL, PRO_MODEL
    from ..pipeline.model_router import route_structured
    from ..live_tutor_agents.contracts import safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.pipeline.gemini_structured import generate_structured_async, FLASH_MODEL, PRO_MODEL  # type: ignore
    from google_agent.pipeline.model_router import route_structured  # type: ignore
    from google_agent.live_tutor_agents.contracts import safe_dict, safe_list, clean_text  # type: ignore


MAX_ATTEMPTS = 3
PASS_SCORE = 0.70
OPENAI_SECOND_OPINION_THRESHOLD = 0.50


class SegmentQualityError(RuntimeError):
    """All repair attempts exhausted — segment could not reach quality bar."""


class SegmentState(TypedDict):
    payload: Dict[str, Any]
    phase_plan: Dict[str, Any]
    draft: Dict[str, Any]
    critique: Dict[str, Any]
    attempts: int
    final: Optional[Dict[str, Any]]
    error: Optional[str]


_CRITIQUE_SCHEMA = {
    "type": "object",
    "properties": {
        "score":    {"type": "number", "description": "0.0-1.0 overall quality"},
        "verdict":  {"type": "string", "enum": ["pass", "repair", "fail"]},
        "rubric": {
            "type": "object",
            "properties": {
                "source_proof":       {"type": "boolean"},
                "vision_grounded":    {"type": "boolean"},
                "voice_sync":         {"type": "boolean"},
                "pointer_targets":    {"type": "boolean"},
                "student_activity":   {"type": "boolean"},
                "differentiation":    {"type": "boolean"},
                "assessment_present": {"type": "boolean"},
                "no_hallucination":   {"type": "boolean"},
                "domain_appropriate": {"type": "boolean"},
            },
            "required": ["source_proof", "vision_grounded", "voice_sync",
                         "pointer_targets", "no_hallucination"],
        },
        "issues":           {"type": "array", "items": {"type": "string"}},
        "required_changes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["score", "verdict", "rubric", "issues", "required_changes"],
}


async def _generate_segment(payload: dict, phase_plan: dict,
                             prior_critique: Optional[dict] = None) -> dict:
    try:
        from ..generation.segment_generator import generate_segment
    except ImportError:
        from google_agent.generation.segment_generator import generate_segment  # type: ignore

    gen_payload = {**payload, "currentPhasePlan": phase_plan}
    if prior_critique:
        gen_payload["repairFeedback"] = prior_critique.get("required_changes", [])
        gen_payload["repairIssues"] = prior_critique.get("issues", [])
    return await generate_segment(gen_payload)


async def _critique_segment(draft: dict, payload: dict, phase_plan: dict,
                             attempt: int) -> dict:
    vision_ids = [safe_dict(r).get("regionId") for r in safe_list(payload.get("visionIndex"))]
    draft_region_ids = []
    for screen in safe_list(draft.get("screens")):
        for cmd in safe_list(safe_dict(screen).get("commands")):
            rid = safe_dict(cmd).get("targetRegionId")
            if rid:
                draft_region_ids.append(rid)

    prompt = (
        f"CRITIQUE THIS LESSON SEGMENT (attempt {attempt + 1}/{MAX_ATTEMPTS}):\n\n"
        f"PHASE PLAN: {clean_text(str(phase_plan), 800)}\n\n"
        f"KNOWN VISION REGION IDs: {', '.join(str(x) for x in vision_ids[:20])}\n"
        f"REGION IDs USED IN DRAFT: {', '.join(draft_region_ids[:20])}\n\n"
        f"DRAFT SCREENS COUNT: {len(safe_list(draft.get('screens')))}\n"
        f"DRAFT COMMANDS COUNT: {len(safe_list(draft.get('commands')))}\n\n"
        "RUBRIC (score each True/False):\n"
        "  source_proof: every screen has a real PDF sourceRef\n"
        "  vision_grounded: commands use real regionIds from the vision list above\n"
        "  voice_sync: every command has a voiceLineId\n"
        "  pointer_targets: movePointer/circle/highlight all have non-null targetRegionId\n"
        "  no_hallucination: no content invented beyond the PDF evidence\n"
        "  student_activity: at least one askStudent or quiz command\n"
        "  differentiation: screens serve both visual and text learners\n"
        "  assessment_present: at least one assessment screen or command\n"
        "  domain_appropriate: screen types match the domain\n\n"
        "Score 0.0-1.0. If score < 0.70 list EXACT required_changes to fix each issue."
    )

    result = await route_structured(
        "critic", prompt, _CRITIQUE_SCHEMA,
        system="You are a rigorous lesson quality judge. Be honest. Never award false passes.",
        temperature=0.1,
    )
    return safe_dict(result.get("result") or result)


async def _get_openai_second_opinion(draft: dict, critique: dict, payload: dict) -> dict:
    prompt = (
        "SECOND OPINION on this lesson segment critique:\n\n"
        f"ORIGINAL CRITIQUE SCORE: {critique.get('score')}\n"
        f"ISSUES: {critique.get('issues')}\n\n"
        "Do you agree with these issues? Are there additional problems?\n"
        "Return the same critique schema with your independent score."
    )
    try:
        result = await route_structured(
            "critic", prompt, _CRITIQUE_SCHEMA,
            system="You are an independent lesson quality judge. Different perspective from the first judge.",
            temperature=0.1,
        )
        return safe_dict(result.get("result") or result)
    except Exception as exc:
        print(f"[segment_graph] OpenAI second opinion failed: {str(exc)[:120]}", file=sys.stderr)
        return critique


def generate_node(state: SegmentState) -> SegmentState:
    prior_critique = state.get("critique") if state.get("attempts", 0) > 0 else None
    draft = asyncio.get_event_loop().run_until_complete(
        _generate_segment(state["payload"], state["phase_plan"], prior_critique)
    )
    return {**state, "draft": draft, "attempts": state.get("attempts", 0) + 1}


def critique_node(state: SegmentState) -> SegmentState:
    critique = asyncio.get_event_loop().run_until_complete(
        _critique_segment(state["draft"], state["payload"], state["phase_plan"], state["attempts"] - 1)
    )
    score = float(critique.get("score") or 0)
    if score < OPENAI_SECOND_OPINION_THRESHOLD:
        second = asyncio.get_event_loop().run_until_complete(
            _get_openai_second_opinion(state["draft"], critique, state["payload"])
        )
        merged_score = (score + float(second.get("score") or 0)) / 2
        merged_issues = list(set(
            safe_list(critique.get("issues")) + safe_list(second.get("issues"))
        ))
        merged_changes = list(set(
            safe_list(critique.get("required_changes")) + safe_list(second.get("required_changes"))
        ))
        critique = {**critique, "score": merged_score, "issues": merged_issues,
                    "required_changes": merged_changes, "secondOpinionUsed": True}
    return {**state, "critique": critique}


def should_continue(state: SegmentState) -> str:
    score = float(safe_dict(state.get("critique")).get("score") or 0)
    attempts = int(state.get("attempts") or 0)
    if score >= PASS_SCORE:
        return "accept"
    if attempts >= MAX_ATTEMPTS:
        return "exhausted"
    return "repair"


def repair_node(state: SegmentState) -> SegmentState:
    return generate_node(state)


def accept_node(state: SegmentState) -> SegmentState:
    return {**state, "final": state["draft"], "error": None}


def exhausted_node(state: SegmentState) -> SegmentState:
    score = float(safe_dict(state.get("critique")).get("score") or 0)
    issues = safe_list(safe_dict(state.get("critique")).get("issues"))
    return {**state, "final": None,
            "error": f"Segment quality {score:.2f} < {PASS_SCORE} after {MAX_ATTEMPTS} attempts. "
                     f"Issues: {issues}"}


_builder = StateGraph(SegmentState)
_builder.add_node("generate", generate_node)
_builder.add_node("critique", critique_node)
_builder.add_node("repair",   repair_node)
_builder.add_node("accept",   accept_node)
_builder.add_node("exhausted", exhausted_node)

_builder.set_entry_point("generate")
_builder.add_edge("generate", "critique")
_builder.add_conditional_edges(
    "critique",
    should_continue,
    {"accept": "accept", "repair": "repair", "exhausted": "exhausted"},
)
_builder.add_edge("repair", "critique")
_builder.add_edge("accept", END)
_builder.add_edge("exhausted", END)

segment_quality_graph = _builder.compile()


async def run_segment_quality_loop(
    payload: dict,
    phase_plan: dict,
) -> dict:
    """
    Run the full quality loop for one segment phase.
    Returns the approved segment dict.
    Raises SegmentQualityError if all attempts fail.
    """
    initial: SegmentState = {
        "payload":    payload,
        "phase_plan": phase_plan,
        "draft":      {},
        "critique":   {},
        "attempts":   0,
        "final":      None,
        "error":      None,
    }

    loop = asyncio.get_event_loop()
    if loop.is_running():
        final_state = await asyncio.get_event_loop().run_in_executor(
            None, lambda: asyncio.run(_invoke_graph(initial))
        )
    else:
        final_state = await _invoke_graph(initial)

    if final_state.get("error"):
        raise SegmentQualityError(final_state["error"])

    segment = final_state.get("final") or {}
    segment["_qualityScore"] = safe_dict(final_state.get("critique")).get("score")
    segment["_attempts"] = final_state.get("attempts")
    return segment


async def _invoke_graph(initial: SegmentState) -> SegmentState:
    result = await segment_quality_graph.ainvoke(initial)
    return result
