"""
google_agent/planning/domain_understanding_agent.py
===============================================================================
DOMAIN UNDERSTANDING — POWERFUL_WORKFLOW Phase 2 Step 2.9 (W2.3).

Small, fast, structured agent: looks at the SourceTruthPacket + visionIndex
and decides WHAT KIND of material this is — so every downstream planner
picks the right screen families (Strategy pattern).

  SQL PDF   → join_bridge_animation, star_schema_fact_dimension, query_dry_run
  Math PDF  → equation_derivation, graph, proof_step
  Bio PDF   → real_figure_label, process_flow, micro_to_macro

Output contract (schema-enforced):
  DomainProfile { domain, contentAssets{...}, recommendedScreenFamilies[],
                  subjectDecoTheme, reasoning }

Everything dynamic — domain detected from REAL evidence, never assumed.
===============================================================================
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional

try:
    from ..pipeline.gemini_structured import generate_structured_async
    from ..registry.lesson_registries import (
        DOMAIN_DECO_THEMES, DOMAIN_SCREEN_FAMILIES, SCREEN_REGISTRY,
        screen_types_for_domain,
    )
except ImportError:  # pragma: no cover
    from google_agent.pipeline.gemini_structured import generate_structured_async  # type: ignore
    from google_agent.registry.lesson_registries import (  # type: ignore
        DOMAIN_DECO_THEMES, DOMAIN_SCREEN_FAMILIES, SCREEN_REGISTRY,
        screen_types_for_domain,
    )

DOMAINS = ["sql_database", "programming", "math", "biology_science",
           "finance_econ", "history_law", "general"]

DOMAIN_PROFILE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "domain": {"type": "string", "enum": DOMAINS},
        "contentAssets": {
            "type": "object",
            "properties": {
                "hasTables": {"type": "boolean"},
                "hasCode": {"type": "boolean"},
                "hasFormulas": {"type": "boolean"},
                "hasFigures": {"type": "boolean"},
                "hasTimelines": {"type": "boolean"},
                "hasCharts": {"type": "boolean"},
            },
            "required": ["hasTables", "hasCode", "hasFormulas",
                         "hasFigures", "hasTimelines", "hasCharts"],
        },
        "reasoning": {"type": "string",
                      "description": "One short paragraph: why this domain"},
    },
    "required": ["domain", "contentAssets", "reasoning"],
}


def _compact_evidence(payload: Dict[str, Any], limit: int = 12) -> str:
    chunks = (payload.get("selectedEvidence") or payload.get("chunks") or [])[:limit]
    lines = []
    for c in chunks:
        text = (c.get("text") or c.get("textPreview") or "")[:220]
        if text:
            lines.append(f"[p.{c.get('page', '?')}] {text}")
    return "\n".join(lines)


def _vision_signal(payload: Dict[str, Any]) -> str:
    """What Vision actually SAW on the pages — strong domain evidence."""
    regions = payload.get("visionIndex") or []
    if not regions:
        return "(no vision scan available)"
    counts: Dict[str, int] = {}
    samples: List[str] = []
    for r in regions:
        rtype = r.get("type", "?")
        counts[rtype] = counts.get(rtype, 0) + 1
        if len(samples) < 6 and r.get("description"):
            samples.append(f"- {rtype}: {r['description'][:120]}")
    counts_str = ", ".join(f"{k}×{v}" for k, v in sorted(counts.items()))
    return f"Region types found: {counts_str}\nSamples:\n" + "\n".join(samples)


async def understand_domain(payload: Dict[str, Any],
                            *, model: Optional[str] = None) -> Dict[str, Any]:
    """
    One focused Flash call → DomainProfile.
    recommendedScreenFamilies / decoTheme derive from the REGISTRY (code),
    keeping Gemini's job small and the registry the single source of truth.
    """
    node_title = (payload.get("nodeTitle")
                  or (payload.get("selectedNode") or {}).get("title")
                  or "unknown topic")

    prompt = f"""Classify the teaching domain of this lesson material.

TOPIC: {node_title}

DOCUMENT SUMMARY: {(payload.get('fullPdfSummary') or {}).get('overview', '(none)')[:400]}

WHAT VISION SAW ON THE ACTUAL PAGES:
{_vision_signal(payload)}

SOURCE EVIDENCE (real chunks from the PDF):
{_compact_evidence(payload)}

Pick the single best domain and report which content assets genuinely exist
in THIS material (tables/code/formulas/figures/timelines/charts) — base it
on the evidence above, not on what the topic name suggests."""

    profile = await generate_structured_async(
        prompt, DOMAIN_PROFILE_SCHEMA, model=model, temperature=0.1,
    )

    domain = profile.get("domain") or "general"
    family = DOMAIN_SCREEN_FAMILIES.get(domain, "explanation")
    profile["recommendedScreenFamilies"] = SCREEN_REGISTRY.get(family, [])
    profile["availableScreenTypes"] = screen_types_for_domain(domain)
    profile["subjectDecoTheme"] = DOMAIN_DECO_THEMES.get(family, "soft_neutral_theme")

    print(f"[domain_understanding] domain={domain} "
          f"assets={[k for k, v in (profile.get('contentAssets') or {}).items() if v]}",
          file=sys.stderr)
    return profile
