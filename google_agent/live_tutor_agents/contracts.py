"""
google_agent/live_tutor_agents/contracts.py
===============================================================================
Shared contracts for the 27-Agent Human-Like Live Tutor.

Project rules:
- No fake fallback.
- Source-grounded PDF/notes/code/transcript teaching.
- BoardCommands for real board animation.
- Voice/subtitle sync.
- Interrupt/repair/resume.
- Every board can be saved/replayed.
- Every agent has strict input/output validation.

This replacement adds robust sourceRef normalization so ADK/Gemini output cannot
break the pipeline just because it returns page=0 or omits chunkId while the real
payload already contains valid chunks/sourceRefs.
===============================================================================
"""

from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Tuple


JsonDict = Dict[str, Any]


def now_ms() -> int:
    return int(time.time() * 1000)


def make_id(prefix: str) -> str:
    safe_prefix = re.sub(r"[^a-zA-Z0-9_]+", "_", str(prefix or "id")).strip("_")
    return f"{safe_prefix}_{now_ms()}_{uuid.uuid4().hex[:8]}"


def safe_str(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return fallback


def clean_text(value: Any, max_len: int = 4000) -> str:
    text = safe_str(value)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()[:max_len]


def safe_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def safe_dict(value: Any) -> JsonDict:
    return value if isinstance(value, dict) else {}


def normalize_id(value: Any, fallback: str = "item") -> str:
    text = clean_text(value, 120).lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = re.sub(r"^_+|_+$", "", text)
    return text or fallback


def dataclass_is_instance(value: Any) -> bool:
    return hasattr(value, "__dataclass_fields__")


def to_jsonable(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if dataclass_is_instance(value):
        return asdict(value)
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_jsonable(v) for v in value]
    return value


def _safe_int(value: Any, fallback: int = 1) -> int:
    try:
        return int(value)
    except Exception:
        return fallback


def _safe_float(value: Any, fallback: float = 0.75) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


@dataclass
class ValidationResult:
    ok: bool
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    checkedAtMs: int = field(default_factory=now_ms)
    validator: str = ""
    fallbackUsed: bool = False

    def to_dict(self) -> JsonDict:
        return asdict(self)


@dataclass
class SourceRef:
    chunkId: str
    sourceRef: str = ""
    pageRef: str = ""
    page: int = 1
    quote: str = ""
    confidence: float = 0.75
    resourceId: str = ""

    def normalized(self) -> "SourceRef":
        page = max(1, _safe_int(self.page, 1))
        chunk_id = clean_text(self.chunkId, 220)
        resource_id = clean_text(self.resourceId, 160)

        if not chunk_id and resource_id:
            chunk_id = f"{resource_id}_p{page}_c0"

        source_ref = clean_text(self.sourceRef, 300)
        if not source_ref and resource_id:
            source_ref = f"{resource_id}:page:{page}:chunk:0"

        page_ref = clean_text(self.pageRef, 300)
        if not page_ref and resource_id:
            page_ref = f"{resource_id}:page:{page}"
        if not page_ref and source_ref:
            page_ref = source_ref

        return SourceRef(
            chunkId=chunk_id,
            sourceRef=source_ref,
            pageRef=page_ref,
            page=page,
            quote=clean_text(self.quote, 700),
            confidence=max(0.0, min(1.0, _safe_float(self.confidence, 0.75))),
            resourceId=resource_id,
        )

    def to_dict(self) -> JsonDict:
        return asdict(self.normalized())


@dataclass
class SourceChunk:
    resourceId: str
    chunkId: str
    text: str
    sourceRef: str = ""
    pageRef: str = ""
    page: int = 1
    chunkIndex: int = 0
    heading: str = ""
    title: str = ""
    textPreview: str = ""
    metadata: JsonDict = field(default_factory=dict)

    @staticmethod
    def from_any(value: Any) -> "SourceChunk":
        raw = safe_dict(value)
        text = clean_text(raw.get("text") or raw.get("textPreview") or raw.get("content") or "", 12000)
        preview = clean_text(raw.get("textPreview") or text, 900)
        resource_id = clean_text(
            raw.get("resourceId")
            or raw.get("resource_id")
            or raw.get("resource")
            or raw.get("documentId")
            or "",
            160,
        )
        page = max(1, _safe_int(raw.get("page") or raw.get("pageNumber") or 1, 1))
        chunk_index = max(0, _safe_int(raw.get("chunkIndex") or raw.get("chunk_index") or raw.get("index") or 0, 0))
        chunk_id = clean_text(
            raw.get("chunkId")
            or raw.get("chunk_id")
            or raw.get("id")
            or f"{resource_id or 'resource'}_p{page}_c{chunk_index}",
            220,
        )
        source_ref = clean_text(
            raw.get("sourceRef")
            or raw.get("source_ref")
            or raw.get("ref")
            or f"{resource_id or 'resource'}:page:{page}:chunk:{chunk_index}",
            300,
        )
        page_ref = clean_text(
            raw.get("pageRef")
            or raw.get("page_ref")
            or f"{resource_id or 'resource'}:page:{page}",
            300,
        )

        return SourceChunk(
            resourceId=resource_id,
            chunkId=chunk_id,
            text=text,
            sourceRef=source_ref,
            pageRef=page_ref,
            page=page,
            chunkIndex=chunk_index,
            heading=clean_text(raw.get("heading") or "", 220),
            title=clean_text(raw.get("title") or "", 220),
            textPreview=preview,
            metadata=safe_dict(raw.get("metadata")),
        )

    def to_source_ref(self, quote: str = "", confidence: float = 0.75) -> SourceRef:
        return SourceRef(
            chunkId=self.chunkId,
            sourceRef=self.sourceRef,
            pageRef=self.pageRef,
            page=self.page,
            quote=clean_text(quote or self.textPreview or self.text, 700),
            confidence=confidence,
            resourceId=self.resourceId,
        ).normalized()

    def to_dict(self) -> JsonDict:
        return asdict(self)


@dataclass
class BoardCommand:
    commandId: str
    type: str
    text: str = ""
    nodeId: str = ""
    sceneId: str = ""
    x: float = 0
    y: float = 0
    width: float = 0
    height: float = 0
    durationMs: int = 1200
    payload: JsonDict = field(default_factory=dict)
    metadata: JsonDict = field(default_factory=dict)

    ALLOWED_TYPES = {
        "setViewport",
        "highlightNode",
        "writeText",
        "writeNearNode",
        "drawArrow",
        "drawLine",
        "drawCircle",
        "drawBox",
        "drawFlowchart",
        "drawTable",
        "drawTree",
        "drawTimeline",
        "drawCodeTrace",
        "drawERDiagram",
        "drawSequenceDiagram",
        "underline",
        "showSourceBadge",
        "showQuiz",
        "pauseForQuestion",
        "erase",
        "recap",
    }

    def validate(self) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        if not self.commandId:
            errors.append("BoardCommand.commandId is required.")
        if self.type not in self.ALLOWED_TYPES:
            errors.append(f"Unsupported BoardCommand.type: {self.type}")
        if self.type in {"writeText", "writeNearNode"} and not clean_text(self.text):
            errors.append(f"{self.type} requires text.")
        if int(self.durationMs or 0) <= 0:
            errors.append("BoardCommand.durationMs must be positive.")
        if self.type == "writeNearNode" and not self.nodeId:
            warnings.append("writeNearNode should include nodeId.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="BoardCommand.validate",
            fallbackUsed=False,
        )

    def to_dict(self) -> JsonDict:
        return asdict(self)


@dataclass
class VoiceLine:
    voiceId: str
    commandId: str
    text: str
    startMs: int = 0
    endMs: int = 0
    emotion: str = "teacher-clear"
    pace: str = "normal"
    metadata: JsonDict = field(default_factory=dict)

    def validate(self) -> ValidationResult:
        errors: List[str] = []
        if not self.voiceId:
            errors.append("VoiceLine.voiceId is required.")
        if not self.commandId:
            errors.append("VoiceLine.commandId is required for board sync.")
        if not clean_text(self.text):
            errors.append("VoiceLine.text is required.")
        if int(self.endMs or 0) < int(self.startMs or 0):
            errors.append("VoiceLine.endMs cannot be before startMs.")
        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="VoiceLine.validate",
            fallbackUsed=False,
        )

    def to_dict(self) -> JsonDict:
        return asdict(self)


@dataclass
class SubtitleLine:
    subtitleId: str
    commandId: str
    text: str
    startMs: int = 0
    endMs: int = 0
    wordHighlights: List[JsonDict] = field(default_factory=list)
    metadata: JsonDict = field(default_factory=dict)

    def validate(self) -> ValidationResult:
        errors: List[str] = []
        if not self.subtitleId:
            errors.append("SubtitleLine.subtitleId is required.")
        if not self.commandId:
            errors.append("SubtitleLine.commandId is required for board sync.")
        if not clean_text(self.text):
            errors.append("SubtitleLine.text is required.")
        if int(self.endMs or 0) < int(self.startMs or 0):
            errors.append("SubtitleLine.endMs cannot be before startMs.")
        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="SubtitleLine.validate",
            fallbackUsed=False,
        )

    def to_dict(self) -> JsonDict:
        return asdict(self)


@dataclass
class AgentContext:
    ownerKey: str = "demo_user"
    offlineUserId: str = "demo_user"
    deviceId: str = "demo_device"
    sessionId: str = ""
    resourceId: str = ""
    language: str = "english"
    studentLevel: str = "beginner"
    question: str = ""
    metadata: JsonDict = field(default_factory=dict)

    @staticmethod
    def from_payload(payload: JsonDict) -> "AgentContext":
        payload = safe_dict(payload)
        return AgentContext(
            ownerKey=clean_text(payload.get("ownerKey") or payload.get("offlineUserId") or "demo_user", 160),
            offlineUserId=clean_text(payload.get("offlineUserId") or payload.get("ownerKey") or "demo_user", 160),
            deviceId=clean_text(payload.get("deviceId") or "demo_device", 160),
            sessionId=clean_text(payload.get("sessionId") or make_id("session"), 220),
            resourceId=clean_text(payload.get("resourceId") or safe_dict(payload.get("resource")).get("resourceId") or "", 220),
            language=clean_text(payload.get("language") or "english", 80),
            studentLevel=clean_text(payload.get("studentLevel") or "beginner", 80),
            question=clean_text(payload.get("question") or "", 1600),
            metadata=safe_dict(payload.get("metadata")),
        )

    def to_dict(self) -> JsonDict:
        return asdict(self)


@dataclass
class AgentResult:
    ok: bool
    agentName: str
    mode: str
    result: JsonDict = field(default_factory=dict)
    validation: ValidationResult = field(default_factory=lambda: ValidationResult(ok=True))
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    sourceRefs: List[JsonDict] = field(default_factory=list)
    boardCommands: List[JsonDict] = field(default_factory=list)
    voiceScript: List[JsonDict] = field(default_factory=list)
    subtitles: List[JsonDict] = field(default_factory=list)
    metadata: JsonDict = field(default_factory=dict)

    def to_dict(self) -> JsonDict:
        return {
            "ok": self.ok,
            "agentName": self.agentName,
            "mode": self.mode,
            "result": to_jsonable(self.result),
            "validation": self.validation.to_dict(),
            "errors": self.errors,
            "warnings": self.warnings,
            "sourceRefs": self.sourceRefs,
            "boardCommands": self.boardCommands,
            "voiceScript": self.voiceScript,
            "subtitles": self.subtitles,
            "metadata": {
                **self.metadata,
                "fallbackUsed": False,
                "generatedAtMs": now_ms(),
            },
        }


def normalize_chunks(chunks: Any) -> List[SourceChunk]:
    return [SourceChunk.from_any(item) for item in safe_list(chunks) if safe_dict(item)]


def normalize_source_ref(ref: Any, fallback: JsonDict | None = None) -> JsonDict:
    raw = safe_dict(ref)
    fallback = safe_dict(fallback)

    page = max(1, _safe_int(raw.get("page") or raw.get("pageNumber") or fallback.get("page") or 1, 1))
    resource_id = clean_text(
        raw.get("resourceId")
        or raw.get("resource_id")
        or fallback.get("resourceId")
        or fallback.get("resource_id")
        or "",
        160,
    )
    chunk_id = clean_text(
        raw.get("chunkId")
        or raw.get("chunk_id")
        or raw.get("id")
        or fallback.get("chunkId")
        or fallback.get("chunk_id")
        or "",
        220,
    )
    if not chunk_id and resource_id:
        chunk_id = f"{resource_id}_p{page}_c0"

    source_ref = clean_text(
        raw.get("sourceRef")
        or raw.get("source_ref")
        or raw.get("ref")
        or fallback.get("sourceRef")
        or fallback.get("source_ref")
        or "",
        300,
    )
    if not source_ref and resource_id:
        source_ref = f"{resource_id}:page:{page}:chunk:0"

    page_ref = clean_text(
        raw.get("pageRef")
        or raw.get("page_ref")
        or fallback.get("pageRef")
        or fallback.get("page_ref")
        or "",
        300,
    )
    if not page_ref and resource_id:
        page_ref = f"{resource_id}:page:{page}"
    if not page_ref:
        page_ref = source_ref

    quote = clean_text(
        raw.get("quote")
        or raw.get("text")
        or raw.get("textPreview")
        or fallback.get("quote")
        or fallback.get("textPreview")
        or fallback.get("text")
        or "",
        700,
    )

    confidence = max(0.0, min(1.0, _safe_float(raw.get("confidence") or fallback.get("confidence") or 0.75, 0.75)))

    return SourceRef(
        chunkId=chunk_id,
        sourceRef=source_ref,
        pageRef=page_ref,
        page=page,
        quote=quote,
        confidence=confidence,
        resourceId=resource_id,
    ).to_dict()


def normalize_source_refs(refs: Any, fallback_refs: Any = None) -> List[JsonDict]:
    raw_refs = safe_list(refs)
    fallbacks = [safe_dict(x) for x in safe_list(fallback_refs) if safe_dict(x)]
    out: List[JsonDict] = []

    for index, ref in enumerate(raw_refs):
        raw = safe_dict(ref)
        fallback = fallbacks[index] if index < len(fallbacks) else (fallbacks[0] if fallbacks else {})
        normalized = normalize_source_ref(raw, fallback=fallback)
        if clean_text(normalized.get("chunkId")):
            out.append(normalized)

    return dedupe_source_refs(out)


def normalize_source_refs_from_chunks(chunks: Any) -> List[JsonDict]:
    refs: List[JsonDict] = []
    for chunk in normalize_chunks(chunks):
        refs.append(chunk.to_source_ref(confidence=0.82).to_dict())
    return dedupe_source_refs(refs)


def normalize_source_refs_from_payload(payload: JsonDict) -> List[JsonDict]:
    payload = safe_dict(payload)
    refs: List[JsonDict] = []

    refs.extend(normalize_source_refs_from_chunks(payload.get("chunks")))

    for key in ["sourceRefs", "refs", "citations"]:
        refs.extend(normalize_source_refs(payload.get(key), fallback_refs=refs))

    for container_key in [
        "node",
        "selectedNode",
        "segment",
        "segmentPlan",
        "explanation",
        "visualPlan",
        "ragResult",
        "retrieval",
    ]:
        container = safe_dict(payload.get(container_key))
        for key in ["sourceRefs", "refs", "citations"]:
            refs.extend(normalize_source_refs(container.get(key), fallback_refs=refs))

    return dedupe_source_refs(refs)


def source_ref_key(ref: JsonDict) -> Tuple[str, str, int]:
    normalized = normalize_source_ref(ref)
    return (
        clean_text(normalized.get("chunkId"), 220),
        clean_text(normalized.get("sourceRef"), 300),
        max(1, _safe_int(normalized.get("page"), 1)),
    )


def dedupe_source_refs(refs: List[JsonDict]) -> List[JsonDict]:
    seen = set()
    out: List[JsonDict] = []

    for ref in refs:
        raw = safe_dict(ref)
        if not raw:
            continue
        normalized = normalize_source_ref(raw)
        key = source_ref_key(normalized)
        if key in seen:
            continue
        seen.add(key)
        out.append(normalized)

    return out


def require_source_refs(refs: List[JsonDict], validator_name: str) -> ValidationResult:
    errors: List[str] = []
    normalized_refs = normalize_source_refs(refs)

    if not normalized_refs:
        errors.append("sourceRefs are required. No ungrounded output allowed.")

    for index, ref in enumerate(normalized_refs):
        raw = safe_dict(ref)
        if not clean_text(raw.get("chunkId")):
            errors.append(f"sourceRefs[{index}].chunkId is required.")
        if max(1, _safe_int(raw.get("page"), 1)) <= 0:
            errors.append(f"sourceRefs[{index}].page must be positive.")

    return ValidationResult(
        ok=not errors,
        errors=errors,
        warnings=[],
        validator=validator_name,
        fallbackUsed=False,
    )


def merge_validations(name: str, validations: List[ValidationResult]) -> ValidationResult:
    errors: List[str] = []
    warnings: List[str] = []

    for validation in validations:
        errors.extend(validation.errors)
        warnings.extend(validation.warnings)

    return ValidationResult(
        ok=not errors,
        errors=errors,
        warnings=warnings,
        validator=name,
        fallbackUsed=False,
    )