"""
tests/python/live_proof_node_to_domain.py
===============================================================================
END-TO-END PROOF for one clicked node:
  1. read the SourceTruthPacket (agent_output/node_payload.json from the Node step)
  2. run the VISION agent on ALL the node's page images  → show what vision returns
  3. run the DOMAIN router on the vision output           → show domain found
  4. assemble the payload handed to the domain agent      → save it

Run:
  cd server && node scripts/nodeToDomainPayload.js          # builds node_payload.json
  conda activate live-tutor-adk
  python tests/python/live_proof_node_to_domain.py

Outputs:
  agent_output/node_vision_output.md / .json   (what vision returns)
  agent_output/node_domain_payload.json        (what goes to the domain agent)
===============================================================================
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "agent_output"


def _bar(t):
    print("\n" + "=" * 74 + f"\n  {t}\n" + "=" * 74)


async def main() -> None:
    payload_path = OUT / "node_payload.json"
    if not payload_path.exists():
        print("Run first:  cd server && node scripts/nodeToDomainPayload.js")
        sys.exit(1)
    payload = json.loads(payload_path.read_text())

    node = payload.get("selectedNode", {})
    _bar(f"NODE CLICKED: {node.get('title')}  (pages {node.get('pageRefs')})")
    imgs = payload.get("pageImages", [])
    print(f"  page images: {len(imgs)} -> {[i.get('page') for i in imgs]}")
    print(f"  evidence: {len(payload.get('selectedEvidence', []))}  | RAG: {len(payload.get('semanticChunks', []))}")

    # ── 1. VISION ────────────────────────────────────────────────────────────
    from google_agent.source.vision_safety_net import build_vision_index
    _bar("STEP 3 — VISION (sees ALL node page images, returns detailed output)")
    print("  (one multimodal call per page, ~20-60s each)\n")
    vision = await build_vision_index(payload)
    print(f"  ok={vision['ok']}  pagesScanned={vision['pagesScanned']}  regions={vision['regionCount']}")

    for pg in vision.get("pages", []):
        print(f"\n  ── Page {pg['page']}: {pg.get('pageTitle')}")
        print(f"     summary: {pg.get('pageSummary','')[:150]}")
        print(f"     concepts: {', '.join(pg.get('conceptsCovered', [])[:6])}")
        print(f"     teaching steps: {len(pg.get('teachingNarrative', []))}")
        for r in pg.get("regions", []):
            print(f"       • {r['regionId']} [{r['type']}] {r.get('title','')[:46]}")

    # save full vision output
    (OUT / "node_vision_output.json").write_text(json.dumps(vision, indent=2, ensure_ascii=False))
    _write_vision_md(node, vision)

    # ── 2. DOMAIN ────────────────────────────────────────────────────────────
    from google_agent.planning.domain_router import route_domain
    _bar("STEP 4 — DOMAIN ROUTER (decides from the vision output)")
    domain_payload_in = {**payload, "visionIndex": vision["visionIndex"]}
    domain = await route_domain(domain_payload_in)
    print(f"  DOMAIN: {domain['domain'].upper()}  ({domain['confidence']:.0%})")
    print(f"  reasoning: {domain['reasoning'][:200]}")
    print(f"  signals: {domain.get('signals')}")

    # ── 3. PAYLOAD HANDED TO THE DOMAIN AGENT ────────────────────────────────
    domain_payload = {
        **payload,
        "visionIndex": vision["visionIndex"],
        "visionPages": vision.get("pages", []),
        "visionEvidence": vision.get("visionEvidence", []),
        "domainProfile": domain,
    }
    (OUT / "node_domain_payload.json").write_text(json.dumps(domain_payload, indent=2, ensure_ascii=False))

    _bar("PAYLOAD HANDED TO THE DOMAIN AGENT")
    print(f"  → teacher selected by domain: {domain['domain']}")
    print(f"  payload keys: {sorted(domain_payload.keys())}")
    print(f"  visionPages: {len(domain_payload['visionPages'])}  | visionIndex regions: {len(domain_payload['visionIndex'])}")
    print(f"  selectedEvidence: {len(domain_payload.get('selectedEvidence', []))}  | pageImages: {len(domain_payload.get('pageImages', []))}")
    print(f"\n  Saved:\n    {OUT/'node_vision_output.md'}\n    {OUT/'node_vision_output.json'}\n    {OUT/'node_domain_payload.json'}")


def _write_vision_md(node, vision):
    L = [f"# Vision output — node: {node.get('title')} (pages {node.get('pageRefs')})\n",
         f"regions={vision['regionCount']} pagesScanned={vision['pagesScanned']} ok={vision['ok']}\n"]
    for pg in vision.get("pages", []):
        L.append(f"\n---\n\n## Page {pg['page']} — {pg.get('pageTitle')}\n")
        L.append(f"**Summary:** {pg.get('pageSummary','')}\n")
        L.append("**Concepts:** " + ", ".join(pg.get("conceptsCovered", [])) + "\n")
        if pg.get("teachingNarrative"):
            L.append("\n**Teaching narrative:**")
            for i, s in enumerate(pg["teachingNarrative"], 1):
                L.append(f"{i}. {s}")
        L.append("\n**Regions:**")
        for r in pg.get("regions", []):
            L.append(f"\n#### `{r['regionId']}` [{r['type']}] {r.get('title','')}")
            L.append(f"- description: {r.get('description','')}")
            L.append(f"- exact content: {r.get('content','')}")
            if r.get("relationships"):
                L.append("- relationships:")
                for rel in r["relationships"]:
                    L.append(f"    - {rel}")
            L.append(f"- concept: {r.get('conceptExplanation','')}")
            L.append(f"- how to teach: {r.get('teachingNote','')}")
    (OUT / "node_vision_output.md").write_text("\n".join(L))


if __name__ == "__main__":
    asyncio.run(main())
