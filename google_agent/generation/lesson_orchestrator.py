"""
google_agent/generation/lesson_orchestrator.py
===============================================================================
LESSON ORCHESTRATOR — the conductor (W3, replaces the dead legacy generation
chain: DetailedExplanation/BoardScene/VoiceScript/DiagramCompiler text-path).

Takes the Lesson Design Contract and produces the COMPLETE lesson by running
every instructional phase through the quality stack:

  for each contract phase:
      screens_target = phase's share of contract.screenCountTarget
      critique_and_repair( generate → verify → critique → repair ×2 )
      segmentSummary flows into the next phase  (continuity — one teacher's arc)

  assemble: boardScreens + boardCommands (from each screen's timed
  boardActions, bbox resolved: pdf_crop→visionIndex bbox, others→element
  position) + voiceScript (per screen voiceover) + subtitles + quality report.

Segment-ready callback hook → Node streams segment_0 while the rest generate
(W3.4 streaming). Honest: per-segment failures flagged in qualityReport,
lesson ships only if enough verified segments exist.
===============================================================================
"""

from __future__ import annotations

import sys
from typing import Any, Awaitable, Callable, Dict, List, Optional

try:
    from .segment_generator import generate_segment, SegmentGenerationError
    from .segment_critic import critique_and_repair
except ImportError:  # pragma: no cover
    from google_agent.generation.segment_generator import (  # type: ignore
        generate_segment, SegmentGenerationError)
    from google_agent.generation.segment_critic import critique_and_repair  # type: ignore


def _phase_screen_share(contract: Dict[str, Any]) -> List[int]:
    """Split screenCountTarget across phases proportional to their minutes."""
    phases = contract.get("instructionalProcedures") or []
    total_target = int(contract.get("screenCountTarget") or 24)
    minutes = [max(1, int(p.get("minutes") or 5)) for p in phases]
    total_min = sum(minutes) or 1
    shares = [max(2, round(total_target * m / total_min)) for m in minutes]
    # Per-call ceiling: 6 screens per call — fewer screens per call means
    # more token budget per screen → DENSER boards (R11). Large phases would
    # dilute depth in a single giant call.
    return [min(s, 6) for s in shares]


def _bbox_for_action(action: Dict[str, Any], screen: Dict[str, Any],
                     vision_by_id: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Resolve the bbox a command points at:
    pdf_crop/zoomRegion targets → the REAL visionIndex bbox (the real page);
    everything else → the element's position on the board."""
    target = action.get("targetElementId")
    element = next((e for e in screen.get("visualElements") or []
                    if e.get("elementId") == target), None)
    if element is None:
        return None
    if element.get("kind") == "pdf_crop" and element.get("regionId") in vision_by_id:
        return vision_by_id[element["regionId"]].get("bbox")
    return element.get("position")


def _assemble(segment_results: List[Dict[str, Any]],
              payload: Dict[str, Any],
              contract: Dict[str, Any]) -> Dict[str, Any]:
    """Segments → final lesson package (the shape Node.js persists)."""
    vision_by_id = {r.get("regionId"): r for r in (payload.get("visionIndex") or [])}

    screens: List[Dict[str, Any]] = []
    commands: List[Dict[str, Any]] = []
    voice: List[Dict[str, Any]] = []
    subtitles: List[Dict[str, Any]] = []
    source_refs: List[Dict[str, Any]] = []
    quality: List[Dict[str, Any]] = []
    clock_ms = 0   # global lesson clock — segments play back to back

    for seg_index, result in enumerate(segment_results):
        segment = result.get("segment") or {}
        quality.append({
            "segmentIndex": seg_index,
            "phase": result.get("phase"),
            "qualityScore": result.get("qualityScore"),
            "verified": result.get("verified"),
            "attempts": result.get("attempts"),
        })

        for screen in segment.get("screens") or []:
            screen["segmentIndex"] = seg_index
            screens.append(screen)

            line_id = f"vl_{screen.get('screenId')}"
            voiceover = screen.get("voiceover") or ""
            est_ms = max(4000, len(voiceover.split()) * 380)  # ~160 wpm

            voice.append({
                "lineId": line_id,
                "screenId": screen.get("screenId"),
                "text": voiceover,
                "startMs": clock_ms,
                "durationEstimateMs": est_ms,
                "sourceRef": screen.get("sourceRef"),
            })
            subtitles.append({"lineId": line_id,
                              "screenId": screen.get("screenId"),
                              "text": voiceover,
                              "startMs": clock_ms, "endMs": clock_ms + est_ms})

            last_end = clock_ms
            for i, action in enumerate(screen.get("boardActions") or []):
                bbox = _bbox_for_action(action, screen, vision_by_id)
                start = clock_ms + int(action.get("atMs") or 0)
                end = start + 1800
                commands.append({
                    "commandId": f"cmd_{screen.get('screenId')}_{i:02d}",
                    "screenId": screen.get("screenId"),
                    "commandType": action.get("action"),
                    "targetElementId": action.get("targetElementId"),
                    "targetRegionId": (
                        next((e.get("regionId") for e in screen.get("visualElements") or []
                              if e.get("elementId") == action.get("targetElementId")
                              and e.get("kind") == "pdf_crop"), None)),
                    "bbox": bbox,
                    "startMs": start,
                    "endMs": end,
                    "narrationCue": action.get("narrationCue"),
                    "voiceLineId": line_id,
                    "sourceRef": screen.get("sourceRef"),
                })
                last_end = max(last_end, end)

            ref = screen.get("sourceRef") or {}
            if ref.get("quote"):
                source_refs.append(ref)
            clock_ms = max(clock_ms + est_ms, last_end) + 600

    verified_count = sum(1 for q in quality if q["verified"])
    scores = [q["qualityScore"] for q in quality if q["qualityScore"] is not None]

    return {
        "ok": len(screens) >= 10 and verified_count >= max(1, len(quality) // 2),
        "boardScreens": screens,
        "boardCommands": commands,
        "voiceScript": voice,
        "subtitles": subtitles,
        "sourceRefs": source_refs,
        "lessonDesignContract": contract,
        "qualityReport": {
            "segments": quality,
            "verifiedSegments": verified_count,
            "totalSegments": len(quality),
            "averageScore": round(sum(scores) / len(scores), 2) if scores else 0,
        },
        "metadata": {
            "pipeline": "quality_stack_v1",
            "fallbackUsed": False,
            "screenCount": len(screens),
            "commandCount": len(commands),
            "voiceLineCount": len(voice),
            "estimatedDurationMs": clock_ms,
        },
    }


async def orchestrate_lesson(
    payload: Dict[str, Any],
    contract: Dict[str, Any],
    *,
    domain_profile: Optional[Dict[str, Any]] = None,
    on_segment_ready: Optional[Callable[[int, Dict[str, Any]], Awaitable[None]]] = None,
    max_repairs: int = 2,
) -> Dict[str, Any]:
    """
    THE full lesson generation. Phases run sequentially (continuity), each
    through the quality stack. on_segment_ready fires per segment → streaming.
    """
    phases = contract.get("instructionalProcedures") or []
    if not phases:
        raise SegmentGenerationError("contract has no instructionalProcedures")

    shares = _phase_screen_share(contract)
    summaries: List[str] = []
    results: List[Dict[str, Any]] = []

    for idx, (phase, target) in enumerate(zip(phases, shares)):
        try:
            result = await critique_and_repair(
                generate_segment, payload, contract, phase, idx,
                screens_target=target,
                previous_summaries=summaries,
                domain_profile=domain_profile,
                max_repairs=max_repairs,
            )
        except SegmentGenerationError as exc:
            print(f"[orchestrator] segment {idx} ({phase.get('phase')}) "
                  f"FAILED honestly: {exc}", file=sys.stderr)
            results.append({"segment": None, "qualityScore": 0,
                            "verified": False, "attempts": 0,
                            "phase": phase.get("phase")})
            continue

        result["phase"] = phase.get("phase")
        results.append(result)
        summary = ((result.get("segment") or {}).get("segmentSummary") or "")
        if summary:
            summaries.append(summary)

        if on_segment_ready and result.get("segment"):
            try:
                playable_segment = _assemble([result], payload, contract)
                playable_segment["ok"] = bool(
                    playable_segment.get("boardScreens")
                    and playable_segment.get("voiceScript")
                )
                playable_segment["segmentIndex"] = idx
                playable_segment["phase"] = result.get("phase")
                playable_segment["segmentSummary"] = (
                    result.get("segment") or {}).get("segmentSummary") or ""
                playable_segment.setdefault("metadata", {}).update({
                    "segmentIndex": idx,
                    "phase": result.get("phase"),
                    "streamingPartial": True,
                })
                await on_segment_ready(idx, playable_segment)
            except Exception as exc:   # streaming must never kill generation
                print(f"[orchestrator] on_segment_ready error: {exc}",
                      file=sys.stderr)

    usable = [r for r in results if r.get("segment")]
    if not usable:
        raise SegmentGenerationError(
            "every segment failed — no lesson. (Honest failure, no padding.)")

    lesson = _assemble(usable, payload, contract)
    print(f"[orchestrator] DONE screens={lesson['metadata']['screenCount']} "
          f"commands={lesson['metadata']['commandCount']} "
          f"avgQuality={lesson['qualityReport']['averageScore']} "
          f"verified={lesson['qualityReport']['verifiedSegments']}"
          f"/{lesson['qualityReport']['totalSegments']}", file=sys.stderr)
    return lesson
