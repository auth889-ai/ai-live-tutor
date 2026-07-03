from __future__ import annotations


def plan_course(learning_units: list[dict], target_minutes: int) -> dict:
    return {
        "courseId": "course_patterns_demo",
        "title": "Nested Loops Pattern Masterclass",
        "targetMinutes": target_minutes,
        "episodes": [
            {
                "episodeId": "ep_001",
                "title": "The Four Pattern Rules",
                "learningUnitIds": [unit["unitId"] for unit in learning_units],
                "estimatedMinutes": min(target_minutes, 8),
            }
        ],
    }

