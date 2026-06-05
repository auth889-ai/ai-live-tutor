"""
google_agent/live/validator_safety_agent.py
===============================================================================
FULL REPLACEMENT FOR VERSION 4

Fix:
- Diagram validation stage must NOT require boardCommands, voiceScript, subtitles.
- Final playback validation MUST require boardCommands, voiceScript, subtitles.
- This fixes the current blocker:
    ValidatorSafetyAgent failed:
    boardCommands are required...
    voiceScript is required...
    subtitles are required...

No fake fallback.
===============================================================================
"""

from __future__ import annotations

from typing import Any, List

try:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        require_source_refs,
        safe_dict,
        safe_list,
    )
except Exception:
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
    from google_agent.live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        require_source_refs,
        safe_dict,
        safe_list,
    )


class ValidatorSafetyAgent(BaseLiveTutorAgent):
    agent_name = "ValidatorSafetyAgent"
    agent_group = "live"
    default_mode = "validate_tutor_output"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Validate the correct stage of the live tutor pipeline.
Diagram-stage validation checks diagrams/sourceRefs only.
Final-stage validation checks boardCommands, voiceScript, subtitles, replay state.
No fake fallback.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        candidate = safe_dict(payload.get("candidate") or payload.get("output") or payload)
        errors: List[str] = []

        if not candidate:
            errors.append("ValidatorSafetyAgent requires candidate/output payload.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="ValidatorSafetyAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        candidate = safe_dict(payload.get("candidate") or payload.get("output") or payload)
        strict = payload.get("strict", True) is not False

        scope = clean_text(
            payload.get("validationScope")
            or payload.get("stage")
            or safe_dict(candidate.get("metadata")).get("stage")
            or "final",
            80,
        )

        require_diagrams = self._flag(
            payload,
            "requireDiagrams",
            default=scope in {"diagram", "diagram_validation", "visual", "final", "live_tutor", "playback"},
        )
        require_board_commands = self._flag(
            payload,
            "requireBoardCommands",
            default=scope in {"final", "live_tutor", "playback", "board"},
        )
        require_voice = self._flag(
            payload,
            "requireVoice",
            default=scope in {"final", "live_tutor", "playback", "voice"},
        )
        require_subtitles = self._flag(
            payload,
            "requireSubtitles",
            default=scope in {"final", "live_tutor", "playback", "subtitle", "voice"},
        )
        require_resume_state = self._flag(
            payload,
            "requireResumeState",
            default=scope in {"final", "live_tutor", "playback"},
        )

        errors: List[str] = []
        warnings: List[str] = []
        checks: List[JsonDict] = []

        def add_check(name: str, ok: bool, detail: str, severity: str = "error") -> None:
            checks.append(
                {
                    "name": name,
                    "ok": bool(ok),
                    "detail": detail,
                    "severity": severity,
                }
            )
            if not ok:
                if severity == "warning":
                    warnings.append(detail)
                else:
                    errors.append(detail)

        source_refs = self._collect_source_refs(candidate)
        source_validation = require_source_refs(source_refs, "ValidatorSafetyAgent.sourceRefs")
        checks.append(source_validation.to_dict())
        errors.extend(source_validation.errors)
        warnings.extend(source_validation.warnings)

        compiled_diagrams = self._collect_compiled_diagrams(candidate)
        board_commands = self._collect_board_commands(candidate)
        voice_script = self._collect_voice_script(candidate)
        subtitles = self._collect_subtitles(candidate)
        resume_state = self._find_resume_state(candidate)

        if require_diagrams:
            add_check(
                "compiledDiagrams_present",
                bool(compiled_diagrams),
                "compiledDiagrams are required for diagram validation.",
            )

            for index, diagram in enumerate(compiled_diagrams):
                diagram_refs = self._collect_source_refs(diagram)
                mermaid = clean_text(diagram.get("mermaid"), 50000)
                html_preview = clean_text(diagram.get("htmlPreview") or diagram.get("html"), 50000)
                react_flow = safe_dict(diagram.get("reactFlow"))

                if not diagram_refs:
                    errors.append(f"compiledDiagrams[{index}] missing sourceRefs.")

                if not mermaid and not html_preview and not react_flow:
                    errors.append(
                        f"compiledDiagrams[{index}] must include mermaid, reactFlow, or htmlPreview."
                    )

                concepts = safe_list(diagram.get("concepts"))
                title = clean_text(diagram.get("title"), 200)
                if self._looks_keyword_only(concepts, title):
                    errors.append(f"compiledDiagrams[{index}] looks keyword-only and was rejected.")

        if require_board_commands:
            add_check(
                "boardCommands_present",
                bool(board_commands),
                "boardCommands are required for live tutor playback.",
            )

        if require_voice:
            add_check(
                "voiceScript_present",
                bool(voice_script),
                "voiceScript is required for human-like tutor playback.",
            )

        if require_subtitles:
            add_check(
                "subtitles_present",
                bool(subtitles),
                "subtitles are required for synced tutor playback.",
            )

        command_ids = {
            clean_text(cmd.get("commandId"), 160)
            for cmd in board_commands
            if clean_text(cmd.get("commandId"), 160)
        }

        if board_commands and len(command_ids) != len(board_commands):
            errors.append("Every boardCommand must have a unique commandId.")

        for index, cmd in enumerate(board_commands):
            command_id = clean_text(cmd.get("commandId"), 160)
            command_type = clean_text(cmd.get("type"), 80)
            payload_obj = safe_dict(cmd.get("payload"))

            if not command_id:
                errors.append(f"boardCommands[{index}] missing commandId.")

            command_refs = (
                safe_list(cmd.get("sourceRefs"))
                or safe_list(payload_obj.get("sourceRefs"))
                or safe_list(cmd.get("refs"))
            )
            if not command_refs:
                errors.append(f"boardCommands[{index}] missing sourceRefs.")

            write_text = clean_text(
                cmd.get("text")
                or cmd.get("body")
                or payload_obj.get("text")
                or payload_obj.get("body"),
                4000,
            )

            if command_type in {"writeText", "writeNearNode", "write", "label", "subtitle"} and not write_text:
                errors.append(f"boardCommands[{index}] write command missing text.")

        for index, line in enumerate(voice_script):
            command_id = clean_text(line.get("commandId"), 160)
            text = clean_text(line.get("text") or line.get("spokenText") or line.get("voiceText"), 4000)

            if not command_id:
                errors.append(f"voiceScript[{index}] missing commandId.")
            elif command_ids and command_id not in command_ids:
                errors.append(f"voiceScript[{index}] commandId does not exist in boardCommands: {command_id}")

            if not text:
                errors.append(f"voiceScript[{index}] missing text.")

        for index, sub in enumerate(subtitles):
            command_id = clean_text(sub.get("commandId"), 160)
            text = clean_text(sub.get("text") or sub.get("subtitle"), 4000)

            if not command_id:
                errors.append(f"subtitles[{index}] missing commandId.")
            elif command_ids and command_id not in command_ids:
                errors.append(f"subtitles[{index}] commandId does not exist in boardCommands: {command_id}")

            if not text:
                errors.append(f"subtitles[{index}] missing text.")

        if require_resume_state:
            if not resume_state:
                warnings.append("resumeState missing; save/replay will be weaker.")
            elif "currentCommandIndex" not in resume_state and "pausedAtCommandIndex" not in resume_state:
                warnings.append("resumeState should include currentCommandIndex or pausedAtCommandIndex.")

        fallback_paths = self._find_truthy_keys(candidate, "fallbackUsed")
        if fallback_paths:
            errors.append(f"fallbackUsed must be false everywhere. Truthy paths: {fallback_paths[:8]}")

        smart_fallback_paths = self._find_truthy_keys(candidate, "usedSmartFallback")
        if smart_fallback_paths:
            errors.append(f"usedSmartFallback must be false everywhere. Truthy paths: {smart_fallback_paths[:8]}")

        layout_report = safe_dict(
            candidate.get("layoutResult")
            or candidate.get("layout")
            or candidate.get("overlapReport")
        )
        if layout_report:
            risk = clean_text(
                layout_report.get("remainingOverlapRisk")
                or layout_report.get("layoutOverlapRisk")
                or "",
                80,
            )
            if risk == "high":
                errors.append("Layout overlap risk is high.")
            elif risk == "medium":
                warnings.append("Layout overlap risk is medium.")

        ok = not errors
        if not strict and errors:
            warnings.extend(errors)
            errors = []
            ok = True

        return {
            "validation": {
                "ok": ok,
                "scope": scope,
                "errors": errors,
                "warnings": warnings,
                "checks": checks,
                "sourceGrounded": bool(source_refs),
                "diagramValid": bool(compiled_diagrams) if require_diagrams else True,
                "boardCommandsValid": (
                    bool(board_commands) if require_board_commands else True
                ) and not any("boardCommands" in error for error in errors),
                "voiceSubtitleSyncValid": (
                    bool(voice_script) if require_voice else True
                ) and (
                    bool(subtitles) if require_subtitles else True
                ) and not any("voiceScript" in error or "subtitles" in error for error in errors),
                "resumeStatePresent": bool(resume_state),
                "fallbackUsed": False,
            },
            "summary": {
                "sourceRefCount": len(source_refs),
                "compiledDiagramCount": len(compiled_diagrams),
                "boardCommandCount": len(board_commands),
                "voiceLineCount": len(voice_script),
                "subtitleCount": len(subtitles),
                "commandIdCount": len(command_ids),
            },
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "strict": strict,
                "validationScope": scope,
                "requireDiagrams": require_diagrams,
                "requireBoardCommands": require_board_commands,
                "requireVoice": require_voice,
                "requireSubtitles": require_subtitles,
                "requireResumeState": require_resume_state,
            },
        }

    @staticmethod
    def _flag(payload: JsonDict, key: str, default: bool) -> bool:
        if key not in payload:
            return default
        return payload.get(key) is not False

    @staticmethod
    def _collect_source_refs(value: Any) -> List[JsonDict]:
        refs: List[JsonDict] = []

        def walk(obj: Any) -> None:
            if isinstance(obj, dict):
                local = obj.get("sourceRefs")
                if isinstance(local, list):
                    refs.extend([safe_dict(x) for x in local if safe_dict(x)])

                for child in obj.values():
                    if isinstance(child, (dict, list)):
                        walk(child)

            elif isinstance(obj, list):
                for item in obj:
                    walk(item)

        walk(value)

        seen = set()
        unique: List[JsonDict] = []

        for ref in refs:
            chunk_id = clean_text(ref.get("chunkId"), 160)
            source_ref = clean_text(ref.get("sourceRef"), 240)
            page = int(ref.get("page") or 1)

            if not chunk_id:
                continue

            key = (chunk_id, source_ref, page)
            if key in seen:
                continue

            seen.add(key)
            unique.append(ref)

        return unique

    @staticmethod
    def _collect_compiled_diagrams(candidate: JsonDict) -> List[JsonDict]:
        result = safe_dict(candidate.get("result"))

        direct = safe_list(candidate.get("compiledDiagrams"))
        if direct:
            return [safe_dict(x) for x in direct]

        direct = safe_list(result.get("compiledDiagrams"))
        if direct:
            return [safe_dict(x) for x in direct]

        diagram_set = safe_dict(candidate.get("diagramSet") or result.get("diagramSet"))
        direct = safe_list(diagram_set.get("compiledDiagrams"))
        if direct:
            return [safe_dict(x) for x in direct]

        artifacts = safe_dict(candidate.get("diagramArtifacts") or result.get("diagramArtifacts"))
        direct = safe_list(artifacts.get("compiledDiagrams"))
        if direct:
            return [safe_dict(x) for x in direct]

        return []

    @staticmethod
    def _collect_board_commands(candidate: JsonDict) -> List[JsonDict]:
        result = safe_dict(candidate.get("result"))

        direct = safe_list(candidate.get("boardCommands") or candidate.get("commands"))
        if direct:
            return [safe_dict(x) for x in direct]

        direct = safe_list(result.get("boardCommands") or result.get("commands"))
        if direct:
            return [safe_dict(x) for x in direct]

        scene_set = safe_dict(candidate.get("sceneSet") or result.get("sceneSet"))
        direct = safe_list(scene_set.get("boardCommands") or scene_set.get("commands"))
        if direct:
            return [safe_dict(x) for x in direct]

        commands: List[JsonDict] = []
        for scene in safe_list(candidate.get("scenes") or result.get("scenes") or scene_set.get("scenes")):
            commands.extend([safe_dict(x) for x in safe_list(safe_dict(scene).get("boardCommands"))])

        return commands

    @staticmethod
    def _collect_voice_script(candidate: JsonDict) -> List[JsonDict]:
        result = safe_dict(candidate.get("result"))

        direct = safe_list(candidate.get("voiceScript") or result.get("voiceScript"))
        if direct:
            return [safe_dict(x) for x in direct]

        voice = safe_dict(candidate.get("voice") or result.get("voice"))
        return [safe_dict(x) for x in safe_list(voice.get("voiceScript"))]

    @staticmethod
    def _collect_subtitles(candidate: JsonDict) -> List[JsonDict]:
        result = safe_dict(candidate.get("result"))

        direct = safe_list(candidate.get("subtitles") or result.get("subtitles"))
        if direct:
            return [safe_dict(x) for x in direct]

        subtitle_result = safe_dict(candidate.get("subtitleResult") or result.get("subtitleResult"))
        return [safe_dict(x) for x in safe_list(subtitle_result.get("subtitles"))]

    @staticmethod
    def _find_resume_state(candidate: JsonDict) -> JsonDict:
        result = safe_dict(candidate.get("result"))

        if safe_dict(candidate.get("resumeState")):
            return safe_dict(candidate.get("resumeState"))

        if safe_dict(result.get("resumeState")):
            return safe_dict(result.get("resumeState"))

        if safe_dict(candidate.get("sessionPatch")):
            return safe_dict(candidate.get("sessionPatch"))

        return {}

    @staticmethod
    def _find_truthy_keys(value: Any, key_name: str, path: str = "$") -> List[str]:
        paths: List[str] = []

        if isinstance(value, dict):
            for key, child in value.items():
                next_path = f"{path}.{key}"
                if key == key_name and child is True:
                    paths.append(next_path)
                paths.extend(ValidatorSafetyAgent._find_truthy_keys(child, key_name, next_path))

        elif isinstance(value, list):
            for index, item in enumerate(value):
                paths.extend(ValidatorSafetyAgent._find_truthy_keys(item, key_name, f"{path}[{index}]"))

        return paths

    @staticmethod
    def _looks_keyword_only(concepts: List[Any], title: str) -> bool:
        labels: List[str] = []

        for concept in concepts:
            if isinstance(concept, dict):
                label = clean_text(concept.get("label") or concept.get("title") or concept.get("name"), 120)
            else:
                label = clean_text(concept, 120)
            if label:
                labels.append(label)

        if len(labels) < 3:
            return False

        title_words = {
            w.lower()
            for w in clean_text(title, 200).replace("-", " ").split()
            if len(w) > 2
        }

        if not title_words:
            return False

        single_title_word_count = 0
        for label in labels[:6]:
            words = label.split()
            if len(words) == 1 and words[0].lower() in title_words:
                single_title_word_count += 1

        return single_title_word_count >= 3

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return raw

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        validation = safe_dict(output.get("validation"))
        errors = [clean_text(x, 700) for x in safe_list(validation.get("errors")) if clean_text(x, 700)]
        warnings = [clean_text(x, 700) for x in safe_list(validation.get("warnings")) if clean_text(x, 700)]

        if "ok" not in validation:
            errors.append("validation.ok is required.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="ValidatorSafetyAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["ValidatorSafetyAgent"]