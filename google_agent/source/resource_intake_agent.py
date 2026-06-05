"""
google_agent/source/resource_intake_agent.py
===============================================================================
Resource Intake Agent.

This is Agent 1 in the 27-agent human-like Live Tutor system.

Responsibility:
- Detect what the user provided: PDF, notes, transcript, screenshot, saved
  resource, raw text, or code.
- Normalize the input into a strict resource descriptor for downstream agents.
- Decide which next source agents should run.
- Never fake source extraction.
- Never claim PDF/OCR/code extraction happened here. This agent only classifies
  and routes.

Why this file is needed:
Your uploaded Stage 2 registry expects ResourceIntakeAgent, but the file was
missing. Without this file, the 27-agent orchestrator cannot load all agents.
===============================================================================
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Tuple

from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
from google_agent.live_tutor_agents.contracts import (
    AgentContext,
    JsonDict,
    ValidationResult,
    clean_text,
    make_id,
    normalize_id,
    safe_dict,
    safe_list,
)


TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".xml",
    ".yaml",
    ".yml",
    ".html",
    ".htm",
}

DOCUMENT_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
}

IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".tiff",
    ".heic",
}

CODE_EXTENSIONS = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript-react",
    ".ts": "typescript",
    ".tsx": "typescript-react",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".cs": "csharp",
    ".go": "go",
    ".rs": "rust",
    ".php": "php",
    ".rb": "ruby",
    ".swift": "swift",
    ".kt": "kotlin",
    ".sql": "sql",
    ".sh": "bash",
}


def _extension(filename: Any) -> str:
    name = clean_text(filename, 500).lower()
    _, ext = os.path.splitext(name)
    return ext.strip()


def _looks_like_youtube_transcript(text: str) -> bool:
    value = clean_text(text, 8000).lower()
    if not value:
        return False

    transcript_markers = [
        "youtube",
        "transcript",
        "0:00",
        "00:00",
        "[music]",
        "[applause]",
        "speaker 1",
        "speaker:",
    ]
    timestamp_hits = len(re.findall(r"\b\d{1,2}:\d{2}(?::\d{2})?\b", value))
    return timestamp_hits >= 3 or any(marker in value for marker in transcript_markers)


def _looks_like_code(text: str) -> Tuple[bool, str]:
    value = clean_text(text, 20000)

    language_markers = [
        ("python", [r"\bdef\s+\w+\s*\(", r"\bimport\s+\w+", r"\bprint\s*\(", r"\bself\b"]),
        ("javascript", [r"\bfunction\s+\w+\s*\(", r"=>", r"\bconsole\.log\s*\(", r"\bconst\s+\w+"]),
        ("java", [r"\bpublic\s+class\s+\w+", r"\bSystem\.out\.println\s*\("]),
        ("cpp", [r"#include\s*<", r"\busing\s+namespace\s+std", r"\bcout\s*<<"]),
        ("c", [r"#include\s*<", r"\bprintf\s*\(", r"\bscanf\s*\("]),
        ("sql", [r"\bselect\b.+\bfrom\b", r"\binsert\s+into\b", r"\bcreate\s+table\b"]),
    ]

    lower = value.lower()
    for language, patterns in language_markers:
        for pattern in patterns:
            if re.search(pattern, lower, flags=re.I | re.S):
                return True, language

    code_symbols = sum(value.count(ch) for ch in "{}[]();=<>")
    line_count = max(1, len(value.splitlines()))
    if line_count >= 4 and code_symbols >= 8:
        return True, "unknown-code"

    return False, ""


def _detect_language(text: str, provided: Any = "") -> str:
    requested = clean_text(provided, 80).lower()
    if requested:
        return requested

    value = clean_text(text, 8000)
    if not value:
        return "unknown"

    bangla_chars = len(re.findall(r"[\u0980-\u09FF]", value))
    latin_chars = len(re.findall(r"[A-Za-z]", value))

    if bangla_chars > 0 and latin_chars > 0:
        return "bangla-english-mixed"
    if bangla_chars > 0:
        return "bangla"
    if latin_chars > 0:
        return "english"
    return "unknown"


def _infer_input_type(payload: JsonDict) -> Tuple[str, str, str]:
    """
    Returns: (inputType, extension, codeLanguage)
    """
    resource = safe_dict(payload.get("resource"))
    file_info = safe_dict(payload.get("file") or payload.get("uploadedFile"))

    filename = (
        payload.get("filename")
        or payload.get("fileName")
        or file_info.get("filename")
        or file_info.get("originalname")
        or resource.get("filename")
        or resource.get("title")
        or ""
    )
    ext = _extension(filename)

    explicit_type = clean_text(
        payload.get("inputType")
        or payload.get("resourceType")
        or file_info.get("mimetype")
        or resource.get("type")
        or resource.get("resourceType"),
        160,
    ).lower()

    raw_text = clean_text(
        payload.get("rawText")
        or payload.get("text")
        or payload.get("transcript")
        or resource.get("text")
        or resource.get("content")
        or "",
        40000,
    )

    if ext in CODE_EXTENSIONS:
        return "code", ext, CODE_EXTENSIONS[ext]

    if ext in DOCUMENT_EXTENSIONS:
        return "document", ext, ""

    if ext in IMAGE_EXTENSIONS:
        return "screenshot-image", ext, ""

    if ext in TEXT_EXTENSIONS:
        if _looks_like_youtube_transcript(raw_text):
            return "transcript", ext, ""
        looks_code, lang = _looks_like_code(raw_text)
        if looks_code:
            return "code", ext, lang
        return "notes-text", ext, ""

    if "pdf" in explicit_type:
        return "document", ext or ".pdf", ""

    if "image" in explicit_type or "png" in explicit_type or "jpeg" in explicit_type:
        return "screenshot-image", ext, ""

    if "transcript" in explicit_type or _looks_like_youtube_transcript(raw_text):
        return "transcript", ext, ""

    if "code" in explicit_type:
        looks_code, lang = _looks_like_code(raw_text)
        return "code", ext, lang or clean_text(payload.get("codeLanguage"), 80) or "unknown-code"

    looks_code, lang = _looks_like_code(raw_text)
    if looks_code:
        return "code", ext, lang

    if raw_text:
        return "notes-text", ext, ""

    if payload.get("resourceId") or resource.get("resourceId"):
        return "saved-resource", ext, ""

    return "unknown", ext, ""


def _next_agents_for(input_type: str, code_language: str) -> List[str]:
    agents = ["SourceGroundingAgent"]

    if input_type == "document":
        agents.insert(0, "DocumentExtractionAgent")
        agents.extend(["RagRetrievalAgent", "ConceptExtractionAgent", "KnowledgeGraphAgent"])
    elif input_type == "screenshot-image":
        agents.insert(0, "OcrScreenshotUnderstandingAgent")
        agents.extend(["ConceptExtractionAgent", "KnowledgeGraphAgent"])
    elif input_type in {"notes-text", "transcript", "saved-resource"}:
        agents.extend(["RagRetrievalAgent", "ConceptExtractionAgent", "KnowledgeGraphAgent"])
    elif input_type == "code":
        agents.extend(["ConceptExtractionAgent", "KnowledgeGraphAgent"])
        if code_language == "sql":
            agents.append("SqlDryRunSandboxAgent")
        else:
            agents.append("CodeDryRunSandboxAgent")
    else:
        agents.append("DocumentExtractionAgent")

    agents.extend(
        [
            "CoursePlannerAgent",
            "SegmentPlannerAgent",
            "TeachingStrategyAgent",
            "DetailedExplanationAgent",
            "VisualPlannerAgent",
            "BoardSceneAgent",
            "BoardCommandAgent",
            "LayoutAgent",
            "HandwritingDrawingAgent",
            "VoiceScriptAgent",
            "SubtitleSyncAgent",
            "ValidatorSafetyAgent",
        ]
    )

    # Keep order but remove duplicates.
    seen = set()
    ordered: List[str] = []
    for agent in agents:
        if agent in seen:
            continue
        seen.add(agent)
        ordered.append(agent)
    return ordered


class ResourceIntakeAgent(BaseLiveTutorAgent):
    agent_name = "ResourceIntakeAgent"
    agent_group = "source"
    default_mode = "classify_resource"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
You classify the user's uploaded resource for the Live Tutor pipeline.
Do not extract PDF text, OCR images, run code, or invent source chunks.
Only return a strict resource descriptor and routing plan.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        resource = safe_dict(payload.get("resource"))
        file_info = safe_dict(payload.get("file") or payload.get("uploadedFile"))

        has_any_input = any(
            [
                payload.get("resourceId"),
                resource.get("resourceId"),
                payload.get("filename"),
                payload.get("fileName"),
                file_info.get("filename"),
                file_info.get("originalname"),
                payload.get("rawText"),
                payload.get("text"),
                payload.get("transcript"),
                payload.get("code"),
                resource.get("text"),
                resource.get("content"),
            ]
        )

        if not has_any_input:
            errors.append(
                "ResourceIntakeAgent requires at least one input: resourceId, filename/file info, rawText/text/transcript/code, or resource object."
            )

        if not payload.get("ownerKey") and not payload.get("offlineUserId"):
            warnings.append("ownerKey/offlineUserId missing; demo_user will be used by AgentContext.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="ResourceIntakeAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        resource = safe_dict(payload.get("resource"))
        file_info = safe_dict(payload.get("file") or payload.get("uploadedFile"))

        input_type, ext, code_language = _infer_input_type(payload)

        raw_text = clean_text(
            payload.get("rawText")
            or payload.get("text")
            or payload.get("transcript")
            or payload.get("code")
            or resource.get("text")
            or resource.get("content")
            or "",
            50000,
        )

        filename = clean_text(
            payload.get("filename")
            or payload.get("fileName")
            or file_info.get("filename")
            or file_info.get("originalname")
            or resource.get("filename")
            or resource.get("title")
            or "",
            500,
        )

        title = clean_text(
            payload.get("title")
            or resource.get("title")
            or filename
            or payload.get("topic")
            or payload.get("question")
            or "Untitled Live Tutor Resource",
            220,
        )

        resource_id = clean_text(
            payload.get("resourceId")
            or resource.get("resourceId")
            or resource.get("_id")
            or make_id("resource"),
            220,
        )

        language = _detect_language(raw_text or title, payload.get("language"))
        owner_key = context.ownerKey or context.offlineUserId

        content_flags = {
            "hasRawText": bool(raw_text),
            "hasFile": bool(filename or file_info),
            "hasSavedResourceId": bool(payload.get("resourceId") or resource.get("resourceId")),
            "hasTranscriptMarkers": _looks_like_youtube_transcript(raw_text),
            "looksLikeCode": _looks_like_code(raw_text)[0],
            "requiresPdfExtraction": input_type == "document" and ext == ".pdf",
            "requiresOcr": input_type == "screenshot-image",
            "requiresRealCodeTrace": input_type == "code",
            "requiresSqlSandbox": input_type == "code" and code_language == "sql",
            "requiresRag": input_type in {"document", "notes-text", "transcript", "saved-resource"},
            "requiresMcp": bool(payload.get("useMcp") or payload.get("useMongoMcp") or payload.get("mcpRequired")),
        }

        intake = {
            "resourceId": resource_id,
            "ownerKey": owner_key,
            "offlineUserId": context.offlineUserId,
            "deviceId": context.deviceId,
            "title": title,
            "filename": filename,
            "extension": ext,
            "inputType": input_type,
            "language": language,
            "codeLanguage": code_language,
            "textPreview": clean_text(raw_text, 1200),
            "textLength": len(raw_text),
            "mimeType": clean_text(file_info.get("mimetype") or payload.get("mimeType"), 160),
            "contentFlags": content_flags,
            "nextAgents": _next_agents_for(input_type, code_language),
            "routing": {
                "sourceRoute": self._source_route(input_type),
                "visualRoute": self._visual_route(input_type, code_language),
                "voiceRoute": "voice-script-now-real-tts-later",
                "dryRunRoute": self._dry_run_route(input_type, code_language),
                "queueRoute": "segment-planner-now-bullmq-later",
            },
            "constraints": {
                "noFakeFallback": True,
                "mustPreserveSourceRefs": True,
                "mustSaveBoardState": True,
                "mustSupportInterruptRepairResume": True,
            },
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "classificationOnly": True,
                "doesNotExtractPdf": True,
                "doesNotRunCode": True,
            },
        }

        return intake

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)

        input_type = clean_text(raw.get("inputType"), 80) or "unknown"
        code_language = clean_text(raw.get("codeLanguage"), 80)

        return {
            "resourceId": clean_text(raw.get("resourceId"), 220) or make_id("resource"),
            "ownerKey": clean_text(raw.get("ownerKey") or context.ownerKey, 160),
            "offlineUserId": clean_text(raw.get("offlineUserId") or context.offlineUserId, 160),
            "deviceId": clean_text(raw.get("deviceId") or context.deviceId, 160),
            "title": clean_text(raw.get("title"), 220) or "Untitled Live Tutor Resource",
            "filename": clean_text(raw.get("filename"), 500),
            "extension": clean_text(raw.get("extension"), 40),
            "inputType": input_type,
            "language": clean_text(raw.get("language"), 80) or "unknown",
            "codeLanguage": code_language,
            "textPreview": clean_text(raw.get("textPreview"), 1200),
            "textLength": int(raw.get("textLength") or 0),
            "mimeType": clean_text(raw.get("mimeType"), 160),
            "contentFlags": safe_dict(raw.get("contentFlags")),
            "nextAgents": [clean_text(x, 120) for x in safe_list(raw.get("nextAgents")) if clean_text(x, 120)],
            "routing": safe_dict(raw.get("routing")),
            "constraints": {
                "noFakeFallback": True,
                "mustPreserveSourceRefs": True,
                "mustSaveBoardState": True,
                "mustSupportInterruptRepairResume": True,
                **safe_dict(raw.get("constraints")),
            },
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        allowed_types = {
            "document",
            "screenshot-image",
            "notes-text",
            "transcript",
            "saved-resource",
            "code",
            "unknown",
        }

        if not clean_text(output.get("resourceId"), 80):
            errors.append("resourceId is required.")
        if clean_text(output.get("inputType"), 80) not in allowed_types:
            errors.append(f"Unsupported inputType: {output.get('inputType')}")
        if not safe_list(output.get("nextAgents")):
            errors.append("nextAgents routing list is required.")

        flags = safe_dict(output.get("contentFlags"))
        if output.get("inputType") == "code" and not flags.get("requiresRealCodeTrace"):
            errors.append("Code input must set contentFlags.requiresRealCodeTrace=true.")
        if output.get("inputType") == "screenshot-image" and not flags.get("requiresOcr"):
            errors.append("Screenshot/image input must set contentFlags.requiresOcr=true.")
        if output.get("inputType") == "document" and output.get("extension") == ".pdf" and not flags.get("requiresPdfExtraction"):
            errors.append("PDF document must set contentFlags.requiresPdfExtraction=true.")

        if output.get("inputType") == "unknown":
            warnings.append("Input type is unknown; downstream extraction may fail until user provides file/text details.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="ResourceIntakeAgent.validate_output",
            fallbackUsed=False,
        )

    @staticmethod
    def _source_route(input_type: str) -> str:
        if input_type == "document":
            return "document-extraction-rag-source-grounding"
        if input_type == "screenshot-image":
            return "ocr-screenshot-understanding-source-grounding"
        if input_type == "transcript":
            return "transcript-chunking-rag-source-grounding"
        if input_type == "notes-text":
            return "text-chunking-rag-source-grounding"
        if input_type == "saved-resource":
            return "mongodb-resource-read-rag-source-grounding"
        if input_type == "code":
            return "code-parse-trace-source-grounding"
        return "unknown-source-route"

    @staticmethod
    def _visual_route(input_type: str, code_language: str) -> str:
        if input_type == "code":
            if code_language == "sql":
                return "sql-trace-table-er-diagram-board"
            return "code-trace-table-flowchart-board"
        if input_type == "document":
            return "concept-tree-flowchart-table-board"
        if input_type == "screenshot-image":
            return "ocr-region-diagram-board"
        return "concept-tree-teacher-writing-board"

    @staticmethod
    def _dry_run_route(input_type: str, code_language: str) -> str:
        if input_type != "code":
            return "not-code"
        if code_language == "sql":
            return "sqlite-sandbox-required"
        return "real-code-sandbox-required"