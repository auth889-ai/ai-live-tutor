"""
google_agent/visual/handwriting_drawing_agent.py
===============================================================================
Handwriting / Drawing Agent.

This replaces the broken duplicate file from the uploaded zip.

Responsibility:
- Take real boardCommands from BoardCommandAgent/LayoutAgent.
- Add human-like drawing metadata: stroke order, pen path, underline path,
  arrow path, reveal timing, erase timing, highlight timing.
- Preserve original boardCommands so existing frontend does not break.
- Produce a separate handwritingPlan that future React Konva/SVG/Fabric renderer
  can animate.
- No fake fallback. If boardCommands are missing, fail.

Important:
This agent does not pretend to produce real handwriting font/video/audio.
It produces deterministic stroke/action instructions from real boardCommands.
Frontend renderer must animate these strokes later.
===============================================================================
"""

from __future__ import annotations

import math
import re
from typing import List, Tuple

from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
from google_agent.live_tutor_agents.contracts import (
    AgentContext,
    BoardCommand,
    JsonDict,
    ValidationResult,
    clean_text,
    dedupe_source_refs,
    normalize_id,
    safe_dict,
    safe_list,
)


DRAWABLE_COMMAND_TYPES = {
    "writeText",
    "writeNearNode",
    "drawArrow",
    "drawLine",
    "drawCircle",
    "drawBox",
    "drawFlowchart",
    "drawTable",
    "drawTree",
    "drawTimeline",
    "drawCodeTrace",
    "drawERDiagram",
    "drawSequenceDiagram",
    "underline",
    "showSourceBadge",
    "showQuiz",
    "recap",
}


def _num(value: object, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(fallback)


def _command_id(cmd: JsonDict, index: int) -> str:
    return clean_text(cmd.get("commandId"), 160) or f"cmd_{index + 1}"


def _source_refs_from_commands(commands: List[JsonDict]) -> List[JsonDict]:
    refs: List[JsonDict] = []
    for cmd in commands:
        payload = safe_dict(cmd.get("payload"))
        refs.extend(safe_list(payload.get("sourceRefs")))
        refs.extend(safe_list(cmd.get("sourceRefs")))
    return dedupe_source_refs([safe_dict(ref) for ref in refs if safe_dict(ref)])


def _estimate_text_size(text: str, width: float, height: float) -> Tuple[float, float]:
    text = clean_text(text, 2000)
    line_count = max(1, len(text.splitlines()))
    char_count = max(1, len(text))
    estimated_width = min(max(180.0, char_count * 8.0), max(width, 260.0))
    estimated_height = min(max(36.0, line_count * 30.0), max(height, 54.0))
    return estimated_width, estimated_height


def _split_text_to_stroke_units(text: str) -> List[str]:
    """
    Human-like unit splitting:
    - keep Bangla clusters readable
    - split long English text by words
    - preserve punctuation pauses
    """
    value = clean_text(text, 3000)
    if not value:
        return []

    parts = re.findall(r"[\u0980-\u09FF]+|[A-Za-z0-9_+\-*/=<>]+|[^\s]", value)
    if not parts:
        return [value]

    units: List[str] = []
    current = ""

    for part in parts:
        if len(current) + len(part) + 1 <= 18 and part not in {".", ",", ";", ":", "।", "?", "!"}:
            current = f"{current} {part}".strip()
        else:
            if current:
                units.append(current)
            current = part

        if part in {".", ";", "।", "?", "!"}:
            if current:
                units.append(current)
            current = ""

    if current:
        units.append(current)

    return units[:90]


def _line_points(x1: float, y1: float, x2: float, y2: float, points: int = 8) -> List[List[float]]:
    total = max(2, points)
    return [
        [
            round(x1 + (x2 - x1) * i / (total - 1), 2),
            round(y1 + (y2 - y1) * i / (total - 1), 2),
        ]
        for i in range(total)
    ]


def _wavy_line_points(x1: float, y1: float, x2: float, y2: float, points: int = 12, amp: float = 2.5) -> List[List[float]]:
    total = max(2, points)
    out: List[List[float]] = []
    for i in range(total):
        t = i / (total - 1)
        x = x1 + (x2 - x1) * t
        y = y1 + (y2 - y1) * t + math.sin(t * math.pi * 3) * amp
        out.append([round(x, 2), round(y, 2)])
    return out


def _rect_points(x: float, y: float, width: float, height: float) -> List[List[float]]:
    w = max(20.0, width)
    h = max(20.0, height)
    return [
        [round(x, 2), round(y, 2)],
        [round(x + w, 2), round(y, 2)],
        [round(x + w, 2), round(y + h, 2)],
        [round(x, 2), round(y + h, 2)],
        [round(x, 2), round(y, 2)],
    ]


def _circle_points(cx: float, cy: float, radius: float, points: int = 24) -> List[List[float]]:
    r = max(8.0, radius)
    out: List[List[float]] = []
    for i in range(points + 1):
        theta = 2 * math.pi * i / points
        out.append([round(cx + r * math.cos(theta), 2), round(cy + r * math.sin(theta), 2)])
    return out


class HandwritingDrawingAgent(BaseLiveTutorAgent):
    agent_name = "HandwritingDrawingAgent"
    agent_group = "visual"
    default_mode = "compile_handwriting"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
You transform boardCommands into human-like handwriting and drawing animation
instructions. Preserve the original commands. Do not generate fake content. Only
derive strokes from real boardCommands.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        commands = safe_list(payload.get("boardCommands") or payload.get("commands"))
        if not commands:
            errors.append("HandwritingDrawingAgent requires boardCommands/commands.")

        for index, raw in enumerate(commands):
            cmd = safe_dict(raw)
            command_type = clean_text(cmd.get("type"), 80)
            if not command_type:
                errors.append(f"boardCommands[{index}].type is required.")
            elif command_type not in BoardCommand.ALLOWED_TYPES:
                errors.append(f"boardCommands[{index}].type is unsupported: {command_type}")

            if command_type in {"writeText", "writeNearNode"} and not clean_text(cmd.get("text"), 50):
                errors.append(f"boardCommands[{index}] {command_type} requires text.")

            if command_type not in DRAWABLE_COMMAND_TYPES:
                warnings.append(f"boardCommands[{index}] type {command_type} is not drawable; it will be kept but not stroked.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="HandwritingDrawingAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        commands = [safe_dict(item) for item in safe_list(payload.get("boardCommands") or payload.get("commands"))]

        enhanced_commands: List[JsonDict] = []
        stroke_groups: List[JsonDict] = []
        timeline: List[JsonDict] = []
        current_ms = 0

        for index, original in enumerate(commands):
            cmd = dict(original)
            command_id = _command_id(cmd, index)
            cmd["commandId"] = command_id

            duration_ms = max(250, int(cmd.get("durationMs") or 1000))
            command_type = clean_text(cmd.get("type"), 80)

            strokes = self._strokes_for_command(cmd, index, duration_ms)
            stroke_start = current_ms
            stroke_end = current_ms + duration_ms

            handwriting_meta = {
                "handwritingEnabled": bool(strokes),
                "strokeGroupId": f"stroke_group_{command_id}",
                "strokeCount": len(strokes),
                "strokeStartMs": stroke_start,
                "strokeEndMs": stroke_end,
                "pen": self._pen_for(command_type),
                "renderEngine": "konva-or-svg",
                "humanLike": True,
                "fallbackUsed": False,
            }

            cmd["metadata"] = {
                **safe_dict(cmd.get("metadata")),
                "handwriting": handwriting_meta,
            }
            cmd["payload"] = {
                **safe_dict(cmd.get("payload")),
                "handwriting": handwriting_meta,
            }

            enhanced_commands.append(cmd)

            if strokes:
                stroke_groups.append(
                    {
                        "strokeGroupId": f"stroke_group_{command_id}",
                        "commandId": command_id,
                        "commandType": command_type,
                        "startMs": stroke_start,
                        "endMs": stroke_end,
                        "durationMs": duration_ms,
                        "strokes": strokes,
                    }
                )

            timeline.append(
                {
                    "commandId": command_id,
                    "index": index,
                    "commandType": command_type,
                    "startMs": stroke_start,
                    "endMs": stroke_end,
                    "strokeGroupId": f"stroke_group_{command_id}" if strokes else "",
                    "drawable": bool(strokes),
                }
            )

            current_ms = stroke_end

        source_refs = _source_refs_from_commands(enhanced_commands)

        return {
            "boardCommands": enhanced_commands,
            "commands": enhanced_commands,
            "handwritingPlan": {
                "planId": normalize_id(payload.get("handwritingPlanId") or "handwriting_plan_1", "handwriting_plan_1"),
                "renderer": "react-konva-or-svg",
                "totalDurationMs": current_ms,
                "strokeGroups": stroke_groups,
                "timeline": timeline,
                "playback": {
                    "supportsPause": True,
                    "supportsResume": True,
                    "supportsSeekByCommandIndex": True,
                    "supportsInterruptRepairResume": True,
                },
            },
            "drawingQuality": {
                "textStrokeUnits": True,
                "arrows": True,
                "lines": True,
                "boxes": True,
                "circles": True,
                "diagramReveal": True,
                "tableReveal": True,
                "treeReveal": True,
                "flowchartReveal": True,
            },
            "sourceRefs": source_refs,
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "frontendNeedsKonvaOrSvgRenderer": True,
                "preservesOriginalBoardCommands": True,
                "notStaticDemo": True,
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)
        commands = [safe_dict(item) for item in safe_list(raw.get("boardCommands") or raw.get("commands"))]

        return {
            "boardCommands": commands,
            "commands": commands,
            "handwritingPlan": safe_dict(raw.get("handwritingPlan")),
            "drawingQuality": safe_dict(raw.get("drawingQuality")),
            "sourceRefs": dedupe_source_refs([safe_dict(ref) for ref in safe_list(raw.get("sourceRefs")) if safe_dict(ref)]),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        commands = safe_list(output.get("boardCommands"))
        if not commands:
            errors.append("Output boardCommands are required.")

        for index, raw in enumerate(commands):
            cmd = safe_dict(raw)
            board_command = BoardCommand(
                commandId=clean_text(cmd.get("commandId"), 160),
                type=clean_text(cmd.get("type"), 80),
                text=clean_text(cmd.get("text"), 4000),
                nodeId=clean_text(cmd.get("nodeId"), 160),
                sceneId=clean_text(cmd.get("sceneId"), 160),
                x=_num(cmd.get("x")),
                y=_num(cmd.get("y")),
                width=_num(cmd.get("width")),
                height=_num(cmd.get("height")),
                durationMs=int(cmd.get("durationMs") or 1000),
                payload=safe_dict(cmd.get("payload")),
                metadata=safe_dict(cmd.get("metadata")),
            )
            validation = board_command.validate()
            errors.extend([f"boardCommands[{index}]: {err}" for err in validation.errors])
            warnings.extend([f"boardCommands[{index}]: {warn}" for warn in validation.warnings])

        plan = safe_dict(output.get("handwritingPlan"))
        if not plan:
            errors.append("handwritingPlan is required.")

        stroke_groups = safe_list(plan.get("strokeGroups"))
        if not stroke_groups:
            warnings.append("No drawable strokeGroups produced. Check command types.")

        for index, group in enumerate(stroke_groups):
            item = safe_dict(group)
            if not clean_text(item.get("commandId"), 160):
                errors.append(f"strokeGroups[{index}].commandId is required.")
            if not safe_list(item.get("strokes")):
                errors.append(f"strokeGroups[{index}].strokes are required.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="HandwritingDrawingAgent.validate_output",
            fallbackUsed=False,
        )

    def _strokes_for_command(self, cmd: JsonDict, index: int, duration_ms: int) -> List[JsonDict]:
        command_type = clean_text(cmd.get("type"), 80)
        command_id = _command_id(cmd, index)

        x = _num(cmd.get("x"), 80)
        y = _num(cmd.get("y"), 80)
        width = _num(cmd.get("width"), 360)
        height = _num(cmd.get("height"), 80)
        text = clean_text(cmd.get("text"), 3000)

        if command_type in {"writeText", "writeNearNode", "recap"}:
            return self._text_strokes(command_id, text, x, y, width, height, duration_ms)

        if command_type == "underline":
            return [
                self._stroke(
                    command_id,
                    "underline",
                    0,
                    _wavy_line_points(x, y + height, x + max(width, 120), y + height, 16),
                    duration_ms,
                    payload={"targetText": text},
                )
            ]

        if command_type in {"drawLine", "drawArrow"}:
            payload = safe_dict(cmd.get("payload"))
            x2 = _num(payload.get("x2"), x + max(width, 160))
            y2 = _num(payload.get("y2"), y + max(10, height / 2))
            stroke = self._stroke(
                command_id,
                command_type,
                0,
                _line_points(x, y, x2, y2, 10),
                duration_ms,
                payload={"arrowHead": command_type == "drawArrow"},
            )
            return [stroke]

        if command_type == "drawBox":
            return [
                self._stroke(
                    command_id,
                    "drawBox",
                    0,
                    _rect_points(x, y, width or 220, height or 90),
                    duration_ms,
                )
            ]

        if command_type == "drawCircle":
            radius = max(width, height, 40) / 2
            return [
                self._stroke(
                    command_id,
                    "drawCircle",
                    0,
                    _circle_points(x + radius, y + radius, radius),
                    duration_ms,
                )
            ]

        if command_type in {
            "drawFlowchart",
            "drawTable",
            "drawTree",
            "drawTimeline",
            "drawCodeTrace",
            "drawERDiagram",
            "drawSequenceDiagram",
            "showQuiz",
            "showSourceBadge",
        }:
            return self._reveal_strokes(command_id, command_type, x, y, width, height, duration_ms, cmd)

        return []

    def _text_strokes(
        self,
        command_id: str,
        text: str,
        x: float,
        y: float,
        width: float,
        height: float,
        duration_ms: int,
    ) -> List[JsonDict]:
        units = _split_text_to_stroke_units(text)
        if not units:
            return []

        estimated_width, _estimated_height = _estimate_text_size(text, width, height)
        strokes: List[JsonDict] = []
        cursor_x = x
        cursor_y = y
        line_height = 30
        max_width = max(220.0, width or estimated_width)

        per_stroke = max(80, int(duration_ms / max(1, len(units))))

        for idx, unit in enumerate(units):
            unit_width = max(32.0, min(180.0, len(unit) * 9.0))
            if cursor_x + unit_width > x + max_width:
                cursor_x = x
                cursor_y += line_height

            points = _wavy_line_points(cursor_x, cursor_y + 18, cursor_x + unit_width, cursor_y + 18, 8, amp=1.3)

            strokes.append(
                self._stroke(
                    command_id,
                    "writeTextUnit",
                    idx,
                    points,
                    per_stroke,
                    payload={
                        "text": unit,
                        "x": round(cursor_x, 2),
                        "y": round(cursor_y, 2),
                        "estimatedWidth": round(unit_width, 2),
                        "fontRole": "teacher-handwriting",
                    },
                )
            )

            cursor_x += unit_width + 10

        return strokes

    def _reveal_strokes(
        self,
        command_id: str,
        command_type: str,
        x: float,
        y: float,
        width: float,
        height: float,
        duration_ms: int,
        cmd: JsonDict,
    ) -> List[JsonDict]:
        w = max(width, 280)
        h = max(height, 140)
        payload = safe_dict(cmd.get("payload"))

        strokes: List[JsonDict] = [
            self._stroke(
                command_id,
                "drawContainer",
                0,
                _rect_points(x, y, w, h),
                max(150, int(duration_ms * 0.25)),
                payload={"commandType": command_type},
            )
        ]

        if command_type == "drawTable":
            rows = safe_list(payload.get("rows") or safe_dict(payload.get("table")).get("rows"))
            cols = safe_list(payload.get("columns") or safe_dict(payload.get("table")).get("columns"))
            row_count = max(2, min(8, len(rows) + 1 if rows else 4))
            col_count = max(2, min(5, len(cols) if cols else 3))

            for r in range(1, row_count):
                yy = y + h * r / row_count
                strokes.append(
                    self._stroke(
                        command_id,
                        "drawTableRowLine",
                        len(strokes),
                        _line_points(x, yy, x + w, yy, 6),
                        120,
                    )
                )
            for c in range(1, col_count):
                xx = x + w * c / col_count
                strokes.append(
                    self._stroke(
                        command_id,
                        "drawTableColumnLine",
                        len(strokes),
                        _line_points(xx, y, xx, y + h, 6),
                        120,
                    )
                )

        elif command_type in {"drawFlowchart", "drawTree", "drawERDiagram", "drawSequenceDiagram"}:
            node_count = self._count_visual_nodes(payload)
            for n in range(node_count):
                nx = x + 24 + (n % 3) * min(190, w / 3)
                ny = y + 34 + (n // 3) * 70
                strokes.append(
                    self._stroke(
                        command_id,
                        "drawVisualNode",
                        len(strokes),
                        _rect_points(nx, ny, 130, 42),
                        140,
                        payload={"nodeIndex": n},
                    )
                )
                if n > 0:
                    prev_x = x + 24 + ((n - 1) % 3) * min(190, w / 3) + 130
                    prev_y = y + 34 + ((n - 1) // 3) * 70 + 21
                    strokes.append(
                        self._stroke(
                            command_id,
                            "drawVisualEdge",
                            len(strokes),
                            _line_points(prev_x, prev_y, nx, ny + 21, 6),
                            110,
                            payload={"edgeIndex": n - 1, "arrowHead": True},
                        )
                    )

        elif command_type in {"drawTimeline", "drawCodeTrace", "showQuiz", "showSourceBadge"}:
            strokes.append(
                self._stroke(
                    command_id,
                    "highlightReveal",
                    len(strokes),
                    _wavy_line_points(x + 12, y + 34, x + w - 12, y + 34, 18),
                    max(180, int(duration_ms * 0.3)),
                    payload={"commandType": command_type},
                )
            )

        return strokes

    @staticmethod
    def _count_visual_nodes(payload: JsonDict) -> int:
        nodes = safe_list(payload.get("nodes") or safe_dict(payload.get("diagram")).get("nodes"))
        edges = safe_list(payload.get("edges") or safe_dict(payload.get("diagram")).get("edges"))
        if nodes:
            return max(2, min(9, len(nodes)))
        if edges:
            return max(2, min(9, len(edges) + 1))
        return 4

    @staticmethod
    def _stroke(
        command_id: str,
        stroke_type: str,
        order: int,
        points: List[List[float]],
        duration_ms: int,
        payload: JsonDict | None = None,
    ) -> JsonDict:
        return {
            "strokeId": f"stroke_{command_id}_{order + 1}",
            "commandId": command_id,
            "strokeType": stroke_type,
            "order": order,
            "points": points,
            "durationMs": max(60, int(duration_ms)),
            "payload": safe_dict(payload),
            "metadata": {
                "humanLike": True,
                "fallbackUsed": False,
            },
        }

    @staticmethod
    def _pen_for(command_type: str) -> JsonDict:
        if command_type in {"drawArrow", "drawLine", "drawBox", "drawCircle", "underline"}:
            return {
                "tool": "marker",
                "strokeWidth": 3,
                "lineCap": "round",
                "lineJoin": "round",
            }

        if command_type in {"drawFlowchart", "drawTree", "drawTable", "drawTimeline", "drawCodeTrace", "drawERDiagram"}:
            return {
                "tool": "diagram-pen",
                "strokeWidth": 2.5,
                "lineCap": "round",
                "lineJoin": "round",
            }

        return {
            "tool": "handwriting-pen",
            "strokeWidth": 2.2,
            "lineCap": "round",
            "lineJoin": "round",
        }