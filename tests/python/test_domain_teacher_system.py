"""
tests/python/test_domain_teacher_system.py
===============================================================================
Tests for the domain router + 8 domain teacher agents + LangGraph quality loop.

All tests use REAL data from the stage2_step3_vision_proof.json proof file
(database/SQL domain — ERD diagrams, schema text).

Run:
  conda activate live-tutor-adk
  pytest tests/python/test_domain_teacher_system.py -v
===============================================================================
"""

import json
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def vision_proof():
    p = ROOT / "agent_output" / "stage2_step3_vision_proof.json"
    if not p.exists():
        pytest.skip("stage2_step3_vision_proof.json not found")
    return json.loads(p.read_text())


@pytest.fixture
def source_truth_proof():
    p = ROOT / "agent_output" / "stage2_step2_source_truth_packet_proof.json"
    if not p.exists():
        pytest.skip("stage2_step2_source_truth_packet_proof.json not found")
    return json.loads(p.read_text())


@pytest.fixture
def real_payload(vision_proof, source_truth_proof):
    """Realistic pipeline payload combining source truth + vision index."""
    src = source_truth_proof.get("result") or source_truth_proof
    return {
        "selectedNode":    {"title": "Database Denormalization", "nodeId": "node_test_1"},
        "studentLevel":    "beginner",
        "visionIndex":     vision_proof.get("visionIndex") or [],
        "pageImages":      [],
        "selectedEvidence": src.get("selectedEvidence") or [],
        "chunks":          src.get("selectedEvidence") or [],
        "sourceRefs":      src.get("sourceRefs") or [],
        "fullPdfSummary":  src.get("fullPdfSummary") or "Database denormalization PDF",
        "fullPdfOutline":  src.get("fullPdfOutline") or "",
    }


# ── TEACHER_REGISTRY ──────────────────────────────────────────────────────────

def test_teacher_registry_has_all_domains():
    from google_agent.planning.teachers import TEACHER_REGISTRY, get_teacher
    expected = {"sql_database", "math", "programming", "biology_science",
                "finance_econ", "history_law", "ai_ml", "general"}
    assert set(TEACHER_REGISTRY.keys()) == expected


def test_get_teacher_returns_correct_type():
    from google_agent.planning.teachers import get_teacher
    from google_agent.planning.teachers.sql_database_teacher import SQLDatabaseTeacher
    teacher = get_teacher("sql_database")
    assert isinstance(teacher, SQLDatabaseTeacher)


def test_get_teacher_raises_on_unknown_domain():
    from google_agent.planning.teachers import get_teacher
    with pytest.raises(ValueError, match="No teacher for domain"):
        get_teacher("quantum_physics")


def test_all_teachers_instantiate():
    from google_agent.planning.teachers import TEACHER_REGISTRY
    for domain, cls in TEACHER_REGISTRY.items():
        teacher = cls()
        assert teacher.agent_name
        assert teacher.domain == domain
        assert len(teacher.screen_families) > 0
        assert len(teacher.teaching_sequence) > 0
        assert teacher.hook_opening
        assert teacher.domain_addon_prompt
        # every teacher emits the LessonContract schema
        assert "segments" in teacher.response_schema["properties"]


# ── DOMAIN ROUTER ─────────────────────────────────────────────────────────────

def test_domain_router_valid_input(real_payload):
    from google_agent.planning.domain_router import DomainRouterAgent
    agent = DomainRouterAgent()
    result = agent.validate_input(real_payload)
    assert result.ok, f"Input validation failed: {result.errors}"


def test_domain_router_rejects_empty_payload():
    from google_agent.planning.domain_router import DomainRouterAgent
    agent = DomainRouterAgent()
    result = agent.validate_input({})
    assert not result.ok
    assert any("visionIndex" in e or "selectedEvidence" in e for e in result.errors)


def test_domain_router_builds_prompt(real_payload):
    from google_agent.planning.domain_router import DomainRouterAgent
    from google_agent.live_tutor_agents.contracts import AgentContext
    agent = DomainRouterAgent()
    ctx = AgentContext.from_payload(real_payload)
    prompt = agent.build_prompt(real_payload, ctx)
    assert "VISION REGIONS" in prompt
    assert "NODE TITLE" in prompt
    assert "Database" in prompt
    assert len(prompt) > 200


def test_domain_router_normalizes_output():
    from google_agent.planning.domain_router import DomainRouterAgent
    from google_agent.live_tutor_agents.contracts import AgentContext
    agent = DomainRouterAgent()
    ctx = AgentContext.from_payload({})
    raw = {"domain": "sql_database", "confidence": 0.92,
           "reasoning": "ERD diagrams and SQL text", "signals": ["ERD", "JOIN", "PRIMARY KEY"]}
    out = agent.normalize_output(raw, {}, ctx)
    assert out["domain"] == "sql_database"
    assert out["confidence"] == 0.92
    assert len(out["signals"]) == 3


def test_domain_router_rejects_low_confidence():
    from google_agent.planning.domain_router import DomainRouterAgent
    from google_agent.live_tutor_agents.contracts import AgentContext
    agent = DomainRouterAgent()
    ctx = AgentContext.from_payload({})
    output = {"domain": "sql_database", "confidence": 0.3,
               "reasoning": "weak", "signals": []}
    result = agent.validate_output(output, {}, ctx)
    assert not result.ok
    assert any("confidence" in e for e in result.errors)


# ── BASE DOMAIN TEACHER ───────────────────────────────────────────────────────

def test_base_teacher_rejects_no_pageimages():
    # the teacher MUST see the page images — no images → invalid
    from google_agent.planning.teachers.sql_database_teacher import SQLDatabaseTeacher
    teacher = SQLDatabaseTeacher()
    result = teacher.validate_input({"visionIndex": [{"regionId": "p1_r1"}],
                                     "selectedEvidence": [{"text": "t"}]})
    assert not result.ok
    assert any("pageImages" in e for e in result.errors)


def test_base_teacher_rejects_no_evidence():
    from google_agent.planning.teachers.sql_database_teacher import SQLDatabaseTeacher
    teacher = SQLDatabaseTeacher()
    result = teacher.validate_input({"pageImages": [{"page": 1, "imagePath": "/x.png"}],
                                     "visionIndex": [{"regionId": "p1_r1"}]})
    assert not result.ok
    assert any("selectedEvidence" in e for e in result.errors)


def test_base_teacher_builds_prompt(real_payload):
    from google_agent.planning.teachers.sql_database_teacher import SQLDatabaseTeacher
    from google_agent.live_tutor_agents.contracts import AgentContext
    teacher = SQLDatabaseTeacher()
    ctx = AgentContext.from_payload(real_payload)
    prompt = teacher.build_prompt(real_payload, ctx)
    assert "sql_database" in prompt.lower()
    assert "TEACHING SEQUENCE" in prompt
    assert "PREBUILT_SCREEN" in prompt          # two-mode design present
    assert "REALTIME_WRITING" in prompt
    assert "LessonContract" in prompt
    assert len(prompt) > 800


def test_base_teacher_level_range_targets_minutes(real_payload):
    from google_agent.planning.teachers.sql_database_teacher import SQLDatabaseTeacher
    teacher = SQLDatabaseTeacher()
    r = teacher._level_range({**real_payload, "studentLevel": "beginner"})
    assert r["minMinutes"] == 45 and r["maxMinutes"] == 120
    assert 45 <= r["targetMinutes"] <= 120
    adv = teacher._level_range({**real_payload, "studentLevel": "advanced"})
    # every concept is at least 30 minutes
    assert adv["minMinutes"] >= 30
    assert r["minMinutes"] >= 30 and r["targetMinutes"] >= 30


def _contract(region_ids, both_modes=True):
    """Minimal valid LessonContract for validation tests (rich: elements + practice)."""
    screens = [
        {"screenId": "s1", "mode": "PREBUILT_SCREEN", "template": "diagram_explainer",
         "mainIdea": "Show the ERD", "requiredRegionIds": region_ids[:1],
         "teacherIntent": "point at the schema", "visualActionsNeeded": ["spotlight"],
         "elements": [
             {"elementType": "pdf_page_image", "contentBrief": "show page 19", "regionId": (region_ids[:1] or [""])[0]},
             {"elementType": "key_points_card", "contentBrief": "fact vs dimension"}]},
        {"screenId": "s2", "mode": "REALTIME_WRITING", "template": "sql_code_example",
         "mainIdea": "Write a JOIN", "requiredRegionIds": region_ids[:1],
         "teacherIntent": "write SQL live", "visualActionsNeeded": ["writeSQL", "drawArrow"],
         "elements": [
             {"elementType": "sql_dry_run", "contentBrief": "trace the join", "needsSandbox": True},
             {"elementType": "progressive_practice_set", "contentBrief": "easy->hard joins"}]},
    ]
    if not both_modes:
        screens = [screens[0]]
    practice = [{"question": f"Q{i}", "answer": f"A{i}"} for i in range(3)]
    return {
        "domain": "sql_database", "nodeId": "n1", "title": "Star Schema",
        "teachingThesis": "A star schema centralizes facts.",
        "learningGoals": ["Explain fact vs dimension"],
        "segments": [
            {"segmentId": "seg1", "title": "Intro", "learningGoal": "see the schema",
             "screenPlan": screens, "practicePlan": practice,
             "teacherVoicePlan": [{"voiceLineIntent": "point_source",
                                   "textGoal": "Look at the Sale fact table",
                                   "targetRegionIds": region_ids[:1]}]},
            {"segmentId": "seg2", "title": "Practice", "learningGoal": "apply it",
             "screenPlan": screens, "practicePlan": practice,
             "teacherVoicePlan": [{"voiceLineIntent": "ask", "textGoal": "Your turn"}]},
        ],
    }


def test_base_teacher_validates_output_no_region_ids(real_payload):
    from google_agent.planning.teachers.sql_database_teacher import SQLDatabaseTeacher
    from google_agent.live_tutor_agents.contracts import AgentContext
    teacher = SQLDatabaseTeacher()
    ctx = AgentContext.from_payload(real_payload)
    bad = _contract([])             # no requiredRegionIds anywhere
    for seg in bad["segments"]:
        for sc in seg["screenPlan"]:
            sc["requiredRegionIds"] = []
    result = teacher.validate_output(bad, real_payload, ctx)
    assert not result.ok
    assert any("vision-grounded" in e or "regionId" in e for e in result.errors)


def test_base_teacher_validates_good_output(real_payload):
    from google_agent.planning.teachers.sql_database_teacher import SQLDatabaseTeacher
    from google_agent.live_tutor_agents.contracts import AgentContext
    teacher = SQLDatabaseTeacher()
    ctx = AgentContext.from_payload(real_payload)
    region_ids = [r.get("regionId") for r in (real_payload.get("visionIndex") or []) if r.get("regionId")]
    region_ids = region_ids or ["p1_r1"]
    good = _contract(region_ids)
    result = teacher.validate_output(good, real_payload, ctx)
    assert result.ok, f"Validation failed: {result.errors}"


# ── SEGMENT GRAPH ─────────────────────────────────────────────────────────────

def test_segment_graph_imports():
    from google_agent.generation.segment_graph import (
        segment_quality_graph, run_segment_quality_loop,
        PASS_SCORE, MAX_ATTEMPTS, SegmentQualityError,
    )
    assert PASS_SCORE == 0.70
    assert MAX_ATTEMPTS == 3
    assert segment_quality_graph is not None


def test_segment_state_typing():
    from google_agent.generation.segment_graph import SegmentState
    state: SegmentState = {
        "payload": {}, "phase_plan": {}, "draft": {},
        "critique": {}, "attempts": 0, "final": None, "error": None,
    }
    assert state["attempts"] == 0


def test_should_continue_accepts_high_score():
    from google_agent.generation.segment_graph import should_continue
    state = {"critique": {"score": 0.85}, "attempts": 1,
             "payload": {}, "phase_plan": {}, "draft": {},
             "final": None, "error": None}
    assert should_continue(state) == "accept"


def test_should_continue_repairs_low_score():
    from google_agent.generation.segment_graph import should_continue
    state = {"critique": {"score": 0.45}, "attempts": 1,
             "payload": {}, "phase_plan": {}, "draft": {},
             "final": None, "error": None}
    assert should_continue(state) == "repair"


def test_should_continue_exhausts_after_max():
    from google_agent.generation.segment_graph import should_continue, MAX_ATTEMPTS
    state = {"critique": {"score": 0.45}, "attempts": MAX_ATTEMPTS,
             "payload": {}, "phase_plan": {}, "draft": {},
             "final": None, "error": None}
    assert should_continue(state) == "exhausted"


# ── INTEGRATION: domain router prompt has real region ids ─────────────────────

def test_domain_router_prompt_includes_region_ids(real_payload):
    from google_agent.planning.domain_router import DomainRouterAgent
    from google_agent.live_tutor_agents.contracts import AgentContext
    agent = DomainRouterAgent()
    ctx = AgentContext.from_payload(real_payload)
    prompt = agent.build_prompt(real_payload, ctx)
    vision_index = real_payload.get("visionIndex") or []
    if vision_index:
        first_region_id = vision_index[0].get("regionId", "")
        assert first_region_id in prompt, f"regionId {first_region_id} not in prompt"


def test_all_teacher_prompts_include_region_ids(real_payload):
    from google_agent.planning.teachers import TEACHER_REGISTRY
    from google_agent.live_tutor_agents.contracts import AgentContext
    vision_index = real_payload.get("visionIndex") or []
    if not vision_index:
        pytest.skip("no visionIndex in real_payload")
    first_rid = vision_index[0].get("regionId", "")
    for domain, cls in TEACHER_REGISTRY.items():
        teacher = cls()
        ctx = AgentContext.from_payload(real_payload)
        prompt = teacher.build_prompt(real_payload, ctx)
        assert first_rid in prompt, f"{teacher.agent_name} prompt missing regionId {first_rid}"
        assert "VISION READING" in prompt
        assert "regionId" in prompt
        assert "PREBUILT_SCREEN" in prompt and "REALTIME_WRITING" in prompt
