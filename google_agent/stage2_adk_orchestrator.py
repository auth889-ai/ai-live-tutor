"""
google_agent/stage2_adk_orchestrator.py
=========================================
NEW Stage 2 entry point — uses all ADK agents via adk_pipeline_runner.
- Preprocessing agents: optional, 30s timeout each
- Content agents: optional, 90s timeout each
- No single timeout kills the pipeline
- Called by stage2LessonOrchestrator.js (not the old bridge)
- Old stage2_live_tutor_orchestrator.py is untouched.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback

CURRENT_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from google_agent.live_tutor_agents.contracts import safe_dict, safe_list, clean_text
from google_agent.pipeline.adk_pipeline_runner import run_pipeline_with_direct_fallback


async def run_orchestrator(payload: dict) -> dict:
    mode = clean_text(payload.get("mode") or "teach_node_pipeline", 60)

    if mode == "health":
        from google_agent.live_tutor_agents.orchestrator_registry import health_all
        health = await health_all()
        return {
            "ok": True, "service": "stage2_adk_orchestrator",
            "mode": "health", "adkAgents": health.get("agentCount"),
            "pipeline": "adk_pipeline_runner_v2",
            "preprocessingOptional": True, "contentOptional": True,
            "metadata": {"fallbackUsed": False},
        }

    if mode in ("teach_node_pipeline", "teach_node", "teachNode"):
        return await run_pipeline_with_direct_fallback(payload)

    if mode in ("interrupt_repair_pipeline", "interrupt_repair"):
        from google_agent.live.voice.interruption_repair import build_repair_segment
        question = clean_text(payload.get("studentQuestion") or payload.get("question") or "", 400)
        evidence = safe_list(payload.get("selectedEvidence") or payload.get("chunks") or [])
        node     = safe_dict(payload.get("selectedNode") or payload.get("node") or {})
        repair   = await build_repair_segment(
            question, safe_dict(payload.get("currentState") or payload),
            evidence, node.get("title") or "", payload.get("studentLevel") or "beginner"
        )
        return {"ok": True, "mode": mode, "result": repair, "metadata": {"fallbackUsed": False}}

    return {"ok": False, "error": f"Unknown mode: {mode}. Use: teach_node_pipeline, interrupt_repair_pipeline, health"}


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw.strip()) if raw.strip() else {}
    except Exception as e:
        payload = {}

    try:
        result = asyncio.run(run_orchestrator(payload))
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({
            "ok": False, "error": str(exc),
            "traceback": traceback.format_exc() if os.getenv("NODE_ENV") == "development" else "",
            "metadata": {"fallbackUsed": False, "pipeline": "stage2_adk_orchestrator"},
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
