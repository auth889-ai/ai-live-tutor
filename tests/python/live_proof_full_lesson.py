"""
tests/python/live_proof_full_lesson.py
===============================================================================
FULL LESSON PROOF — generate ALL segments of the LessonContract IN PARALLEL
(the BullMQ model, via asyncio.gather) and assemble the complete node lesson.

Needs:
  agent_output/node_domain_payload.json
  agent_output/node_lesson_contract.json

Run:
  conda activate live-tutor-adk
  python tests/python/live_proof_full_lesson.py

Outputs:
  agent_output/node_full_lesson.json
  agent_output/node_full_lesson.md
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
    contract = json.loads((OUT / "node_lesson_contract.json").read_text())
    segments = contract.get("segments", [])
    if not segments:
        print("No segments."); sys.exit(1)

    from google_agent.generation.segment_generator import generate_segment_content
    from tests.python.live_proof_segment_content import _md as seg_md

    print("=" * 74)
    print(f"  FULL LESSON — {contract.get('title')}  ({len(segments)} segments, target {contract.get('targetMinutes')} min)")
    print("=" * 74)
    print(f"  generating all {len(segments)} segments IN PARALLEL (BullMQ model)…\n")

    async def gen(i, seg):
        try:
            r = await generate_segment_content(payload, seg, contract=contract)
            return i, r, None
        except Exception as e:
            return i, None, str(e)

    results = await asyncio.gather(*[gen(i, s) for i, s in enumerate(segments)])
    results.sort(key=lambda x: x[0])

    full = {"title": contract.get("title"), "targetMinutes": contract.get("targetMinutes"),
            "segments": []}
    md = [f"# Full lesson — {contract.get('title')}  ({contract.get('targetMinutes')} min)\n",
          f"_{contract.get('teachingThesis','')}_\n"]
    tot_screens = tot_el = tot_voice = tot_qa = 0
    for i, seg, err in results:
        plan = segments[i]
        if err:
            print(f"  ❌ segment {i} ({plan.get('title')}): {err[:120]}")
            md.append(f"\n## ⚠ Segment {i+1}: {plan.get('title')} — FAILED: {err[:160]}\n")
            continue
        scr = seg.get("screens", [])
        el = sum(len(s.get("elements", [])) for s in scr)
        vc = sum(len(s.get("voiceLines", [])) for s in scr)
        qa = len(seg.get("scenarioQuestions", []))
        tot_screens += len(scr); tot_el += el; tot_voice += vc; tot_qa += qa
        print(f"  ✅ seg {i+1}: {plan.get('title')[:42]:42} — {len(scr)} screens, {el} elements, {vc} voice, {qa} Q&A")
        full["segments"].append(seg)
        md.append(f"\n\n# ════ SEGMENT {i+1}: {plan.get('title')} ════\n")
        md.append(seg_md(seg))

    print(f"\n  TOTAL: {len(full['segments'])}/{len(segments)} segments | "
          f"{tot_screens} screens | {tot_el} elements | {tot_voice} voice lines | {tot_qa} scenario Q&A")

    (OUT / "node_full_lesson.json").write_text(json.dumps(full, indent=2, ensure_ascii=False))
    (OUT / "node_full_lesson.md").write_text("\n".join(md))
    print(f"\n  Saved:\n    {OUT/'node_full_lesson.md'}\n    {OUT/'node_full_lesson.json'}")


if __name__ == "__main__":
    asyncio.run(main())
