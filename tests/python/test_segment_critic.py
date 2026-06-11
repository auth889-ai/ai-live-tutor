"""
tests/python/test_segment_critic.py
Tests for teaching principles wiring + segment critic (stage 6) + repair loop.
"""

from unittest.mock import patch

import pytest

from google_agent.generation.teaching_principles import (
    CRITIC_RUBRIC, EXPLANATION_PRINCIPLES, rubric_prompt_block,
)
from google_agent.generation.segment_critic import (
    PASS_SCORE, critique_and_repair, critique_segment,
)

_CRITIC = "google_agent.generation.segment_critic"


def _payload():
    return {"selectedEvidence": [
        {"chunkId": "c1", "page": 11,
         "text": "Adding a new table is a non-destructive change."}],
        "visionIndex": []}


def _contract():
    return {"studentLevel": "beginner",
            "learningObjectives": ["obj"], "misconceptions": ["m1"]}


def _phase():
    return {"phase": "teacher_model_1", "description": "model it",
            "studentActivity": "watch"}


def _segment():
    return {"segmentSummary": "taught X",
            "screens": [{
                "screenId": "s1", "screenType": "simple_explanation",
                "title": "T", "layout": "full",
                "visualElements": [
                    {"elementId": "e1", "kind": "label", "content": "x",
                     "position": {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.1},
                     "style": "normal"},
                    {"elementId": "e2", "kind": "box", "content": "users table",
                     "position": {"x": 0.5, "y": 0.2, "w": 0.3, "h": 0.3},
                     "style": "normal"},
                    {"elementId": "e3", "kind": "label", "content": "note: additive",
                     "position": {"x": 0.1, "y": 0.8, "w": 0.5, "h": 0.06},
                     "style": "annotation"},
                ],
                "blocks": [
                    {"type": "heading", "content": "h", "emphasis": "normal"},
                    {"type": "body", "content": "real", "emphasis": "normal"},
                    {"type": "body", "content": "more real", "emphasis": "normal"},
                    {"type": "annotation", "content": "note", "emphasis": "highlight"},
                ],
                "boardActions": [{"atMs": 0, "action": "writeText",
                                  "targetElementId": "e1", "narrationCue": "go"}],
                "voiceover": "Teacher speaks.", "teacherNote": "why",
                "keyPoints": ["k"], "checkQuestion": "why?",
                "sourceRef": {"page": 11,
                              "quote": "Adding a new table is a non-destructive change"},
            }]}


def _critique(score=8.5, defects=None):
    return {"itemScores": [{"rubricId": r["id"], "score": 8, "evidence": "ok"}
                           for r in CRITIC_RUBRIC],
            "overallScore": score,
            "topDefects": defects or [],
            "strengths": ["clear"]}


# ── Principles wiring ─────────────────────────────────────────────────────────

class TestPrinciplesWiring:
    def test_rubric_covers_the_science(self):
        ids = {r["id"] for r in CRITIC_RUBRIC}
        for required in ("small_steps", "intuition_first", "worked_examples",
                         "dual_coding", "error_anticipation", "accuracy",
                         "source_fidelity"):
            assert required in ids

    def test_principles_injected_into_generator_prompt(self):
        """The laws must reach every generation call."""
        import google_agent.generation.segment_generator as gen
        import inspect
        src = inspect.getsource(gen.generate_segment)
        assert "EXPLANATION_PRINCIPLES" in src
        assert "SMALL STEPS" in EXPLANATION_PRINCIPLES
        assert "INTUITION BEFORE FORMALISM" in EXPLANATION_PRINCIPLES
        assert "DUAL CODING" in EXPLANATION_PRINCIPLES

    def test_rubric_prompt_block_lists_all(self):
        block = rubric_prompt_block()
        assert "[accuracy]" in block and "[dual_coding]" in block


# ── Critic ────────────────────────────────────────────────────────────────────

class TestCritic:
    @pytest.mark.asyncio
    async def test_critic_uses_thinking_and_rubric(self):
        captured = {}
        async def fake(prompt, schema, **kw):
            captured["prompt"] = prompt; captured.update(kw)
            return _critique()
        with patch(f"{_CRITIC}.generate_structured_async", side_effect=fake):
            await critique_segment(_segment(), _contract(), _phase())
        assert captured.get("thinking") is True
        assert "[small_steps]" in captured["prompt"]
        assert "did NOT write it" in captured["prompt"]   # independence framing


# ── Repair loop ───────────────────────────────────────────────────────────────

class TestRepairLoop:
    @pytest.mark.asyncio
    async def test_passing_segment_ships_first_attempt(self):
        async def gen_fn(payload, contract, phase, idx, **kw):
            return _segment()
        async def fake_critic(prompt, schema, **kw):
            return _critique(9.0)
        with patch(f"{_CRITIC}.generate_structured_async", side_effect=fake_critic):
            result = await critique_and_repair(gen_fn, _payload(), _contract(),
                                               _phase(), 1, screens_target=1)
        assert result["verified"] is True
        assert result["attempts"] == 1
        assert result["qualityScore"] >= PASS_SCORE

    @pytest.mark.asyncio
    async def test_failing_segment_regenerates_with_named_defects(self):
        calls = {"n": 0, "extra": []}
        async def gen_fn(payload, contract, phase, idx, **kw):
            calls["n"] += 1
            calls["extra"].append(kw.get("extra_instructions") or "")
            return _segment()
        scores = iter([5.0, 9.0])
        async def fake_critic(prompt, schema, **kw):
            return _critique(next(scores),
                             defects=["s1: voiceover ignores the visual (dual coding)"])
        with patch(f"{_CRITIC}.generate_structured_async", side_effect=fake_critic):
            result = await critique_and_repair(gen_fn, _payload(), _contract(),
                                               _phase(), 1, screens_target=1)
        assert calls["n"] == 2                       # regenerated once
        assert "dual coding" in calls["extra"][1]    # defects fed back BY NAME
        assert result["verified"] is True

    @pytest.mark.asyncio
    async def test_hard_check_failure_caps_score(self):
        bad = _segment()
        bad["screens"][0]["sourceRef"]["quote"] = "totally invented quote here"
        async def gen_fn(payload, contract, phase, idx, **kw):
            return bad
        async def fake_critic(prompt, schema, **kw):
            return _critique(9.5)    # critic loves it — but quote is fake
        with patch(f"{_CRITIC}.generate_structured_async", side_effect=fake_critic):
            result = await critique_and_repair(gen_fn, _payload(), _contract(),
                                               _phase(), 1, screens_target=1,
                                               max_repairs=1)
        assert result["verified"] is False           # hard checks beat opinion
        assert result["qualityScore"] <= 6.0

    @pytest.mark.asyncio
    async def test_exhausted_repairs_returns_best_flagged_honest(self):
        async def gen_fn(payload, contract, phase, idx, **kw):
            return _segment()
        async def fake_critic(prompt, schema, **kw):
            return _critique(5.5, defects=["s1: no realization arc"])
        with patch(f"{_CRITIC}.generate_structured_async", side_effect=fake_critic):
            result = await critique_and_repair(gen_fn, _payload(), _contract(),
                                               _phase(), 1, screens_target=1,
                                               max_repairs=2)
        assert result["verified"] is False           # flagged, never silent
        assert result["attempts"] == 3
        assert result["segment"] is not None         # best attempt kept
