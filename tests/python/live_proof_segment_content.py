"""
tests/python/live_proof_segment_content.py
===============================================================================
STAGE C PROOF — generate the ACTUAL detailed board content for one real segment
of the LessonContract (multimodal: sees the page images), and show it.

Needs (from earlier steps):
  agent_output/node_domain_payload.json   (visionPages + pageImages + evidence)
  agent_output/node_lesson_contract.json  (the LessonContract plan)

Run:
  conda activate live-tutor-adk
  python tests/python/live_proof_segment_content.py [segment_index]

Outputs:
  agent_output/node_segment_content.json
  agent_output/node_segment_content.md
===============================================================================
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "agent_output"


def _md(seg: dict) -> str:
    L = [f"# Segment content — {seg.get('title')} ({seg.get('segmentId')})\n",
         f"_{seg.get('summary','')}_\n"]
    for sc in seg.get("screens", []):
        L.append(f"\n---\n\n## Screen `{sc.get('screenId')}` — {sc.get('title')}  "
                 f"[{sc.get('mode')}/{sc.get('template')}]  pages {sc.get('pages')}")
        for el in sc.get("elements", []):
            L.append(f"\n### element `{el.get('elementType')}`"
                     + (f"  (region {el.get('regionId')})" if el.get("regionId") else "")
                     + ("  [SANDBOX]" if el.get("needsSandbox") else ""))
            if el.get("title"):
                L.append(f"**{el['title']}**")
            if el.get("body"):
                L.append(el["body"])
            for b in el.get("bullets", []):
                L.append(f"- {b}")
            tbl = el.get("table") or {}
            if tbl.get("columns"):
                L.append("| " + " | ".join(tbl["columns"]) + " |")
                L.append("|" + "|".join(["---"] * len(tbl["columns"])) + "|")
                for row in tbl.get("rows", []):
                    L.append("| " + " | ".join(str(c) for c in row) + " |")
            code = el.get("code") or {}
            if code.get("content"):
                L.append(f"```{code.get('language','')}\n{code['content']}\n```")
            if el.get("dryRun"):
                L.append("\n_dry-run plan:_")
                for d in el["dryRun"]:
                    L.append(f"  {d.get('step')}. {d.get('action')} → {d.get('result')}")
            if el.get("diagramSpec"):
                L.append(f"```\n{el['diagramSpec']}\n```")
        L.append("\n**Teacher voice (step by step):**")
        for v in sc.get("voiceLines", []):
            tgt = v.get("targetRegionId") or v.get("targetElementId") or ""
            acts = ",".join(v.get("boardActions", []))
            L.append(f"- {v.get('text')}  _({acts}{' → '+tgt if tgt else ''})_")
    qs = seg.get("scenarioQuestions", [])
    if qs:
        L.append(f"\n---\n\n## Scenario practice ({len(qs)})")
        for i, q in enumerate(qs, 1):
            L.append(f"\n**Q{i} [{q.get('type','')}/{q.get('difficulty','')}]** {q.get('question')}")
            L.append(f"**A:** {q.get('answer')}")
    return "\n".join(L)


async def main() -> None:
    payload = json.loads((OUT / "node_domain_payload.json").read_text())
    contract = json.loads((OUT / "node_lesson_contract.json").read_text())
    segments = contract.get("segments", [])
    if not segments:
        print("No segments in contract."); sys.exit(1)

    idx = int(sys.argv[1]) if len(sys.argv) > 1 else 1  # default: 2nd segment (content-heavy)
    idx = max(0, min(idx, len(segments) - 1))
    segment = segments[idx]

    print("=" * 74)
    print(f"  STAGE C — generating content for segment {idx}: {segment.get('title')}")
    print("=" * 74)
    print(f"  planned screens: {len(segment.get('screenPlan', []))}")
    print("  (multimodal — sees the segment's page images, ~30-90s)\n")

    from google_agent.generation.segment_generator import generate_segment_content
    seg = await generate_segment_content(payload, segment, contract=contract)

    screens = seg.get("screens", [])
    n_el = sum(len(s.get("elements", [])) for s in screens)
    n_v = sum(len(s.get("voiceLines", [])) for s in screens)
    el_types = sorted({e.get("elementType") for s in screens for e in s.get("elements", []) if e.get("elementType")})
    qa = seg.get("scenarioQuestions", [])
    sandbox = sum(1 for s in screens for e in s.get("elements", []) if e.get("needsSandbox"))
    tables = sum(1 for s in screens for e in s.get("elements", []) if (e.get("table") or {}).get("rows"))
    code = sum(1 for s in screens for e in s.get("elements", []) if (e.get("code") or {}).get("content"))

    bodies = [e.get("body", "") for s in screens for e in s.get("elements", []) if e.get("body")]
    avg_body = int(sum(len(b) for b in bodies) / max(1, len(bodies)))
    print(f"  ✅ content generated")
    print(f"     screens: {len(screens)} | elements: {n_el} | voice lines: {n_v}")
    print(f"     elements with written body: {len(bodies)}/{n_el} | avg body length: {avg_body} chars")
    print(f"     element types: {el_types}")
    print(f"     real tables: {tables} | code blocks: {code} | sandbox dry-runs: {sandbox}")
    print(f"     scenario Q&A: {len(qa)}")
    for s in screens:
        print(f"       • {s.get('screenId')} {s.get('title','')[:48]} — "
              f"{len(s.get('elements', []))} elements, {len(s.get('voiceLines', []))} voice")

    (OUT / "node_segment_content.json").write_text(json.dumps(seg, indent=2, ensure_ascii=False))
    (OUT / "node_segment_content.md").write_text(_md(seg))
    print(f"\n  Saved:\n    {OUT/'node_segment_content.md'}\n    {OUT/'node_segment_content.json'}")


if __name__ == "__main__":
    asyncio.run(main())
