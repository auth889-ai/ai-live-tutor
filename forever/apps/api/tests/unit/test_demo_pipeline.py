from forever_api.generation.demo_pipeline import generate_demo_course
from tests.fixtures.sample_inputs import PATTERN_LESSON_TEXT


def test_demo_pipeline_returns_reviewed_manifest():
    result = generate_demo_course(PATTERN_LESSON_TEXT, "topic", 8)

    assert result["review"]["status"] == "pass"
    assert result["manifest"]["sceneId"] == "scene_nested_loop_rules"
    assert result["manifest"]["actions"]
    assert result["manifest"]["sourceEvidence"]

