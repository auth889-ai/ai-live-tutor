"""
tests/python/live_proof_lesson_contract.py
===============================================================================
STAGE A PROOF — run the real domain teacher on the real node payload and show
the LessonContract it produces (multimodal: the teacher SEES the page images).

Run:
  cd server && node scripts/nodeToDomainPayload.js          # builds node_domain payload
  conda activate live-tutor-adk
  python tests/python/live_proof_node_to_domain.py           # writes node_domain_payload.json
  python tests/python/live_proof_lesson_contract.py          # this

Outputs:
  agent_output/node_lesson_contract.json
  agent_output/node_lesson_contract.md
===============================================================================
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "agent_output"


def _md(contract: dict) -> str:
    L = [f"# LessonContract — {contract.get('title')}  ({contract.get('domain')})\n",
         f"**Thesis:** {contract.get('teachingThesis','')}\n",
         f"**Student level:** {contract.get('studentLevel')}  |  **target:** {contract.get('targetMinutes')} min\n",
         "**Learning goals:**"]
    for g in contract.get("learningGoals", []):
        L.append(f"- {g}")
    sup = contract.get("sourceUsePlan", {})
    L.append(f"\n**Source use:** pages {sup.get('primaryPages')} | regions {sup.get('primaryRegionIds')}\n")
    for seg in contract.get("segments", []):
        L.append(f"\n---\n\n## Segment: {seg.get('title')}  ({seg.get('segmentId')})")
        L.append(f"*goal:* {seg.get('learningGoal','')}  |  *modeMix:* {seg.get('modeMix')}")
        L.append("\n**Screens:**")
        for sc in seg.get("screenPlan", []):
            L.append(f"- `{sc.get('screenId')}` **{sc.get('mode')}** / {sc.get('template')} — "
                     f"{sc.get('mainIdea')}  → regions {sc.get('requiredRegionIds')}")
            for el in sc.get("elements", []):
                sb = " [sandbox]" if el.get("needsSandbox") else ""
                L.append(f"    · element `{el.get('elementType')}`{sb}: {el.get('contentBrief','')}")
            lc = sc.get("levelCoverage") or {}
            if lc:
                L.append(f"    · levels — weak: {lc.get('weak','')[:70]} | core: {lc.get('core','')[:70]} | stretch: {lc.get('stretch','')[:70]}")
        L.append("\n**Teacher voice plan:**")
        for v in seg.get("teacherVoicePlan", []):
            L.append(f"- [{v.get('voiceLineIntent')}] {v.get('textGoal')}  "
                     f"→ regions {v.get('targetRegionIds')} actions {v.get('boardActions')}")
        if seg.get("practicePlan"):
            L.append("\n**Practice:**")
            for p in seg["practicePlan"]:
                tag = " (web)" if p.get("fromWebSearch") else ""
                L.append(f"- Q{tag}: {p.get('question')}")
        if seg.get("misconceptions"):
            L.append("\n**Misconceptions:** " + "; ".join(seg["misconceptions"]))
    return "\n".join(L)


async def main() -> None:
    payload_path = OUT / "node_domain_payload.json"
    if not payload_path.exists():
        print("Run live_proof_node_to_domain.py first to create node_domain_payload.json")
        sys.exit(1)
    payload = json.loads(payload_path.read_text())

    domain = (payload.get("domainProfile") or {}).get("domain") or "general"
    node = payload.get("selectedNode", {})
    print("=" * 72)
    print(f"  STAGE A — Domain teacher for '{domain}' on node: {node.get('title')}")
    print("=" * 72)
    print(f"  pageImages: {len(payload.get('pageImages', []))} | "
          f"visionPages: {len(payload.get('visionPages', []))} | "
          f"evidence: {len(payload.get('selectedEvidence', []))}")
    print("  (Gemini Pro + Thinking, multimodal — ~30-90s)\n")

    from google_agent.planning.teachers import get_teacher
    teacher = get_teacher(domain)
    result = await teacher.run(payload)

    if not result.ok:
        print(f"  ❌ FAILED: {result.errors}")
        sys.exit(1)
    contract = result.result

    segs = contract.get("segments", [])
    n_screens = sum(len(s.get("screenPlan", [])) for s in segs)
    n_voice = sum(len(s.get("teacherVoicePlan", [])) for s in segs)
    n_elements = sum(len(sc.get("elements", [])) for s in segs for sc in s.get("screenPlan", []))
    n_sandbox = sum(1 for s in segs for sc in s.get("screenPlan", []) for e in sc.get("elements", []) if e.get("needsSandbox"))
    el_types = sorted({e.get("elementType") for s in segs for sc in s.get("screenPlan", []) for e in sc.get("elements", []) if e.get("elementType")})
    n_practice = sum(len(s.get("practicePlan", [])) for s in segs)
    modes = {sc.get("mode") for s in segs for sc in s.get("screenPlan", [])}
    grounded = sum(1 for s in segs for sc in s.get("screenPlan", []) if sc.get("requiredRegionIds"))
    queries = (contract.get("externalResources") or {}).get("searchQueries", [])

    print(f"  ✅ LessonContract by {teacher.agent_name}")
    print(f"     thesis: {contract.get('teachingThesis','')[:130]}")
    print(f"     target minutes: {contract.get('targetMinutes')}")
    print(f"     segments: {len(segs)} | screens: {n_screens} | voice lines: {n_voice}")
    print(f"     board ELEMENTS: {n_elements}  ({n_sandbox} need sandbox dry-run)")
    print(f"     element types used: {el_types}")
    print(f"     practice items: {n_practice}")
    print(f"     modes used: {sorted(m for m in modes if m)}  | grounded screens: {grounded}/{n_screens}")
    print(f"     externalResources.searchQueries: {len(queries)}")
    for q in queries[:5]:
        print(f"        ? {q}")
    print(f"     learning goals: {len(contract.get('learningGoals', []))}")
    for s in segs:
        print(f"       • {s.get('title')}  ({len(s.get('screenPlan', []))} screens, "
              f"{len(s.get('teacherVoicePlan', []))} voice)")

    (OUT / "node_lesson_contract.json").write_text(json.dumps(contract, indent=2, ensure_ascii=False))
    (OUT / "node_lesson_contract.md").write_text(_md(contract))
    print(f"\n  Saved:\n    {OUT/'node_lesson_contract.md'}\n    {OUT/'node_lesson_contract.json'}")


if __name__ == "__main__":
    asyncio.run(main())
