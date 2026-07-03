from __future__ import annotations

import json
from typing import Any

from forever_api.generation.demo_pipeline import generate_demo_course
from forever_api.modules.ingestion.source_pack import build_source_pack
from forever_api.modules.learning_units.extractor import extract_learning_units
from forever_api.modules.planning.course_planner import plan_course
from forever_api.modules.review.quality_gate import review_manifest
from forever_api.modules.timeline.compiler import compile_timeline
from forever_api.modules.tts.alignment import align_voice
from forever_api.qwen.client import QwenClient


SYSTEM_PROMPT = """
You are Forever's ScriptBeatAgent inside a source-grounded tutor product.
Return compact JSON only. Generate exactly four beats with these exact IDs:
beat_hook, beat_outer, beat_inner, beat_code.
Each beat must have beatId, beatType, text, sourceRefs.
The narration should feel like a clear YouTube coding teacher, not a slide deck.
No unsupported claims. Use the provided source text only.
"""


def _build_user_prompt(text: str, learner_level: str) -> str:
    return json.dumps(
        {
            "task": "Generate one scene of script beats for a human-like coding tutor lesson.",
            "learnerLevel": learner_level,
            "sourceText": text[:6000],
            "requiredOutput": {
                "beats": [
                    {
                        "beatId": "beat_hook",
                        "beatType": "hook",
                        "text": "2-3 sentences",
                        "sourceRefs": ["Input source"],
                    }
                ]
            },
            "style": [
                "warm but direct",
                "teacher explains like a real coding video",
                "focus on nested loops, rows, columns, dry run, code",
            ],
        }
    )


def _normalize_beats(payload: dict[str, Any]) -> list[dict]:
    beats = payload.get("beats")
    if not isinstance(beats, list) or len(beats) < 4:
        raise ValueError("Qwen response missing four beats")

    required_ids = ["beat_hook", "beat_outer", "beat_inner", "beat_code"]
    normalized = []
    by_id = {beat.get("beatId"): beat for beat in beats if isinstance(beat, dict)}

    for beat_id in required_ids:
        beat = by_id.get(beat_id)
        if not beat:
            raise ValueError(f"Qwen response missing {beat_id}")
        text = str(beat.get("text") or "").strip()
        if len(text) < 40:
            raise ValueError(f"Qwen beat {beat_id} is too short")
        normalized.append(
            {
                "beatId": beat_id,
                "beatType": str(beat.get("beatType") or "explain"),
                "text": text,
                "sourceRefs": beat.get("sourceRefs") or ["Input source"],
            }
        )

    return normalized


async def generate_qwen_course(text: str, input_type: str, learner_level: str, target_minutes: int) -> dict:
    client = QwenClient()
    if not client.configured:
        fallback = generate_demo_course(text, input_type, target_minutes)
        fallback["generationMode"] = "deterministic_fallback_no_qwen_key"
        fallback["qwenUsed"] = False
        return fallback

    source_pack = build_source_pack(text, input_type)
    learning_units = extract_learning_units(source_pack)
    course = plan_course(learning_units, target_minutes)

    raw = await client.chat_json(SYSTEM_PROMPT, _build_user_prompt(text, learner_level))
    beats = _normalize_beats(json.loads(raw))
    alignment = align_voice(beats)
    manifest = compile_timeline(alignment)
    review = review_manifest(manifest)

    if review["status"] != "pass":
        raise ValueError(f"Qwen manifest failed review: {review['issues']}")

    return {
        "course": course,
        "sourcePack": source_pack,
        "learningUnits": learning_units,
        "manifest": manifest,
        "review": review,
        "generationMode": "qwen_one_scene",
        "qwenUsed": True,
    }
