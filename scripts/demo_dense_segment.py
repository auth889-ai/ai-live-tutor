"""
scripts/demo_dense_segment.py
Regenerates ONE segment (teacher_model_1) with the new DENSITY rules (R11),
through the full quality loop, and saves it for rendering.
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


async def main():
    from google_agent.generation.segment_generator import generate_segment
    from google_agent.generation.segment_critic import critique_and_repair

    lesson = json.loads(Path("agent_output/backend_preview.json").read_text())
    contract = lesson["lessonDesignContract"]
    vision = lesson["agentOutputs"]["VisionSafetyNet"]["visionIndex"]

    db = MongoClient(os.environ["MONGODB_URI"])["live-tutor"]
    chunks = list(db.resource_chunks.find({"resourceId": RID}).sort("page", 1))

    payload = {
        "nodeTitle": "Non-Destructive vs Destructive Database Changes",
        "studentLevel": "beginner",
        "selectedEvidence": [
            {"chunkId": c["chunkId"], "page": c["page"], "text": c["text"]}
            for c in chunks
        ],
        "visionIndex": vision,
        "fullPdfSummary": {},
    }

    phase = next(p for p in contract["instructionalProcedures"]
                 if p["phase"] == "teacher_model_1")

    result = await critique_and_repair(
        generate_segment, payload, contract, phase, 0,
        screens_target=4,
        domain_profile={"domain": "sql_database"},
        max_repairs=1,
    )

    out = {"segment": result["segment"],
           "qualityScore": result["qualityScore"],
           "verified": result["verified"],
           "attempts": result["attempts"]}
    Path("agent_output/dense_segment_demo.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1))
    print(f"DONE score={result['qualityScore']} verified={result['verified']} "
          f"attempts={result['attempts']} "
          f"screens={len((result['segment'] or {}).get('screens') or [])}")


asyncio.run(main())
