"""
google_agent/pipeline/pipeline_state.py
Mutable state object passed through the entire Stage2 agent pipeline.
"""
from __future__ import annotations
import time
from dataclasses import dataclass, field
from typing import Dict, List

try:
    from ..live_tutor_agents.contracts import JsonDict, safe_dict, safe_list
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list

try:
    from .context_loader import PipelineContext
except ImportError:
    from google_agent.pipeline.context_loader import PipelineContext


@dataclass
class PipelineState:
    context: PipelineContext
    agent_outputs: Dict[str, JsonDict] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    timings: Dict[str, int] = field(default_factory=dict)
    board_screens: List[JsonDict] = field(default_factory=list)
    board_commands: List[JsonDict] = field(default_factory=list)
    voice_lines: List[JsonDict] = field(default_factory=list)
    subtitle_lines: List[JsonDict] = field(default_factory=list)
    source_refs: List[JsonDict] = field(default_factory=list)
    fallback_used: bool = False

    def set_output(self, agent_name: str, result: JsonDict) -> None:
        self.agent_outputs[agent_name] = safe_dict(result)
        self.timings[f"{agent_name}_completedMs"] = int(time.time() * 1000)

    def get_output(self, agent_name: str) -> JsonDict:
        return safe_dict(self.agent_outputs.get(agent_name))

    def add_error(self, msg: str, agent_name: str = "") -> None:
        self.errors.append(f"[{agent_name}] {msg}" if agent_name else msg)

    def add_warning(self, msg: str, agent_name: str = "") -> None:
        self.warnings.append(f"[{agent_name}] {msg}" if agent_name else msg)

    def is_healthy(self) -> bool:
        return not self.fallback_used and len(self.errors) == 0

    def merge_agent_result(self, agent_name: str, result: JsonDict) -> None:
        r = safe_dict(result)
        self.set_output(agent_name, r)
        self.board_commands.extend(safe_list(r.get("boardCommands") or []))
        self.voice_lines.extend(safe_list(r.get("voiceScript") or r.get("voiceLines") or []))
        self.subtitle_lines.extend(safe_list(r.get("subtitles") or []))
        self.source_refs.extend(safe_list(r.get("sourceRefs") or []))
        if safe_list(r.get("boardScreens")):
            self.board_screens.extend(safe_list(r.get("boardScreens")))
        for e in safe_list(r.get("errors") or []):
            self.add_error(str(e), agent_name)
        for w in safe_list(r.get("warnings") or []):
            self.add_warning(str(w), agent_name)

    def as_agent_input_patch(self) -> JsonDict:
        return {
            "agentOutputs": self.agent_outputs,
            "boardCommands": self.board_commands,
            "voiceScript": self.voice_lines,
            "subtitles": self.subtitle_lines,
            "sourceRefs": self.source_refs,
            "boardScreens": self.board_screens,
        }
