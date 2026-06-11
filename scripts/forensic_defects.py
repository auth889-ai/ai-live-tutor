"""
scripts/forensic_defects.py
Re-runs the grounding verifier on the saved proof-run lesson and prints the
EXACT defects per screen — the flywheel's first turn.

Run: python scripts/forensic_defects.py
"""

import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv()

from pymongo import MongoClient
from google_agent.generation.grounding_verifier import verify_screen

RID = "glt_resource_1781020240341_814ec180"

lesson = json.loads(Path("agent_output/backend_preview.json").read_text())

# Rebuild the payload the verifier saw: real chunks + THIS run's visionIndex
db = MongoClient(os.environ["MONGODB_URI"])["live-tutor"]
chunks = list(db.resource_chunks.find({"resourceId": RID}))
vision = (lesson.get("agentOutputs", {}).get("VisionSafetyNet", {})
          .get("visionIndex", []))

payload = {
    "selectedEvidence": [
        {"chunkId": c["chunkId"], "page": c["page"], "text": c["text"]}
        for c in chunks
    ],
    "visionIndex": vision,
}
# Vision discoveries were also evidence during generation — include them
payload["selectedEvidence"] += [
    {"chunkId": f"vision_{r.get('regionId')}", "page": r.get("page"),
     "text": f"[{(r.get('type') or '').upper()} on page {r.get('page')}] "
             f"{r.get('description', '')}. {r.get('content', '')}"}
    for r in vision
]

print(f"Lesson: {len(lesson.get('boardScreens', []))} screens · "
      f"visionIndex: {len(vision)} regions · "
      f"evidence: {len(payload['selectedEvidence'])} entries\n")

defect_types = Counter()
screens_bad = 0
for screen in lesson.get("boardScreens", []):
    defects = verify_screen(screen, payload)
    if defects:
        screens_bad += 1
        seg = screen.get("segmentIndex")
        print(f"── seg{seg} {screen.get('screenId')} [{screen.get('screenType')}]")
        for d in defects:
            print(f"   ✗ {d}")
            for key in ("NOT verbatim", "not in visionIndex", "off-board",
                        "not monotonic", "requires dryRun", "empty",
                        "missing element"):
                if key in d:
                    defect_types[key] += 1
                    break

print(f"\n══ SUMMARY ══")
print(f"screens with defects: {screens_bad}/{len(lesson.get('boardScreens', []))}")
print("defect type counts:", dict(defect_types))
qr = lesson.get("qualityReport", {})
print("\nqualityReport:", json.dumps(qr, indent=1)[:800])
