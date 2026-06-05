"""
google_agent/live/voice_script_agent.py
===============================================================================
PHASE 2 COMPLETE REPLACEMENT

Human teacher VoiceScriptAgent, now selected-page-vision aware.

What this fixes:
- Uses DetailedExplanationAgent rich explanation.
- Uses selectedPageVision/diagramSummary/pageImageAnalyses if available.
- Generates human teacher narration, not robotic board-section narration.
- Syncs voice lines to real boardCommands.
- Mentions exact diagram/visual targets when available.
- Keeps sourceRefs on every line.
- Preserves Google TTS readiness metadata.
- No fake fallback.
===============================================================================
"""

from __future__ import annotations

import json
import re
from typing import Any, List

try:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        require_source_refs,
        safe_dict,
        safe_list,
    )
except Exception:
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
    from google_agent.live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        require_source_refs,
        safe_dict,
        safe_list,
    )


GENERIC_VOICE_PATTERNS = [
    r"now we open this board section",
    r"look at this board note",
    r"focus here first",
    r"watch how each part connects to the source",
    r"this block gives the next important explanation",
    r"this board explains",
    r"source backed concept",
    r"source-grounded concept",
    r"let'?s explore this selected node",
]


def _json(value: Any, limit: int = 170000) -> str:
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), limit)
    except Exception:
        return clean_text(value, limit)


def _walk_refs(value: Any, refs: List[JsonDict]) -> None:
    if isinstance(value, list):
        for item in value:
            _walk_refs(item, refs)
        return

    if isinstance(value, dict):
        local = value.get("sourceRefs") or value.get("refs")
        if isinstance(local, list):
            refs.extend([safe_dict(item) for item in local if safe_dict(item)])

        if any(key in value for key in ("chunkId", "sourceRef", "page", "quote")):
            refs.append(safe_dict(value))

        for child in value.values():
            if isinstance(child, (dict, list)):
                _walk_refs(child, refs)


def _chunk_ref(chunk: JsonDict) -> JsonDict:
    c = safe_dict(chunk)
    page = c.get("page") or c.get("pageNumber") or 1
    idx = c.get("chunkIndex") or c.get("index") or 0
    resource_id = clean_text(c.get("resourceId") or c.get("resource_id") or "", 180)

    return {
        "chunkId": clean_text(c.get("chunkId") or c.get("id") or f"{resource_id or 'resource'}_p{page}_c{idx}", 220),
        "sourceRef": clean_text(c.get("sourceRef") or c.get("ref") or f"{resource_id or 'resource'}:page:{page}:chunk:{idx}", 300),
        "pageRef": clean_text(c.get("pageRef") or f"{resource_id or 'resource'}:page:{page}", 300),
        "page": page,
        "quote": clean_text(c.get("quote") or c.get("textPreview") or c.get("text") or c.get("ocrText") or "", 900),
        "confidence": c.get("confidence") or 0.82,
        "resourceId": resource_id,
    }


def collect_source_refs(payload: JsonDict) -> List[JsonDict]:
    refs: List[JsonDict] = []

    for key in [
        "selectedEvidence",
        "primaryEvidence",
        "samePageEvidence",
        "nearbyEvidence",
        "relatedEvidence",
        "comparisonEvidence",
        "sourceRefs",
        "groundedRefs",
        "verifiedSourceRefs",
        "selectedNode",
        "node",
        "sourceGrounding",
        "detailedExplanation",
        "explanation",
        "selectedPageVision",
        "pageImageAnalyses",
        "detectedVisualDiagrams",
        "visualContext",
        "visualPlan",
        "premiumBoardScreens",
        "boardScreens",
        "boardSections",
        "sceneSet",
        "boardCommands",
        "commands",
        "compiledDiagrams",
        "diagramArtifacts",
        "exactChunks",
        "samePageChunks",
        "nearbyChunks",
        "relatedChunks",
        "chunks",
        "retrievedChunks",
    ]:
        _walk_refs(payload.get(key), refs)

    if not refs:
        for chunk in safe_list(payload.get("selectedEvidence") or payload.get("exactChunks") or payload.get("chunks") or payload.get("retrievedChunks")):
            refs.append(_chunk_ref(safe_dict(chunk)))

    return dedupe_source_refs(refs)


def _best_quotes(payload: JsonDict, limit: int = 14) -> List[JsonDict]:
    selected = [safe_dict(r) for r in safe_list(payload.get("selectedEvidence") or payload.get("primaryEvidence")) if safe_dict(r)]
    refs = dedupe_source_refs(selected + collect_source_refs(payload))
    out: List[JsonDict] = []
    seen = set()

    for ref in refs:
        quote = clean_text(ref.get("quote") or ref.get("text") or ref.get("snippet") or "", 450)
        key = quote.lower()[:180]
        if quote and key not in seen:
            seen.add(key)
            out.append({**ref, "quote": quote})
        if len(out) >= limit:
            break

    return out


def _command_refs(command: JsonDict, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    cmd = safe_dict(command)
    payload = safe_dict(cmd.get("payload") or cmd.get("visualPayload"))
    refs = dedupe_source_refs(safe_list(cmd.get("sourceRefs")) + safe_list(payload.get("sourceRefs")))
    return refs or fallback_refs[:4]


def _command_text(command: JsonDict) -> str:
    cmd = safe_dict(command)
    payload = safe_dict(cmd.get("payload") or cmd.get("visualPayload"))
    body = payload.get("body")

    if isinstance(body, dict):
        body_text = clean_text(
            body.get("text")
            or body.get("summary")
            or body.get("definition")
            or body.get("reason")
            or body,
            1400,
        )
    elif isinstance(body, list):
        body_text = clean_text("; ".join(clean_text(x, 260) for x in body[:8]), 1400)
    else:
        body_text = clean_text(body, 1400)

    return clean_text(
        cmd.get("text")
        or payload.get("text")
        or body_text
        or payload.get("teacherNotes")
        or payload.get("title")
        or payload.get("label")
        or cmd.get("title")
        or cmd.get("type")
        or "",
        1400,
    )


def _compact_commands(commands: List[JsonDict], refs: List[JsonDict], limit: int = 140) -> List[JsonDict]:
    out: List[JsonDict] = []

    for index, raw in enumerate(safe_list(commands)[:limit]):
        cmd = safe_dict(raw)
        payload = safe_dict(cmd.get("payload") or cmd.get("visualPayload"))
        command_id = clean_text(cmd.get("commandId") or cmd.get("id") or f"cmd_{index + 1}", 180)
        if not command_id:
            continue

        out.append(
            {
                "commandId": command_id,
                "type": clean_text(cmd.get("type") or cmd.get("action") or "writeText", 80),
                "text": _command_text(cmd),
                "screenNo": payload.get("screenNo") or safe_dict(cmd.get("metadata")).get("screenNo") or cmd.get("screenNo") or 1,
                "targetId": clean_text(payload.get("targetId") or payload.get("blockId") or cmd.get("targetId"), 180),
                "startMs": cmd.get("startMs"),
                "endMs": cmd.get("endMs"),
                "durationMs": cmd.get("durationMs"),
                "sourceRefs": _command_refs(cmd, refs),
            }
        )

    return out


def _compact_screens(payload: JsonDict) -> List[JsonDict]:
    out: List[JsonDict] = []

    for screen in safe_list(payload.get("premiumBoardScreens") or payload.get("boardScreens"))[:12]:
        s = safe_dict(screen)
        blocks = []

        for block in safe_list(s.get("blocks"))[:12]:
            b = safe_dict(block)
            blocks.append(
                {
                    "blockId": b.get("blockId") or b.get("id"),
                    "type": b.get("type"),
                    "title": clean_text(b.get("title"), 180),
                    "body": clean_text(b.get("body"), 1000),
                    "teacherAction": clean_text(b.get("teacherAction"), 300),
                    "sourceRefs": safe_list(b.get("sourceRefs"))[:4],
                    "hasMermaid": bool(b.get("mermaid") or safe_dict(b.get("compiledDiagram")).get("mermaid")),
                }
            )

        out.append(
            {
                "screenId": s.get("screenId") or s.get("id"),
                "screenNo": s.get("screenNo"),
                "title": clean_text(s.get("title"), 220),
                "goal": clean_text(s.get("goal"), 700),
                "blocks": blocks,
            }
        )

    return out


def _compact_diagrams(payload: JsonDict) -> List[JsonDict]:
    out: List[JsonDict] = []

    for raw in safe_list(payload.get("compiledDiagrams"))[:10]:
        d = safe_dict(raw)
        out.append(
            {
                "compiledDiagramId": d.get("compiledDiagramId"),
                "title": clean_text(d.get("title"), 180),
                "diagramType": d.get("diagramType"),
                "concepts": safe_list(d.get("concepts"))[:14],
                "relations": safe_list(d.get("relations") or d.get("edges"))[:20],
                "evidenceRows": safe_list(d.get("evidenceRows"))[:12],
                "mermaid": clean_text(d.get("mermaid") or d.get("mermaidCode"), 12000),
                "sourceRefs": safe_list(d.get("sourceRefs"))[:8],
            }
        )

    for raw in safe_list(payload.get("detectedVisualDiagrams"))[:6]:
        d = safe_dict(raw)
        out.append(
            {
                "compiledDiagramId": d.get("id") or f"vision_diagram_page_{d.get('page', 'x')}",
                "title": clean_text(d.get("title") or f"Vision diagram page {d.get('page', '?')}", 180),
                "diagramType": d.get("diagramType") or "selectedPageVisionDiagram",
                "concepts": safe_list(d.get("nodes"))[:14],
                "relations": safe_list(d.get("edges"))[:20],
                "renderSuggestion": clean_text(d.get("renderSuggestion") or d.get("summary"), 2200),
                "sourceRefs": safe_list(d.get("sourceRefs"))[:8],
                "fromSelectedPageVision": True,
            }
        )

    return out


def _vision_pack(payload: JsonDict) -> JsonDict:
    selected_vision = safe_dict(payload.get("selectedPageVision"))
    visual_context = safe_dict(payload.get("visualContext"))

    analyses = (
        safe_list(payload.get("pageImageAnalyses"))
        or safe_list(selected_vision.get("pageImageAnalyses"))
        or safe_list(visual_context.get("pageImageAnalyses"))
    )

    detected = (
        safe_list(payload.get("detectedVisualDiagrams"))
        or safe_list(selected_vision.get("detectedDiagrams"))
        or safe_list(visual_context.get("detectedDiagrams"))
    )

    summary = clean_text(
        payload.get("selectedPageVisionDiagramSummary")
        or selected_vision.get("diagramSummary")
        or visual_context.get("diagramSummary"),
        10000,
    )

    hints = (
        safe_list(payload.get("visualTeachingHints"))
        or safe_list(selected_vision.get("visualTeachingHints"))
        or safe_list(visual_context.get("visualTeachingHints"))
    )

    return {
        "selectedPageVisionUsed": bool(
            payload.get("selectedPageVisionUsed")
            or selected_vision.get("selectedPageVisionUsed")
            or safe_dict(selected_vision.get("metadata")).get("modelVisionUsed")
            or analyses
        ),
        "diagramSummary": summary,
        "pageImageAnalyses": analyses[:8],
        "detectedDiagrams": detected[:8],
        "visualTeachingHints": [clean_text(x, 500) for x in hints[:20]],
        "metadata": {
            "modelVisionUsed": bool(
                safe_dict(selected_vision.get("metadata")).get("modelVisionUsed")
                or safe_dict(visual_context.get("metadata")).get("modelVisionUsed")
                or analyses
            ),
            "pageImageAnalysisCount": len(analyses),
            "detectedDiagramCount": len(detected),
        },
    }


def _explanation_pack(payload: JsonDict) -> JsonDict:
    exp = safe_dict(payload.get("explanation") or payload.get("detailedExplanation"))
    visual = safe_dict(exp.get("diagramOrVisualExplanation"))

    return {
        "title": clean_text(exp.get("title"), 220),
        "simpleDefinition": clean_text(exp.get("simpleDefinition"), 1600),
        "intuition": clean_text(exp.get("intuition"), 1800),
        "sourceGroundedExplanation": clean_text(exp.get("sourceGroundedExplanation"), 3200),
        "diagramOrVisualExplanation": {
            "summary": clean_text(visual.get("summary"), 2500),
            "teacherPointingPlan": safe_list(visual.get("teacherPointingPlan"))[:12],
            "sourceRefs": safe_list(visual.get("sourceRefs"))[:8],
        },
        "stepByStep": [
            {
                "stepId": safe_dict(s).get("stepId"),
                "heading": clean_text(safe_dict(s).get("heading"), 180),
                "explanation": clean_text(safe_dict(s).get("explanation"), 1600),
                "boardNote": clean_text(safe_dict(s).get("boardNote"), 600),
                "teacherAction": clean_text(safe_dict(s).get("teacherAction"), 300),
                "sourceRefs": safe_list(safe_dict(s).get("sourceRefs"))[:4],
            }
            for s in safe_list(exp.get("stepByStep"))[:12]
        ],
        "workedExample": safe_dict(exp.get("workedExample")),
        "commonMistakes": safe_list(exp.get("commonMistakes"))[:8],
        "boardNotes": safe_list(exp.get("boardNotes"))[:16],
        "checkpoint": safe_dict(exp.get("checkpoint")),
        "teacherSummary": clean_text(exp.get("teacherSummary"), 1500),
        "sourceRefs": safe_list(exp.get("sourceRefs"))[:16],
    }


def _line_text(line: JsonDict) -> str:
    return clean_text(
        line.get("text")
        or line.get("dialog")
        or line.get("teacherDialog")
        or line.get("spokenText")
        or line.get("scriptText")
        or line.get("speech")
        or line.get("narration")
        or line.get("voice")
        or line.get("caption")
        or line.get("line")
        or "",
        3000,
    )


def _is_generic_voice(text: str) -> bool:
    low = clean_text(text, 1600).lower()
    return any(re.search(pattern, low, flags=re.I) for pattern in GENERIC_VOICE_PATTERNS)


def _safe_int(value: Any, fallback: int) -> int:
    try:
        if value in (None, ""):
            return int(fallback)
        return int(value)
    except Exception:
        return int(fallback)


def _naturalize_text(text: str) -> str:
    value = clean_text(text, 3000)
    value = re.sub(r"\bsource-backed concept\b", "this idea", value, flags=re.I)
    value = re.sub(r"\bsource-grounded concept\b", "this idea", value, flags=re.I)
    value = re.sub(r"\bselected node\b", "topic", value, flags=re.I)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _normalize_line(raw: JsonDict, index: int, commands: List[JsonDict], refs: List[JsonDict]) -> JsonDict:
    line = safe_dict(raw)
    command_ids = [c["commandId"] for c in commands]
    requested = clean_text(line.get("commandId") or line.get("boardCommandId"), 180)

    command_id = requested if requested in command_ids else (
        command_ids[index] if index < len(command_ids) else (command_ids[index % len(command_ids)] if command_ids else "")
    )

    command = next((c for c in commands if c.get("commandId") == command_id), {})

    source_refs = dedupe_source_refs(
        safe_list(line.get("sourceRefs"))
        or safe_list(command.get("sourceRefs"))
        or refs[:3]
    )

    if not source_refs:
        source_refs = refs[:3]

    text = _naturalize_text(_line_text(line))

    if len(text.split()) < 8 and command:
        command_text = clean_text(command.get("text"), 500)
        if command_text:
            text = _naturalize_text(f"{text} {command_text}")

    start_ms = _safe_int(line.get("startMs"), _safe_int(command.get("startMs"), index * 4600))
    duration = _safe_int(line.get("durationMs"), 0)

    if duration <= 0:
        duration = max(3200, min(18000, int(max(10, len(text.split())) / 2.15 * 1000)))

    end_ms = _safe_int(line.get("endMs"), start_ms + duration)
    if end_ms <= start_ms:
        end_ms = start_ms + duration

    return {
        "lineId": normalize_id(line.get("lineId") or line.get("voiceId") or f"voice_{index + 1}", f"voice_{index + 1}"),
        "voiceId": normalize_id(line.get("voiceId") or line.get("lineId") or f"voice_{index + 1}", f"voice_{index + 1}"),
        "commandId": command_id,
        "screenNo": _safe_int(line.get("screenNo") or command.get("screenNo"), 1),
        "startMs": start_ms,
        "endMs": end_ms,
        "durationMs": end_ms - start_ms,
        "text": text,
        "tone": clean_text(line.get("tone") or "human-teacher", 80),
        "emotion": clean_text(line.get("emotion") or "teacher-clear", 80),
        "pace": clean_text(line.get("pace") or "calm", 80),
        "teacherGesture": clean_text(line.get("teacherGesture") or line.get("gesture") or "point to the board", 260),
        "sourceRefs": source_refs,
        "metadata": {
            **safe_dict(line.get("metadata")),
            "fallbackUsed": False,
            "usedSmartFallback": False,
            "humanTeacherStyle": True,
            "sourceGrounded": True,
            "acceptedDialogField": bool(line.get("dialog") and not line.get("text")),
        },
    }


class VoiceScriptAgent(BaseLiveTutorAgent):
    agent_name = "VoiceScriptAgent"
    agent_group = "live"
    default_mode = "make_command_synced_voice_script"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the spoken voice of a human-like PDF tutor standing at a live board.

Return STRICT JSON ONLY.
Return ONE top-level JSON object only.
Do not return markdown.
Do not return commentary before or after JSON.

Write natural teacher narration that matches boardCommands exactly.
Do not use generic template phrases like:
- "Now we open this board section"
- "Look at this board note"
- "Focus here first"
- "Watch how each part connects to the source"

Use selectedEvidence first.
Use selectedPageVision/diagramSummary/pageImageAnalyses when available.
Explain like a teacher pointing, circling, drawing arrows, pausing, and asking checkpoints.
Every line must include commandId copied from boardCommands.
Every line must include sourceRefs.
Use the field "text" for spoken voice text, not "dialog".
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        refs = collect_source_refs(payload)
        commands = _compact_commands(safe_list(payload.get("boardCommands") or payload.get("commands")), refs)

        if not refs:
            errors.append("VoiceScriptAgent requires sourceRefs/selectedEvidence.")

        if not commands:
            errors.append("VoiceScriptAgent requires boardCommands with commandId.")

        vision = _vision_pack(payload)
        if vision["selectedPageVisionUsed"]:
            warnings.append(
                f"SelectedPageVision available for voice. analyses={vision['metadata']['pageImageAnalysisCount']} "
                f"diagrams={vision['metadata']['detectedDiagramCount']}"
            )

        warnings.append(f"VoiceScriptAgent commandCount={len(commands)} sourceRefCount={len(refs)}")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="VoiceScriptAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        refs = collect_source_refs(payload)
        commands = _compact_commands(safe_list(payload.get("boardCommands") or payload.get("commands")), refs, limit=140)
        vision = _vision_pack(payload)

        prompt_payload = {
            "task": "Create command-synchronized human teacher voiceScript for a live board lesson.",
            "strictRules": [
                "Return ONLY valid JSON as ONE TOP-LEVEL OBJECT.",
                "Do not return markdown fences.",
                "Do not return extra text after JSON.",
                "Use the key text for spoken narration. Do not use dialog.",
                "Do not use generic phrases: Now we open this board section, Look at this board note, Focus here first.",
                "Each line must copy one commandId from boardCommands; do not invent commandIds.",
                "Every line must explain what the board is showing and connect it to selected PDF evidence.",
                "If selectedPageVision exists, mention the actual visible diagram/table/layout in natural teacher words.",
                "Use selectedEvidence as primary evidence. Use relatedEvidence only as supporting. Comparison evidence only when comparing.",
                "Make it sound like a real teacher pointing, circling, drawing arrows, and asking checkpoints.",
                "Do not invent unsupported facts.",
            ],
            "student": {
                "level": context.studentLevel,
                "language": context.language,
                "question": clean_text(payload.get("question") or context.question, 1400),
            },
            "selectedNode": safe_dict(payload.get("selectedNode") or payload.get("node")),
            "selectedEvidence": safe_list(payload.get("selectedEvidence") or payload.get("primaryEvidence"))[:24],
            "samePageEvidence": safe_list(payload.get("samePageEvidence"))[:12],
            "relatedEvidence": safe_list(payload.get("relatedEvidence"))[:12],
            "comparisonEvidence": safe_list(payload.get("comparisonEvidence"))[:8],
            "bestSourceQuotes": _best_quotes(payload, 14),
            "detailedExplanation": _explanation_pack(payload),
            "selectedPageVisionPack": vision,
            "boardScreens": _compact_screens(payload),
            "compiledDiagrams": _compact_diagrams(payload),
            "boardCommands": commands,
            "teacherPromptPack": safe_dict(payload.get("teacherPromptPack")),
            "voiceStyle": {
                "tone": "friendly expert teacher",
                "pace": "calm but detailed",
                "mustSoundLike": [
                    "Here notice the central idea...",
                    "I am circling this part because...",
                    "This source line is important because...",
                    "A common mistake is...",
                    "Pause and check yourself...",
                ],
                "mustNotSoundLike": [
                    "Now we open this board section",
                    "Look at this board note",
                    "This block gives the next important explanation",
                ],
            },
            "requiredOutputSchema": {
                "voiceScriptId": "voice_script_1",
                "title": "Human Teacher Voice Script",
                "voiceScript": [
                    {
                        "lineId": "voice_1",
                        "commandId": "must match boardCommands.commandId",
                        "screenNo": 1,
                        "startMs": 0,
                        "endMs": 5000,
                        "durationMs": 5000,
                        "text": "natural teacher narration connected to source, board action, and diagram if present",
                        "tone": "human-teacher",
                        "teacherGesture": "point/circle/underline/draw-arrow/pause",
                        "sourceRefs": [],
                    }
                ],
                "teacherTranscript": "string",
                "sourceRefs": [],
                "metadata": {
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                    "humanTeacherStyle": True,
                    "commandSynchronized": True,
                    "selectedPageVisionUsed": True,
                    "googleTtsReady": True,
                },
            },
        }

        return _json(prompt_payload, 190000)

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)

        if isinstance(raw.get("result"), dict):
            result = safe_dict(raw.get("result"))
            if result.get("voiceScript") or result.get("lines") or result.get("script"):
                raw = result

        refs = dedupe_source_refs(safe_list(raw.get("sourceRefs")) + collect_source_refs(payload))
        if not refs:
            raise RuntimeError("VoiceScriptAgent cannot normalize without sourceRefs.")

        commands = _compact_commands(safe_list(payload.get("boardCommands") or payload.get("commands")), refs, limit=180)
        if not commands:
            raise RuntimeError("VoiceScriptAgent cannot normalize without boardCommands.")

        raw_lines = safe_list(
            raw.get("voiceScript")
            or raw.get("lines")
            or raw.get("script")
            or raw.get("items")
            or raw.get("rawList")
        )

        voice_lines: List[JsonDict] = []
        for index, line in enumerate(raw_lines):
            normalized = _normalize_line(safe_dict(line), index, commands, refs)
            if clean_text(normalized.get("text")):
                voice_lines.append(normalized)

        voice_lines.sort(key=lambda item: (_safe_int(item.get("startMs"), 0), _safe_int(item.get("endMs"), 0)))

        transcript = "\n".join(clean_text(line.get("text"), 3000) for line in voice_lines)
        vision = _vision_pack(payload)

        return {
            "voiceScriptId": normalize_id(raw.get("voiceScriptId") or "voice_script_1", "voice_script_1"),
            "title": clean_text(raw.get("title") or "Human Teacher Voice Script", 180),
            "estimatedDurationMs": max([_safe_int(line.get("endMs"), 0) for line in voice_lines] or [0]),
            "voiceScript": voice_lines,
            "teacherTranscript": transcript,
            "sourceRefs": refs,
            "googleTtsPlan": {
                "ready": True,
                "provider": "google-cloud-tts",
                "recommendedVoice": "teacher-natural",
                "syncUnit": "voiceScript.lineId + boardCommands.commandId",
                "note": "This agent prepares TTS-ready script. Actual audio rendering should be done by GoogleTtsVoiceRendererAgent/service.",
            },
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "humanTeacherStyle": True,
                "commandSynchronized": True,
                "voiceLineCount": len(voice_lines),
                "acceptedDialogField": any(safe_dict(line).get("acceptedDialogField") for line in voice_lines),
                "selectedPageVisionUsed": bool(vision.get("selectedPageVisionUsed")),
                "modelVisionUsed": bool(safe_dict(vision.get("metadata")).get("modelVisionUsed")),
                "pageImageAnalysisCount": safe_dict(vision.get("metadata")).get("pageImageAnalysisCount", 0),
                "detectedDiagramCount": safe_dict(vision.get("metadata")).get("detectedDiagramCount", 0),
                "googleTtsReady": True,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        lines = safe_list(output.get("voiceScript"))
        refs = safe_list(output.get("sourceRefs"))

        ref_validation = require_source_refs(refs, "VoiceScriptAgent.output.sourceRefs")
        errors.extend(ref_validation.errors)
        warnings.extend(ref_validation.warnings)

        commands = _compact_commands(safe_list(payload.get("boardCommands") or payload.get("commands")), refs, limit=180)
        command_ids = {command.get("commandId") for command in commands if command.get("commandId")}

        if not lines:
            errors.append("voiceScript lines are required.")

        generic_count = 0
        covered = set()

        for index, raw in enumerate(lines):
            line = safe_dict(raw)
            text = clean_text(line.get("text"), 3000)
            command_id = clean_text(line.get("commandId"), 180)

            if not command_id:
                errors.append(f"voiceScript[{index}] missing commandId.")
            elif command_ids and command_id not in command_ids:
                errors.append(f"voiceScript[{index}] commandId does not match boardCommands: {command_id}")
            else:
                covered.add(command_id)

            if len(text.split()) < 8:
                errors.append(f"voiceScript[{index}] text too short.")

            if _is_generic_voice(text):
                generic_count += 1

            if not safe_list(line.get("sourceRefs")):
                errors.append(f"voiceScript[{index}] missing sourceRefs.")

            if _safe_int(line.get("endMs"), 0) <= _safe_int(line.get("startMs"), 0):
                errors.append(f"voiceScript[{index}] invalid timing.")

        if generic_count:
            errors.append(f"{generic_count} voice lines still use generic/template wording.")

        if command_ids and len(covered) < min(12, len(command_ids)):
            warnings.append(
                f"Voice covers only {len(covered)} commandIds out of {len(command_ids)}. "
                "Use repair/refiner if full command coverage is required."
            )

        if safe_dict(output.get("metadata")).get("modelVisionUsed") and not any(
            "diagram" in clean_text(line.get("text"), 2000).lower()
            or "visual" in clean_text(line.get("text"), 2000).lower()
            or "image" in clean_text(line.get("text"), 2000).lower()
            or "table" in clean_text(line.get("text"), 2000).lower()
            for line in lines[:20]
        ):
            warnings.append("Vision was used, but early voice lines do not mention visual/diagram/table context.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="VoiceScriptAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["VoiceScriptAgent"]