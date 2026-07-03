"""
tests/python/live_proof_lesson_architect.py
===============================================================================
LIVE PROOF — runs the REAL LessonArchitectAgent through the REAL ADK Runner on a
cached node payload (pages 18-20, "Understanding the Star Schema"). No mocks.

Proves: the Teacher is now decomposed — the architect produces a SKELETON +
segment outline (not one giant LessonContract), ran through the ADK Runner, and
assigned EVERY page and EVERY region to a segment (nothing dropped).

Usage:
  conda activate live-tutor-adk
  python tests/python/live_proof_lesson_architect.py
===============================================================================
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
OUTPUT_DIR = ROOT / "agent_output"
PAYLOAD = OUTPUT_DIR / "node_domain_payload.json"


async def main() -> None:
    from google_agent.planning.teachers.lesson_architect import LessonArchitectAgent
    from google_agent.planning.teachers import teacher_context as tc

    payload = json.load(open(PAYLOAD))

    print("\n" + "=" * 72)
    print("  LIVE PROOF — LessonArchitectAgent (REAL ADK Runner, multimodal)")
    print("=" * 72)
    node = payload.get("selectedNode", {})
    print(f"  Node: {node.get('title')}  pages={node.get('pageRefs')}")
    print(f"  Regions in scope: {len(tc.region_ids(payload))}  "
          f"Pages: {tc.pages_list(payload)}")
    print("  (one focused ADK call — skeleton only, ~30-60s)\n")

    agent = LessonArchitectAgent(
        domain="SQL_DATABASE",
        teaching_sequence=["hook", "definition", "diagram", "worked example", "practice", "recap"],
        hook_opening="Start from a real query that is slow on a normalized schema.",
    )
    skeleton = await agent.run(payload)

    adk = skeleton.get("_adk", {})
    segs = skeleton.get("segmentOutline", [])
    all_regions = set(tc.region_ids(payload))
    all_pages = set(tc.pages_list(payload))
    assigned_r, assigned_p = set(), set()
    for s in segs:
        assigned_r.update(str(r) for r in (s.get("regionIds") or []))
        for p in (s.get("pages") or []):
            try:
                assigned_p.add(int(p))
            except (TypeError, ValueError):
                pass

    print(f"  ranThroughAdkRunner = {adk.get('ranThroughAdkRunner')}  "
          f"(events={adk.get('adkEvents')}, model={adk.get('model')})")
    print(f"  teachingThesis: {skeleton.get('teachingThesis','')[:120]}")
    print(f"  learningGoals: {len(skeleton.get('learningGoals') or [])}  "
          f"searchQueries: {len(skeleton.get('externalSearchQueries') or [])}")
    print(f"  segments: {len(segs)}")
    for s in segs:
        print(f"    • {s.get('segmentId')}: {str(s.get('title'))[:48]:48} "
              f"pages={s.get('pages')} regions={len(s.get('regionIds') or [])} "
              f"~{s.get('targetMinutes')}min mustCover={len(s.get('mustCover') or [])}")
    cov_r = (assigned_r & all_regions)
    print(f"\n  COVERAGE: pages {sorted(assigned_p & all_pages)}/{sorted(all_pages)}  "
          f"regions {len(cov_r)}/{len(all_regions)}")
    print(f"  every page assigned   = {all_pages <= assigned_p}")
    print(f"  every region assigned = {all_regions <= assigned_r}")

    (OUTPUT_DIR / "node_lesson_skeleton.json").write_text(json.dumps(skeleton, indent=2, ensure_ascii=False))
    print(f"\n  Saved: {OUTPUT_DIR / 'node_lesson_skeleton.json'}")

    ok = (adk.get("ranThroughAdkRunner") and all_pages <= assigned_p and all_regions <= assigned_r)
    print("\n  RESULT:", "✅ PASS" if ok else "❌ FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
