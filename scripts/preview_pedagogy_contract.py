"""
scripts/preview_pedagogy_contract.py
Regenerates the FULL Lesson Design Contract live (real chunks + real vision)
and saves it to agent_output/lesson_design_contract.json
"""

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv()

from pymongo import MongoClient

RID = "glt_resource_1781020240341_814ec180"
PAGES = [10, 11, 12]
NODE_TITLE = "Non-Destructive vs Destructive Database Changes"


async def main():
    from google_agent.source.vision_safety_net import build_vision_index
    from google_agent.planning.domain_understanding_agent import understand_domain
    from google_agent.planning.pedagogy_planner_agent import plan_pedagogy

    client = MongoClient(os.environ["MONGODB_URI"])
    db = client["live-tutor"]
    chunks = list(db.resource_chunks.find({"resourceId": RID}).sort("page", 1))
    resource = db.resources.find_one({"resourceId": RID}) or {}

    img_dir = Path("server/public/live-tutor-page-images") / RID
    payload = {
        "nodeTitle": NODE_TITLE,
        "studentLevel": "beginner",
        "selectedEvidence": [
            {"chunkId": c["chunkId"], "page": c["page"], "text": c["text"]}
            for c in chunks
        ],
        "pageImages": [
            {"page": p, "imagePath": str((img_dir / f"page-{p:02d}.png").resolve())}
            for p in PAGES
        ],
        "fullPdfSummary": (resource.get("metadata") or {}).get("fullPdfSummary", {}),
    }

    net = await build_vision_index(payload)
    payload["visionIndex"] = net["visionIndex"]
    print(f"vision: {len(net['visionIndex'])} regions", file=sys.stderr)

    profile = await understand_domain(payload)
    contract = await plan_pedagogy(payload, profile)

    out = Path("agent_output"); out.mkdir(exist_ok=True)
    (out / "lesson_design_contract.json").write_text(
        json.dumps(contract, ensure_ascii=False, indent=2))

    print(json.dumps(contract, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
