"""
tests/python/test_quality_stack.py
Tests for W3 quality stack: screen schema, gold exemplars,
segment generator (stages 2-4), grounding verifier (stage 5).
"""

import json
from unittest.mock import patch

import pytest

from google_agent.generation.screen_schema import (
    BOARD_SCREEN_SCHEMA, SEGMENT_SCHEMA, DRYRUN_REQUIRED_TYPES,
)
from google_agent.generation.gold_exemplars import (
    EXEMPLAR_DRYRUN, EXEMPLAR_REALIZATION, pick_exemplar,
)
from google_agent.generation.segment_generator import (
    SegmentGenerationError, generate_segment,
)
from google_agent.generation.grounding_verifier import verify_screen, verify_segment

_GEN = "google_agent.generation.segment_generator"


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _payload():
    return {
        "nodeTitle": "Non-Destructive Changes",
        "studentLevel": "beginner",
        "selectedEvidence": [
            {"chunkId": "c1", "page": 11,
             "text": "Adding a new table is a non-destructive change. "
                     "CREATE TABLE wishlists with id user_id and added_at columns."},
            {"chunkId": "c2", "page": 15,
             "text": "Simply adding NOT NULL without a default will break inserts "
                     "from old code that doesn't send the field."},
        ],
        "visionIndex": [
            {"regionId": "p11_r4", "page": 11, "type": "code",
             "description": "SQL CREATE TABLE block",
             "bbox": {"x": 0.47, "y": 0.14, "w": 0.48, "h": 0.31}},
        ],
    }


def _contract():
    return {
        "studentLevel": "beginner",
        "learningObjectives": ["Identify non-destructive changes"],
        "misconceptions": ["Adding a column is always safe"],
        "smartBoardInteractionPlan": [
            {"phase": "teacher_model_1", "commandTypes": ["showPdfCrop", "circle"]},
        ],
    }


def _phase():
    return {"phase": "teacher_model_1", "minutes": 15,
            "description": "Model non-destructive changes using page 11 SQL",
            "useRegionIds": ["p11_r4"], "studentActivity": "follow the dry run"}


def _good_screen(sid="s1"):
    return {
        "screenId": sid, "screenType": "line_by_line_dry_run",
        "title": "T", "layout": "code_walkthrough",
        "visualElements": [
            {"elementId": "e1", "kind": "code_line", "content": "CREATE TABLE",
             "position": {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.05}, "style": "normal"},
            {"elementId": "crop1", "kind": "pdf_crop", "content": "real code",
             "position": {"x": 0.55, "y": 0.1, "w": 0.4, "h": 0.3},
             "style": "normal", "regionId": "p11_r4"},
            {"elementId": "note1", "kind": "label", "content": "wishlists: new table, zero impact",
             "position": {"x": 0.1, "y": 0.8, "w": 0.6, "h": 0.06}, "style": "annotation"},
        ],
        "blocks": [
            {"type": "heading", "content": "Watch the table build", "emphasis": "normal"},
            {"type": "body", "content": "real teaching", "emphasis": "normal"},
            {"type": "step", "content": "line 1 starts the definition", "emphasis": "normal"},
            {"type": "annotation", "content": "old code never touched", "emphasis": "highlight"},
        ],
        "dryRun": [{"step": 1, "codeLine": "CREATE TABLE wishlists",
                    "whatHappens": "table defined", "stateAfter": "table exists"}],
        "boardActions": [
            {"atMs": 0, "action": "writeText", "targetElementId": "e1",
             "narrationCue": "start"},
            {"atMs": 3000, "action": "showPdfCrop", "targetElementId": "crop1",
             "narrationCue": "the real page"},
        ],
        "voiceover": "Let's walk through this together.",
        "teacherNote": "dry run discipline",
        "keyPoints": ["DDL changes schema state"],
        "sourceRef": {"page": 11,
                      "quote": "Adding a new table is a non-destructive change"},
        "checkQuestion": "What exists after line 1?",
    }


def _segment(n=6):
    return {"segmentSummary": "Taught non-destructive changes via dry run.",
            "screens": [_good_screen(f"s{i}") for i in range(n)]}


# ── Schema sanity ─────────────────────────────────────────────────────────────

class TestSchema:
    def test_screen_requires_teaching_surfaces(self):
        req = BOARD_SCREEN_SCHEMA["required"]
        for field in ("visualElements", "blocks", "boardActions", "voiceover",
                      "teacherNote", "sourceRef", "checkQuestion", "keyPoints"):
            assert field in req

    def test_segment_requires_continuity_summary(self):
        assert "segmentSummary" in SEGMENT_SCHEMA["required"]

    def test_dryrun_required_types_exist(self):
        assert "line_by_line_dry_run" in DRYRUN_REQUIRED_TYPES
        assert "equation_derivation" in DRYRUN_REQUIRED_TYPES   # math too


# ── Gold exemplars ────────────────────────────────────────────────────────────

class TestExemplars:
    def test_exemplars_are_valid_json_at_approved_depth(self):
        for raw in (EXEMPLAR_REALIZATION, EXEMPLAR_DRYRUN):
            ex = json.loads(raw)
            assert ex["voiceover"] and ex["teacherNote"] and ex["sourceRef"]["quote"]
            assert ex["boardActions"][0]["atMs"] == 0

    def test_walkthrough_phase_gets_dryrun_exemplar(self):
        assert pick_exemplar("guided_practice", ["worked_example_step"]) == EXEMPLAR_DRYRUN

    def test_explanation_phase_gets_realization_exemplar(self):
        assert pick_exemplar("check_repair", ["misconception_repair"]) == EXEMPLAR_REALIZATION


# ── Segment generator (stages 2-4) ───────────────────────────────────────────

class TestSegmentGenerator:
    @pytest.mark.asyncio
    async def test_prompt_grounds_contract_regions_evidence_exemplar(self):
        captured = {}
        async def fake(prompt, schema, **kw):
            captured["prompt"] = prompt; captured.update(kw)
            return _segment(6)
        with patch(f"{_GEN}.generate_structured_async", side_effect=fake):
            await generate_segment(_payload(), _contract(), _phase(), 1,
                                   screens_target=6,
                                   domain_profile={"domain": "sql_database"})
        p = captured["prompt"]
        assert "Model non-destructive changes" in p          # contract phase
        assert "p11_r4" in p and "bbox=(0.47" in p           # real region + bbox
        assert "NOT NULL without a default" in p             # real evidence
        assert "GOLD EXEMPLAR" in p and "dryRun" in p        # anchor present
        assert "machine-verified" in p                        # quote warning

    @pytest.mark.asyncio
    async def test_continuity_summaries_included(self):
        captured = {}
        async def fake(prompt, schema, **kw):
            captured["prompt"] = prompt
            return _segment(6)
        with patch(f"{_GEN}.generate_structured_async", side_effect=fake):
            await generate_segment(_payload(), _contract(), _phase(), 3,
                                   screens_target=6,
                                   previous_summaries=["Taught the house analogy."])
        assert "house analogy" in captured["prompt"]
        assert "do not re-explain" in captured["prompt"]

    @pytest.mark.asyncio
    async def test_beginner_model_phase_uses_pro(self):
        captured = {}
        async def fake(prompt, schema, **kw):
            captured.update(kw)
            return _segment(6)
        with patch(f"{_GEN}.generate_structured_async", side_effect=fake):
            await generate_segment(_payload(), _contract(), _phase(), 1,
                                   screens_target=6)
        assert "pro" in captured["model"]

    @pytest.mark.asyncio
    async def test_too_few_screens_raises_honestly(self):
        async def fake(prompt, schema, **kw):
            return _segment(1)   # asked for 8, got 1
        with patch(f"{_GEN}.generate_structured_async", side_effect=fake):
            with pytest.raises(SegmentGenerationError, match="refusing to fake"):
                await generate_segment(_payload(), _contract(), _phase(), 1,
                                       screens_target=8)


# ── Grounding verifier (stage 5 — hard checks) ───────────────────────────────

class TestGroundingVerifier:
    def test_good_screen_passes(self):
        assert verify_screen(_good_screen(), _payload()) == []

    def test_invented_quote_caught(self):
        """THE anti-hallucination boolean."""
        s = _good_screen()
        s["sourceRef"]["quote"] = "the moon is made of cheese and databases"
        defects = verify_screen(s, _payload())
        assert any("NOT grounded" in d for d in defects)

    def test_verbatim_quote_tolerates_whitespace_case(self):
        s = _good_screen()
        s["sourceRef"]["quote"] = "  adding a NEW table is   a non-destructive change"
        assert verify_screen(s, _payload()) == []

    def test_fake_pdf_crop_region_caught(self):
        s = _good_screen()
        s["visualElements"][1]["regionId"] = "p99_invented"
        defects = verify_screen(s, _payload())
        assert any("not in visionIndex" in d for d in defects)

    def test_action_targeting_missing_element_caught(self):
        s = _good_screen()
        s["boardActions"].append({"atMs": 5000, "action": "circle",
                                  "targetElementId": "ghost", "narrationCue": "x"})
        defects = verify_screen(s, _payload())
        assert any("missing element 'ghost'" in d for d in defects)

    def test_non_monotonic_timing_caught(self):
        s = _good_screen()
        s["boardActions"].append({"atMs": 1000, "action": "circle",
                                  "targetElementId": "e1", "narrationCue": "x"})
        defects = verify_screen(s, _payload())
        assert any("not monotonic" in d for d in defects)

    def test_offboard_position_caught(self):
        s = _good_screen()
        s["visualElements"][0]["position"] = {"x": 0.9, "y": 0.9, "w": 0.5, "h": 0.5}
        defects = verify_screen(s, _payload())
        assert any("off-board" in d for d in defects)

    def test_procedural_screen_without_dryrun_caught(self):
        s = _good_screen()
        s["dryRun"] = []
        defects = verify_screen(s, _payload())
        assert any("requires dryRun" in d for d in defects)

    def test_empty_voiceover_caught(self):
        s = _good_screen()
        s["voiceover"] = "  "
        defects = verify_screen(s, _payload())
        assert any("empty voiceover" in d for d in defects)

    def test_segment_report_aggregates(self):
        seg = _segment(3)
        seg["screens"][1]["sourceRef"]["quote"] = "invented nonsense quote here"
        report = verify_segment(seg, _payload())
        assert report["ok"] is False
        assert report["screensChecked"] == 3
        assert report["screensWithDefects"] == 1

    def test_clean_segment_ok(self):
        report = verify_segment(_segment(4), _payload())
        assert report["ok"] is True and report["defects"] == []


# ── Layered quote grounding (the verifier fairness fix) ──────────────────────

from google_agent.generation.grounding_verifier import quote_is_grounded


class TestLayeredQuoteGrounding:
    CHUNKS = [{"chunkId": "c1", "page": 11,
               "text": "Simply adding NOT NULL without a default will break "
                       "inserts from old code that doesn't send the field."}]

    def test_exact_quote_passes(self):
        assert quote_is_grounded(
            "adding NOT NULL without a default will break inserts", self.CHUNKS)

    def test_punctuation_drift_passes(self):
        """Smart quotes / commas / dashes — meaning-identical must pass."""
        assert quote_is_grounded(
            "adding NOT NULL, without a default, will break inserts",
            self.CHUNKS)

    def test_smart_quotes_pass(self):
        assert quote_is_grounded(
            "old code that doesn’t send the field", self.CHUNKS)

    def test_single_word_drift_passes_fuzzy(self):
        """One inserted word — still clearly the same source sentence."""
        assert quote_is_grounded(
            "adding the NOT NULL without a default will break inserts",
            self.CHUNKS)

    def test_invented_quote_still_caught(self):
        """The whole point: fairness must NOT open the door to invention."""
        assert not quote_is_grounded(
            "star schemas dramatically improve OLAP query performance",
            self.CHUNKS)

    def test_half_invented_quote_caught(self):
        assert not quote_is_grounded(
            "adding NOT NULL makes databases run twice as fast always",
            self.CHUNKS)
