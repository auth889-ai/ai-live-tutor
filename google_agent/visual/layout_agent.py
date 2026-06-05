"""
google_agent/live_tutor_agents/visual/layout_agent.py
===============================================================================
Layout Agent.

Separate strong agent responsibility:
- Check boardCommands for overlap and board bounds.
- Repair positions deterministically where possible.
- Produce autoscale metadata for frontend board.
- No fake fallback.

This agent is algorithmic, not LLM-based.
It prepares commands for React Flow / Konva / SVG board rendering.
===============================================================================
"""

from __future__ import annotations

from typing import List, Tuple

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
    AgentContext,
    JsonDict,
    ValidationResult,
    clean_text,
    safe_dict,
    safe_list,
)


def rect_from_command(cmd: JsonDict) -> Tuple[float, float, float, float]:
    x = float(cmd.get("x") or 0)
    y = float(cmd.get("y") or 0)
    w = float(cmd.get("width") or 0)
    h = float(cmd.get("height") or 0)
    return x, y, max(1.0, w), max(1.0, h)


def overlaps(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float], padding: float = 12) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return not (
        ax + aw + padding <= bx
        or bx + bw + padding <= ax
        or ay + ah + padding <= by
        or by + bh + padding <= ay
    )


def command_needs_rect(cmd: JsonDict) -> bool:
    return clean_text(cmd.get("type"), 80) in {
        "writeText",
        "writeNearNode",
        "drawFlowchart",
        "drawTable",
        "drawTree",
        "drawTimeline",
        "drawCodeTrace",
        "drawERDiagram",
        "drawSequenceDiagram",
        "showQuiz",
        "recap",
    }


class LayoutAgent(BaseLiveTutorAgent):
    agent_name = "LayoutAgent"
    agent_group = "visual"
    default_mode = "layout_board"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Layout Agent:
Check overlap, bounds, autoscale, and repair board command positions.
No fake fallback.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        commands = safe_list(payload.get("boardCommands") or payload.get("commands"))

        if not commands:
            errors.append("LayoutAgent requires boardCommands/commands.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="LayoutAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw_commands = [safe_dict(x) for x in safe_list(payload.get("boardCommands") or payload.get("commands"))]
        board_width = float(payload.get("boardWidth") or safe_dict(payload.get("layout")).get("boardWidth") or 1600)
        board_height = float(payload.get("boardHeight") or safe_dict(payload.get("layout")).get("boardHeight") or 1000)
        margin = float(payload.get("safeMargin") or safe_dict(payload.get("layout")).get("safeMargin") or 48)
        padding = float(payload.get("overlapPadding") or 18)

        placed: List[Tuple[float, float, float, float]] = []
        repaired_commands: List[JsonDict] = []
        repairs: List[JsonDict] = []
        warnings: List[str] = []

        cursor_x = margin
        cursor_y = margin

        for index, original in enumerate(raw_commands):
            cmd = dict(original)

            if not command_needs_rect(cmd):
                repaired_commands.append(cmd)
                continue

            x, y, w, h = rect_from_command(cmd)

            if w <= 1:
                w = 520
            if h <= 1:
                h = 72

            if x < margin:
                x = margin
            if y < margin:
                y = margin
            if x + w > board_width - margin:
                x = max(margin, board_width - margin - w)
            if y + h > board_height - margin:
                y = max(margin, board_height - margin - h)

            rect = (x, y, w, h)
            moved = False
            attempts = 0

            while any(overlaps(rect, old, padding=padding) for old in placed) and attempts < 200:
                y += h + padding
                if y + h > board_height - margin:
                    y = margin
                    x += w + padding
                    if x + w > board_width - margin:
                        x = cursor_x
                        y = cursor_y + (len(placed) + 1) * (h + padding)
                rect = (x, y, w, h)
                attempts += 1
                moved = True

            if attempts >= 200:
                warnings.append(f"Could not fully resolve overlap for command {cmd.get('commandId')}.")

            if moved:
                repairs.append(
                    {
                        "commandId": cmd.get("commandId"),
                        "from": {
                            "x": original.get("x"),
                            "y": original.get("y"),
                            "width": original.get("width"),
                            "height": original.get("height"),
                        },
                        "to": {"x": x, "y": y, "width": w, "height": h},
                        "reason": "overlap-or-bounds-repair",
                    }
                )

            cmd["x"] = round(x, 2)
            cmd["y"] = round(y, 2)
            cmd["width"] = round(w, 2)
            cmd["height"] = round(h, 2)
            cmd["metadata"] = {
                **safe_dict(cmd.get("metadata")),
                "layoutChecked": True,
                "layoutRepaired": moved,
                "fallbackUsed": False,
            }

            placed.append(rect)
            repaired_commands.append(cmd)

        bounds = self._compute_bounds(repaired_commands)
        recommended_zoom = self._recommended_zoom(bounds, board_width, board_height, margin)

        return {
            "layoutId": clean_text(payload.get("layoutId") or "layout_1", 120),
            "boardWidth": board_width,
            "boardHeight": board_height,
            "safeMargin": margin,
            "commands": repaired_commands,
            "boardCommands": repaired_commands,
            "repairs": repairs,
            "overlapReport": {
                "checked": True,
                "repairCount": len(repairs),
                "warnings": warnings,
                "remainingOverlapRisk": "low" if not warnings else "medium",
            },
            "autoscale": {
                "enabled": True,
                "contentBounds": bounds,
                "recommendedZoom": recommended_zoom,
                "fitViewRecommended": True,
            },
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "reactFlowReady": True,
                "konvaReady": True,
            },
        }

    @staticmethod
    def _compute_bounds(commands: List[JsonDict]) -> JsonDict:
        rects = [rect_from_command(cmd) for cmd in commands if command_needs_rect(cmd)]
        if not rects:
            return {"minX": 0, "minY": 0, "maxX": 0, "maxY": 0, "width": 0, "height": 0}

        min_x = min(x for x, y, w, h in rects)
        min_y = min(y for x, y, w, h in rects)
        max_x = max(x + w for x, y, w, h in rects)
        max_y = max(y + h for x, y, w, h in rects)

        return {
            "minX": round(min_x, 2),
            "minY": round(min_y, 2),
            "maxX": round(max_x, 2),
            "maxY": round(max_y, 2),
            "width": round(max_x - min_x, 2),
            "height": round(max_y - min_y, 2),
        }

    @staticmethod
    def _recommended_zoom(bounds: JsonDict, board_width: float, board_height: float, margin: float) -> float:
        content_w = float(bounds.get("width") or 1)
        content_h = float(bounds.get("height") or 1)
        available_w = max(1.0, board_width - margin * 2)
        available_h = max(1.0, board_height - margin * 2)
        zoom = min(1.0, available_w / content_w, available_h / content_h)
        return round(max(0.2, min(1.0, zoom)), 3)

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return raw

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        commands = safe_list(output.get("boardCommands") or output.get("commands"))
        if not commands:
            errors.append("LayoutAgent output must include boardCommands.")

        board_width = float(output.get("boardWidth") or 1600)
        board_height = float(output.get("boardHeight") or 1000)
        margin = float(output.get("safeMargin") or 48)

        rects: List[Tuple[str, Tuple[float, float, float, float]]] = []
        for index, cmd in enumerate(commands):
            item = safe_dict(cmd)
            if not command_needs_rect(item):
                continue

            x, y, w, h = rect_from_command(item)
            command_id = clean_text(item.get("commandId") or f"cmd_{index}", 120)

            if x < 0 or y < 0:
                errors.append(f"{command_id} has negative position.")
            if x + w > board_width + margin or y + h > board_height + margin:
                warnings.append(f"{command_id} may exceed board bounds.")

            rects.append((command_id, (x, y, w, h)))

        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                if overlaps(rects[i][1], rects[j][1], padding=8):
                    warnings.append(f"Possible overlap: {rects[i][0]} and {rects[j][0]}.")

        autoscale = safe_dict(output.get("autoscale"))
        if not autoscale.get("enabled"):
            warnings.append("autoscale.enabled should be true.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="LayoutAgent.validate_output",
            fallbackUsed=False,
        )