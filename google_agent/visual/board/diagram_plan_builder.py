"""
diagram_plan_builder.py — converts a detected diagram into timed boardCommands.
Each node/edge becomes a draw command that appears as the teacher talks.
"""
from __future__ import annotations
import uuid, time
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

try:
    from .command_contract import BoardCommand
except ImportError:
    from google_agent.visual.board.command_contract import BoardCommand

_BOX_COLORS = ["#2563eb","#16a34a","#9333ea","#dc2626","#0891b2","#d97706"]
_STEP_INTERVAL_MS = 2200


def build_flowchart_commands(diagram: JsonDict, screen_id: str, segment_id: str, start_ms: int = 0) -> List[dict]:
    d      = safe_dict(diagram)
    nodes  = [clean_text(n, 60) for n in safe_list(d.get("nodes") or [])]
    edges  = safe_list(d.get("edges") or [])
    cmds   = []
    cur_ms = start_ms

    x_spacing = 0.15
    y_base    = 0.35
    positions = {n: (0.05 + i * x_spacing, y_base) for i, n in enumerate(nodes[:8])}

    for i, node in enumerate(nodes[:8]):
        x, y  = positions[node]
        color = _BOX_COLORS[i % len(_BOX_COLORS)]
        cmd   = BoardCommand(
            type="drawBox", text=node, screenId=screen_id, segmentId=segment_id,
            x=x, y=y, width=0.12, height=0.08, color=color,
            startMs=cur_ms, durationMs=1800, revealOrder=i+1,
            teacherIntent=f"show_step_{i+1}",
        )
        cmds.append(cmd.to_dict())
        cur_ms += _STEP_INTERVAL_MS

    for edge in safe_list(edges)[:10]:
        e    = safe_dict(edge)
        frm  = clean_text(e.get("from") or e.get("source") or "", 60)
        to   = clean_text(e.get("to")   or e.get("target") or "", 60)
        if frm in positions and to in positions:
            fx, fy = positions[frm]; tx, ty = positions[to]
            cmd = BoardCommand(
                type="drawArrow", text=e.get("label") or "", screenId=screen_id, segmentId=segment_id,
                x=fx+0.12, y=fy+0.04, width=tx-fx-0.12, height=0.0,
                startMs=cur_ms, durationMs=900,
                arrowTarget={"fromX": fx+0.12, "fromY": fy+0.04, "toX": tx, "toY": ty+0.04},
                teacherIntent="connect_steps",
            )
            cmds.append(cmd.to_dict())
            cur_ms += 1000

    return cmds
