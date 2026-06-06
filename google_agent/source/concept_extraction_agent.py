"""
google_agent/source/concept_extraction_agent.py
===============================================================================
Clean final ConceptExtractionAgent.

Purpose:
- Extract rich teachable concepts for the live tutor.
- Gemini/ADK receives:
  FULL vision coverage, compressed per item.
  COMPACT source/PDF context.
- Full payload remains preserved outside prompt by orchestrator/stage2_flow_contract.
- No previousPromptForCompatibility.
- No old monkey-patches.
- No hardcoded topic.
- No fake/static fallback.

Concept output is prepared for:
KnowledgeGraphAgent -> TeachingStrategyAgent -> VisualPlannerAgent
-> BoardSceneAgent -> BoardCommandAgent -> VoiceScriptAgent -> frontend board.
===============================================================================
"""

from __future__ import annotations

import json
import re
from typing import Any, List, Tuple

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
    AgentContext,
    JsonDict,
    ValidationResult,
    clean_text,
    dedupe_source_refs,
    normalize_id,
    normalize_source_refs,
    safe_dict,
    safe_list,
)


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

def _json(value: Any, limit: int = 70000) -> str:
    """
    Prompt text helper. This is only prompt text, not parsed by our backend.
    Keep it bounded so ADK/Gemini does not timeout.
    """
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), limit)
    except Exception:
        return clean_text(value, limit)


def _text(value: Any, limit: int = 800) -> str:
    try:
        return clean_text(value or "", limit)
    except Exception:
        return str(value or "")[:limit]


def _dict(value: Any) -> JsonDict:
    try:
        return safe_dict(value)
    except Exception:
        return value if isinstance(value, dict) else {}


def _list(value: Any) -> List[Any]:
    try:
        return safe_list(value)
    except Exception:
        return value if isinstance(value, list) else []


def _first_dict(*values: Any) -> JsonDict:
    for value in values:
        item = _dict(value)
        if item:
            return item
    return {}


def _words(value: Any) -> List[str]:
    text = _text(value, 6000).lower()
    return [w for w in re.findall(r"[a-zA-Z0-9_]+", text) if len(w) >= 3]


def _as_float(value: Any, default: float = 0.75) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except Exception:
        return default


# ---------------------------------------------------------------------------
# Source truth helpers
# ---------------------------------------------------------------------------

def _source_truth(payload: JsonDict) -> JsonDict:
    return _first_dict(
        payload.get("sourceTruth"),
        payload.get("sourceTruthPacket"),
        _dict(payload.get("ragRetrieval")).get("sourceTruthPacket"),
    )


def _chunk_ref(chunk: JsonDict, role: str = "chunk") -> JsonDict:
    return {
        "chunkId": _text(chunk.get("chunkId") or chunk.get("id") or "", 220),
        "sourceRef": _text(chunk.get("sourceRef") or chunk.get("pageRef") or chunk.get("chunkId") or chunk.get("id") or "", 380),
        "pageRef": _text(chunk.get("pageRef") or chunk.get("sourceRef") or "", 380),
        "page": chunk.get("page") or chunk.get("pageNumber"),
        "quote": _text(chunk.get("quote") or chunk.get("textPreview") or chunk.get("text") or "", 900),
        "confidence": chunk.get("confidence") or 0.82,
        "resourceId": _text(chunk.get("resourceId") or "", 220),
        "evidenceRole": role,
    }


def _collect_chunk_refs(payload: JsonDict) -> List[JsonDict]:
    refs: List[JsonDict] = []

    for key, role in [
        ("selectedEvidence", "selectedEvidence"),
        ("samePageEvidence", "samePageEvidence"),
        ("nearbyEvidence", "nearbyEvidence"),
        ("relatedEvidence", "relatedEvidence"),
        ("comparisonEvidence", "comparisonEvidence"),
        ("chunks", "chunk"),
        ("retrievedChunks", "retrievedChunk"),
    ]:
        for item in _list(payload.get(key)):
            chunk = _dict(item)
            if chunk:
                refs.append(_chunk_ref(chunk, role))

    source = _source_truth(payload)
    for key, role in [
        ("selectedEvidence", "selectedEvidence"),
        ("samePageEvidence", "samePageEvidence"),
        ("nearbyEvidence", "nearbyEvidence"),
        ("relatedEvidence", "relatedEvidence"),
        ("comparisonEvidence", "comparisonEvidence"),
        ("sourceRefs", "sourceRef"),
    ]:
        for item in _list(source.get(key)):
            chunk = _dict(item)
            if chunk:
                refs.append(_chunk_ref(chunk, role))

    for ref in _list(payload.get("sourceRefs")):
        r = _dict(ref)
        if r:
            refs.append(_chunk_ref(r, "sourceRef"))

    clean: List[JsonDict] = []
    for ref in refs:
        if not _text(ref.get("quote")):
            continue
        if not (ref.get("sourceRef") or ref.get("chunkId")):
            continue
        clean.append(ref)

    return dedupe_source_refs(normalize_source_refs(clean))[:90]


def _compact_evidence(items: Any, limit: int) -> List[JsonDict]:
    out: List[JsonDict] = []
    for item in _list(items)[:limit]:
        d = _dict(item)
        quote = _text(d.get("quote") or d.get("textPreview") or d.get("text"), 650)
        if not quote:
            continue
        out.append(
            {
                "page": d.get("page"),
                "heading": _text(d.get("heading") or d.get("title"), 160),
                "quote": quote,
                "sourceRef": _text(d.get("sourceRef"), 260),
                "evidenceRole": _text(d.get("evidenceRole"), 80),
            }
        )
    return out


def _compact_refs(payload: JsonDict, limit: int = 30) -> List[JsonDict]:
    out: List[JsonDict] = []
    for ref in _collect_chunk_refs(payload)[:limit]:
        r = _dict(ref)
        out.append(
            {
                "page": r.get("page"),
                "sourceRef": _text(r.get("sourceRef"), 260),
                "quote": _text(r.get("quote"), 520),
                "evidenceRole": _text(r.get("evidenceRole"), 80),
            }
        )
    return out


def _selected_keywords(payload: JsonDict) -> List[str]:
    node = _dict(payload.get("selectedNode") or payload.get("node"))
    source = _source_truth(payload)
    text_parts = [
        node.get("title"),
        node.get("label"),
        node.get("definition"),
        node.get("summary"),
        payload.get("question"),
    ]

    for item in _list(source.get("selectedEvidence"))[:8]:
        text_parts.append(_dict(item).get("text") or _dict(item).get("quote"))

    stop = {"the", "and", "for", "with", "that", "this", "from", "page", "source", "concept"}
    out: List[str] = []
    seen = set()

    for part in text_parts:
        for w in _words(part):
            if w in stop:
                continue
            if w not in seen:
                seen.add(w)
                out.append(w)
            if len(out) >= 70:
                return out

    return out


def _score_ref_for_text(ref: JsonDict, text: str, selected_keywords: List[str]) -> float:
    quote = _text(ref.get("quote"), 1200)
    if not quote:
        return -100.0

    score = 0.0
    role = _text(ref.get("evidenceRole"), 80)

    if role == "selectedEvidence":
        score += 8
    elif role == "samePageEvidence":
        score += 5
    elif role == "nearbyEvidence":
        score += 2

    q_words = set(_words(quote))
    t_words = set(_words(text))

    if q_words and t_words:
        score += min(10.0, len(q_words.intersection(t_words)) * 2.0)

    if selected_keywords and q_words:
        score += min(6.0, len(q_words.intersection(set(selected_keywords))) * 1.0)

    if len(quote.split()) < 5:
        score -= 5

    return score


def _best_refs_for_text(text: str, refs: List[JsonDict], selected_keywords: List[str], limit: int = 5) -> List[JsonDict]:
    scored: List[Tuple[float, JsonDict]] = []

    for ref in refs:
        score = _score_ref_for_text(ref, text, selected_keywords)
        if score > 0:
            scored.append((score, ref))

    scored.sort(key=lambda x: x[0], reverse=True)
    return dedupe_source_refs([r for _, r in scored])[:limit]


def _selected_page_text(payload: JsonDict) -> str:
    source = _source_truth(payload)
    return _text(
        payload.get("selectedPageFullText")
        or source.get("selectedPageFullText")
        or source.get("selectedPageFullTextExcerpt")
        or "",
        7500,
    )


def _full_pdf_summary(payload: JsonDict) -> Any:
    source = _source_truth(payload)
    summary = payload.get("fullPdfSummary") or source.get("fullPdfSummary") or _dict(payload.get("pdfBackground")).get("fullPdfSummary") or {}

    if isinstance(summary, str):
        return _text(summary, 5000)

    if isinstance(summary, dict):
        out: JsonDict = {}
        for key, value in summary.items():
            if isinstance(value, str):
                out[key] = _text(value, 900)
            elif isinstance(value, list):
                out[key] = value[:12]
            else:
                out[key] = value
        return out

    if isinstance(summary, list):
        return summary[:20]

    return summary


def _full_pdf_outline_text(payload: JsonDict) -> str:
    source = _source_truth(payload)
    return _text(
        payload.get("fullPdfOutlineText")
        or source.get("fullPdfOutlineText")
        or _dict(payload.get("pdfBackground")).get("fullPdfOutlineText")
        or "",
        7000,
    )


# ---------------------------------------------------------------------------
# Vision packet helpers
# ---------------------------------------------------------------------------

def _visual_packet(payload: JsonDict) -> JsonDict:
    vision = _dict(payload.get("selectedPageVision"))
    visual_truth = _dict(payload.get("visualTruth"))
    visual_lesson = _dict(payload.get("visualLessonInput"))
    visual_context = _dict(payload.get("visualContext"))

    return _first_dict(
        payload.get("visualTeacherPacket"),
        visual_truth.get("visualTeacherPacket"),
        vision.get("visualTeacherPacket"),
        _dict(vision.get("visualLessonInput")).get("visualTeacherPacket"),
        visual_lesson.get("visualTeacherPacket"),
        visual_context.get("visualTeacherPacket"),
        _dict(visual_context.get("visualLessonInput")).get("visualTeacherPacket"),
    )


def _vision_fact(item: Any) -> JsonDict:
    d = _dict(item)
    return {
        "visualFact": _text(d.get("visualFact") or d.get("fact") or d.get("text"), 430),
        "sourceProof": _text(d.get("sourceProof") or d.get("quote"), 330),
        "visualObservation": _text(d.get("visualObservation"), 330),
        "teachingMeaning": _text(d.get("teachingMeaning") or d.get("whyStudentShouldCare"), 430),
        "boardMove": _text(d.get("exactBoardMove") or d.get("boardAction"), 300),
        "teacherLine": _text(d.get("spokenTeacherLine") or d.get("spokenCue"), 320),
        "studentCheck": _text(d.get("studentCheckQuestion"), 220),
        "sourceType": _text(d.get("sourceType"), 80),
        "needsSourceVerification": bool(d.get("needsSourceVerification")),
        "confidence": d.get("confidence"),
        "sourceRefs": _list(d.get("sourceRefs"))[:3],
    }


def _vision_element(item: Any) -> JsonDict:
    d = _dict(item)
    return {
        "label": _text(d.get("label") or d.get("name"), 120),
        "kind": _text(d.get("kind") or d.get("type"), 90),
        "location": _text(d.get("exactLocation") or d.get("position"), 130),
        "visualRole": _text(d.get("visualRole"), 250),
        "attributesSeen": _list(d.get("attributesSeen") or d.get("attributes"))[:12],
        "connectedTo": _list(d.get("connectedTo") or d.get("connections"))[:12],
        "conceptMeaning": _text(d.get("conceptMeaning"), 390),
        "teacherExplanation": _text(d.get("teacherExplanation"), 390),
        "boardMove": _text(d.get("boardRedrawInstruction") or d.get("exactBoardMove"), 350),
        "teacherLine": _text(d.get("spokenTeacherLine") or d.get("voiceHint"), 300),
        "studentCheck": _text(d.get("studentCheckQuestion"), 220),
        "sourceType": _text(d.get("sourceType"), 80),
        "confidence": d.get("confidence"),
        "sourceRefs": _list(d.get("sourceRefs"))[:3],
    }


def _vision_relationship(item: Any) -> JsonDict:
    d = _dict(item)
    return {
        "from": _text(d.get("from") or d.get("source"), 120),
        "to": _text(d.get("to") or d.get("target"), 120),
        "relationship": _text(d.get("relationship") or d.get("type"), 200),
        "visualEvidence": _text(d.get("visualEvidence"), 280),
        "sourceProof": _text(d.get("sourceProof") or d.get("quote"), 280),
        "whyItMatters": _text(d.get("whyItMatters"), 390),
        "misconceptionRisk": _text(d.get("misconceptionRisk"), 280),
        "boardAction": _text(d.get("boardAction") or d.get("boardMove"), 300),
        "spokenCue": _text(d.get("spokenCue") or d.get("voiceHint"), 300),
        "studentCheck": _text(d.get("studentCheckQuestion"), 220),
        "sourceType": _text(d.get("sourceType"), 80),
        "confidence": d.get("confidence"),
        "sourceRefs": _list(d.get("sourceRefs"))[:3],
    }


def _vision_mark(item: Any) -> JsonDict:
    d = _dict(item)
    return {
        "markType": _text(d.get("markType") or d.get("type"), 80),
        "target": _text(d.get("target"), 170),
        "teacherReason": _text(d.get("teacherReason") or d.get("reason"), 240),
        "spokenCue": _text(d.get("spokenCue") or d.get("voiceHint"), 240),
    }


def _vision_redraw(item: Any) -> JsonDict:
    d = _dict(item)
    return {
        "order": d.get("order"),
        "action": _text(d.get("action") or d.get("type"), 90),
        "content": _text(d.get("content"), 280),
        "layoutHint": _text(d.get("layoutHint"), 240),
        "voiceHint": _text(d.get("voiceHint"), 240),
        "teacherPurpose": _text(d.get("teacherPurpose"), 240),
        "studentCheck": _text(d.get("studentCheckQuestion"), 220),
    }


def _vision_risk(item: Any) -> JsonDict:
    d = _dict(item)
    return {
        "risk": _text(d.get("risk") or d.get("confusion"), 260),
        "repairMove": _text(d.get("repairMove"), 280),
        "boardRepair": _text(d.get("boardRepair"), 260),
        "visualTrigger": _text(d.get("visualTrigger"), 200),
    }


def _vision_sequence(item: Any) -> JsonDict:
    d = _dict(item)
    return {
        "step": d.get("step"),
        "teacherMove": _text(d.get("teacherMove"), 300),
        "boardMove": _text(d.get("boardMove"), 300),
        "whyThisStepNow": _text(d.get("whyThisStepNow"), 220),
        "studentCheck": _text(d.get("studentCheck"), 220),
    }


def _full_vision_coverage_for_prompt(packet: JsonDict) -> JsonDict:
    facts = [_vision_fact(x) for x in _list(packet.get("sourceGroundedVisualFacts"))]
    elements = [_vision_element(x) for x in _list(packet.get("diagramElementDetails"))]
    relationships = [_vision_relationship(x) for x in _list(packet.get("relationshipWalkthrough"))]
    marks = [_vision_mark(x) for x in _list(packet.get("teacherMarkingScript"))]
    redraw = [_vision_redraw(x) for x in _list(packet.get("boardRedrawPlan"))]
    risks = [_vision_risk(x) for x in _list(packet.get("misconceptionRisks"))]
    sequence = [_vision_sequence(x) for x in _list(packet.get("visualTeachingSequence"))]

    return {
        "pageVisualNarrative": _text(packet.get("pageVisualNarrative"), 3000),
        "sourceGroundedVisualFacts_ALL": facts,
        "diagramElementDetails_ALL": elements,
        "relationshipWalkthrough_ALL": relationships,
        "teacherMarkingScript_ALL": marks,
        "boardRedrawPlan_ALL": redraw,
        "misconceptionRisks_ALL": risks,
        "visualTeachingSequence_ALL": sequence,
        "coverageCounts": {
            "facts": len(facts),
            "elements": len(elements),
            "relationships": len(relationships),
            "marks": len(marks),
            "redraw": len(redraw),
            "risks": len(risks),
            "sequence": len(sequence),
        },
        "metadata": {
            **_dict(packet.get("metadata")),
            "fullVisionCoverageSentToConceptPromptV1": True,
            "compressedPerItem": True,
        },
    }


# ---------------------------------------------------------------------------
# Concept derivation helpers
# ---------------------------------------------------------------------------

def _source_type_from_raw(raw: JsonDict, refs: List[JsonDict]) -> str:
    explicit = _text(raw.get("sourceType"), 120)
    if explicit:
        return explicit
    if refs:
        return "source_grounded_visual"
    return "visual_observation"


def _make_visual_concept(payload: JsonDict, raw: JsonDict, index: int, kind: str) -> JsonDict:
    label = _text(
        raw.get("label")
        or raw.get("visualFact")
        or raw.get("relationship")
        or raw.get("content")
        or raw.get("target")
        or raw.get("risk")
        or raw.get("teacherMove")
        or f"Visual Concept {index + 1}",
        150,
    )

    definition = _text(
        raw.get("definition")
        or raw.get("conceptMeaning")
        or raw.get("teachingMeaning")
        or raw.get("whyItMatters")
        or raw.get("visualObservation")
        or raw.get("teacherExplanation")
        or raw.get("visualFact")
        or raw.get("content")
        or raw.get("relationship")
        or label,
        1300,
    )

    teacher_line = _text(
        raw.get("teacherLine")
        or raw.get("spokenTeacherLine")
        or raw.get("spokenCue")
        or raw.get("voiceHint")
        or raw.get("teacherExplanation")
        or raw.get("teacherMove")
        or definition,
        1100,
    )

    board_use = _text(
        raw.get("boardUse")
        or raw.get("exactBoardMove")
        or raw.get("boardRedrawInstruction")
        or raw.get("boardAction")
        or raw.get("boardMove")
        or raw.get("action")
        or "draw/highlight",
        220,
    )

    grounding_text = " ".join([label, definition, teacher_line, board_use])
    all_refs = _collect_chunk_refs(payload)
    keywords = _selected_keywords(payload)

    raw_refs = dedupe_source_refs(normalize_source_refs([_dict(x) for x in _list(raw.get("sourceRefs"))]))
    good_refs = [r for r in raw_refs if _text(r.get("quote"))][:5]
    refs = good_refs or _best_refs_for_text(grounding_text, all_refs, keywords, limit=5)

    source_type = _source_type_from_raw(raw, refs)

    return {
        "conceptId": normalize_id(label, f"visual_concept_{index + 1}"),
        "label": label,
        "definition": definition,
        "summary": _text(raw.get("summary") or definition, 850),
        "conceptType": kind,
        "importance": _as_float(raw.get("importance") or raw.get("confidence"), 0.82),
        "teachingPriority": _text(raw.get("teachingPriority") or ("core" if index < 5 else "supporting"), 90),
        "studentDifficulty": _text(raw.get("studentDifficulty") or "medium", 90),
        "misconceptionRisk": _text(raw.get("misconceptionRisk") or raw.get("risk") or "medium", 650),
        "whyItMatters": _text(raw.get("whyItMatters") or raw.get("whyStudentShouldCare") or definition, 950),
        "explainLikeHuman": _text(raw.get("explainLikeHuman") or teacher_line or definition, 1200),
        "boardUse": board_use,
        "visualRole": _text(raw.get("visualRole") or raw.get("kind") or kind, 160),
        "parentHint": _text(raw.get("parentHint") or "", 160),
        "dependsOn": [_text(x, 160) for x in _list(raw.get("dependsOn"))],
        "prerequisiteOf": [_text(x, 160) for x in _list(raw.get("prerequisiteOf"))],
        "examples": [_text(x, 750) for x in _list(raw.get("examples"))],
        "commonMistakes": [
            _text(raw.get("misconceptionRisk") or raw.get("risk"), 750)
        ] if _text(raw.get("misconceptionRisk") or raw.get("risk")) else [],
        "assessmentSeeds": [
            _text(raw.get("studentCheckQuestion") or raw.get("studentCheck") or "Explain this concept in your own words.", 750)
        ],
        "visualHints": [
            _text(raw.get("exactLocation") or raw.get("layoutHint"), 360),
            _text(raw.get("visualObservation") or raw.get("visualEvidence"), 650),
        ],
        "teacherLine": teacher_line,
        "visualProof": {
            "sourceType": source_type,
            "needsSourceVerification": bool(raw.get("needsSourceVerification")) or source_type == "visual_observation",
            "visualObservation": _text(raw.get("visualObservation") or raw.get("visualEvidence") or definition, 1000),
            "confidence": raw.get("confidence", 0.82),
        },
        "frontendBoardHint": {
            "boardUse": board_use,
            "exactBoardMove": _text(raw.get("exactBoardMove") or raw.get("boardAction") or raw.get("boardRedrawInstruction") or raw.get("boardMove"), 1000),
            "layoutHint": _text(raw.get("layoutHint") or raw.get("exactLocation"), 700),
            "teacherPurpose": _text(raw.get("teacherPurpose") or raw.get("whyStudentShouldCare") or raw.get("whyItMatters"), 700),
            "studentCheckQuestion": _text(raw.get("studentCheckQuestion") or raw.get("studentCheck"), 700),
        },
        "sourceRefs": refs,
        "metadata": {
            **_dict(raw.get("metadata")),
            "visualPacketDerivedConcept": True,
            "sourceType": source_type,
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }


def _derive_visual_concepts(payload: JsonDict, limit: int = 18) -> List[JsonDict]:
    packet = _visual_packet(payload)
    if not packet:
        return []

    raw_items: List[Tuple[str, JsonDict]] = []

    for item in _list(packet.get("sourceGroundedVisualFacts"))[:8]:
        raw_items.append(("visual_fact", _dict(item)))

    for item in _list(packet.get("diagramElementDetails"))[:8]:
        raw_items.append(("visual_element", _dict(item)))

    for item in _list(packet.get("relationshipWalkthrough"))[:8]:
        raw_items.append(("visual_relationship", _dict(item)))

    for item in _list(packet.get("misconceptionRisks"))[:5]:
        raw_items.append(("visual_misconception", _dict(item)))

    for item in _list(packet.get("boardRedrawPlan"))[:4]:
        raw_items.append(("board_action", _dict(item)))

    out: List[JsonDict] = []
    seen = set()

    for index, (kind, raw) in enumerate(raw_items):
        concept = _make_visual_concept(payload, raw, index, kind)
        key = _text(concept.get("label"), 180).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(concept)
        if len(out) >= limit:
            break

    return out


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class ConceptExtractionAgent(BaseLiveTutorAgent):
    agent_name = "ConceptExtractionAgent"
    agent_group = "source"
    default_mode = "extract_concepts"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are ConceptExtractionAgent for a world-class Live Tutor.

Extract rich teachable concepts, not keyword labels.

Hard rules:
- Output ONLY valid JSON.
- No fake fallback.
- No fixed domain.
- No unsupported concepts.
- Do not invent source quotes.
- Use compact source evidence as textual truth.
- Use full compressed vision coverage as visual/board truth.
- Visual-only concepts must be marked sourceType='visual_observation'.
- Every concept should help KnowledgeGraph, TeachingStrategy, VisualPlanner, BoardScene, BoardCommand, VoiceScript, and frontend board tools.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        refs = _collect_chunk_refs(payload)
        packet = _visual_packet(payload)

        if not refs:
            errors.append("ConceptExtractionAgent requires clean source refs/chunks with quotes.")
        if not packet:
            warnings.append("visualTeacherPacket not found; concept extraction will be source-only.")
        if not _list(payload.get("chunks")) and not _list(payload.get("selectedEvidence")):
            warnings.append("No chunks/selectedEvidence at top level; using sourceTruth if available.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="ConceptExtractionAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        source = _source_truth(payload)
        packet = _visual_packet(payload)

        prompt_payload = {
            "task": "Extract rich board-ready concepts for a world-class live tutor lesson.",
            "inputPolicy": {
                "fullVisionCoverage": "Included below, compressed per item. Use all visual sections.",
                "compactSourceContext": "Source/PDF is compact. Use selected evidence as textual truth.",
                "doNotUse": [
                    "previousPromptForCompatibility",
                    "full raw chunks dump",
                    "full pageContexts dump",
                    "full raw PDF text",
                    "repeated same data under many names",
                ],
                "truthRules": [
                    "Do not invent source quotes.",
                    "If sourceRefs/sourceProof supports a concept, mark sourceType as source_grounded_visual or text_only.",
                    "If concept is from image only, mark sourceType as visual_observation and needsSourceVerification=true.",
                ],
            },
            "student": {
                "level": context.studentLevel,
                "language": context.language,
                "question": _text(context.question or payload.get("question"), 1000),
            },
            "selectedNode": _dict(payload.get("selectedNode") or payload.get("node")),
            "sourceTruthCompact": {
                "selectedEvidence": _compact_evidence(source.get("selectedEvidence") or payload.get("selectedEvidence"), 12),
                "samePageEvidence": _compact_evidence(source.get("samePageEvidence") or payload.get("samePageEvidence"), 6),
                "nearbyEvidence": _compact_evidence(source.get("nearbyEvidence") or payload.get("nearbyEvidence"), 6),
                "validSourceRefs": _compact_refs(payload, 30),
                "selectedPageFullTextExcerpt": _selected_page_text(payload),
            },
            "pdfBackgroundCompact": {
                "fullPdfSummary": _full_pdf_summary(payload),
                "fullPdfOutlineTextExcerpt": _full_pdf_outline_text(payload),
                "rule": "Use this as course/chapter context only. Selected evidence remains primary truth.",
            },
            "visualTeacherPacketFullCoverage": _full_vision_coverage_for_prompt(packet),
            "outputRequirements": {
                "conceptCount": "8-12",
                "mustInclude": [
                    "main source concept",
                    "definition/rule concept",
                    "visual element concept",
                    "visual relationship concept",
                    "misconception concept",
                    "board-action concept",
                    "student-check concept",
                ],
                "eachConceptNeeds": [
                    "definition",
                    "explainLikeHuman",
                    "teacherLine",
                    "boardUse",
                    "frontendBoardHint",
                    "visualProof or sourceRefs",
                ],
                "keepOutputFocused": True,
            },
            "outputSchema": {
                "title": "concept map title",
                "concepts": [
                    {
                        "conceptId": "stable_snake_case",
                        "label": "short label",
                        "definition": "clear definition",
                        "summary": "one teaching sentence",
                        "conceptType": "root|definition|rule|relationship|visual_fact|visual_element|visual_relationship|visual_misconception|warning|board_action",
                        "importance": 0.9,
                        "teachingPriority": "core|supporting|repair",
                        "studentDifficulty": "easy|medium|hard",
                        "misconceptionRisk": "specific risk",
                        "whyItMatters": "why student needs it",
                        "explainLikeHuman": "2-4 sentences",
                        "boardUse": "write|draw|circle|arrow|highlight|compare|quiz",
                        "visualRole": "center|surrounding|arrow|table|warning|none",
                        "teacherLine": "spoken teacher line",
                        "frontendBoardHint": {
                            "exactBoardMove": "specific board move",
                            "layoutHint": "where/how to show",
                            "teacherPurpose": "why this helps",
                            "studentCheckQuestion": "quick check",
                        },
                        "visualProof": {
                            "sourceType": "source_grounded_visual|visual_observation|text_only",
                            "visualObservation": "what image shows, if any",
                            "needsSourceVerification": False,
                            "confidence": 0.9,
                        },
                        "sourceRefs": [],
                    }
                ],
                "conceptClusters": [],
                "metadata": {
                    "worldConceptExtractionCleanV1": True,
                    "visualTeacherPacketConsumedCleanV1": True,
                    "fullVisionCoverageSentToConceptPromptCleanV1": True,
                    "compactSourceContextUsedCleanV1": True,
                    "fullPdfContextUsedCleanV1": True,
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                },
            },
        }

        return _json(prompt_payload, 70000)

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        raise RuntimeError("ConceptExtractionAgent requires Gemini/ADK. No rule-based/static fallback is allowed.")

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = _dict(raw)
        if isinstance(raw.get("result"), dict):
            raw = _dict(raw.get("result"))

        clean_refs = _collect_chunk_refs(payload)
        selected_keywords = _selected_keywords(payload)

        concepts: List[JsonDict] = []
        seen_ids = set()

        for index, item in enumerate(_list(raw.get("concepts"))):
            raw_concept = _dict(item)
            label = _text(raw_concept.get("label") or raw_concept.get("title") or raw_concept.get("name"), 150)
            if not label:
                continue

            concept_id = normalize_id(raw_concept.get("conceptId") or raw_concept.get("id") or label, f"concept_{index + 1}")
            if concept_id in seen_ids:
                concept_id = f"{concept_id}_{index + 1}"
            seen_ids.add(concept_id)

            grounding_text = " ".join(
                [
                    label,
                    _text(raw_concept.get("definition"), 1000),
                    _text(raw_concept.get("summary"), 700),
                    _text(raw_concept.get("explainLikeHuman"), 900),
                    _text(raw_concept.get("whyItMatters"), 700),
                    _text(raw_concept.get("teacherLine"), 700),
                ]
            )

            raw_refs = dedupe_source_refs(normalize_source_refs([_dict(x) for x in _list(raw_concept.get("sourceRefs"))]))
            good_refs = [r for r in raw_refs if _text(r.get("quote"))]
            refs = good_refs[:5] or _best_refs_for_text(grounding_text, clean_refs, selected_keywords, limit=5)

            visual_proof = _dict(raw_concept.get("visualProof"))
            source_type = _text(visual_proof.get("sourceType") or raw_concept.get("sourceType"), 120)
            if not source_type:
                source_type = "text_only" if refs else "visual_observation"

            concept = {
                "conceptId": concept_id,
                "label": label,
                "definition": _text(raw_concept.get("definition"), 1500),
                "summary": _text(raw_concept.get("summary"), 850),
                "conceptType": _text(raw_concept.get("conceptType") or "topic", 120),
                "importance": _as_float(raw_concept.get("importance"), 0.7),
                "teachingPriority": _text(raw_concept.get("teachingPriority") or "supporting", 90),
                "studentDifficulty": _text(raw_concept.get("studentDifficulty") or "medium", 90),
                "misconceptionRisk": _text(raw_concept.get("misconceptionRisk") or "medium", 650),
                "whyItMatters": _text(raw_concept.get("whyItMatters"), 950),
                "explainLikeHuman": _text(raw_concept.get("explainLikeHuman"), 1300),
                "boardUse": _text(raw_concept.get("boardUse") or "write", 160),
                "visualRole": _text(raw_concept.get("visualRole") or "none", 160),
                "parentHint": _text(raw_concept.get("parentHint") or raw_concept.get("parent"), 160),
                "dependsOn": [_text(x, 160) for x in _list(raw_concept.get("dependsOn"))],
                "prerequisiteOf": [_text(x, 160) for x in _list(raw_concept.get("prerequisiteOf"))],
                "examples": [_text(x, 750) for x in _list(raw_concept.get("examples"))],
                "commonMistakes": [_text(x, 750) for x in _list(raw_concept.get("commonMistakes"))],
                "assessmentSeeds": [_text(x, 750) for x in _list(raw_concept.get("assessmentSeeds"))],
                "visualHints": [_text(x, 240) for x in _list(raw_concept.get("visualHints"))],
                "teacherLine": _text(raw_concept.get("teacherLine") or raw_concept.get("spokenTeacherLine"), 1100),
                "frontendBoardHint": {
                    "boardUse": _text(_dict(raw_concept.get("frontendBoardHint")).get("boardUse") or raw_concept.get("boardUse"), 180),
                    "exactBoardMove": _text(_dict(raw_concept.get("frontendBoardHint")).get("exactBoardMove"), 900),
                    "layoutHint": _text(_dict(raw_concept.get("frontendBoardHint")).get("layoutHint"), 700),
                    "teacherPurpose": _text(_dict(raw_concept.get("frontendBoardHint")).get("teacherPurpose"), 700),
                    "studentCheckQuestion": _text(_dict(raw_concept.get("frontendBoardHint")).get("studentCheckQuestion"), 700),
                },
                "visualProof": {
                    "sourceType": source_type,
                    "visualObservation": _text(visual_proof.get("visualObservation"), 1000),
                    "needsSourceVerification": bool(visual_proof.get("needsSourceVerification")) or source_type == "visual_observation",
                    "confidence": visual_proof.get("confidence", 0.82),
                },
                "sourceRefs": refs,
                "metadata": {
                    **_dict(raw_concept.get("metadata")),
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                    "worldConceptExtractionCleanV1": True,
                },
            }

            concepts.append(concept)

        # Enrich from full visual packet if Gemini missed visual concepts.
        existing_labels = {_text(c.get("label"), 180).lower() for c in concepts}
        derived = []
        for concept in _derive_visual_concepts(payload, 18):
            key = _text(concept.get("label"), 180).lower()
            if key and key not in existing_labels:
                existing_labels.add(key)
                derived.append(concept)

        # Keep Gemini's concepts first, then deterministic visual payload-derived concepts.
        concepts = (concepts + derived)[:28]

        clusters: List[JsonDict] = []
        for index, item in enumerate(_list(raw.get("conceptClusters"))):
            cluster = _dict(item)
            clusters.append(
                {
                    "clusterId": normalize_id(cluster.get("clusterId") or f"cluster_{index + 1}", f"cluster_{index + 1}"),
                    "title": _text(cluster.get("title") or f"Cluster {index + 1}", 180),
                    "purpose": _text(cluster.get("purpose") or "", 800),
                    "conceptIds": [normalize_id(x, "") for x in _list(cluster.get("conceptIds"))],
                    "sourceRefs": dedupe_source_refs(normalize_source_refs([_dict(x) for x in _list(cluster.get("sourceRefs"))]))[:6],
                }
            )

        all_refs: List[JsonDict] = []
        for concept in concepts:
            all_refs.extend(_list(_dict(concept).get("sourceRefs")))
        for cluster in clusters:
            all_refs.extend(_list(_dict(cluster).get("sourceRefs")))

        packet = _visual_packet(payload)

        return {
            "title": _text(raw.get("title") or "Extracted Concepts", 220),
            "conceptCount": len(concepts),
            "concepts": concepts,
            "conceptClusters": clusters,
            "sourceRefs": dedupe_source_refs(all_refs),
            "pdfBackground": {
                "fullPdfSummary": _full_pdf_summary(payload),
                "fullPdfOutlineText": _full_pdf_outline_text(payload),
            },
            "visualTeacherPacketSummary": {
                "consumed": bool(packet),
                "sourceGroundedVisualFactCount": len(_list(packet.get("sourceGroundedVisualFacts"))),
                "diagramElementDetailCount": len(_list(packet.get("diagramElementDetails"))),
                "relationshipWalkthroughCount": len(_list(packet.get("relationshipWalkthrough"))),
                "derivedConceptCount": len(derived),
            },
            "qualitySignals": {
                "worldConceptExtractionCleanV1": True,
                "visualTeacherPacketConsumedCleanV1": bool(packet),
                "fullVisionCoverageSentToConceptPromptCleanV1": True,
                "compactSourceContextUsedCleanV1": True,
                "fullPdfContextUsedCleanV1": True,
                "conceptCount": len(concepts),
                "sourceGrounded": bool(all_refs),
                "readyForKnowledgeGraph": True,
                "readyForTeachingStrategy": True,
                "readyForFrontendBoard": True,
                "fallbackUsed": False,
            },
            "metadata": {
                **_dict(raw.get("metadata")),
                "agent": "ConceptExtractionAgent",
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "worldConceptExtractionCleanV1": True,
                "visualTeacherPacketConsumedCleanV1": bool(packet),
                "fullVisionCoverageSentToConceptPromptCleanV1": True,
                "compactSourceContextUsedCleanV1": True,
                "fullPdfContextUsedCleanV1": True,
                "visualPacketDerivedConceptCount": len(derived),
                "conceptCount": len(concepts),
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        concepts = _list(output.get("concepts"))
        packet = _visual_packet(payload)

        if len(concepts) < 6:
            errors.append("ConceptExtractionAgent must output at least 6 teachable concepts.")

        visual_concept_count = 0
        board_hint_count = 0
        teacher_line_count = 0
        proof_count = 0

        seen = set()
        for index, concept in enumerate(concepts):
            item = _dict(concept)
            concept_id = _text(item.get("conceptId"), 140)

            if not concept_id:
                errors.append(f"concepts[{index}].conceptId is required.")
            if concept_id in seen:
                errors.append(f"Duplicate conceptId: {concept_id}")
            seen.add(concept_id)

            if not _text(item.get("label")):
                errors.append(f"concepts[{index}].label is required.")
            if len(_text(item.get("definition")).split()) < 5:
                errors.append(f"concepts[{index}].definition is too short.")
            if not _text(item.get("explainLikeHuman")):
                errors.append(f"concepts[{index}].explainLikeHuman is required.")
            if not _text(item.get("boardUse")):
                errors.append(f"concepts[{index}].boardUse is required.")

            concept_type = _text(item.get("conceptType")).lower()
            if concept_type.startswith("visual") or _dict(item.get("visualProof")).get("visualObservation"):
                visual_concept_count += 1

            if _dict(item.get("frontendBoardHint")):
                board_hint_count += 1
            if _text(item.get("teacherLine")) or _text(item.get("explainLikeHuman")):
                teacher_line_count += 1
            if _list(item.get("sourceRefs")) or _dict(item.get("visualProof")):
                proof_count += 1

            source_type = _text(_dict(item.get("visualProof")).get("sourceType"))
            if source_type == "visual_observation" and not bool(_dict(item.get("visualProof")).get("needsSourceVerification")):
                errors.append(f"concepts[{index}] visual_observation must set needsSourceVerification=true.")

        if packet and visual_concept_count < 3:
            errors.append("ConceptExtractionAgent must output at least 3 visual/diagram-aware concepts when visualTeacherPacket exists.")
        if board_hint_count < min(4, len(concepts)):
            errors.append("ConceptExtractionAgent must create frontendBoardHint for at least 4 concepts.")
        if teacher_line_count < min(6, len(concepts)):
            errors.append("ConceptExtractionAgent must create teacherLine/explainLikeHuman for at least 6 concepts.")
        if proof_count < min(6, len(concepts)):
            warnings.append("Many concepts lack sourceRefs or visualProof.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="ConceptExtractionAgent.validate_output.cleanFinalV1",
            fallbackUsed=False,
        )


__all__ = ["ConceptExtractionAgent"]
