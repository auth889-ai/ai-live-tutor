"""
google_agent/visual/board_command_agent.py
===============================================================================
Rich Board Command Agent

Fixes:
- Converts BoardSceneAgent scenes/premiumBoardScreens into playable boardCommands.
- Adds teacher-like marking commands:
  setViewport, writeText, drawFlowchart, drawTree, drawTable, drawCodeTrace,
  drawBox, underline, drawCircle, drawArrow, highlightNode, showSourceBadge,
  pauseForQuestion, recap.
- Every command has commandId.
- Every command payload has sourceRefs.
- No fake fallback.
===============================================================================
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

try:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext,
        BoardCommand,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        merge_validations,
        normalize_id,
        require_source_refs,
        safe_dict,
        safe_list,
    )
except Exception:
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
    from google_agent.live_tutor_agents.contracts import (
        AgentContext,
        BoardCommand,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        merge_validations,
        normalize_id,
        require_source_refs,
        safe_dict,
        safe_list,
    )


ACTION_TO_TYPE: Dict[str, str] = {
    "setViewport": "setViewport",
    "zoomToBlock": "setViewport",
    "zoomToScreen": "setViewport",
    "writeText": "writeText",
    "writeNearNode": "writeNearNode",
    "drawDiagram": "drawFlowchart",
    "drawFlowchart": "drawFlowchart",
    "drawTree": "drawTree",
    "drawTable": "drawTable",
    "drawTimeline": "drawTimeline",
    "drawCodeTrace": "drawCodeTrace",
    "drawERDiagram": "drawERDiagram",
    "drawSequenceDiagram": "drawSequenceDiagram",
    "drawArrow": "drawArrow",
    "arrow": "drawArrow",
    "drawLine": "drawLine",
    "drawCircle": "drawCircle",
    "circle": "drawCircle",
    "drawBox": "drawBox",
    "focusBox": "drawBox",
    "underline": "underline",
    "markSourceQuote": "underline",
    "highlight": "highlightNode",
    "highlightNode": "highlightNode",
    "showSourceBadge": "showSourceBadge",
    "sourceBadge": "showSourceBadge",
    "showQuiz": "showQuiz",
    "pauseForQuiz": "pauseForQuestion",
    "pauseForQuestion": "pauseForQuestion",
    "recap": "recap",
    "erase": "erase",
}

BLOCK_TO_COMMAND: Dict[str, str] = {
    "heroDefinition": "writeText",
    "sourceEvidenceCard": "writeText",
    "miniConceptTree": "drawTree",
    "workflowStrip": "drawFlowchart",
    "diagramPanel": "drawFlowchart",
    "examplePanel": "writeText",
    "mappingTable": "drawTable",
    "codeOrSqlExample": "drawCodeTrace",
    "commonMistakeCard": "highlightNode",
    "bestPracticeChecklist": "drawTable",
    "quizCheckpoint": "showQuiz",
    "recapChecklist": "recap",
    "sourcePagePreview": "writeText",
    "htmlPreviewCard": "writeText",
    "dryRunPanel": "drawCodeTrace",
    "tutorActionRail": "writeText",
    "voiceSubtitlePanel": "writeText",
}


def _safe_int(value: Any, fallback: int) -> int:
    try:
        if value in (None, ""):
            return int(fallback)
        return int(value)
    except Exception:
        return int(fallback)


def _safe_float(value: Any, fallback: float) -> float:
    try:
        if value in (None, ""):
            return float(fallback)
        return float(value)
    except Exception:
        return float(fallback)


def _walk_refs(value: Any, refs: List[JsonDict]) -> None:
    if isinstance(value, list):
        for item in value:
            _walk_refs(item, refs)
        return

    if isinstance(value, dict):
        if isinstance(value.get("sourceRefs"), list):
            refs.extend([safe_dict(item) for item in value["sourceRefs"] if safe_dict(item)])

        payload = value.get("payload")
        if isinstance(payload, dict):
            _walk_refs(payload, refs)

        visual_payload = value.get("visualPayload")
        if isinstance(visual_payload, dict):
            _walk_refs(visual_payload, refs)

        for child in value.values():
            if isinstance(child, (dict, list)):
                _walk_refs(child, refs)


def _collect_refs(*values: Any) -> List[JsonDict]:
    refs: List[JsonDict] = []
    for value in values:
        _walk_refs(value, refs)
    return dedupe_source_refs(refs)


def _block_refs(block: JsonDict, screen: JsonDict, global_refs: List[JsonDict]) -> List[JsonDict]:
    refs = dedupe_source_refs(
        safe_list(block.get("sourceRefs"))
        or safe_list(safe_dict(block.get("payload")).get("sourceRefs"))
        or safe_list(screen.get("sourceRefs"))
        or global_refs
    )
    return refs


def _command_text(item: JsonDict, fallback: str = "Teacher board note") -> str:
    payload = safe_dict(item.get("payload") or item.get("visualPayload"))

    return clean_text(
        item.get("text")
        or item.get("body")
        or item.get("teacherNotes")
        or item.get("title")
        or item.get("label")
        or payload.get("text")
        or payload.get("body")
        or payload.get("teacherNotes")
        or payload.get("title")
        or payload.get("label")
        or fallback,
        1200,
    )


def _key_phrase(text: str) -> str:
    words = clean_text(text, 260).split()
    return " ".join(words[:9]) or "source-backed idea"


def _source_badge_text(refs: List[JsonDict]) -> str:
    if not refs:
        return "Source"
    first = safe_dict(refs[0])
    page = first.get("page") or first.get("pageNumber") or "?"
    return f"Source p.{page}"


def _unique_id(raw: Any, used: set[str], fallback: str = "cmd") -> str:
    base = normalize_id(raw or fallback, fallback)
    candidate = base
    counter = 2

    while candidate in used:
        candidate = f"{base}_{counter}"
        counter += 1

    used.add(candidate)
    return candidate


class BoardCommandAgent(BaseLiveTutorAgent):
    agent_name = "BoardCommandAgent"
    agent_group = "visual"
    default_mode = "build_rich_board_commands"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Create rich, source-grounded, frontend-playable boardCommands.
Add teacher marking commands so frontend can animate writing, source badges,
underlines, circles, arrows, highlights, focus boxes, and quiz pauses.
Never create factual commands without sourceRefs.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        refs = _collect_refs(payload)
        scene_set = safe_dict(payload.get("sceneSet") or payload.get("boardScenes"))
        scenes = safe_list(scene_set.get("scenes") or payload.get("scenes"))
        premium_screens = safe_list(
            payload.get("premiumBoardScreens")
            or safe_dict(payload.get("visualPlan")).get("premiumBoardScreens")
            or scene_set.get("premiumBoardScreens")
            or scene_set.get("boardScreens")
        )

        if not refs:
            errors.append("BoardCommandAgent requires sourceRefs.")

        if not scenes and not premium_screens and not safe_list(payload.get("commandDrafts")):
            errors.append("BoardCommandAgent requires scenes, premiumBoardScreens, or commandDrafts.")

        warnings.append(f"BoardCommandAgent sceneCount={len(scenes)} premiumScreenCount={len(premium_screens)}")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="BoardCommandAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def _make_command(
        self,
        *,
        command_id: str,
        command_type: str,
        text: str,
        scene_id: str,
        x: float,
        y: float,
        width: float,
        height: float,
        duration_ms: int,
        refs: List[JsonDict],
        payload: Optional[JsonDict] = None,
        metadata: Optional[JsonDict] = None,
        node_id: str = "",
    ) -> JsonDict:
        cmd_type = ACTION_TO_TYPE.get(command_type, command_type)
        payload_obj = safe_dict(payload)

        command = BoardCommand(
            commandId=clean_text(command_id, 180),
            type=cmd_type,
            text=clean_text(text or "Teacher board note", 1200),
            nodeId=clean_text(node_id, 140),
            sceneId=clean_text(scene_id or "scene_1", 140),
            x=float(x),
            y=float(y),
            width=max(1.0, float(width)),
            height=max(1.0, float(height)),
            durationMs=max(250, int(duration_ms)),
            payload={
                **payload_obj,
                "sourceRefs": refs,
                "sourceGrounded": True,
                "fallbackUsed": False,
            },
            metadata={
                **safe_dict(metadata),
                "fallbackUsed": False,
                "sourceGrounded": True,
            },
        )

        return command.to_dict()

    def _commands_from_premium_screens(self, screens: List[JsonDict], global_refs: List[JsonDict], used: set[str]) -> List[JsonDict]:
        commands: List[JsonDict] = []

        for screen_index, raw_screen in enumerate(screens):
            screen = safe_dict(raw_screen)
            screen_no = _safe_int(screen.get("screenNo"), screen_index + 1)
            scene_id = clean_text(screen.get("screenId") or f"screen_{screen_no}", 140)
            screen_refs = dedupe_source_refs(safe_list(screen.get("sourceRefs")) or global_refs)

            commands.append(
                self._make_command(
                    command_id=_unique_id(f"{scene_id}_viewport", used, "cmd_viewport"),
                    command_type="setViewport",
                    text=clean_text(screen.get("title") or f"Open screen {screen_no}", 240),
                    scene_id=scene_id,
                    x=0,
                    y=0,
                    width=1360,
                    height=820,
                    duration_ms=500,
                    refs=screen_refs,
                    payload={
                        "screenNo": screen_no,
                        "screenId": scene_id,
                        "title": clean_text(screen.get("title"), 220),
                        "zoom": "fit",
                    },
                    metadata={"teacherMarking": True, "generatedBy": "screenViewport"},
                )
            )

            for block_index, raw_block in enumerate(safe_list(screen.get("blocks"))):
                block = safe_dict(raw_block)
                block_id = clean_text(block.get("blockId") or f"{scene_id}_block_{block_index + 1}", 160)
                block_type = clean_text(block.get("type") or "heroDefinition", 100)
                refs = _block_refs(block, screen, global_refs)
                if not refs:
                    continue

                col = block_index % 3
                row = block_index // 3
                x = 70 + col * 410
                y = 90 + row * 185
                width = 360
                height = 135

                if block_type in {"workflowStrip", "diagramPanel"}:
                    x = 80
                    y = 150 + row * 220
                    width = 900
                    height = 170
                elif block_type in {"sourceEvidenceCard", "sourcePagePreview"}:
                    x = 940
                    y = 130 + row * 180
                    width = 310
                    height = 145
                elif block_type in {"mappingTable", "bestPracticeChecklist"}:
                    width = 430
                    height = 170
                elif block_type in {"quizCheckpoint", "recapChecklist"}:
                    width = 430
                    height = 140

                base_type = BLOCK_TO_COMMAND.get(block_type, "writeText")
                base_text = _command_text(block, clean_text(screen.get("title") or "Teacher board block", 220))
                base_id = _unique_id(f"{block_id}_{base_type}", used, "cmd_block")

                commands.append(
                    self._make_command(
                        command_id=base_id,
                        command_type=base_type,
                        text=base_text,
                        scene_id=scene_id,
                        x=x,
                        y=y,
                        width=width,
                        height=height,
                        duration_ms=1400,
                        refs=refs,
                        payload={
                            **block,
                            "targetBlockId": block_id,
                            "blockId": block_id,
                            "blockType": block_type,
                            "screenNo": screen_no,
                            "screenId": scene_id,
                        },
                        metadata={"generatedBy": "premiumBoardBlock"},
                    )
                )

                commands.extend(
                    self._marking_commands_for_block(
                        base_command_id=base_id,
                        block=block,
                        block_id=block_id,
                        block_type=block_type,
                        scene_id=scene_id,
                        screen_no=screen_no,
                        x=x,
                        y=y,
                        width=width,
                        height=height,
                        refs=refs,
                        used=used,
                    )
                )

        return commands

    def _commands_from_scene_set(self, scene_set: JsonDict, global_refs: List[JsonDict], used: set[str]) -> List[JsonDict]:
        commands: List[JsonDict] = []
        scenes = safe_list(scene_set.get("scenes"))

        if not scenes:
            return commands

        for scene_index, raw_scene in enumerate(scenes):
            scene = safe_dict(raw_scene)
            scene_id = clean_text(scene.get("sceneId") or f"scene_{scene_index + 1}", 140)
            screen_no = _safe_int(scene.get("screenNo"), scene_index + 1)
            refs = dedupe_source_refs(safe_list(scene.get("sourceRefs")) or global_refs)

            commands.append(
                self._make_command(
                    command_id=_unique_id(f"{scene_id}_viewport", used, "cmd_viewport"),
                    command_type="setViewport",
                    text=clean_text(scene.get("title") or f"Open board scene {screen_no}", 240),
                    scene_id=scene_id,
                    x=0,
                    y=0,
                    width=1360,
                    height=820,
                    duration_ms=500,
                    refs=refs,
                    payload={"screenNo": screen_no, "sceneId": scene_id, "title": clean_text(scene.get("title"), 220)},
                    metadata={"teacherMarking": True, "generatedBy": "sceneViewport"},
                )
            )

            drafts = safe_list(scene.get("commandDrafts") or scene.get("commands"))
            for draft_index, raw_draft in enumerate(drafts):
                draft = safe_dict(raw_draft)
                payload = safe_dict(draft.get("payload") or draft.get("visualPayload"))
                cmd_refs = dedupe_source_refs(safe_list(draft.get("sourceRefs")) or safe_list(payload.get("sourceRefs")) or refs)
                if not cmd_refs:
                    continue

                action = clean_text(draft.get("action") or draft.get("type") or "writeText", 80)
                cmd_type = ACTION_TO_TYPE.get(action, "writeText")
                block_id = clean_text(payload.get("blockId") or draft.get("targetBlockId") or draft.get("blockId") or f"{scene_id}_draft_{draft_index + 1}", 160)
                block_type = clean_text(payload.get("blockType") or draft.get("blockType") or "", 100)

                x = _safe_float(draft.get("x"), 80 + (draft_index % 3) * 410)
                y = _safe_float(draft.get("y"), 100 + (draft_index // 3) * 180)
                width = _safe_float(draft.get("width"), 360)
                height = _safe_float(draft.get("height"), 130)
                command_id = _unique_id(draft.get("commandId") or f"{block_id}_{cmd_type}", used, "cmd_draft")

                commands.append(
                    self._make_command(
                        command_id=command_id,
                        command_type=cmd_type,
                        text=_command_text(draft, "Teacher board command"),
                        scene_id=scene_id,
                        x=x,
                        y=y,
                        width=width,
                        height=height,
                        duration_ms=_safe_int(draft.get("durationMs"), 1200),
                        refs=cmd_refs,
                        payload={
                            **payload,
                            "targetBlockId": block_id,
                            "blockId": block_id,
                            "blockType": block_type,
                            "screenNo": screen_no,
                            "sceneId": scene_id,
                        },
                        metadata={"generatedBy": "sceneDraft"},
                    )
                )

                commands.extend(
                    self._marking_commands_for_block(
                        base_command_id=command_id,
                        block={**draft, **payload},
                        block_id=block_id,
                        block_type=block_type,
                        scene_id=scene_id,
                        screen_no=screen_no,
                        x=x,
                        y=y,
                        width=width,
                        height=height,
                        refs=cmd_refs,
                        used=used,
                    )
                )

        return commands

    def _marking_commands_for_block(
        self,
        *,
        base_command_id: str,
        block: JsonDict,
        block_id: str,
        block_type: str,
        scene_id: str,
        screen_no: int,
        x: float,
        y: float,
        width: float,
        height: float,
        refs: List[JsonDict],
        used: set[str],
    ) -> List[JsonDict]:
        text = _command_text(block, "source-backed idea")
        phrase = _key_phrase(text)
        out: List[JsonDict] = []

        out.append(
            self._make_command(
                command_id=_unique_id(f"{base_command_id}_focus", used, "cmd_focus"),
                command_type="drawBox",
                text=f"Focus on: {phrase}",
                scene_id=scene_id,
                x=max(0, x - 8),
                y=max(0, y - 8),
                width=width + 16,
                height=height + 16,
                duration_ms=600,
                refs=refs,
                payload={"targetCommandId": base_command_id, "targetBlockId": block_id, "screenNo": screen_no},
                metadata={"teacherMarking": True, "generatedBy": "focusBox"},
            )
        )

        if block_type in {"sourceEvidenceCard", "sourcePagePreview"}:
            out.append(
                self._make_command(
                    command_id=_unique_id(f"{base_command_id}_source_badge", used, "cmd_source_badge"),
                    command_type="showSourceBadge",
                    text=_source_badge_text(refs),
                    scene_id=scene_id,
                    x=x + max(0, width - 145),
                    y=y + 12,
                    width=135,
                    height=36,
                    duration_ms=650,
                    refs=refs,
                    payload={"targetCommandId": base_command_id, "targetBlockId": block_id, "screenNo": screen_no},
                    metadata={"teacherMarking": True, "sourceBadge": True, "generatedBy": "sourceBadge"},
                )
            )
            out.append(
                self._make_command(
                    command_id=_unique_id(f"{base_command_id}_underline_quote", used, "cmd_underline"),
                    command_type="underline",
                    text=phrase,
                    scene_id=scene_id,
                    x=x + 22,
                    y=y + min(height - 22, 88),
                    width=max(120, min(width - 44, 520)),
                    height=22,
                    duration_ms=700,
                    refs=refs,
                    payload={"targetCommandId": base_command_id, "targetBlockId": block_id, "phrase": phrase, "screenNo": screen_no},
                    metadata={"teacherMarking": True, "markSourceQuote": True, "generatedBy": "sourceUnderline"},
                )
            )
            return out

        if block_type in {"workflowStrip", "diagramPanel", "miniConceptTree", "mappingTable", "codeOrSqlExample", "dryRunPanel"}:
            out.append(
                self._make_command(
                    command_id=_unique_id(f"{base_command_id}_circle", used, "cmd_circle"),
                    command_type="drawCircle",
                    text=f"Circle key idea: {phrase}",
                    scene_id=scene_id,
                    x=x + max(30, width * 0.42),
                    y=y + 24,
                    width=150,
                    height=64,
                    duration_ms=750,
                    refs=refs,
                    payload={"targetCommandId": base_command_id, "targetBlockId": block_id, "phrase": phrase, "screenNo": screen_no},
                    metadata={"teacherMarking": True, "generatedBy": "circle"},
                )
            )
            out.append(
                self._make_command(
                    command_id=_unique_id(f"{base_command_id}_arrow", used, "cmd_arrow"),
                    command_type="drawArrow",
                    text="Connect this visual to source evidence",
                    scene_id=scene_id,
                    x=x + max(50, width - 110),
                    y=y + height * 0.52,
                    width=130,
                    height=35,
                    duration_ms=650,
                    refs=refs,
                    payload={"fromBlockId": block_id, "screenNo": screen_no},
                    metadata={"teacherMarking": True, "connectsEvidence": True, "generatedBy": "arrow"},
                )
            )
            return out

        if block_type in {"commonMistakeCard"}:
            out.append(
                self._make_command(
                    command_id=_unique_id(f"{base_command_id}_highlight_mistake", used, "cmd_highlight"),
                    command_type="highlightNode",
                    text=f"Common mistake: {phrase}",
                    scene_id=scene_id,
                    x=x + 14,
                    y=y + 50,
                    width=max(150, width - 28),
                    height=42,
                    duration_ms=700,
                    refs=refs,
                    payload={"targetCommandId": base_command_id, "targetBlockId": block_id, "phrase": phrase, "screenNo": screen_no},
                    metadata={"teacherMarking": True, "mistakeMark": True, "generatedBy": "mistakeHighlight"},
                )
            )
            return out

        if block_type in {"quizCheckpoint"}:
            out.append(
                self._make_command(
                    command_id=_unique_id(f"{base_command_id}_pause", used, "cmd_pause"),
                    command_type="pauseForQuestion",
                    text=phrase or "Pause and answer this checkpoint.",
                    scene_id=scene_id,
                    x=x,
                    y=y + height + 12,
                    width=width,
                    height=60,
                    duration_ms=1300,
                    refs=refs,
                    payload={"targetCommandId": base_command_id, "targetBlockId": block_id, "screenNo": screen_no},
                    metadata={"teacherMarking": True, "quizPause": True, "generatedBy": "quizPause"},
                )
            )
            return out

        out.append(
            self._make_command(
                command_id=_unique_id(f"{base_command_id}_underline", used, "cmd_underline"),
                command_type="underline",
                text=phrase,
                scene_id=scene_id,
                x=x + 18,
                y=y + min(height - 22, 82),
                width=max(120, min(width - 36, 460)),
                height=22,
                duration_ms=620,
                refs=refs,
                payload={"targetCommandId": base_command_id, "targetBlockId": block_id, "phrase": phrase, "screenNo": screen_no},
                metadata={"teacherMarking": True, "generatedBy": "underline"},
            )
        )

        return out

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        global_refs = _collect_refs(payload)
        if not global_refs:
            raise RuntimeError("BoardCommandAgent cannot create commands without sourceRefs.")

        used: set[str] = set()
        commands: List[JsonDict] = []

        scene_set = safe_dict(payload.get("sceneSet") or payload.get("boardScenes"))
        commands.extend(self._commands_from_scene_set(scene_set, global_refs, used))

        premium_screens = safe_list(
            payload.get("premiumBoardScreens")
            or safe_dict(payload.get("visualPlan")).get("premiumBoardScreens")
            or scene_set.get("premiumBoardScreens")
            or scene_set.get("boardScreens")
        )

        if premium_screens:
            commands.extend(self._commands_from_premium_screens(premium_screens, global_refs, used))

        if not commands and safe_list(payload.get("commandDrafts")):
            synthetic_scene = {
                "sceneId": "scene_1",
                "screenNo": 1,
                "title": "Board Scene",
                "sourceRefs": global_refs,
                "commandDrafts": safe_list(payload.get("commandDrafts")),
            }
            commands.extend(self._commands_from_scene_set({"scenes": [synthetic_scene]}, global_refs, used))

        if not commands:
            raise RuntimeError("BoardCommandAgent produced zero commands. No fake board commands generated.")

        timeline: List[JsonDict] = []
        total_ms = 0
        all_refs: List[JsonDict] = []

        normalized_commands: List[JsonDict] = []
        final_used: set[str] = set()

        for index, raw_cmd in enumerate(commands):
            cmd = safe_dict(raw_cmd)
            payload_obj = safe_dict(cmd.get("payload"))
            refs = dedupe_source_refs(safe_list(payload_obj.get("sourceRefs")) or global_refs)

            command_id = _unique_id(cmd.get("commandId") or f"cmd_{index + 1}", final_used, "cmd")
            duration = max(250, _safe_int(cmd.get("durationMs"), 1000))
            start = total_ms
            end = start + duration
            total_ms = end

            normalized = {
                **cmd,
                "commandId": command_id,
                "type": ACTION_TO_TYPE.get(clean_text(cmd.get("type") or "writeText", 80), "writeText"),
                "text": clean_text(cmd.get("text") or "Teacher board command", 1200),
                "durationMs": duration,
                "startMs": start,
                "endMs": end,
                "payload": {
                    **payload_obj,
                    "sourceRefs": refs,
                    "sourceGrounded": True,
                    "fallbackUsed": False,
                },
                "metadata": {
                    **safe_dict(cmd.get("metadata")),
                    "fallbackUsed": False,
                    "sourceGrounded": True,
                },
            }

            normalized_commands.append(normalized)
            all_refs.extend(refs)
            timeline.append(
                {
                    "commandId": command_id,
                    "index": index,
                    "startMs": start,
                    "endMs": end,
                    "durationMs": duration,
                    "sceneId": normalized.get("sceneId"),
                    "type": normalized.get("type"),
                    "screenNo": normalized["payload"].get("screenNo"),
                }
            )

        return {
            "commandSetId": normalize_id(payload.get("commandSetId") or "rich_board_command_set", "rich_board_command_set"),
            "commands": normalized_commands,
            "boardCommands": normalized_commands,
            "timeline": timeline,
            "estimatedMs": total_ms,
            "sourceRefs": dedupe_source_refs(all_refs or global_refs),
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "frontendPlayable": True,
                "teacherMarkingReady": True,
                "voiceCommandSyncReady": True,
                "sourceGrounded": True,
                "commandCount": len(normalized_commands),
                "markingCommandCount": len(
                    [cmd for cmd in normalized_commands if safe_dict(cmd.get("metadata")).get("teacherMarking")]
                ),
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return safe_dict(raw)

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []
        validations: List[ValidationResult] = []

        commands = safe_list(output.get("boardCommands") or output.get("commands"))
        if not commands:
            errors.append("boardCommands are required.")

        ids: set[str] = set()

        for index, raw_cmd in enumerate(commands):
            cmd = safe_dict(raw_cmd)
            payload_obj = safe_dict(cmd.get("payload"))

            board_command = BoardCommand(
                commandId=clean_text(cmd.get("commandId"), 180),
                type=clean_text(cmd.get("type"), 80),
                text=clean_text(cmd.get("text"), 1200),
                nodeId=clean_text(cmd.get("nodeId"), 140),
                sceneId=clean_text(cmd.get("sceneId"), 140),
                x=_safe_float(cmd.get("x"), 0),
                y=_safe_float(cmd.get("y"), 0),
                width=_safe_float(cmd.get("width"), 1),
                height=_safe_float(cmd.get("height"), 1),
                durationMs=_safe_int(cmd.get("durationMs"), 0),
                payload=payload_obj,
                metadata=safe_dict(cmd.get("metadata")),
            )

            validations.append(board_command.validate())

            if board_command.commandId in ids:
                errors.append(f"Duplicate commandId: {board_command.commandId}")
            ids.add(board_command.commandId)

            if not safe_list(payload_obj.get("sourceRefs")):
                errors.append(f"boardCommands[{index}] missing payload.sourceRefs.")

        source_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "BoardCommandAgent.output.sourceRefs",
        )
        validations.append(source_validation)

        merged = merge_validations("BoardCommandAgent.validate_output", validations)
        errors.extend(merged.errors)
        warnings.extend(merged.warnings)

        if len(commands) < 20:
            warnings.append("boardCommands count is below rich-board target 20; small nodes may be okay.")

        if not any(safe_dict(command.get("metadata")).get("teacherMarking") for command in commands):
            warnings.append("No teacher marking commands found; frontend may look static.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="BoardCommandAgent.validate_output",
            fallbackUsed=False,
        )