"""
google_agent/pipeline/agent_runner.py
Runs a single BaseLiveTutorAgent safely with timeout and structured error capture.
"""
from __future__ import annotations
import asyncio
import inspect
import time
from typing import Any

try:
    from ..live_tutor_agents.contracts import JsonDict, safe_dict, safe_list
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent

try:
    from .pipeline_state import PipelineState
except ImportError:
    from google_agent.pipeline.pipeline_state import PipelineState

DEFAULT_TIMEOUT_MS = 60_000


async def run_agent_safe(
    agent: BaseLiveTutorAgent,
    state: PipelineState,
    *,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    required: bool = True,
) -> bool:
    name = agent.agent_name
    start = int(time.time() * 1000)

    try:
        payload = {**state.context.payload, **state.as_agent_input_patch()}
        coro_or_result = agent.run(payload)

        if inspect.isawaitable(coro_or_result):
            raw_result = await asyncio.wait_for(coro_or_result, timeout=timeout_ms / 1000)
        else:
            raw_result = await asyncio.wait_for(_wrap(coro_or_result), timeout=timeout_ms / 1000)

        result_dict = raw_result.to_dict() if hasattr(raw_result, "to_dict") else safe_dict(raw_result)
        inner = safe_dict(result_dict.get("result") or result_dict)

        if result_dict.get("ok") is False:
            msg = f"{name} returned ok:false — {result_dict.get('errors', ['unknown error'])}"
            (state.add_error if required else state.add_warning)(msg, name)
            return False

        state.merge_agent_result(name, inner)
        state.timings[f"{name}_durationMs"] = int(time.time() * 1000) - start
        return True

    except asyncio.TimeoutError:
        msg = f"{name} timed out after {timeout_ms}ms"
        (state.add_error if required else state.add_warning)(msg, name)
        return False

    except Exception as exc:
        msg = f"{name} raised {type(exc).__name__}: {exc}"
        (state.add_error if required else state.add_warning)(msg, name)
        return False


async def run_agents_parallel(
    agents: list,
    state: PipelineState,
    *,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    required: bool = False,
) -> None:
    await asyncio.gather(
        *[run_agent_safe(a, state, timeout_ms=timeout_ms, required=required) for a in agents]
    )


async def _wrap(value: Any) -> Any:
    return value
