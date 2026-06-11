"""
tests/python/test_pedagogy_layer.py
Tests for W2.3 DomainUnderstanding + W2.4 PedagogyPlanner.
Gemini mocked; live verification via separate script runs.
"""

from unittest.mock import patch

import pytest

from google_agent.planning.domain_understanding_agent import (
    DOMAIN_PROFILE_SCHEMA, understand_domain,
)
from google_agent.planning.pedagogy_planner_agent import (
    LESSON_CONTRACT_SCHEMA, LEVEL_RANGES, plan_pedagogy, screen_range_for,
)

_DOMAIN_MOD = "google_agent.planning.domain_understanding_agent"
_PED_MOD = "google_agent.planning.pedagogy_planner_agent"


def _payload(level="beginner", evidence=20):
    return {
        "nodeTitle": "Star Schema",
        "studentLevel": level,
        "selectedEvidence": [
            {"chunkId": f"c{i}", "page": 5 + i % 3,
             "text": f"Star schema fact table dimension content {i}"}
            for i in range(evidence)
        ],
        "visionIndex": [
            {"regionId": "p5_r1", "page": 5, "type": "diagram",
             "description": "Star schema diagram", "teachingValue": "high",
             "bbox": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.4}},
        ],
        "fullPdfSummary": {"overview": "Database design slides."},
    }


def _domain_response():
    return {
        "domain": "sql_database",
        "contentAssets": {"hasTables": True, "hasCode": True, "hasFormulas": False,
                          "hasFigures": True, "hasTimelines": False, "hasCharts": False},
        "reasoning": "SQL DDL and schema diagrams dominate the evidence.",
    }


def _contract_response(screens=100):
    return {
        "learningObjectives": ["Explain why star schema speeds up analytics"],
        "lessonIntroduction": {"hook": "Your bank app...", "context": "ctx",
                               "whyThisMatters": "because"},
        "instructionalProcedures": [
            {"phase": "hook", "minutes": 5, "description": "open",
             "useRegionIds": ["p5_r1"], "studentActivity": "listen"},
            {"phase": "teacher_model_1", "minutes": 15, "description": "model",
             "useRegionIds": ["p5_r1"], "studentActivity": "watch"},
            {"phase": "assessment", "minutes": 10, "description": "quiz",
             "useRegionIds": [], "studentActivity": "answer"},
        ],
        "differentiationStrategies": {"thisStudent": ["analogy first"]},
        "assessmentPlan": [{"checkpoint": "mid", "focus": "joins", "questionCount": 3}],
        "closureAndReflection": {"summary": "s", "reflectionPrompts": ["what clicked?"]},
        "smartBoardInteractionPlan": [{"phase": "teacher_model_1",
                                       "commandTypes": ["showPdfCrop", "circle"]}],
        "screenCountTarget": screens,
        "screenMix": {"sourceGrounded": 12, "explanation": 20, "visualModel": 18,
                      "workedExample": 20, "quizCheck": 12, "mistakeRepair": 10,
                      "summaryBook": 6, "decoration": 2},
        "keyConcepts": ["fact table", "dimension table"],
        "misconceptions": ["denormalization means no design"],
    }


# ── Domain understanding ──────────────────────────────────────────────────────

class TestDomainUnderstanding:
    @pytest.mark.asyncio
    async def test_registry_families_attached_from_code_not_gemini(self):
        """Gemini picks the domain; the REGISTRY supplies the families."""
        async def fake(prompt, schema, **kw):
            return _domain_response()
        with patch(f"{_DOMAIN_MOD}.generate_structured_async", side_effect=fake):
            profile = await understand_domain(_payload())
        assert profile["domain"] == "sql_database"
        assert "star_schema_fact_dimension" in profile["recommendedScreenFamilies"]
        assert "join_bridge_animation" in profile["recommendedScreenFamilies"]
        assert profile["subjectDecoTheme"] == "database_table_icons"

    @pytest.mark.asyncio
    async def test_vision_signal_included_in_prompt(self):
        captured = {}
        async def fake(prompt, schema, **kw):
            captured["prompt"] = prompt
            return _domain_response()
        with patch(f"{_DOMAIN_MOD}.generate_structured_async", side_effect=fake):
            await understand_domain(_payload())
        assert "Star schema diagram" in captured["prompt"]   # vision evidence used

    def test_schema_requires_assets_and_reasoning(self):
        assert "contentAssets" in DOMAIN_PROFILE_SCHEMA["required"]
        assert "reasoning" in DOMAIN_PROFILE_SCHEMA["required"]


# ── Screen range math (dynamic, never hardcoded) ─────────────────────────────

class TestScreenRange:
    def test_beginner_range(self):
        r = screen_range_for("beginner", 30)
        assert r["min"] == 80 and r["max"] == 140

    def test_advanced_range(self):
        r = screen_range_for("advanced", 30)
        assert r["min"] == 20 and r["max"] == 35

    def test_more_evidence_more_screens(self):
        thin = screen_range_for("beginner", 5)["suggested"]
        rich = screen_range_for("beginner", 30)["suggested"]
        assert rich > thin

    def test_unknown_level_defaults_to_beginner(self):
        assert screen_range_for("wizard", 10)["min"] == LEVEL_RANGES["beginner"]["min"]


# ── Pedagogy planner ──────────────────────────────────────────────────────────

class TestPedagogyPlanner:
    @pytest.mark.asyncio
    async def test_contract_returned_with_level_and_bounds(self):
        async def fake(prompt, schema, **kw):
            return _contract_response(100)
        with patch(f"{_PED_MOD}.generate_structured_async", side_effect=fake):
            contract = await plan_pedagogy(_payload("beginner"))
        assert contract["studentLevel"] == "beginner"
        assert contract["screenCountTarget"] == 100

    @pytest.mark.asyncio
    async def test_screen_count_clamped_to_level_range(self):
        """Gemini says 500 screens? Clamp to the honest beginner max (140)."""
        async def fake(prompt, schema, **kw):
            return _contract_response(500)
        with patch(f"{_PED_MOD}.generate_structured_async", side_effect=fake):
            contract = await plan_pedagogy(_payload("beginner"))
        assert contract["screenCountTarget"] == 140

    @pytest.mark.asyncio
    async def test_advanced_clamp_low(self):
        async def fake(prompt, schema, **kw):
            return _contract_response(100)
        with patch(f"{_PED_MOD}.generate_structured_async", side_effect=fake):
            contract = await plan_pedagogy(_payload("advanced"))
        assert contract["screenCountTarget"] == 35   # advanced max

    @pytest.mark.asyncio
    async def test_uses_thinking_mode_and_pro(self):
        """Golden requirement: the planner THINKS."""
        captured = {}
        async def fake(prompt, schema, **kw):
            captured.update(kw)
            return _contract_response()
        with patch(f"{_PED_MOD}.generate_structured_async", side_effect=fake):
            await plan_pedagogy(_payload())
        assert captured.get("thinking") is True
        assert "pro" in (captured.get("model") or "")

    @pytest.mark.asyncio
    async def test_prompt_contains_real_region_ids_and_evidence(self):
        captured = {}
        async def fake(prompt, schema, **kw):
            captured["prompt"] = prompt
            return _contract_response()
        with patch(f"{_PED_MOD}.generate_structured_async", side_effect=fake):
            await plan_pedagogy(_payload())
        assert "p5_r1" in captured["prompt"]            # vision regions offered
        assert "Star schema fact table" in captured["prompt"]  # real evidence

    @pytest.mark.asyncio
    async def test_failure_raises_never_fakes(self):
        """Golden Rule #5 + #9: no contract → no lesson. Never a fake contract."""
        async def fake(prompt, schema, **kw):
            raise RuntimeError("API down")
        with patch(f"{_PED_MOD}.generate_structured_async", side_effect=fake):
            with pytest.raises(Exception):
                await plan_pedagogy(_payload())

    def test_schema_requires_the_teaching_craft(self):
        req = LESSON_CONTRACT_SCHEMA["required"]
        for field in ("learningObjectives", "instructionalProcedures",
                      "assessmentPlan", "closureAndReflection",
                      "screenCountTarget", "screenMix", "misconceptions"):
            assert field in req
