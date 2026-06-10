#!/usr/bin/env bash
set -euo pipefail

# Real HTTP proof for Stage 2 teach-node.
# Requires the backend server to be running.

API_BASE="${API_BASE:-http://localhost:3000/api}"
OWNER_KEY="${OWNER_KEY:-jana_test}"
OFFLINE_USER_ID="${OFFLINE_USER_ID:-$OWNER_KEY}"
DEVICE_ID="${DEVICE_ID:-device_test}"
RESOURCE_ID="${RESOURCE_ID:-glt_resource_1780558985921_5f1ea0e3}"
TREE_ID="${TREE_ID:-tree_1781042787991_f29ae235}"
NODE_ID="${NODE_ID:-example_sales_reports}"
STUDENT_LEVEL="${STUDENT_LEVEL:-beginner}"
LESSON_MODE="${LESSON_MODE:-masterclass}"
OUT_FILE="${OUT_FILE:-/tmp/stage2_teach_node_response.json}"

curl -sS \
  -X POST "$API_BASE/google-agent/live-tutor/stage2/teach-node" \
  -H "Content-Type: application/json" \
  -H "x-owner-key: $OWNER_KEY" \
  -H "x-offline-user-id: $OFFLINE_USER_ID" \
  -H "x-device-id: $DEVICE_ID" \
  --max-time "${CURL_MAX_TIME:-900}" \
  --data-binary @- > "$OUT_FILE" <<JSON
{
  "ownerKey": "$OWNER_KEY",
  "offlineUserId": "$OFFLINE_USER_ID",
  "deviceId": "$DEVICE_ID",
  "resourceId": "$RESOURCE_ID",
  "treeId": "$TREE_ID",
  "nodeId": "$NODE_ID",
  "studentLevel": "$STUDENT_LEVEL",
  "lessonMode": "$LESSON_MODE",
  "language": "english",
  "question": "Teach this selected PDF concept like a human tutor with source-grounded board, voice, subtitles, and correct visual pointing.",
  "synthesizeVoice": false,
  "requireSelectedPageVision": true,
  "proofRequestVersion": "stage2-curl-proof-v1"
}
JSON

python3 - "$OUT_FILE" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

inner = data.get("result") if isinstance(data.get("result"), dict) else {}

def arr(*keys):
    for root in (data, inner):
        for key in keys:
            value = root.get(key)
            if isinstance(value, list) and value:
                return value
    return []

board = arr("boardCommands", "commands")
voice = arr("voiceScript")
subs = arr("subtitles")
screens = arr("boardScreens", "premiumBoardScreens")
refs = arr("sourceRefs")
trace = arr("agentTrace", "trace")
metadata = {}
metadata.update(inner.get("metadata") if isinstance(inner.get("metadata"), dict) else {})
metadata.update(data.get("metadata") if isinstance(data.get("metadata"), dict) else {})

print(f"ok: {data.get('ok')}")
print(f"pipeline: {data.get('_pipeline') or metadata.get('pipeline') or metadata.get('usesAdkPipelineV2')}")
print(f"boardCommands: {len(board)}")
print(f"voiceScript: {len(voice)}")
print(f"subtitles: {len(subs)}")
print(f"boardScreens: {len(screens)}")
print(f"sourceRefs: {len(refs)}")
print(f"mcpUsed: {metadata.get('mcpUsed')}")
print(f"mcpToolCallCount: {metadata.get('mcpToolCallCount')}")
print(f"googleTtsUsed: {metadata.get('googleTtsUsed')}")

vision = None
agent_outputs = data.get("agentOutputs") if isinstance(data.get("agentOutputs"), dict) else {}
if isinstance(agent_outputs.get("SelectedPageVisionAgent"), dict):
    vision = agent_outputs["SelectedPageVisionAgent"]
vision_meta = vision.get("metadata") if isinstance(vision, dict) and isinstance(vision.get("metadata"), dict) else {}
if vision is not None:
    print(f"selectedPageVisionUsed: {vision.get('selectedPageVisionUsed')}")
    print(f"geminiVisionCalled: {vision_meta.get('geminiVisionCalled')}")
    print(f"pageImageAnalyses: {len(vision.get('pageImageAnalyses') or [])}")

failed = [t for t in trace if isinstance(t, dict) and not t.get("ok")]
if failed:
    print("failedAgents:")
    for item in failed[:12]:
        print(f"  - {item.get('agent')}: {item.get('error') or item.get('summary') or ''}")

if not board or not voice or not subs:
    print(f"response saved: {path}")
    raise SystemExit("Stage 2 proof failed: boardCommands, voiceScript, and subtitles are required.")

print(f"response saved: {path}")
PY
