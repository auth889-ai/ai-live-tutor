"""
google_agent/debug_vision_scan.py
Step-3 curl proof entry: reads a SourceTruthPacket JSON on stdin,
runs the Vision Safety Net, prints the vision proof JSON on stdout.
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from google_agent.source.vision_safety_net import build_vision_index  # noqa: E402


def main() -> None:
    payload = json.loads(sys.stdin.read() or "{}")
    result = asyncio.run(build_vision_index(payload))
    # keep response compact for curl: drop bulky evidence bodies
    result["visionEvidenceCount"] = len(result.pop("visionEvidence", []) or [])
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
