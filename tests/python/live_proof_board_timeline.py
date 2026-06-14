"""
tests/python/live_proof_board_timeline.py
===============================================================================
STAGE B PROOF — REAL Gemini agent generates the ordered Action timeline for a
segment (which element/region to spotlight, when to speak). Uses the API key.

Needs:
  agent_output/node_full_lesson.json     (segment content)
  agent_output/node_domain_payload.json  (visionIndex for region bboxes)

Run:
  python tests/python/live_proof_board_timeline.py [segment_index]
Outputs:
  agent_output/node_timeline.json
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
    full = json.loads((OUT / "node_full_lesson.json").read_text())
    segments = full.get("segments", [])
    if not segments:
        print("No segments in node_full_lesson.json"); sys.exit(1)

    idx = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    idx = max(0, min(idx, len(segments) - 1))
    seg = segments[idx]

    from google_agent.generation.board_timeline import generate_segment_timeline, CANVAS_W, CANVAS_H

    print("=" * 74)
    print(f"  STAGE B — REAL Gemini timeline agent for segment {idx}: {seg.get('title')}")
    print(f"  canvas {CANVAS_W}x{CANVAS_H}")
    print("=" * 74)

    tl = await generate_segment_timeline(seg, payload)

    total_actions = sum(len(s["actions"]) for s in tl["screens"])
    focus = sum(1 for s in tl["screens"] for a in s["actions"] if a.get("sync") == "fire_and_forget")
    speech = sum(1 for s in tl["screens"] for a in s["actions"] if a.get("type") == "speech")
    writes = sum(1 for s in tl["screens"] for a in s["actions"]
                 if a.get("type") in ("writeText", "drawArrow", "drawTable", "drawCode", "drawLatex", "drawBox"))
    bound = sum(1 for s in tl["screens"] for a in s["actions"]
                if a.get("regionId") or a.get("elementId"))

    print(f"  valid: {tl.get('valid')}  (timing resolved by: {tl.get('timingResolvedBy')})")
    print(f"  screens: {len(tl['screens'])} | actions: {total_actions} "
          f"(focus={focus}, speech={speech}, write={writes})")
    print(f"  actions bound to real region/element: {bound}/{total_actions}")

    sc = tl["screens"][0]
    print(f"\n  ── ordered timeline of screen '{sc['screenId']}' — first 12 actions (focus-before-speech):")
    for a in sorted(sc["actions"], key=lambda x: x.get("order", 0))[:12]:
        tgt = a.get("regionId") or a.get("elementId") or "-"
        extra = f' "{a.get("text","")[:50]}…"' if a.get("type") == "speech" else ""
        print(f"     order {a.get('order'):>2}  [{a.get('sync',''):<15}] {a.get('type',''):<12} → {tgt:<10} "
              f"vl={a.get('voiceLineId','')}{extra}")

    (OUT / "node_timeline.json").write_text(json.dumps(tl, indent=2, ensure_ascii=False))
    print(f"\n  Saved: {OUT/'node_timeline.json'}")


if __name__ == "__main__":
    asyncio.run(main())
