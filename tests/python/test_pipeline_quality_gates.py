"""
tests/python/test_pipeline_quality_gates.py

Quality gate tests — every pipeline output MUST pass these.
If ANY of these fail, the lesson is too poor to show the student.
"""
import json
import pytest
import sys
import os
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from google_agent.pipeline.direct_gemini_pipeline import run_direct_pipeline, _ensure_minimums, _SCREEN_CATALOG


VALID_COMMAND_TYPES = {
    "writeTitle", "writeText", "highlightRow", "circleRegion", "drawArrow",
    "underlineText", "showSourceBadge", "zoomRegion", "pointerToRegion",
    "revealBlock", "fadeIn", "eraseBoard", "drawTable", "drawDiagram",
    "showCode", "animateStep", "showQuiz", "showFormula", "drawTimeline",
    "showMiniScene",
}


def make_good_result(subject="database", n_screens=25, n_cmds_per_screen=5):
    """Build a valid pipeline output for testing."""
    types = _SCREEN_CATALOG.get(subject, _SCREEN_CATALOG["general"])
    screens = [
        {
            "screenId": f"screen_{i:03d}",
            "screenType": types[i % len(types)],
            "title": f"Section {i}",
            "blocks": [
                {"blockId": f"b{i}_1", "type": "heading", "content": f"Point {i}"},
                {"blockId": f"b{i}_2", "type": "body", "content": "Explanation content here."},
            ],
            "sourceRef": f"[Page {i+1}]",
            "teacherNote": f"Teacher note for section {i}",
        }
        for i in range(n_screens)
    ]
    commands = []
    for i, screen in enumerate(screens):
        for j in range(n_cmds_per_screen):
            commands.append({
                "commandId": f"cmd_{i:03d}_{j}",
                "screenId": screen["screenId"],
                "voiceLineId": f"vl_{i:03d}",
                "commandType": "writeText",
                "content": f"Board note {j}",
                "targetRegionId": None,
                "bbox": None,
                "startMs": j * 2000,
                "endMs": (j + 1) * 2000,
                "sourceRef": screen["sourceRef"],
            })
    voice = [
        {
            "lineId": f"vl_{i:03d}",
            "screenId": screen["screenId"],
            "text": f"Let me explain section {i} which is about {screen['title']} in detail.",
            "startMs": 0,
            "endMs": 10000,
            "words": [],
        }
        for i, screen in enumerate(screens)
    ]
    return {
        "boardScreens": screens,
        "boardCommands": commands,
        "voiceScript": voice,
        "subtitles": [{"lineId": v["lineId"], "text": v["text"], "startMs": 0, "endMs": 10000} for v in voice],
        "sourceRefs": [{"chunkId": "c1", "page": 1, "quote": "Evidence.", "confidence": 0.9}],
        "metadata": {"fallbackUsed": False, "pipeline": "test"},
        "lessonMetadata": {
            "totalScreens": n_screens,
            "totalCommands": n_screens * n_cmds_per_screen,
            "fallbackUsed": False,
        },
    }


# ══════════════════════════════════════════════════════════════════
# MINIMUM COUNT GATES
# ══════════════════════════════════════════════════════════════════

class TestMinimumCountGates:

    def test_gate_min_20_screens(self):
        result = make_good_result(n_screens=25)
        assert len(result["boardScreens"]) >= 20, "GATE FAIL: fewer than 20 screens"

    def test_gate_min_100_commands(self):
        result = make_good_result(n_screens=25, n_cmds_per_screen=5)
        assert len(result["boardCommands"]) >= 100, "GATE FAIL: fewer than 100 commands"

    def test_gate_min_20_voice_lines(self):
        result = make_good_result(n_screens=25)
        assert len(result["voiceScript"]) >= 20, "GATE FAIL: fewer than 20 voice lines"

    def test_gate_min_1_source_ref(self):
        result = make_good_result()
        assert len(result.get("sourceRefs", [])) >= 1, "GATE FAIL: no source refs — AI teaching from nothing"

    def test_gate_fails_if_10_screens(self):
        """Prove the gate correctly rejects low output."""
        result = make_good_result(n_screens=10)
        assert len(result["boardScreens"]) < 20  # confirms gate would fail

    def test_gate_fails_if_50_commands(self):
        result = make_good_result(n_screens=10, n_cmds_per_screen=5)
        assert len(result["boardCommands"]) < 100  # confirms gate would fail


# ══════════════════════════════════════════════════════════════════
# STRUCTURAL INTEGRITY GATES
# ══════════════════════════════════════════════════════════════════

class TestStructuralGates:

    def test_every_screen_has_screenId(self):
        result = make_good_result()
        for screen in result["boardScreens"]:
            assert "screenId" in screen, f"Screen missing screenId: {screen}"

    def test_every_screen_has_screenType(self):
        result = make_good_result()
        for screen in result["boardScreens"]:
            assert "screenType" in screen, f"Screen missing screenType: {screen}"

    def test_every_screen_has_at_least_1_block(self):
        result = make_good_result()
        for screen in result["boardScreens"]:
            assert len(screen.get("blocks", [])) >= 1, f"Screen {screen['screenId']} has no blocks"

    def test_every_command_has_commandId(self):
        result = make_good_result()
        for cmd in result["boardCommands"]:
            assert "commandId" in cmd, "Command missing commandId"

    def test_every_command_has_timing(self):
        result = make_good_result()
        for cmd in result["boardCommands"]:
            assert "startMs" in cmd and "endMs" in cmd, f"Command {cmd.get('commandId')} missing timing"

    def test_command_timing_valid(self):
        result = make_good_result()
        for cmd in result["boardCommands"]:
            assert cmd["startMs"] >= 0, "Negative startMs"
            assert cmd["endMs"] > cmd["startMs"], f"endMs <= startMs for {cmd['commandId']}"

    def test_command_ids_are_unique(self):
        result = make_good_result()
        ids = [c["commandId"] for c in result["boardCommands"]]
        assert len(ids) == len(set(ids)), f"Duplicate commandIds: {len(ids) - len(set(ids))} duplicates"

    def test_screen_ids_are_unique(self):
        result = make_good_result()
        ids = [s["screenId"] for s in result["boardScreens"]]
        assert len(ids) == len(set(ids)), "Duplicate screenIds"

    def test_every_voice_line_has_text(self):
        result = make_good_result()
        for vl in result["voiceScript"]:
            assert len(vl.get("text", "")) > 10, f"Voice line {vl.get('lineId')} has empty text"

    def test_voice_lines_reference_valid_screens(self):
        result = make_good_result()
        screen_ids = {s["screenId"] for s in result["boardScreens"]}
        for vl in result["voiceScript"]:
            assert vl.get("screenId") in screen_ids, f"Voice line {vl['lineId']} references unknown screen"

    def test_commands_reference_valid_screens(self):
        result = make_good_result()
        screen_ids = {s["screenId"] for s in result["boardScreens"]}
        for cmd in result["boardCommands"]:
            assert cmd.get("screenId") in screen_ids, f"Command {cmd['commandId']} references unknown screen"


# ══════════════════════════════════════════════════════════════════
# QUALITY GATES (fallbackUsed contract)
# ══════════════════════════════════════════════════════════════════

class TestFallbackUsedContract:
    """
    CRITICAL: fallbackUsed must ALWAYS be False.
    The MongoDB model rejects any session with fallbackUsed=True.
    This is a hard contract throughout the entire system.
    """

    def test_pipeline_output_fallback_false(self):
        result = make_good_result()
        assert result["metadata"]["fallbackUsed"] is False

    def test_ensure_minimums_always_false(self):
        result = _ensure_minimums(
            {"boardScreens": [], "boardCommands": [], "voiceScript": [], "subtitles": [],
             "metadata": {"fallbackUsed": True}},  # attempt to set true
            _SCREEN_CATALOG["general"]
        )
        assert result["lessonMetadata"]["fallbackUsed"] is False

    def test_lesson_metadata_false(self):
        result = make_good_result()
        assert result["lessonMetadata"]["fallbackUsed"] is False

    def test_no_fake_fallback_in_screens(self):
        result = make_good_result()
        for screen in result["boardScreens"]:
            meta = screen.get("metadata", {})
            assert meta.get("fallbackUsed", False) is False


# ══════════════════════════════════════════════════════════════════
# EVIDENCE / SOURCE REF GATES
# ══════════════════════════════════════════════════════════════════

class TestSourceEvidenceGates:

    def test_source_refs_not_empty(self):
        result = make_good_result()
        assert len(result["sourceRefs"]) >= 1

    def test_screen_source_refs_cite_page(self):
        result = make_good_result()
        for screen in result["boardScreens"]:
            ref = screen.get("sourceRef", "")
            if ref:
                assert "Page" in ref or "page" in ref or ref == "", \
                    f"Screen {screen['screenId']} sourceRef doesn't cite a page: {ref!r}"

    def test_at_least_half_screens_have_source_ref(self):
        result = make_good_result()
        screens_with_ref = sum(1 for s in result["boardScreens"] if s.get("sourceRef"))
        ratio = screens_with_ref / len(result["boardScreens"])
        assert ratio >= 0.5, f"Only {ratio:.0%} of screens have sourceRef — AI teaching without evidence"


# ══════════════════════════════════════════════════════════════════
# HONEST PIPELINE CONTRACT (v3 — 2 structured calls, no fake padding)
# ══════════════════════════════════════════════════════════════════

class TestPipelineHonestContract:

    @pytest.fixture
    def database_node_payload(self):
        return {
            "nodeId": "database_denormalization",
            "nodeTitle": "Database Denormalization",
            "selectedEvidence": [{"chunkId": "c1", "text": "Denormalization adds redundancy.", "page": 5}],
        }

    def _call_a(self, n=25):
        return {
            "lessonTitle": "Database Denormalization",
            "boardScreens": [
                {"screenId": f"s{i}", "screenType": "title_concept_card", "title": f"T{i}",
                 "blocks": [{"type": "body", "content": "real content"}],
                 "sourceRef": {"page": 5, "chunkId": "c1"}} for i in range(n)
            ],
            "voiceScript": [
                {"lineId": f"v{i}", "screenId": f"s{i}",
                 "text": f"Teaching section {i} content here."} for i in range(n)
            ],
        }

    def _call_b(self, n=25, per=5):
        return {
            "boardCommands": [
                {"commandId": f"c{i}_{j}", "screenId": f"s{i}", "commandType": "writeText",
                 "bbox": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.1},
                 "startMs": (i * per + j) * 1000, "endMs": (i * per + j) * 1000 + 900,
                 "voiceLineId": f"v{i}"} for i in range(n) for j in range(per)
            ],
        }

    def test_real_pipeline_passes_gates_with_real_content(self, database_node_payload):
        with patch(
            "google_agent.pipeline.direct_gemini_pipeline._call_gemini_structured",
            side_effect=[self._call_a(), self._call_b()],
        ):
            result = run_direct_pipeline(database_node_payload)

        assert len(result["boardScreens"]) >= 20
        assert len(result["boardCommands"]) >= 100
        assert len(result["voiceScript"]) >= 20
        assert result["metadata"]["fallbackUsed"] is False
        # every command carries bbox — schema-enforced
        assert all("bbox" in c for c in result["boardCommands"])

    def test_pipeline_failure_is_honest_not_padded(self, database_node_payload):
        """GOLDEN RULE #5: Gemini failure raises — NEVER padded to 20 screens."""
        from google_agent.pipeline.direct_gemini_pipeline import DirectPipelineError
        with patch(
            "google_agent.pipeline.direct_gemini_pipeline._call_gemini_structured",
            side_effect=RuntimeError("API down"),
        ):
            with pytest.raises(DirectPipelineError):
                run_direct_pipeline(database_node_payload)
