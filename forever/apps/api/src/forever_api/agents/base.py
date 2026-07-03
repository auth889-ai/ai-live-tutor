from __future__ import annotations

from dataclasses import dataclass

from forever_api.orchestration.state import ForeverState


@dataclass(frozen=True)
class AgentSpec:
    name: str
    role: str
    output_contract: str


class ForeverAgent:
    spec: AgentSpec

    async def run(self, state: ForeverState) -> ForeverState:
        raise NotImplementedError

