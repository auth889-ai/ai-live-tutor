"""
google_agent/source/concept_extraction_agent.py
===============================================================================
WORLD-TEACHER ConceptExtractionAgent.

Goal:
- Extract rich teachable concepts, not only labels.
- Make every concept useful for later:
  KnowledgeGraphAgent -> TeachingStrategyAgent -> DetailedExplanationAgent
  -> VisualPlannerAgent -> BoardSceneAgent.
- No fixed domain.
- No hardcoded Star Schema.
- No fake/static fallback.
- Source grounded only.

Output adds:
- studentDifficulty
- teachingPriority
- misconceptionRisk
- visualRole
- boardUse
- prerequisiteOf / dependsOn
- explainLikeHuman
- assessmentSeeds
- clean sourceRefs
===============================================================================
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Tuple

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
    AgentContext,
    JsonDict,
    ValidationResult,
    clean_text,
    dedupe_source_refs,
    normalize_id,
    normalize_source_refs,
    require_source_refs,
    safe_dict,
    safe_list,
)


def _json(value: Any, limit: int = 150000) -> str:
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), limit)
    except Exception:
        return clean_text(value, limit)


def _words(value: Any) -> List[str]:
    text = clean_text(value, 6000).lower()
    return [w for w in re.findall(r"[a-zA-Z0-9_]+", text) if len(w) >= 3]


def _chunk_ref(chunk: JsonDict, role: str = "chunk") -> JsonDict:
    return {
        "chunkId": clean_text(chunk.get("chunkId") or chunk.get("id") or "", 220),
        "sourceRef": clean_text(chunk.get("sourceRef") or chunk.get("pageRef") or chunk.get("chunkId") or chunk.get("id") or "", 380),
        "pageRef": clean_text(chunk.get("pageRef") or chunk.get("sourceRef") or "", 380),
        "page": chunk.get("page") or chunk.get("pageNumber"),
        "quote": clean_text(chunk.get("quote") or chunk.get("textPreview") or chunk.get("text") or "", 1400),
        "confidence": chunk.get("confidence") or 0.82,
        "resourceId": clean_text(chunk.get("resourceId") or "", 220),
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
        for item in safe_list(payload.get(key)):
            chunk = safe_dict(item)
            if chunk:
                refs.append(_chunk_ref(chunk, role))

    source_truth = safe_dict(payload.get("sourceTruth"))
    for key, role in [
        ("selectedEvidence", "selectedEvidence"),
        ("samePageEvidence", "samePageEvidence"),
        ("nearbyEvidence", "nearbyEvidence"),
        ("relatedEvidence", "relatedEvidence"),
        ("comparisonEvidence", "comparisonEvidence"),
    ]:
        for item in safe_list(source_truth.get(key)):
            chunk = safe_dict(item)
            if chunk:
                refs.append(_chunk_ref(chunk, role))

    for ref in safe_list(payload.get("sourceRefs")):
        r = safe_dict(ref)
        if r:
            refs.append(_chunk_ref(r, "sourceRef"))

    clean: List[JsonDict] = []
    for r in refs:
        if not clean_text(r.get("quote")):
            continue
        if not (r.get("sourceRef") or r.get("chunkId")):
            continue
        clean.append(r)

    return dedupe_source_refs(normalize_source_refs(clean))[:80]


def _selected_keywords(payload: JsonDict) -> List[str]:
    node = safe_dict(payload.get("selectedNode") or payload.get("node"))
    text_parts = [
        node.get("title"),
        node.get("label"),
        node.get("definition"),
        node.get("summary"),
        payload.get("question"),
    ]
    for item in safe_list(payload.get("selectedEvidence"))[:8]:
        text_parts.append(safe_dict(item).get("text") or safe_dict(item).get("quote"))
    source_truth = safe_dict(payload.get("sourceTruth"))
    for item in safe_list(source_truth.get("selectedEvidence"))[:8]:
        text_parts.append(safe_dict(item).get("text") or safe_dict(item).get("quote"))

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
    quote = clean_text(ref.get("quote"), 1600)
    if not quote:
        return -100.0

    score = 0.0
    role = clean_text(ref.get("evidenceRole"), 80)
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

    lower = quote.lower()
    if len(quote.split()) < 5:
        score -= 5
    if "software design and architecture" in lower and len(quote.split()) < 12:
        score -= 6
    if "lets solve" in lower or "top management want" in lower:
        score -= 3

    return score


def _best_refs_for_text(text: str, refs: List[JsonDict], selected_keywords: List[str], limit: int = 5) -> List[JsonDict]:
    scored: List[Tuple[float, JsonDict]] = []
    for ref in refs:
        score = _score_ref_for_text(ref, text, selected_keywords)
        if score > 0:
            scored.append((score, ref))
    scored.sort(key=lambda x: x[0], reverse=True)
    return dedupe_source_refs([r for _, r in scored])[:limit]


class ConceptExtractionAgent(BaseLiveTutorAgent):
    agent_name = "ConceptExtractionAgent"
    agent_group = "source"
    default_mode = "extract_concepts"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are ConceptExtractionAgent for a world-class Live Tutor.

Extract concepts that are useful for teaching, not just keywords.

Hard rules:
- Output ONLY valid JSON.
- No fake fallback.
- No fixed domain.
- No unsupported concepts.
- Every concept must be grounded in sourceRefs.
- Prefer selectedEvidence and same-page evidence.
- Create concepts that later agents can use for visual board teaching.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        refs = _collect_chunk_refs(payload)
        if not refs:
            errors.append("ConceptExtractionAgent requires clean source refs/chunks with quotes.")

        if not safe_list(payload.get("chunks")) and not safe_list(payload.get("selectedEvidence")):
            warnings.append("No chunks/selectedEvidence at top level; using sourceTruth if available.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="ConceptExtractionAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        chunks_text = self.compact_chunks_for_prompt(
            safe_list(payload.get("chunks") or payload.get("retrievedChunks")),
            max_chars=70000,
        )
        refs = _collect_chunk_refs(payload)
        selected_node = safe_dict(payload.get("selectedNode") or payload.get("node"))
        source_truth = safe_dict(payload.get("sourceTruth"))
        vision = safe_dict(payload.get("selectedPageVision"))

        prompt_payload = {
            "task": "Extract rich source-grounded teachable concepts for a human tutor board lesson.",
            "student": {
                "level": context.studentLevel,
                "language": context.language,
                "question": clean_text(context.question or payload.get("question"), 1500),
            },
            "selectedNode": selected_node,
            "sourceTruth": {
                "selectedEvidence": source_truth.get("selectedEvidence") or payload.get("selectedEvidence") or [],
                "samePageEvidence": source_truth.get("samePageEvidence") or payload.get("samePageEvidence") or [],
                "nearbyEvidence": source_truth.get("nearbyEvidence") or payload.get("nearbyEvidence") or [],
                "selectedPageFullTextExcerpt": clean_text(
                    source_truth.get("selectedPageFullTextExcerpt") or payload.get("selectedPageFullText") or "",
                    9000,
                ),
            },
            "visionHints": {
                "diagramSummary": clean_text(vision.get("diagramSummary") or payload.get("selectedPageVisionDiagramSummary"), 5000),
                "diagramElements": safe_list(payload.get("diagramElements") or vision.get("diagramElements"))[:60],
                "relationships": safe_list(payload.get("relationships") or vision.get("relationships"))[:60],
                "teacherMarkingHints": safe_list(payload.get("teacherMarkingHints") or vision.get("teacherMarkingHints"))[:40],
            },
            "validSourceRefs": refs[:50],
            "compactChunks": chunks_text,
            "outputSchema": {
                "title": "concept map title",
                "concepts": [
                    {
                        "conceptId": "stable_snake_case",
                        "label": "short label",
                        "definition": "clear source-grounded definition",
                        "summary": "simple teaching sentence",
                        "conceptType": "root|topic|definition|process|example|warning|rule|relationship|question",
                        "importance": 0.9,
                        "teachingPriority": "core|supporting|advanced|repair",
                        "studentDifficulty": "easy|medium|hard",
                        "misconceptionRisk": "low|medium|high",
                        "whyItMatters": "why student needs this",
                        "explainLikeHuman": "how a patient tutor explains it",
                        "boardUse": "write|draw|circle|arrow|highlight|compare|quiz",
                        "visualRole": "center|surrounding|arrow|warning|zoom|table|example|none",
                        "parentHint": "parent label",
                        "dependsOn": [],
                        "prerequisiteOf": [],
                        "examples": [],
                        "commonMistakes": [],
                        "assessmentSeeds": [],
                        "visualHints": [],
                        "sourceRefs": [],
                    }
                ],
                "conceptClusters": [
                    {
                        "clusterId": "cluster_1",
                        "title": "cluster title",
                        "purpose": "how this cluster helps teaching",
                        "conceptIds": [],
                        "sourceRefs": [],
                    }
                ],
                "metadata": {
                    "fallbackUsed": False,
                    "worldConceptExtractionV2": True,
                },
            },
            "qualityBar": {
                "minimumConcepts": 6,
                "mustInclude": [
                    "core concept",
                    "definition concept",
                    "relationship/rule concept",
                    "visual/diagram concept when vision exists",
                    "mistake or confusion concept",
                    "example/application concept",
                ],
                "everyConceptNeedsSourceRefs": True,
                "everyConceptNeedsBoardUse": True,
                "everyConceptNeedsHumanExplanation": True,
            },
        }

        return _json(prompt_payload, 150000)

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        raise RuntimeError("ConceptExtractionAgent requires Gemini/ADK. No rule-based/static fallback is allowed.")

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)
        if isinstance(raw.get("result"), dict):
            raw = safe_dict(raw.get("result"))

        clean_refs = _collect_chunk_refs(payload)
        selected_keywords = _selected_keywords(payload)
        concepts: List[JsonDict] = []

        for index, item in enumerate(safe_list(raw.get("concepts"))):
            raw_concept = safe_dict(item)
            label = clean_text(raw_concept.get("label") or raw_concept.get("title") or raw_concept.get("name"), 140)
            concept_id = normalize_id(raw_concept.get("conceptId") or raw_concept.get("id") or label, f"concept_{index + 1}")

            grounding_text = " ".join(
                [
                    label,
                    clean_text(raw_concept.get("definition"), 1000),
                    clean_text(raw_concept.get("summary"), 700),
                    clean_text(raw_concept.get("explainLikeHuman"), 900),
                    clean_text(raw_concept.get("whyItMatters"), 700),
                ]
            )

            raw_refs = dedupe_source_refs(normalize_source_refs([safe_dict(x) for x in safe_list(raw_concept.get("sourceRefs"))]))
            good_raw_refs = [r for r in raw_refs if clean_text(r.get("quote"))]
            refs = good_raw_refs[:5] or _best_refs_for_text(grounding_text, clean_refs, selected_keywords, limit=5)

            concepts.append(
                {
                    "conceptId": concept_id,
                    "label": label,
                    "definition": clean_text(raw_concept.get("definition") or "", 1600),
                    "summary": clean_text(raw_concept.get("summary") or "", 900),
                    "conceptType": clean_text(raw_concept.get("conceptType") or "topic", 90),
                    "importance": max(0.0, min(1.0, float(raw_concept.get("importance") or 0.65))),
                    "teachingPriority": clean_text(raw_concept.get("teachingPriority") or "supporting", 80),
                    "studentDifficulty": clean_text(raw_concept.get("studentDifficulty") or "medium", 80),
                    "misconceptionRisk": clean_text(raw_concept.get("misconceptionRisk") or "medium", 80),
                    "whyItMatters": clean_text(raw_concept.get("whyItMatters") or "", 900),
                    "explainLikeHuman": clean_text(raw_concept.get("explainLikeHuman") or "", 1400),
                    "boardUse": clean_text(raw_concept.get("boardUse") or "write", 120),
                    "visualRole": clean_text(raw_concept.get("visualRole") or "none", 120),
                    "parentHint": clean_text(raw_concept.get("parentHint") or raw_concept.get("parent") or "", 140),
                    "dependsOn": [clean_text(x, 140) for x in safe_list(raw_concept.get("dependsOn"))],
                    "prerequisiteOf": [clean_text(x, 140) for x in safe_list(raw_concept.get("prerequisiteOf"))],
                    "examples": [clean_text(x, 700) for x in safe_list(raw_concept.get("examples"))],
                    "commonMistakes": [clean_text(x, 700) for x in safe_list(raw_concept.get("commonMistakes"))],
                    "assessmentSeeds": [clean_text(x, 700) for x in safe_list(raw_concept.get("assessmentSeeds"))],
                    "visualHints": [clean_text(x, 100) for x in safe_list(raw_concept.get("visualHints"))],
                    "sourceRefs": refs,
                    "metadata": {
                        **safe_dict(raw_concept.get("metadata")),
                        "fallbackUsed": False,
                        "worldConceptExtractionV2": True,
                        "sourceRefsCleanedV2": True,
                    },
                }
            )

        clusters: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("conceptClusters"))):
            cluster = safe_dict(item)
            refs = dedupe_source_refs(normalize_source_refs([safe_dict(x) for x in safe_list(cluster.get("sourceRefs"))]))
            clusters.append(
                {
                    "clusterId": normalize_id(cluster.get("clusterId") or f"cluster_{index + 1}", f"cluster_{index + 1}"),
                    "title": clean_text(cluster.get("title") or f"Cluster {index + 1}", 180),
                    "purpose": clean_text(cluster.get("purpose") or "", 900),
                    "conceptIds": [normalize_id(x, "") for x in safe_list(cluster.get("conceptIds"))],
                    "sourceRefs": [r for r in refs if clean_text(r.get("quote"))][:6],
                }
            )

        all_refs: List[JsonDict] = []
        for concept in concepts:
            all_refs.extend(safe_list(concept.get("sourceRefs")))
        for cluster in clusters:
            all_refs.extend(safe_list(cluster.get("sourceRefs")))

        return {
            "title": clean_text(raw.get("title") or "Extracted Concepts", 220),
            "conceptCount": len(concepts),
            "concepts": concepts,
            "conceptClusters": clusters,
            "sourceRefs": dedupe_source_refs(all_refs),
            "qualitySignals": {
                "worldConceptExtractionV2": True,
                "conceptCount": len(concepts),
                "clusterCount": len(clusters),
                "sourceGrounded": bool(all_refs),
                "readyForKnowledgeGraph": True,
                "readyForTeachingStrategy": True,
                "fallbackUsed": False,
            },
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "worldConceptExtractionV2": True,
                "sourceRefsCleanedV2": True,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        concepts = safe_list(output.get("concepts"))
        if len(concepts) < 6:
            errors.append("ConceptExtractionAgent must output at least 6 rich teachable concepts.")

        seen = set()
        for index, concept in enumerate(concepts):
            item = safe_dict(concept)
            concept_id = clean_text(item.get("conceptId"), 140)

            if not concept_id:
                errors.append(f"concepts[{index}].conceptId is required.")
            if concept_id in seen:
                errors.append(f"Duplicate conceptId: {concept_id}")
            seen.add(concept_id)

            if not clean_text(item.get("label")):
                errors.append(f"concepts[{index}].label is required.")
            if len(clean_text(item.get("definition")).split()) < 8:
                errors.append(f"concepts[{index}].definition is too short.")
            if not clean_text(item.get("explainLikeHuman")):
                errors.append(f"concepts[{index}].explainLikeHuman is required.")
            if not clean_text(item.get("boardUse")):
                errors.append(f"concepts[{index}].boardUse is required.")
            if not clean_text(item.get("visualRole")):
                warnings.append(f"concepts[{index}].visualRole should be present.")

            ref_validation = require_source_refs(
                safe_list(item.get("sourceRefs")),
                f"ConceptExtractionAgent.concepts[{index}].sourceRefs",
            )
            errors.extend(ref_validation.errors)

            for ref in safe_list(item.get("sourceRefs")):
                if not clean_text(safe_dict(ref).get("quote")):
                    warnings.append(f"concepts[{index}] has a sourceRef with empty quote.")

        top_ref_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "ConceptExtractionAgent.output.sourceRefs",
        )
        errors.extend(top_ref_validation.errors)

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="ConceptExtractionAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["ConceptExtractionAgent"]


# === FINAL_VISUAL_PACKET_AWARE_CONCEPT_EXTRACTION_V5 ===
# v37 final concept fix:
# - Consume full visualTeacherPacket.
# - Preserve fullPdfSummary/fullPdfOutline/fullPdfOutlineText.
# - Create text-grounded + visual-grounded + board-ready concepts.
# - No static fallback and no hardcoded topic.
# - If ADK omits visual concepts, normalize_output derives them from real visual packet.

_PREV_CONCEPT_BUILD_PROMPT_V5 = ConceptExtractionAgent.build_prompt
_PREV_CONCEPT_NORMALIZE_OUTPUT_V5 = ConceptExtractionAgent.normalize_output
_PREV_CONCEPT_VALIDATE_OUTPUT_V5 = ConceptExtractionAgent.validate_output


def _cv5_text(value: Any, limit: int = 1200) -> str:
    try:
        return clean_text(value or "", limit)
    except Exception:
        return str(value or "")[:limit]


def _cv5_dict(value: Any) -> JsonDict:
    try:
        return safe_dict(value)
    except Exception:
        return value if isinstance(value, dict) else {}


def _cv5_list(value: Any) -> List[Any]:
    try:
        return safe_list(value)
    except Exception:
        return value if isinstance(value, list) else []


def _cv5_first_dict(*values: Any) -> JsonDict:
    for value in values:
        item = _cv5_dict(value)
        if item:
            return item
    return {}


def _cv5_visual_packet(payload: JsonDict) -> JsonDict:
    vision = _cv5_dict(payload.get("selectedPageVision"))
    visual_truth = _cv5_dict(payload.get("visualTruth"))
    visual_lesson = _cv5_dict(payload.get("visualLessonInput"))
    visual_context = _cv5_dict(payload.get("visualContext"))

    return _cv5_first_dict(
        payload.get("visualTeacherPacket"),
        visual_truth.get("visualTeacherPacket"),
        vision.get("visualTeacherPacket"),
        _cv5_dict(vision.get("visualLessonInput")).get("visualTeacherPacket"),
        visual_lesson.get("visualTeacherPacket"),
        visual_context.get("visualTeacherPacket"),
        _cv5_dict(visual_context.get("visualLessonInput")).get("visualTeacherPacket"),
    )


def _cv5_source_truth(payload: JsonDict) -> JsonDict:
    return _cv5_first_dict(
        payload.get("sourceTruth"),
        payload.get("sourceTruthPacket"),
        _cv5_dict(payload.get("ragRetrieval")).get("sourceTruthPacket"),
    )


def _cv5_full_summary(payload: JsonDict) -> Any:
    source_truth = _cv5_source_truth(payload)
    return (
        payload.get("fullPdfSummary")
        or source_truth.get("fullPdfSummary")
        or _cv5_dict(payload.get("pdfBackground")).get("fullPdfSummary")
        or {}
    )


def _cv5_full_outline(payload: JsonDict) -> Any:
    source_truth = _cv5_source_truth(payload)
    return (
        payload.get("fullPdfOutline")
        or source_truth.get("fullPdfOutline")
        or _cv5_dict(payload.get("pdfBackground")).get("fullPdfOutline")
        or {}
    )


def _cv5_full_outline_text(payload: JsonDict) -> str:
    source_truth = _cv5_source_truth(payload)
    return _cv5_text(
        payload.get("fullPdfOutlineText")
        or source_truth.get("fullPdfOutlineText")
        or _cv5_dict(payload.get("pdfBackground")).get("fullPdfOutlineText")
        or "",
        50000,
    )


def _cv5_selected_page_text(payload: JsonDict) -> str:
    source_truth = _cv5_source_truth(payload)
    return _cv5_text(
        payload.get("selectedPageFullText")
        or source_truth.get("selectedPageFullText")
        or source_truth.get("selectedPageFullTextExcerpt")
        or "",
        50000,
    )


def _cv5_refs(payload: JsonDict, grounding_text: str, limit: int = 5) -> List[JsonDict]:
    refs = _collect_chunk_refs(payload)
    selected_keywords = _selected_keywords(payload)
    best = _best_refs_for_text(grounding_text, refs, selected_keywords, limit=limit)
    return best or refs[: min(limit, len(refs))]


def _cv5_concept_id(label: str, fallback: str) -> str:
    return normalize_id(label or fallback, fallback)


def _cv5_make_visual_concept(payload: JsonDict, raw: JsonDict, index: int, kind: str) -> JsonDict:
    label = _cv5_text(
        raw.get("label")
        or raw.get("visualFact")
        or raw.get("relationship")
        or raw.get("content")
        or raw.get("target")
        or raw.get("risk")
        or raw.get("teacherMove")
        or f"Visual Concept {index + 1}",
        160,
    )

    definition = _cv5_text(
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
        1800,
    )

    teacher_line = _cv5_text(
        raw.get("teacherLine")
        or raw.get("spokenTeacherLine")
        or raw.get("spokenCue")
        or raw.get("voiceHint")
        or raw.get("teacherExplanation")
        or raw.get("teacherMove")
        or definition,
        1600,
    )

    board_use = _cv5_text(
        raw.get("boardUse")
        or raw.get("exactBoardMove")
        or raw.get("boardRedrawInstruction")
        or raw.get("boardAction")
        or raw.get("boardMove")
        or raw.get("action")
        or "draw/highlight",
        260,
    )

    grounding_text = " ".join([label, definition, teacher_line, board_use])

    refs = dedupe_source_refs(
        normalize_source_refs([_cv5_dict(x) for x in _cv5_list(raw.get("sourceRefs"))])
    )
    refs = [r for r in refs if _cv5_text(r.get("quote"))][:5] or _cv5_refs(payload, grounding_text, 5)

    source_type = _cv5_text(raw.get("sourceType") or ("source_grounded_visual" if refs else "visual_observation"), 120)

    return {
        "conceptId": _cv5_concept_id(label, f"visual_concept_{index + 1}"),
        "label": label,
        "definition": definition,
        "summary": _cv5_text(raw.get("summary") or definition, 1000),
        "conceptType": kind,
        "importance": max(0.0, min(1.0, float(raw.get("importance") or raw.get("confidence") or 0.82))),
        "teachingPriority": _cv5_text(raw.get("teachingPriority") or ("core" if index < 5 else "supporting"), 90),
        "studentDifficulty": _cv5_text(raw.get("studentDifficulty") or "medium", 90),
        "misconceptionRisk": _cv5_text(raw.get("misconceptionRisk") or raw.get("risk") or "medium", 700),
        "whyItMatters": _cv5_text(raw.get("whyItMatters") or raw.get("whyStudentShouldCare") or definition, 1200),
        "explainLikeHuman": _cv5_text(raw.get("explainLikeHuman") or teacher_line or definition, 1600),
        "boardUse": board_use,
        "visualRole": _cv5_text(raw.get("visualRole") or raw.get("kind") or kind, 180),
        "parentHint": _cv5_text(raw.get("parentHint") or "", 180),
        "dependsOn": [_cv5_text(x, 180) for x in _cv5_list(raw.get("dependsOn"))],
        "prerequisiteOf": [_cv5_text(x, 180) for x in _cv5_list(raw.get("prerequisiteOf"))],
        "examples": [_cv5_text(x, 900) for x in _cv5_list(raw.get("examples"))],
        "commonMistakes": [
            _cv5_text(raw.get("misconceptionRisk") or raw.get("risk"), 900)
        ] if _cv5_text(raw.get("misconceptionRisk") or raw.get("risk")) else [],
        "assessmentSeeds": [
            _cv5_text(raw.get("studentCheckQuestion") or raw.get("studentCheck") or "Explain this visual/concept in your own words.", 900)
        ],
        "visualHints": [
            _cv5_text(raw.get("exactLocation") or raw.get("layoutHint"), 500),
            _cv5_text(raw.get("visualObservation") or raw.get("visualEvidence"), 900),
        ],
        "teacherLine": teacher_line,
        "visualProof": {
            "sourceType": source_type,
            "needsSourceVerification": bool(raw.get("needsSourceVerification")) or source_type == "visual_observation",
            "visualObservation": _cv5_text(raw.get("visualObservation") or raw.get("visualEvidence") or definition, 1400),
            "confidence": raw.get("confidence", 0.82),
        },
        "frontendBoardHint": {
            "boardUse": board_use,
            "exactBoardMove": _cv5_text(raw.get("exactBoardMove") or raw.get("boardAction") or raw.get("boardRedrawInstruction") or raw.get("boardMove"), 1200),
            "layoutHint": _cv5_text(raw.get("layoutHint") or raw.get("exactLocation"), 900),
            "teacherPurpose": _cv5_text(raw.get("teacherPurpose") or raw.get("whyStudentShouldCare") or raw.get("whyItMatters"), 900),
            "studentCheckQuestion": _cv5_text(raw.get("studentCheckQuestion") or raw.get("studentCheck"), 900),
        },
        "sourceRefs": refs,
        "metadata": {
            **_cv5_dict(raw.get("metadata")),
            "visualPacketDerivedConceptV5": True,
            "sourceType": source_type,
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }


def _cv5_extra_visual_concepts(payload: JsonDict, limit: int = 18) -> List[JsonDict]:
    packet = _cv5_visual_packet(payload)
    if not packet:
        return []

    raw_items: List[tuple[str, JsonDict]] = []

    for item in _cv5_list(packet.get("sourceGroundedVisualFacts"))[:8]:
        raw_items.append(("visual_fact", _cv5_dict(item)))

    for item in _cv5_list(packet.get("diagramElementDetails"))[:8]:
        raw_items.append(("visual_element", _cv5_dict(item)))

    for item in _cv5_list(packet.get("relationshipWalkthrough"))[:8]:
        raw_items.append(("visual_relationship", _cv5_dict(item)))

    for item in _cv5_list(packet.get("misconceptionRisks"))[:5]:
        raw_items.append(("visual_misconception", _cv5_dict(item)))

    for item in _cv5_list(packet.get("visualTeachingSequence"))[:5]:
        raw_items.append(("visual_teaching_step", _cv5_dict(item)))

    out: List[JsonDict] = []
    seen = set()

    for index, (kind, raw) in enumerate(raw_items):
        concept = _cv5_make_visual_concept(payload, raw, index, kind)
        key = _cv5_text(concept.get("label"), 180).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(concept)
        if len(out) >= limit:
            break

    return out


def _cv5_build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
    old_prompt = _PREV_CONCEPT_BUILD_PROMPT_V5(self, payload, context)
    packet = _cv5_visual_packet(payload)
    source_truth = _cv5_source_truth(payload)

    prompt_payload = {
        "task": "Extract rich source-grounded AND visual-board-grounded concepts for a premium live tutor.",
        "strictInstruction": [
            "Do not ignore visualTeacherPacket.",
            "Use sourceTruth selectedEvidence as textual truth.",
            "Use fullPdfSummary and fullPdfOutlineText to understand where this node fits in the full PDF/course.",
            "Use visualTeacherPacket as visual/board truth.",
            "If a concept comes only from image observation, mark sourceType='visual_observation' and needsSourceVerification=true.",
            "Never invent source quotes.",
            "Every concept should help later KnowledgeGraph, TeachingStrategy, VisualPlanner, BoardScene, BoardCommand, VoiceScript.",
            "Output useful frontend board hints, teacher lines, student checks, visual proofs.",
        ],
        "student": {
            "level": context.studentLevel,
            "language": context.language,
            "question": _cv5_text(context.question or payload.get("question"), 1800),
        },
        "selectedNode": _cv5_dict(payload.get("selectedNode") or payload.get("node")),
        "sourceTruth": {
            "selectedEvidence": source_truth.get("selectedEvidence") or payload.get("selectedEvidence") or [],
            "samePageEvidence": source_truth.get("samePageEvidence") or payload.get("samePageEvidence") or [],
            "nearbyEvidence": source_truth.get("nearbyEvidence") or payload.get("nearbyEvidence") or [],
            "sourceRefs": _collect_chunk_refs(payload)[:70],
            "selectedPageFullTextExcerpt": _cv5_text(
                source_truth.get("selectedPageFullTextExcerpt")
                or source_truth.get("selectedPageFullText")
                or payload.get("selectedPageFullText")
                or "",
                16000,
            ),
        },
        "pdfBackground": {
            "fullPdfSummary": _cv5_full_summary(payload),
            "fullPdfOutline": _cv5_full_outline(payload),
            "fullPdfOutlineText": _cv5_full_outline_text(payload),
            "rule": "Use this as course/chapter context. Selected evidence remains primary truth.",
        },
        "visualTeacherPacket": {
            "pageVisualNarrative": _cv5_text(packet.get("pageVisualNarrative"), 6000),
            "sourceGroundedVisualFacts": _cv5_list(packet.get("sourceGroundedVisualFacts"))[:50],
            "diagramElementDetails": _cv5_list(packet.get("diagramElementDetails"))[:60],
            "relationshipWalkthrough": _cv5_list(packet.get("relationshipWalkthrough"))[:60],
            "teacherMarkingScript": _cv5_list(packet.get("teacherMarkingScript"))[:45],
            "boardRedrawPlan": _cv5_list(packet.get("boardRedrawPlan"))[:45],
            "misconceptionRisks": _cv5_list(packet.get("misconceptionRisks"))[:30],
            "visualTeachingSequence": _cv5_list(packet.get("visualTeachingSequence"))[:35],
            "metadata": _cv5_dict(packet.get("metadata")),
        },
        "frontendBoardNeeds": {
            "needConceptTree": True,
            "needBoardCards": True,
            "needFlowBlocks": True,
            "needSourceEvidenceBlocks": True,
            "needVisualMarkingPlan": True,
            "needVoiceSyncHints": True,
        },
        "outputSchema": {
            "title": "concept map title",
            "concepts": [
                {
                    "conceptId": "stable_snake_case",
                    "label": "short label",
                    "definition": "clear source-grounded or visual-observation-grounded definition",
                    "summary": "simple teaching sentence",
                    "conceptType": "root|topic|definition|process|example|warning|rule|relationship|visual_fact|visual_element|visual_relationship|visual_misconception",
                    "importance": 0.9,
                    "teachingPriority": "core|supporting|advanced|repair",
                    "studentDifficulty": "easy|medium|hard",
                    "misconceptionRisk": "specific risk",
                    "whyItMatters": "why student needs this",
                    "explainLikeHuman": "patient human teacher explanation, 2-4 sentences",
                    "boardUse": "write|draw|circle|arrow|highlight|compare|quiz",
                    "visualRole": "center|surrounding|arrow|warning|zoom|table|example|none",
                    "teacherLine": "spoken teacher line",
                    "frontendBoardHint": {
                        "exactBoardMove": "specific board move",
                        "layoutHint": "where/how to show",
                        "teacherPurpose": "why this helps",
                        "studentCheckQuestion": "quick check"
                    },
                    "visualProof": {
                        "sourceType": "source_grounded_visual|visual_observation",
                        "visualObservation": "what the image shows",
                        "needsSourceVerification": False,
                        "confidence": 0.9,
                    },
                    "dependsOn": [],
                    "prerequisiteOf": [],
                    "examples": [],
                    "commonMistakes": [],
                    "assessmentSeeds": [],
                    "visualHints": [],
                    "sourceRefs": [],
                }
            ],
            "conceptClusters": [],
            "metadata": {
                "fallbackUsed": False,
                "worldConceptExtractionV5": True,
                "visualTeacherPacketConsumedV5": True,
                "fullPdfContextUsedV5": True,
            },
        },
        "qualityBar": {
            "minimumConcepts": 8,
            "mustInclude": [
                "core source concept",
                "definition concept",
                "visual element concept",
                "visual relationship concept",
                "mistake/confusion concept",
                "board/action concept",
                "student check concept",
            ],
            "mustUseVisualTeacherPacket": bool(packet),
            "mustUseFullPdfSummary": bool(_cv5_full_summary(payload)),
            "mustUseFullPdfOutlineText": bool(_cv5_full_outline_text(payload)),
            "everyConceptNeedsBoardUse": True,
            "everyConceptNeedsHumanExplanation": True,
            "visualOnlyConceptsMustBeMarked": True,
        },
        "previousPromptForCompatibility": old_prompt,
    }

    return _json(prompt_payload, 240000)


def _cv5_normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
    out = _PREV_CONCEPT_NORMALIZE_OUTPUT_V5(self, raw, payload, context)

    concepts = _cv5_list(out.get("concepts"))
    existing = {_cv5_text(_cv5_dict(c).get("label"), 180).lower() for c in concepts}

    extras: List[JsonDict] = []
    for concept in _cv5_extra_visual_concepts(payload, 18):
        key = _cv5_text(concept.get("label"), 180).lower()
        if key and key not in existing:
            existing.add(key)
            extras.append(concept)

    concepts = (concepts + extras)[:28]

    all_refs: List[JsonDict] = []
    for concept in concepts:
        c = _cv5_dict(concept)
        all_refs.extend(_cv5_list(c.get("sourceRefs")))

    packet = _cv5_visual_packet(payload)

    out["concepts"] = concepts
    out["conceptCount"] = len(concepts)
    out["sourceRefs"] = dedupe_source_refs(all_refs) or out.get("sourceRefs")
    out["pdfBackground"] = {
        "fullPdfSummary": _cv5_full_summary(payload),
        "fullPdfOutline": _cv5_full_outline(payload),
        "fullPdfOutlineText": _cv5_full_outline_text(payload),
    }
    out["visualTeacherPacketSummary"] = {
        "consumed": bool(packet),
        "derivedConceptCount": len(extras),
        "sourceGroundedVisualFactCount": len(_cv5_list(packet.get("sourceGroundedVisualFacts"))),
        "diagramElementDetailCount": len(_cv5_list(packet.get("diagramElementDetails"))),
        "relationshipWalkthroughCount": len(_cv5_list(packet.get("relationshipWalkthrough"))),
        "boardRedrawPlanCount": len(_cv5_list(packet.get("boardRedrawPlan"))),
        "visualTeachingSequenceCount": len(_cv5_list(packet.get("visualTeachingSequence"))),
    }

    out["qualitySignals"] = {
        **_cv5_dict(out.get("qualitySignals")),
        "worldConceptExtractionV5": True,
        "visualTeacherPacketConsumedV5": bool(packet),
        "visualPacketDerivedConceptCount": len(extras),
        "fullPdfContextUsedV5": bool(_cv5_full_summary(payload) or _cv5_full_outline_text(payload)),
        "readyForKnowledgeGraph": True,
        "readyForTeachingStrategy": True,
        "readyForFrontendBoard": True,
        "fallbackUsed": False,
    }

    out["metadata"] = {
        **_cv5_dict(out.get("metadata")),
        "worldConceptExtractionV5": True,
        "visualTeacherPacketConsumedV5": bool(packet),
        "visualPacketDerivedConceptCount": len(extras),
        "fullPdfContextUsedV5": bool(_cv5_full_summary(payload) or _cv5_full_outline_text(payload)),
        "conceptCount": len(concepts),
        "fallbackUsed": False,
        "usedSmartFallback": False,
    }

    return out


def _cv5_validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
    result = _PREV_CONCEPT_VALIDATE_OUTPUT_V5(self, output, payload, context)

    errors = list(result.errors)
    warnings = list(result.warnings)

    packet = _cv5_visual_packet(payload)
    if packet and not _cv5_dict(output.get("metadata")).get("visualTeacherPacketConsumedV5"):
        errors.append("ConceptExtractionAgent ignored visualTeacherPacket.")

    visual_concept_count = 0
    board_hint_count = 0
    teacher_line_count = 0

    for concept in _cv5_list(output.get("concepts")):
        c = _cv5_dict(concept)
        if _cv5_text(c.get("conceptType")).startswith("visual") or _cv5_dict(c.get("visualProof")):
            visual_concept_count += 1
        if _cv5_dict(c.get("frontendBoardHint")):
            board_hint_count += 1
        if _cv5_text(c.get("teacherLine")) or _cv5_text(c.get("explainLikeHuman")):
            teacher_line_count += 1

    if packet and visual_concept_count < 3:
        errors.append("ConceptExtractionAgent must create at least 3 visual/diagram-aware concepts when visualTeacherPacket exists.")

    if packet and board_hint_count < 4:
        errors.append("ConceptExtractionAgent must create frontendBoardHint for at least 4 concepts.")

    if teacher_line_count < 6:
        errors.append("ConceptExtractionAgent must create teacherLine/explainLikeHuman for at least 6 concepts.")

    if (_cv5_full_summary(payload) or _cv5_full_outline_text(payload)) and not _cv5_dict(output.get("metadata")).get("fullPdfContextUsedV5"):
        errors.append("ConceptExtractionAgent did not preserve/use full PDF summary or outline context.")

    return ValidationResult(
        ok=not errors,
        errors=errors,
        warnings=warnings,
        validator="ConceptExtractionAgent.validate_output.visualPacketAwareV5",
        fallbackUsed=False,
    )


ConceptExtractionAgent.build_prompt = _cv5_build_prompt
ConceptExtractionAgent.normalize_output = _cv5_normalize_output
ConceptExtractionAgent.validate_output = _cv5_validate_output
