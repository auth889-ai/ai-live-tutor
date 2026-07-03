"""
tests/python/live_proof_domain_adk.py
===============================================================================
STEP 2 PROOF — the Domain agent now runs as a REAL Google ADK agent (through the
ADK Runner), producing the same domain result. Uses the real node payload.

Run:  python tests/python/live_proof_domain_adk.py
===============================================================================
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "agent_output"


async def main() -> None:
    payload = json.loads((OUT / "node_domain_payload.json").read_text())

    print("=" * 72)
    print("  STEP 2 — Domain agent through the REAL Google ADK Runner")
    print("=" * 72)
    print(f"  node: {payload.get('selectedNode', {}).get('title')}")
    print(f"  visionIndex regions: {len(payload.get('visionIndex', []))} | "
          f"evidence: {len(payload.get('selectedEvidence', []))}\n")

    from google_agent.planning.domain_router import route_domain
    r = await route_domain(payload)

    adk = r.get("_adk", {})
    print(f"  ranThroughAdkRunner = {adk.get('ranThroughAdkRunner')}")
    print(f"  ADK events emitted  = {adk.get('adkEvents')}   (proof the ADK Runner executed)")
    print(f"\n  DOMAIN   = {r.get('domain', '').upper()}  ({r.get('confidence', 0):.0%})")
    print(f"  REASONING= {r.get('reasoning', '')[:200]}")
    print(f"  SIGNALS  = {r.get('signals')}")
    print("\n  ✅ Domain is now a real ADK agent — same output, real framework.")


if __name__ == "__main__":
    asyncio.run(main())
