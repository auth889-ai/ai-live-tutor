from __future__ import annotations

from forever_api.orchestration.forever_graph import run_first_slice_graph
from forever_api.orchestration.state import new_state
from forever_api.queues.celery_app import celery_app


def generate_course_job(course_id: str, session_id: str, text: str, input_type: str) -> dict:
    state = new_state(course_id=course_id, session_id=session_id, text=text, input_type=input_type)
    return dict(run_first_slice_graph(state))


if celery_app is not None:

    @celery_app.task(name="forever.generate_course")
    def generate_course_task(course_id: str, session_id: str, text: str, input_type: str) -> dict:
        return generate_course_job(course_id, session_id, text, input_type)

