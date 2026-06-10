"""
google_agent/pipeline/validation_gate.py
Validates Stage2 pipeline output before it is returned to Node.
Strict: no fake fallback, no empty board data, no ungrounded content.
"""
from __future__ import annotations
from typing import List

try:
    from ..live_tutor_agents.contracts import ValidationResult, clean_text, JsonDict
except ImportError:
    from google_agent.live_tutor_agents.contracts import ValidationResult, clean_text, JsonDict

try:
    from .pipeline_state import PipelineState
except ImportError:
    from google_agent.pipeline.pipeline_state import PipelineState


def validate_pipeline_output(state: PipelineState) -> ValidationResult:
    errors: List[str] = []
    warnings: List[str] = []

    if state.fallback_used:
        errors.append("fallbackUsed is true — no fake data allowed.")

    if not state.board_commands:
        errors.append("boardCommands is empty — real board animation is required.")

    if not state.voice_lines:
        errors.append("voiceScript is empty — voice narration is required.")

    if not state.subtitle_lines:
        warnings.append("subtitles is empty — subtitle sync strongly recommended.")

    has_refs = bool(state.source_refs or state.context.selected_evidence or state.context.source_refs)
    if not has_refs:
        errors.append("sourceRefs is empty — every lesson must be source-grounded.")

    _check_board_commands(state.board_commands[:12], errors, warnings)
    _check_voice_lines(state.voice_lines[:12], errors, warnings)

    for agent_err in state.errors:
        errors.append(f"Pipeline agent error: {agent_err}")

    return ValidationResult(
        ok=not errors,
        errors=errors,
        warnings=warnings,
        validator="validation_gate.validate_pipeline_output",
        fallbackUsed=False,
    )


def _check_board_commands(cmds: List[JsonDict], errors: List[str], warnings: List[str]) -> None:
    for i, cmd in enumerate(cmds):
        if not cmd.get("commandId"):
            errors.append(f"boardCommands[{i}].commandId missing.")
        if not cmd.get("type"):
            errors.append(f"boardCommands[{i}].type missing.")
        if int(cmd.get("durationMs") or 0) <= 0:
            warnings.append(f"boardCommands[{i}].durationMs should be positive.")


def _check_voice_lines(lines: List[JsonDict], errors: List[str], warnings: List[str]) -> None:
    for i, line in enumerate(lines):
        if not clean_text(line.get("text") or ""):
            errors.append(f"voiceScript[{i}].text is empty.")
        start_ms = int(line.get("startMs") or 0)
        end_ms = int(line.get("endMs") or 0)
        if end_ms > 0 and end_ms < start_ms:
            warnings.append(f"voiceScript[{i}] endMs {end_ms} < startMs {start_ms}.")
