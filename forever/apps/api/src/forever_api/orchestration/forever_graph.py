from __future__ import annotations

from forever_api.generation.demo_pipeline import generate_demo_course
from forever_api.orchestration.state import ForeverState


GRAPH_NODE_NAMES = [
    "ingest_input",
    "build_source_pack",
    "retrieve_semantic_context",
    "extract_learning_units",
    "plan_course",
    "plan_teaching_intents",
    "plan_representations",
    "generate_script_beats",
    "align_voice",
    "compile_timeline",
    "review_grounding_pedagogy_sync",
    "repair_failed_parts",
    "persist_ready_scene",
    "publish_scene_ready",
]


def run_first_slice_graph(state: ForeverState) -> ForeverState:
    """
    Deterministic stand-in for the LangGraph graph.

    Phase 2 replaces this with a real StateGraph while keeping the same state
    keys and node boundaries.
    """
    state["status"] = "generating"
    state["progress"] = 10

    result = generate_demo_course(
        text=state["raw_input_text"],
        input_type=state["input_type"],
        target_minutes=8,
    )
    state["source_pack"] = result["sourcePack"]
    state["learning_units"] = result["learningUnits"]
    state["course_plan"] = result["course"]
    state["timeline_manifest"] = result["manifest"]
    state["review_report"] = result["review"]
    state["ready_scene_ids"] = [result["manifest"]["sceneId"]]
    state["progress"] = 100
    state["status"] = "ready"
    return state


def build_langgraph_placeholder() -> dict:
    return {
        "engine": "langgraph",
        "status": "planned",
        "nodes": GRAPH_NODE_NAMES,
        "persistence": "state is persisted after every node",
    }

