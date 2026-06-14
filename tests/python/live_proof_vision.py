"""
tests/python/live_proof_vision.py
===============================================================================
LIVE PROOF — runs the REAL upgraded Vision agent on REAL page PNGs and shows
exactly what the AI returns. No mocks.

Proves the upgrade: deep page understanding (pageTitle, pageSummary,
teachingNarrative) + rich per-region analysis (conceptExplanation,
relationships, teachingNote) — not the old shallow "ERD on page 1" map.

Output:
  agent_output/live_proof_vision.json   (full raw)
  agent_output/live_proof_vision.md     (human-readable)

Usage:
  conda activate live-tutor-adk
  python tests/python/live_proof_vision.py [page numbers...]   # default: 1 2
===============================================================================
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))

OUTPUT_DIR = ROOT / "agent_output"
import os
RESOURCE = os.getenv("LIVE_PROOF_RESOURCE", "glt_resource_1780558985921_5f1ea0e3")
IMAGE_DIR = ROOT / "server" / "public" / "live-tutor-page-images" / RESOURCE


def _build_payload(pages: list[int]) -> dict:
    page_images = []
    for p in pages:
        candidate = IMAGE_DIR / f"page-{p:02d}.png"
        if not candidate.exists():
            raise FileNotFoundError(f"Real page image missing: {candidate}")
        page_images.append({"page": p, "imagePath": str(candidate)})

    return {
        "selectedNode": {"title": "Database Denormalization", "nodeId": "node_live_vision",
                         "pageRefs": pages},
        "studentLevel": "beginner",
        "pageImages": page_images,
        "fullPdfSummary": "A software design course covering database schema design, "
                          "normalization, denormalization, ERDs, and SQL query patterns.",
        "fullPdfOutline": "1. Databases 2. Normalization 3. Denormalization 4. Schema changes "
                          "5. ERD diagrams 6. SQL queries",
    }


def _save_md(result: dict) -> None:
    lines: list[str] = []
    lines.append("# Live Proof — Vision Agent (REAL Gemini, REAL page images)\n")
    lines.append(f"**Pages scanned:** {result['pagesScanned']}  |  "
                 f"**Failed:** {result['pagesFailed']}  |  "
                 f"**Regions:** {result['regionCount']}  |  "
                 f"**ok:** {result['ok']}\n")

    for page in result.get("pages", []):
        lines.append(f"\n---\n\n## Page {page['page']} — {page.get('pageTitle','')}\n")
        lines.append(f"**Page summary:** {page.get('pageSummary','')}\n")
        if page.get("conceptsCovered"):
            lines.append("**Concepts covered:** " + ", ".join(page["conceptsCovered"]) + "\n")
        if page.get("prerequisiteConcepts"):
            lines.append("**Prerequisites:** " + ", ".join(page["prerequisiteConcepts"]) + "\n")

        if page.get("teachingNarrative"):
            lines.append("\n### Step-by-step teaching narrative\n")
            for i, step in enumerate(page["teachingNarrative"], 1):
                lines.append(f"{i}. {step}")
            lines.append("")

        if page.get("readingOrder"):
            lines.append("**Reading order:** " + " → ".join(page["readingOrder"]) + "\n")

        lines.append("\n### Regions\n")
        for r in page.get("regions", []):
            lines.append(f"\n#### `{r['regionId']}` — [{r['type']}] {r.get('title','')}  "
                         f"_(teachingValue: {r['teachingValue']})_")
            lines.append(f"- **bbox:** x={r['bbox']['x']} y={r['bbox']['y']} "
                         f"w={r['bbox']['w']} h={r['bbox']['h']}")
            lines.append(f"- **description:** {r.get('description','')}")
            lines.append(f"- **exact content:** {r.get('content','')}")
            if r.get("contains"):
                lines.append(f"- **contains:** {', '.join(r['contains'])}")
            lines.append(f"- **concept (meaning):** {r.get('conceptExplanation','')}")
            if r.get("relationships"):
                lines.append("- **relationships:**")
                for rel in r["relationships"]:
                    lines.append(f"    - {rel}")
            lines.append(f"- **how to teach it:** {r.get('teachingNote','')}")
            if r.get("suggestedActions"):
                lines.append(f"- **suggested board actions:** {', '.join(r['suggestedActions'])}")
            if r.get("commonMisconception"):
                lines.append(f"- **common misconception:** {r['commonMisconception']}")

    (OUTPUT_DIR / "live_proof_vision.md").write_text("\n".join(lines))
    (OUTPUT_DIR / "live_proof_vision.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))


async def main() -> None:
    pages = [int(a) for a in sys.argv[1:]] or [1, 2]

    from google_agent.source.vision_safety_net import VisionAgent

    print("\n" + "=" * 72)
    print("  LIVE PROOF — Vision Agent (REAL Gemini multimodal)")
    print("=" * 72)
    print(f"  Pages: {pages}")
    print(f"  Image dir: {IMAGE_DIR}")
    print("  (each page = one multimodal call with thinking — ~20-60s/page)\n")

    payload = _build_payload(pages)
    agent = VisionAgent()
    out = await agent.run(payload)
    result = out["result"]

    print(f"  ok={result['ok']}  pagesScanned={result['pagesScanned']}  "
          f"regions={result['regionCount']}  failed={result['pagesFailed']}")
    if result.get("warnings"):
        for w in result["warnings"]:
            print(f"  ⚠ {w}")

    for page in result.get("pages", []):
        print(f"\n  ── Page {page['page']}: {page.get('pageTitle','')}")
        print(f"     summary: {page.get('pageSummary','')[:160]}")
        print(f"     concepts: {', '.join(page.get('conceptsCovered', [])[:6])}")
        print(f"     teaching steps: {len(page.get('teachingNarrative', []))}")
        for r in page.get("regions", []):
            print(f"       • {r['regionId']} [{r['type']}] {r.get('title','')[:50]} "
                  f"— concept: {r.get('conceptExplanation','')[:70]}")

    _save_md(result)
    print(f"\n  Saved:\n    {OUTPUT_DIR / 'live_proof_vision.md'}\n    {OUTPUT_DIR / 'live_proof_vision.json'}")

    if not result["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
