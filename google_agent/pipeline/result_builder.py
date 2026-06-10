"""
google_agent/pipeline/result_builder.py
Assembles the final Stage2 JSON result from pipeline state.
"""
from __future__ import annotations
import time
from typing import Dict, List

try:
    from ..live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, dedupe_source_refs
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, dedupe_source_refs

try:
    from .pipeline_state import PipelineState
    from .validation_gate import validate_pipeline_output
except ImportError:
    from google_agent.pipeline.pipeline_state import PipelineState
    from google_agent.pipeline.validation_gate import validate_pipeline_output


def build_final_result(state: PipelineState) -> JsonDict:
    validation = validate_pipeline_output(state)
    screens = _build_screens(state)
    all_refs = dedupe_source_refs(state.source_refs + state.context.source_refs)

    return {
        "ok": validation.ok,
        "boardScreens": screens,
        "boardCommands": state.board_commands,
        "voiceScript": state.voice_lines,
        "subtitles": state.subtitle_lines,
        "sourceRefs": all_refs[:80],
        "selectedNode": state.context.selected_node,
        "selectedNodeTitle": state.context.selected_node_title,
        "agentOutputs": state.agent_outputs,
        "validation": validation.to_dict(),
        "errors": state.errors,
        "warnings": state.warnings,
        "metadata": {
            "fallbackUsed": False,
            "realSeparateAgents": True,
            "agentCount": len(state.agent_outputs),
            "boardCommandCount": len(state.board_commands),
            "voiceLineCount": len(state.voice_lines),
            "subtitleCount": len(state.subtitle_lines),
            "screenCount": len(screens),
            "sourceRefCount": len(all_refs),
            "timings": state.timings,
            "generatedAtMs": int(time.time() * 1000),
        },
    }


def _build_screens(state: PipelineState) -> List[JsonDict]:
    if state.board_screens:
        return _enrich_screens(state.board_screens, state)

    screen_map: Dict[str, List[JsonDict]] = {}
    for cmd in state.board_commands:
        sid = cmd.get("sceneId") or cmd.get("screenId") or "screen_1"
        screen_map.setdefault(sid, []).append(cmd)

    screens = []
    for idx, (sid, cmds) in enumerate(screen_map.items()):
        screens.append({
            "screenId": sid,
            "screenIndex": idx + 1,
            "screenType": _infer_screen_type(cmds),
            "title": cmds[0].get("text", "")[:60] if cmds else "",
            "boardCommands": cmds,
            "sourceRefs": state.source_refs[:8],
        })
    return screens


def _enrich_screens(screens: List[JsonDict], state: PipelineState) -> List[JsonDict]:
    cmd_index: Dict[str, JsonDict] = {
        c["commandId"]: c for c in state.board_commands if c.get("commandId")
    }
    for screen in screens:
        ids = safe_list(screen.get("boardCommandIds") or [])
        if ids and not screen.get("boardCommands"):
            screen["boardCommands"] = [cmd_index[cid] for cid in ids if cid in cmd_index]
        if not screen.get("sourceRefs"):
            screen["sourceRefs"] = state.source_refs[:8]
    return screens


def _infer_screen_type(cmds: List[JsonDict]) -> str:
    types = {c.get("type", "") for c in cmds}
    if "showQuiz" in types or "pauseForQuestion" in types:
        return "quiz"
    if "drawFlowchart" in types or "drawERDiagram" in types or "drawArrow" in types:
        return "diagram"
    if "drawTable" in types:
        return "comparison"
    if "drawCodeTrace" in types:
        return "code"
    return "explanation"
