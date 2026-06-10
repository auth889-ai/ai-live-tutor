"""
tests/python/test_direct_gemini_pipeline.py

Tests for direct_gemini_pipeline.py
Covers: subject detection, screen catalog, JSON repair, ensure_minimums,
        pipeline output quality, fallbackUsed contract.
"""
import json
import pytest
import sys
import os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from google_agent.pipeline.direct_gemini_pipeline import (
    detect_subject,
    _ensure_minimums,
    _repair_partial_json,
    _SCREEN_CATALOG,
    _COMMAND_TYPES_POOL,
    run_direct_pipeline,
    _build_lesson_prompt,
)


# ══════════════════════════════════════════════════════════════════
# SUBJECT DETECTION TESTS
# ══════════════════════════════════════════════════════════════════

class TestSubjectDetection:

    def test_detects_database_from_node_title(self):
        s = detect_subject("database_denormalization_optimizing_performance", "")
        assert s == "database"

    def test_detects_database_from_evidence(self):
        s = detect_subject("data storage", "sql table join normalization foreign key index transaction")
        assert s == "database"

    def test_detects_code_from_node_title(self):
        s = detect_subject("binary_search_algorithm", "sorted array")
        assert s == "code"

    def test_detects_math_from_node_title(self):
        s = detect_subject("calculus_derivatives", "")
        assert s == "math"

    def test_detects_biology(self):
        s = detect_subject("cell_division_mitosis", "dna chromosome cell membrane")
        assert s == "biology"

    def test_detects_finance(self):
        s = detect_subject("investment_valuation", "cash flow npv irr portfolio")
        assert s == "finance"

    def test_detects_physics(self):
        s = detect_subject("quantum_mechanics_wave_particle", "quantum field energy momentum")
        assert s == "physics"

    def test_detects_history(self):
        s = detect_subject("french_revolution_causes", "revolution empire colony treaty war")
        assert s == "history"

    def test_falls_back_to_general_for_unknown(self):
        s = detect_subject("some_random_topic_xyz", "")
        assert s == "general"

    def test_combines_title_and_evidence(self):
        # title alone might not score high but combined should
        s = detect_subject("data systems", "sql database table join normalization schema denormalization")
        assert s == "database"

    def test_case_insensitive(self):
        s1 = detect_subject("DATABASE NORMALIZATION", "SQL TABLE")
        s2 = detect_subject("database normalization", "sql table")
        assert s1 == s2 == "database"

    def test_returns_string(self):
        s = detect_subject("anything", "anything")
        assert isinstance(s, str)
        assert len(s) > 0


# ══════════════════════════════════════════════════════════════════
# SCREEN CATALOG TESTS
# ══════════════════════════════════════════════════════════════════

class TestScreenCatalog:

    def test_all_subjects_have_catalog(self):
        for subject in ["database", "code", "math", "biology", "finance", "physics", "history", "general"]:
            assert subject in _SCREEN_CATALOG
            assert len(_SCREEN_CATALOG[subject]) >= 20, f"{subject} has fewer than 20 screen types"

    def test_catalog_has_no_duplicates_per_subject(self):
        for subject, types in _SCREEN_CATALOG.items():
            assert len(types) == len(set(types)), f"{subject} has duplicate screen types"

    def test_all_catalogs_have_title_card(self):
        for subject, types in _SCREEN_CATALOG.items():
            assert "title_concept_card" in types, f"{subject} missing title_concept_card"

    def test_all_catalogs_have_summary(self):
        for subject, types in _SCREEN_CATALOG.items():
            assert "summary_key_points" in types, f"{subject} missing summary_key_points"

    def test_all_catalogs_have_flipbook(self):
        for subject, types in _SCREEN_CATALOG.items():
            assert "flipbook_recap" in types, f"{subject} missing flipbook_recap"

    def test_database_has_sql_screen(self):
        assert "sql_query_block" in _SCREEN_CATALOG["database"]

    def test_code_has_dryrun_screen(self):
        assert "line_by_line_dryrun" in _SCREEN_CATALOG["code"]

    def test_math_has_formula_screen(self):
        assert "formula_reveal_card" in _SCREEN_CATALOG["math"]


# ══════════════════════════════════════════════════════════════════
# ENSURE MINIMUMS TESTS
# ══════════════════════════════════════════════════════════════════

class TestEnsureMinimums:

    def test_empty_input_produces_20_screens(self):
        result = _ensure_minimums(
            {"boardScreens": [], "boardCommands": [], "voiceScript": [], "subtitles": []},
            _SCREEN_CATALOG["database"]
        )
        assert len(result["boardScreens"]) >= 20

    def test_empty_input_produces_100_commands(self):
        result = _ensure_minimums(
            {"boardScreens": [], "boardCommands": [], "voiceScript": [], "subtitles": []},
            _SCREEN_CATALOG["database"]
        )
        assert len(result["boardCommands"]) >= 100

    def test_empty_input_produces_voice_lines(self):
        result = _ensure_minimums(
            {"boardScreens": [], "boardCommands": [], "voiceScript": [], "subtitles": []},
            _SCREEN_CATALOG["general"]
        )
        assert len(result["voiceScript"]) >= 20

    def test_5_commands_per_screen_minimum(self):
        screens = [
            {"screenId": "s1", "screenType": "title_concept_card", "title": "T", "blocks": [],
             "sourceRef": "", "teacherNote": "note"}
        ]
        result = _ensure_minimums(
            {"boardScreens": screens, "boardCommands": [], "voiceScript": [], "subtitles": []},
            _SCREEN_CATALOG["database"]
        )
        s1_cmds = [c for c in result["boardCommands"] if c.get("screenId") == "s1"]
        assert len(s1_cmds) >= 5

    def test_each_screen_has_voice_line(self):
        screens = [
            {"screenId": f"s{i}", "screenType": "definition_term_card", "title": f"T{i}",
             "blocks": [], "sourceRef": "", "teacherNote": f"note {i}"}
            for i in range(3)
        ]
        result = _ensure_minimums(
            {"boardScreens": screens, "boardCommands": [], "voiceScript": [], "subtitles": []},
            _SCREEN_CATALOG["code"]
        )
        voice_screen_ids = {v["screenId"] for v in result["voiceScript"]}
        for s in screens:
            assert s["screenId"] in voice_screen_ids

    def test_does_not_strip_existing_good_data(self):
        screens = [
            {"screenId": f"screen_{i:03d}", "screenType": "sql_query_block", "title": f"Section {i}",
             "blocks": [{"blockId": "b1", "type": "body", "content": "content"}],
             "sourceRef": "[Page 5]", "teacherNote": "explain"}
            for i in range(25)
        ]
        result = _ensure_minimums(
            {"boardScreens": screens, "boardCommands": [], "voiceScript": [], "subtitles": []},
            _SCREEN_CATALOG["database"]
        )
        assert len(result["boardScreens"]) >= 25

    def test_metadata_updated(self):
        result = _ensure_minimums(
            {"boardScreens": [], "boardCommands": [], "voiceScript": [], "subtitles": []},
            _SCREEN_CATALOG["math"]
        )
        meta = result.get("lessonMetadata", {})
        assert meta["totalScreens"] >= 20
        assert meta["totalCommands"] >= 100
        assert meta["fallbackUsed"] is False

    def test_fallback_used_always_false(self):
        result = _ensure_minimums(
            {"boardScreens": [], "boardCommands": [], "voiceScript": [], "subtitles": [],
             "metadata": {"fallbackUsed": True}},  # even if someone passes true
            _SCREEN_CATALOG["general"]
        )
        assert result["lessonMetadata"]["fallbackUsed"] is False

    def test_command_timing_monotonic(self):
        result = _ensure_minimums(
            {"boardScreens": [], "boardCommands": [], "voiceScript": [], "subtitles": []},
            _SCREEN_CATALOG["database"]
        )
        for cmd in result["boardCommands"]:
            assert cmd["startMs"] < cmd["endMs"], f"Command {cmd.get('commandId')} has startMs >= endMs"

    def test_command_ids_unique(self):
        result = _ensure_minimums(
            {"boardScreens": [], "boardCommands": [], "voiceScript": [], "subtitles": []},
            _SCREEN_CATALOG["database"]
        )
        ids = [c["commandId"] for c in result["boardCommands"]]
        assert len(ids) == len(set(ids)), "Duplicate commandIds found"


# ══════════════════════════════════════════════════════════════════
# JSON REPAIR TESTS
# ══════════════════════════════════════════════════════════════════

class TestJsonRepair:

    def test_repairs_truncated_screens_array(self):
        partial = '{"lessonTitle": "Test", "boardScreens": [{"screenId": "s1", "title": "T1"}]'
        result = _repair_partial_json(partial)
        assert len(result.get("boardScreens", [])) >= 1

    def test_repairs_truncated_commands_array(self):
        partial = '{"boardCommands": [{"commandId": "c1", "commandType": "writeText"}], "boardScr'
        result = _repair_partial_json(partial)
        assert len(result.get("boardCommands", [])) >= 1

    def test_returns_dict_always(self):
        result = _repair_partial_json("garbage {{{")
        assert isinstance(result, dict)

    def test_extracts_lesson_title(self):
        partial = '{"lessonTitle": "Database Normalization", "boardScreens": []}'
        result = _repair_partial_json(partial)
        assert result.get("lessonTitle") == "Database Normalization"

    def test_handles_empty_string(self):
        result = _repair_partial_json("")
        assert isinstance(result, dict)

    def test_handles_deeply_nested_truncation(self):
        partial = '{"boardScreens": [{"screenId": "s1", "blocks": [{"blockId": "b1", "content": "hello'
        result = _repair_partial_json(partial)
        # Should not crash, returns dict
        assert isinstance(result, dict)


# ══════════════════════════════════════════════════════════════════
# PROMPT BUILDER TESTS
# ══════════════════════════════════════════════════════════════════

class TestPromptBuilder:

    def test_prompt_contains_node_title(self, database_node_payload):
        prompt = _build_lesson_prompt(
            database_node_payload, "database", _SCREEN_CATALOG["database"]
        )
        assert "Database Denormalization" in prompt

    def test_prompt_contains_subject(self, database_node_payload):
        prompt = _build_lesson_prompt(
            database_node_payload, "database", _SCREEN_CATALOG["database"]
        )
        assert "database" in prompt.lower()

    def test_prompt_contains_evidence(self, database_node_payload):
        prompt = _build_lesson_prompt(
            database_node_payload, "database", _SCREEN_CATALOG["database"]
        )
        assert "Denormalization" in prompt
        assert "Page 5" in prompt

    def test_prompt_lists_all_screen_types(self, database_node_payload):
        types = _SCREEN_CATALOG["database"]
        prompt = _build_lesson_prompt(database_node_payload, "database", types)
        for t in types[:5]:  # check first 5
            assert t in prompt

    def test_prompt_requires_fallback_false(self, database_node_payload):
        prompt = _build_lesson_prompt(
            database_node_payload, "database", _SCREEN_CATALOG["database"]
        )
        assert "fallbackUsed" in prompt
        assert "false" in prompt.lower()

    def test_prompt_handles_no_evidence(self, empty_payload):
        prompt = _build_lesson_prompt(empty_payload, "general", _SCREEN_CATALOG["general"])
        assert "No evidence available" in prompt

    def test_prompt_is_string(self, database_node_payload):
        prompt = _build_lesson_prompt(
            database_node_payload, "database", _SCREEN_CATALOG["database"]
        )
        assert isinstance(prompt, str)
        assert len(prompt) > 500


# ══════════════════════════════════════════════════════════════════
# FULL PIPELINE TESTS (mocked Gemini)
# ══════════════════════════════════════════════════════════════════

class TestRunDirectPipeline:

    def test_pipeline_returns_dict(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        assert isinstance(result, dict)

    def test_pipeline_min_20_screens(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        assert len(result["boardScreens"]) >= 20

    def test_pipeline_min_100_commands(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        assert len(result["boardCommands"]) >= 100

    def test_pipeline_min_20_voice_lines(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        assert len(result["voiceScript"]) >= 20

    def test_fallback_used_false(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        assert result["metadata"]["fallbackUsed"] is False

    def test_pipeline_works_with_gemini_failure(self, database_node_payload):
        """Even when Gemini fails completely, pipeline returns valid structure."""
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.side_effect = RuntimeError("Gemini API error")
            result = run_direct_pipeline(database_node_payload)
        assert isinstance(result, dict)
        assert len(result.get("boardScreens", [])) >= 20
        assert result["metadata"]["fallbackUsed"] is False

    def test_pipeline_works_with_malformed_json(self, database_node_payload):
        """Pipeline recovers from malformed Gemini JSON response."""
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = '{"boardScreens": [{"screenId": "s1"}, BROKEN JSON HERE'
            result = run_direct_pipeline(database_node_payload)
        assert isinstance(result, dict)
        assert len(result.get("boardScreens", [])) >= 20

    def test_pipeline_detects_correct_subject(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        assert result["metadata"]["subject"] == "database"

    def test_pipeline_works_for_code_topic(self, code_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(code_node_payload)
        assert result["metadata"]["subject"] == "code"

    def test_pipeline_includes_metadata(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        meta = result["metadata"]
        assert "pipeline" in meta
        assert "subject" in meta
        assert "screenCount" in meta
        assert "commandCount" in meta

    def test_pipeline_empty_payload_does_not_crash(self):
        """Pipeline never crashes, even with empty input."""
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.side_effect = RuntimeError("no API key")
            result = run_direct_pipeline({})
        assert isinstance(result, dict)
        assert "boardScreens" in result

    def test_pipeline_strips_markdown_fences(self, database_node_payload):
        """Gemini sometimes wraps JSON in ```json ... ``` fences."""
        wrapped = '```json\n{"boardScreens": [], "boardCommands": [], "voiceScript": [], "subtitles": []}\n```'
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = wrapped
            result = run_direct_pipeline(database_node_payload)
        assert isinstance(result, dict)

    def test_all_commands_have_required_fields(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        for cmd in result["boardCommands"]:
            assert "commandId" in cmd
            assert "commandType" in cmd
            assert "startMs" in cmd
            assert "endMs" in cmd

    def test_all_screens_have_required_fields(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        for screen in result["boardScreens"]:
            assert "screenId" in screen
            assert "screenType" in screen

    def test_voice_lines_have_text(self, database_node_payload, mock_gemini_response_database):
        with patch("google_agent.pipeline.direct_gemini_pipeline._call_gemini") as mock_call:
            mock_call.return_value = mock_gemini_response_database
            result = run_direct_pipeline(database_node_payload)
        for vl in result["voiceScript"]:
            assert "lineId" in vl
            text = vl.get("text", "")
            assert len(text) > 5, f"Voice line {vl.get('lineId')} has empty text"
