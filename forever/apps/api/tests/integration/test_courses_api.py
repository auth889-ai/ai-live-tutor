from fastapi.testclient import TestClient

from forever_api.main import app
from tests.fixtures.sample_inputs import PATTERN_LESSON_TEXT


client = TestClient(app)


def test_start_course_returns_first_scene_manifest():
    response = client.post(
        "/api/courses/start",
        json={
            "inputType": "topic",
            "text": PATTERN_LESSON_TEXT,
            "learnerLevel": "beginner",
            "targetMinutes": 8,
            "useQwen": False,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["firstSceneId"] == "scene_nested_loop_rules"
    assert body["manifest"]["actions"]


def test_architecture_endpoints_are_demoable():
    graph = client.get("/api/architecture/graph").json()
    agents = client.get("/api/architecture/agents").json()

    assert graph["engine"] == "langgraph"
    assert len(agents["agents"]) >= 8

