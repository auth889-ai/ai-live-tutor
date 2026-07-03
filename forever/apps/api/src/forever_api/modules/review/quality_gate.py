from __future__ import annotations


def review_manifest(manifest: dict) -> dict:
    object_ids = {item["objectId"] for item in manifest["objects"]}
    issues = []

    for action in manifest["actions"]:
        target = action.get("objectId") or action.get("targetObjectId")
        if target and target not in object_ids:
            issues.append({"type": "missing_object", "actionId": action["actionId"], "target": target})
        if action["endMs"] < action["startMs"]:
            issues.append({"type": "bad_timing", "actionId": action["actionId"]})

    if not manifest["sourceEvidence"]:
        issues.append({"type": "missing_source_evidence"})

    return {"status": "pass" if not issues else "fail", "issues": issues}

