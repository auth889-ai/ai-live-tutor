"""
google_agent/planning/domain_router.py
===============================================================================
DOMAIN ROUTER — Step 4 of the pipeline (after VisionSafetyNet).

Fast Gemini Flash call: reads visionIndex regions + PDF evidence text →
returns the exact domain string that selects the specialist teacher agent.

No fallback. If domain cannot be detected with confidence >= 0.6 → raises.
The caller (adk_pipeline_runner) picks the teacher from TEACHER_REGISTRY.
===============================================================================
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List

try:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext, JsonDict, ValidationResult, clean_text, safe_dict, safe_list,
    )
    from ..pipeline.gemini_structured import FLASH_MODEL
except ImportError:
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent  # type: ignore
    from google_agent.live_tutor_agents.contracts import (  # type: ignore
        AgentContext, JsonDict, ValidationResult, clean_text, safe_dict, safe_list,
    )
    from google_agent.pipeline.gemini_structured import FLASH_MODEL  # type: ignore


VALID_DOMAINS = [
    "sql_database", "programming", "math", "biology_science",
    "finance_econ", "history_law", "ai_ml", "general",
]

_SCHEMA: JsonDict = {
    "type": "object",
    "properties": {
        "domain":     {"type": "string", "enum": VALID_DOMAINS},
        "confidence": {"type": "number"},
        "reasoning":  {"type": "string"},
        "signals":    {"type": "array", "items": {"type": "string"}},
    },
    "required": ["domain", "confidence", "reasoning", "signals"],
}


class DomainRouterAgent(BaseLiveTutorAgent):
    agent_name    = "DomainRouterAgent"
    agent_group   = "planning"
    model         = FLASH_MODEL
    response_schema = _SCHEMA

    @property
    def instruction(self) -> str:
        return (
            "You are a domain classifier for an AI teaching system. "
            "Read the PDF evidence and visual regions, then return the single best "
            "domain that describes the material. Be decisive. Never return 'general' "
            "unless nothing else fits. Output only valid JSON."
        )

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        has_vision = bool(safe_list(payload.get("visionIndex")))
        has_evidence = bool(
            safe_list(payload.get("selectedEvidence")) or
            safe_list(payload.get("chunks"))
        )
        errors = []
        if not has_vision and not has_evidence:
            errors.append("DomainRouter requires visionIndex or selectedEvidence")
        return ValidationResult(ok=not errors, errors=errors, warnings=[],
                                validator="DomainRouterAgent.input", fallbackUsed=False)

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        regions = safe_list(payload.get("visionIndex"))[:12]
        vision_lines = "\n".join(
            f"  [{r.get('regionId')}] type={r.get('type')} | {clean_text(r.get('description',''),120)}"
            for r in regions if isinstance(r, dict)
        )
        chunks = safe_list(payload.get("selectedEvidence") or payload.get("chunks"))[:10]
        text_lines = "\n".join(
            f"  [p.{c.get('page','?')}] {clean_text(c.get('text') or c.get('textPreview',''),180)}"
            for c in chunks if isinstance(c, dict)
        )
        node_title = clean_text(
            safe_dict(payload.get("selectedNode")).get("title") or
            payload.get("nodeTitle") or "", 80
        )
        return (
            f"NODE TITLE: {node_title}\n\n"
            f"VISION REGIONS FOUND ON THE PDF PAGES:\n{vision_lines}\n\n"
            f"PDF TEXT EVIDENCE (first 10 chunks):\n{text_lines}\n\n"
            f"VALID DOMAINS: {', '.join(VALID_DOMAINS)}\n\n"
            "Return JSON with domain, confidence (0.0-1.0), reasoning, and signals "
            "(3-5 specific phrases from the text/regions that prove your choice)."
        )

    def normalize_output(self, raw: JsonDict, payload: JsonDict,
                         context: AgentContext) -> JsonDict:
        return {
            "domain":     clean_text(raw.get("domain") or "general", 40),
            "confidence": float(raw.get("confidence") or 0.0),
            "reasoning":  clean_text(raw.get("reasoning") or "", 400),
            "signals":    [clean_text(s, 120) for s in safe_list(raw.get("signals"))[:6]],
        }

    def validate_output(self, output: JsonDict, payload: JsonDict,
                        context: AgentContext) -> ValidationResult:
        errors = []
        if output.get("domain") not in VALID_DOMAINS:
            errors.append(f"domain '{output.get('domain')}' not in VALID_DOMAINS")
        if float(output.get("confidence") or 0) < 0.5:
            errors.append(f"confidence {output.get('confidence')} too low — domain unclear")
        return ValidationResult(ok=not errors, errors=errors, warnings=[],
                                validator="DomainRouterAgent.output", fallbackUsed=False)


async def route_domain(payload: JsonDict) -> JsonDict:
    """Called by adk_pipeline_runner. Returns normalized domain profile."""
    agent = DomainRouterAgent()
    result = await agent.run(payload)
    if not result.ok:
        raise RuntimeError(f"DomainRouterAgent failed: {result.errors}")
    return result.result
