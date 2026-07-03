from __future__ import annotations

from forever_api.modules.ingestion.source_pack import build_source_pack
from forever_api.modules.learning_units.extractor import extract_learning_units
from forever_api.modules.planning.course_planner import plan_course
from forever_api.modules.review.quality_gate import review_manifest
from forever_api.modules.script.beat_generator import generate_script_beats
from forever_api.modules.timeline.compiler import compile_timeline
from forever_api.modules.tts.alignment import align_voice


def generate_demo_course(text: str, input_type: str, target_minutes: int) -> dict:
    source_pack = build_source_pack(text, input_type)
    learning_units = extract_learning_units(source_pack)
    course = plan_course(learning_units, target_minutes)
    beats = generate_script_beats()
    alignment = align_voice(beats)
    manifest = compile_timeline(alignment)
    review = review_manifest(manifest)

    if review["status"] != "pass":
        raise ValueError(f"Demo manifest failed review: {review['issues']}")

    return {
        "course": course,
        "sourcePack": source_pack,
        "learningUnits": learning_units,
        "manifest": manifest,
        "review": review,
    }

