"""
scripts/preview_backend_lesson.py
─────────────────────────────────
BACKEND OUTPUT PREVIEW — runs the EXACT pipeline entry Node.js calls
(run_pipeline_with_direct_fallback) on REAL data:
  real chunks from MongoDB + real page images + real PDF summary.

Shows what the frontend will receive, before any frontend exists.
Full JSON saved to agent_output/backend_preview.json

Run: python scripts/preview_backend_lesson.py
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from pymongo import MongoClient

RID = "glt_resource_1781020240341_814ec180"   # Evolutionary Database Design (17 pages)
PAGES = [10, 11, 12]                           # node's pages — real images on disk
NODE_TITLE = "Non-Destructive vs Destructive Database Changes"


def build_real_payload():
    """Exactly what Node's sourceContextPipeline would send (SourceTruthPacket)."""
    client = MongoClient(os.environ["MONGODB_URI"])
    db = client["live-tutor"]

    chunks = list(db.resource_chunks.find({"resourceId": RID}).sort("page", 1))
    resource = db.resources.find_one({"resourceId": RID}) or {}
    meta = resource.get("metadata") or {}

    img_dir = Path("server/public/live-tutor-page-images") / RID
    page_images = []
    for p in PAGES:
        f = img_dir / f"page-{p:02d}.png"
        if f.exists():
            page_images.append({"page": p, "imagePath": str(f.resolve())})

    evidence = [
        {"chunkId": c["chunkId"], "page": c["page"], "text": c["text"],
         "sourceRef": c.get("sourceRef", "")}
        for c in chunks
    ]

    print(f"REAL PAYLOAD: {len(evidence)} chunks · {len(page_images)} page images "
          f"· summary={'yes' if meta.get('fullPdfSummary') else 'no'}", file=sys.stderr)

    return {
        "nodeId": "nondestructive_vs_destructive_changes",
        "nodeTitle": NODE_TITLE,
        "studentLevel": "beginner",
        "resourceId": RID,
        "selectedNode": {"nodeId": "nondestructive_vs_destructive_changes",
                         "title": NODE_TITLE},
        "selectedEvidence": evidence,
        "chunks": evidence,
        "sourceRefs": [{"chunkId": e["chunkId"], "page": e["page"],
                        "quote": e["text"][:200]} for e in evidence],
        "pageImages": page_images,
        "fullPdfSummary": meta.get("fullPdfSummary", {}),
        "fullPdfOutline": meta.get("fullPdfOutline", {}),
        # Cap each legacy agent so one slow stage can't stall the preview.
        "agentTimeoutsMs": {name: 90_000 for name in (
            "MongoDbMcpToolAgent", "RagRetrievalAgent", "DetailedExplanationAgent",
            "AnalogyExampleAgent", "AssessmentQuizAgent", "VisualPlannerAgent",
            "DiagramCompilerAgent", "BoardSceneAgent", "BoardCommandAgent",
            "LayoutAgent", "HandwritingDrawingAgent", "VoiceScriptAgent",
            "SubtitleSyncAgent", "ValidatorSafetyAgent",
        )},
    }


async def main():
    from google_agent.pipeline.adk_pipeline_runner import run_pipeline_with_direct_fallback

    payload = build_real_payload()
    t0 = time.time()
    result = await run_pipeline_with_direct_fallback(payload)
    elapsed = time.time() - t0

    out_dir = Path("agent_output"); out_dir.mkdir(exist_ok=True)
    out_file = out_dir / "backend_preview.json"
    out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2))

    screens = result.get("boardScreens") or []
    commands = result.get("boardCommands") or []
    voice = result.get("voiceScript") or []
    meta = result.get("metadata") or {}

    print()
    print("═" * 72)
    print(f"BACKEND OUTPUT — generated in {elapsed:.0f}s — saved to {out_file}")
    print("═" * 72)
    print(f"pipeline used : {meta.get('pipeline')}")
    print(f"boardScreens  : {len(screens)}")
    print(f"boardCommands : {len(commands)}")
    print(f"voiceScript   : {len(voice)}")
    print(f"subtitles     : {len(result.get('subtitles') or [])}")
    print(f"sourceRefs    : {len(result.get('sourceRefs') or [])}")
    has_contract = bool(result.get("agentOutputs", {}).get("PedagogyPlanner"))
    print(f"LessonDesignContract attached: {has_contract}")

    bbox_count = sum(1 for c in commands if isinstance(c.get("bbox"), dict)
                     and all(k in c["bbox"] for k in "xywh"))
    print(f"commands with bbox: {bbox_count}/{len(commands)}")

    print()
    print("── SAMPLE SCREEN (first content screen) " + "─" * 30)
    for s in screens[:3]:
        print(f"\n  [{s.get('screenId')}] type={s.get('screenType')}")
        print(f"  TITLE: {s.get('title')}")
        for b in (s.get("blocks") or [])[:2]:
            content = (b.get("content") or "")[:200]
            print(f"    block[{b.get('type')}]: {content}")

    print()
    print("── SAMPLE COMMANDS (what the pointer will do) " + "─" * 24)
    for c in commands[:6]:
        bbox = c.get("bbox") or {}
        print(f"  {c.get('commandId', '')[:24]:26s} {c.get('commandType', ''):14s} "
              f"screen={c.get('screenId', '')[:14]:16s} "
              f"bbox=({bbox.get('x')},{bbox.get('y')},{bbox.get('w')},{bbox.get('h')}) "
              f"t={c.get('startMs')}-{c.get('endMs')}ms")

    print()
    print("── SAMPLE TEACHER VOICE " + "─" * 46)
    for v in voice[:4]:
        print(f"  [{v.get('lineId')}→{v.get('screenId')}] {(v.get('text') or '')[:160]}")

    print()
    print("Full JSON: agent_output/backend_preview.json")


if __name__ == "__main__":
    asyncio.run(main())
