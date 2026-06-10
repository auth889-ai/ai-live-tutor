#!/usr/bin/env python3
"""
Fast Stage 2 contract checks.

This test does not call Gemini or MongoDB MCP. It proves the local wiring that
previously stopped Claude:
- SelectedPageVisionAgent.validate_input no longer crashes on ValidationResult.
- adk_pipeline_runner imports after packet-builder wiring edits.
- the new pipeline explicitly sends MCP mission mode and command lists to the
  downstream layout/handwriting agents.
"""
from __future__ import annotations

import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_selected_page_vision_validation() -> None:
    from google_agent.source.selected_page_vision_agent import SelectedPageVisionAgent

    agent = SelectedPageVisionAgent()
    for key in ("pageImagePath", "imagePath"):
        result = agent.validate_input(
            {
                "pageImages": [
                    {
                        "page": 5,
                        key: "/tmp/page-05.png",
                        "base64": "not-used-by-this-validation-test",
                    }
                ]
            }
        )
        assert_true(result.ok is True, f"SelectedPageVisionAgent input validation should pass for {key}.")
        assert_true(
            any("Gemini-ready page image" in warning for warning in result.warnings),
            f"SelectedPageVisionAgent should report page-image readiness for {key}.",
        )


def test_adk_pipeline_imports_and_wiring_markers() -> None:
    from google_agent.pipeline.adk_pipeline_runner import run_adk_pipeline

    assert_true(callable(run_adk_pipeline), "run_adk_pipeline must import.")

    source = (ROOT / "google_agent" / "pipeline" / "adk_pipeline_runner.py").read_text()
    assert_true('"mode": "mission_read_context"' in source, "MongoDbMcpToolAgent must receive mission mode.")
    assert_true('"coursePlan": course_plan' in source, "SegmentPlannerAgent must receive CoursePlannerAgent output.")
    assert_true('"boardCommands": all_cmds' in source, "Layout/handwriting agents must receive board commands.")
    assert_true('"candidate": candidate' in source, "ValidatorSafetyAgent must validate final candidate output.")


def main() -> None:
    test_selected_page_vision_validation()
    test_adk_pipeline_imports_and_wiring_markers()
    print("stage2 contract checks: ok")


if __name__ == "__main__":
    main()
