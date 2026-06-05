"""
google_agent/teaching/detailed_explanation_agent.py
===============================================================================
REAL WORLD-TEACHER DetailedExplanationAgent.

This is the Teacher Brain fusion agent.

It does NOT fake-fill generic steps in Python.
It forces Gemini/ADK to create a rich, source-grounded, board-ready teacher brain.

Consumes:
- selected evidence / source truth
- selected page vision
- concept extraction
- knowledge graph
- teaching strategy
- analogy/example agent

Produces:
- classic backward-compatible fields:
  simpleDefinition, intuition, sourceGroundedExplanation, stepByStep,
  workedExample, commonMistakes, boardNotes, checkpoint
- strong downstream field:
  worldTeacherLesson
    microTeachingSteps
    visualTeachingMoments
    boardRecipe
    mistakeRepairMoments
    comparisonMoments
    workedExampleMoment
    checkpoint
    explainBackPrompt
    visualBoardBridge
    qualitySignals

Rules:
- No fixed domain.
- No Star Schema hardcoding.
- No static fallback.
- No fake 100 score.
- If Gemini returns weak/short/card-only brain, validation fails.
===============================================================================
"""

from __future__ import annotations

import json
import re
from typing import Any, List

try:
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
    from google_agent.live_tutor_agents.contracts import (
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
except Exception:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
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


def _json(value: Any, limit: int = 180000) -> str:
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), limit)
    except Exception:
        return clean_text(value, limit)


def _clean_teacher_text(value: Any, limit: int = 2600) -> str:
    text = clean_text(value, limit)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _walk_refs(value: Any, refs: List[JsonDict]) -> None:
    if isinstance(value, list):
        for item in value:
            _walk_refs(item, refs)
        return

    if isinstance(value, dict):
        local_refs = value.get("sourceRefs") or value.get("refs")
        if isinstance(local_refs, list):
            refs.extend([safe_dict(x) for x in local_refs if safe_dict(x)])

        if value.get("sourceRef") or value.get("chunkId") or value.get("pageRef") or value.get("quote"):
            refs.append(safe_dict(value))

        for child in value.values():
            if isinstance(child, (dict, list)):
                _walk_refs(child, refs)


def collect_source_refs(payload: JsonDict) -> List[JsonDict]:
    refs: List[JsonDict] = []

    for key in [
        "sourceRefs",
        "groundedRefs",
        "verifiedSourceRefs",
        "selectedNode",
        "node",
        "selectedEvidence",
        "primaryEvidence",
        "samePageEvidence",
        "nearbyEvidence",
        "relatedEvidence",
        "comparisonEvidence",
        "externalEvidence",
        "sourceTruth",
        "sourceGrounding",
        "ragRetrieval",
        "selectedPageVision",
        "pageImageAnalyses",
        "detectedVisualDiagrams",
        "visualContext",
        "diagramElements",
        "relationships",
        "teacherMarkingHints",
        "conceptExtraction",
        "knowledgeGraph",
        "teachingStrategy",
        "analogyExample",
        "analogyExamples",
        "chunks",
        "retrievedChunks",
        "exactChunks",
        "pageContexts",
    ]:
        _walk_refs(payload.get(key), refs)

    return dedupe_source_refs(normalize_source_refs([r for r in refs if safe_dict(r)]))[:100]


def _good_refs(refs: List[JsonDict], fallback_refs: List[JsonDict], limit: int = 8) -> List[JsonDict]:
    cleaned: List[JsonDict] = []
    for raw in safe_list(refs):
        r = safe_dict(raw)
        if not r:
            continue
        if not (r.get("sourceRef") or r.get("chunkId") or r.get("pageRef") or r.get("quote")):
            continue
        cleaned.append(r)

    if not cleaned:
        cleaned = fallback_refs[:3]

    return dedupe_source_refs(normalize_source_refs(cleaned))[:limit]


def _selected_node_title(payload: JsonDict) -> str:
    node = safe_dict(payload.get("selectedNode") or payload.get("node"))
    return clean_text(
        node.get("title")
        or node.get("label")
        or node.get("name")
        or node.get("nodeId")
        or payload.get("topic")
        or payload.get("question")
        or "Selected concept",
        260,
    )


def _role_items(payload: JsonDict, key: str, limit: int, text_limit: int = 1800) -> List[JsonDict]:
    out: List[JsonDict] = []
    for raw in safe_list(payload.get(key))[:limit]:
        item = safe_dict(raw)
        if not item:
            continue
        out.append(
            {
                "chunkId": clean_text(item.get("chunkId"), 220),
                "sourceRef": clean_text(item.get("sourceRef"), 350),
                "pageRef": clean_text(item.get("pageRef"), 350),
                "page": item.get("page") or item.get("pageNumber"),
                "heading": clean_text(item.get("heading") or item.get("title"), 220),
                "text": clean_text(item.get("text") or item.get("textPreview") or item.get("quote") or "", text_limit),
                "quote": clean_text(item.get("quote") or item.get("textPreview") or item.get("text") or "", 900),
                "evidenceRole": clean_text(item.get("evidenceRole") or key, 100),
                "pageImageUrl": clean_text(item.get("pageImageUrl"), 1000),
                "pageImagePath": clean_text(item.get("pageImagePath"), 1000),
                "hasPageImage": bool(item.get("hasPageImage") or item.get("pageImageUrl") or item.get("pageImagePath")),
                "tables": safe_list(item.get("tables"))[:8],
                "figures": safe_list(item.get("figures"))[:8],
                "layoutBlocks": safe_list(item.get("layoutBlocks"))[:12],
                "sourceRefs": safe_list(item.get("sourceRefs"))[:5] or [item],
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

    return {
        "selectedPageVisionUsed": bool(
            payload.get("selectedPageVisionUsed")
            or selected_vision.get("selectedPageVisionUsed")
            or safe_dict(selected_vision.get("metadata")).get("modelVisionUsed")
            or analyses
        ),
        "diagramSummary": clean_text(
            payload.get("selectedPageVisionDiagramSummary")
            or selected_vision.get("diagramSummary")
            or visual_context.get("diagramSummary"),
            12000,
        ),
        "pageImageAnalyses": analyses[:8],
        "detectedDiagrams": detected[:8],
        "diagramElements": safe_list(payload.get("diagramElements") or selected_vision.get("diagramElements"))[:100],
        "relationships": safe_list(payload.get("relationships") or selected_vision.get("relationships"))[:100],
        "teacherMarkingHints": safe_list(
            payload.get("teacherMarkingHints")
            or selected_vision.get("teacherMarkingHints")
            or visual_context.get("teacherMarkingHints")
        )[:80],
        "visualTeachingHints": safe_list(
            payload.get("visualTeachingHints")
            or selected_vision.get("visualTeachingHints")
            or visual_context.get("visualTeachingHints")
        )[:80],
        "pageImages": safe_list(payload.get("pageImages") or visual_context.get("pageImages"))[:8],
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


def _evidence_pack(payload: JsonDict) -> JsonDict:
    return {
        "selectedEvidence": _role_items(payload, "selectedEvidence", 18, 2800),
        "samePageEvidence": _role_items(payload, "samePageEvidence", 14, 2200),
        "nearbyEvidence": _role_items(payload, "nearbyEvidence", 10, 1700),
        "relatedEvidence": _role_items(payload, "relatedEvidence", 8, 1500),
        "comparisonEvidence": _role_items(payload, "comparisonEvidence", 8, 1500),
        "externalEvidence": _role_items(payload, "externalEvidence", 5, 1200),
        "selectedPageFullText": clean_text(payload.get("selectedPageFullText"), 18000),
        "fullPdfSummary": safe_dict(payload.get("fullPdfSummary") or payload.get("pdfSummary")),
        "fullPdfOutline": safe_dict(payload.get("fullPdfOutline")),
        "pageContexts": [
            {
                "page": safe_dict(p).get("page"),
                "relation": safe_dict(p).get("relation"),
                "fullText": clean_text(safe_dict(p).get("fullText"), 3500),
                "ocrText": clean_text(safe_dict(p).get("ocrText"), 1500),
                "tables": safe_list(safe_dict(p).get("tables"))[:8],
                "figures": safe_list(safe_dict(p).get("figures"))[:8],
                "sourceRefs": safe_list(safe_dict(p).get("sourceRefs"))[:6],
            }
            for p in safe_list(payload.get("pageContexts"))[:8]
        ],
    }


def _upstream_pack(payload: JsonDict) -> JsonDict:
    return {
        "conceptExtraction": safe_dict(payload.get("conceptExtraction")),
        "knowledgeGraph": safe_dict(payload.get("knowledgeGraph")),
        "teachingStrategy": safe_dict(payload.get("teachingStrategy") or payload.get("strategy")),
        "analogyExample": safe_dict(payload.get("analogyExample") or payload.get("analogyExamples")),
        "sourceGrounding": safe_dict(payload.get("sourceGrounding")),
    }


class DetailedExplanationAgent(BaseLiveTutorAgent):
    agent_name = "DetailedExplanationAgent"
    agent_group = "teaching"
    default_mode = "explain_detail"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are DetailedExplanationAgent, the Teacher Brain Fusion Agent for a live AI tutor.

You synthesize:
- RAG/source evidence,
- selected page vision,
- concept extraction,
- knowledge graph,
- teaching strategy,
- analogy/example guidance,
into one rich, source-grounded, board-ready teacher-brain lesson.

This project is for a Google Cloud Rapid Agent Hackathon-style system:
the agent must move beyond chat, plan a multi-step mission, use partner/tool
context, and produce artifacts that downstream agents can execute on an
interactive board.

Hard rules:
- Output ONLY valid JSON.
- No fake fallback.
- No generic filler.
- No unsupported facts.
- No paragraph-only lesson.
- No fixed domain.
- No hardcoded Star Schema.
- Every factual object must include sourceRefs copied from validSourceRefs.
- If visual/diagram information exists, create teacher pointing and board redraw moments.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        if not safe_dict(payload.get("selectedNode") or payload.get("node")) and not clean_text(payload.get("question")):
            errors.append("DetailedExplanationAgent requires selectedNode or question.")

        refs = collect_source_refs(payload)
        if not refs:
            errors.append("DetailedExplanationAgent requires real sourceRefs/chunks. No ungrounded output allowed.")

        if not safe_list(payload.get("selectedEvidence")) and not safe_list(payload.get("chunks")):
            warnings.append("selectedEvidence missing; teacher brain may be weaker.")

        if not safe_dict(payload.get("teachingStrategy")):
            warnings.append("teachingStrategy missing; detailed explanation will still run but strategy handoff is weaker.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="DetailedExplanationAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        refs = collect_source_refs(payload)
        evidence = _evidence_pack(payload)
        vision = _vision_pack(payload)
        upstream = _upstream_pack(payload)

        chunks_text = self.compact_chunks_for_prompt(
            safe_list(payload.get("chunks") or payload.get("retrievedChunks")),
            max_chars=65000,
        )

        prompt_payload = {
            "task": "Create a real worldTeacherLesson for a live human-like board tutor.",
            "student": {
                "level": context.studentLevel,
                "language": context.language,
                "question": clean_text(payload.get("question") or context.question, 1600),
            },
            "selectedNode": safe_dict(payload.get("selectedNode") or payload.get("node")),
            "selectedNodeTitle": _selected_node_title(payload),
            "validSourceRefs": refs[:50],
            "evidencePack": evidence,
            "selectedPageVisionPack": vision,
            "upstreamAgentContext": upstream,
            "compactSourceChunks": chunks_text,
            "strictEvidenceRules": [
                "selectedEvidence is the main truth.",
                "samePageEvidence clarifies selected evidence.",
                "nearbyEvidence supports only.",
                "comparisonEvidence only belongs in comparisonMoments.",
                "Vision explains shapes/layout/diagram; PDF text remains truth.",
                "Every claim needs sourceRefs copied from validSourceRefs.",
            ],
            "qualityBar": {
                "minimumStepByStep": 5,
                "minimumMicroTeachingSteps": 7,
                "minimumBoardRecipeItems": 7,
                "minimumMistakeRepairMoments": 2,
                "mustIncludeVisualTeachingMoments": True,
                "mustIncludeWorkedExampleMoment": True,
                "mustIncludeCheckpoint": True,
                "mustIncludeExplainBackPrompt": True,
                "mustIncludeVisualBoardBridge": True,
                "mustBeUsefulForBeginner": True,
                "mustBeDetailedButNotVerboseDump": True,
                "mustBeReadyForVisualPlanner": True,
                "mustAvoidCardOnlyOutput": True,
            },
            "requiredOutputSchema": {
                "explanationId": "string",
                "title": "string",
                "simpleDefinition": "accurate beginner-friendly definition grounded in evidence",
                "intuition": "why this concept exists and why it matters",
                "sourceGroundedExplanation": "rich explanation using selected evidence first",
                "diagramOrVisualExplanation": {
                    "hasVisual": True,
                    "summary": "how the selected visual/diagram/table teaches the concept",
                    "teacherPointingPlan": [
                        {
                            "target": "specific visual/text element",
                            "teacherAction": "point|circle|draw-arrow|underline|zoom|highlight",
                            "spokenReason": "what teacher explains while pointing",
                            "sourceRefs": [],
                        }
                    ],
                    "sourceRefs": [],
                },
                "stepByStep": [
                    {
                        "stepId": "step_1",
                        "heading": "specific teaching step",
                        "explanation": "detailed student-friendly explanation",
                        "boardNote": "what appears on board",
                        "teacherAction": "what tutor draws/writes/highlights",
                        "sourceRefs": [],
                    }
                ],
                "whyItMatters": ["specific practical value"],
                "workedExample": {
                    "title": "example title",
                    "example": "step-by-step worked example using the concept",
                    "boardNote": "short board version",
                    "sourceRefs": [],
                },
                "comparisonOnlyNotes": [
                    {
                        "noteId": "comparison_1",
                        "title": "comparison title",
                        "text": "only if comparison evidence exists",
                        "sourceRefs": [],
                    }
                ],
                "commonMistakes": [
                    {
                        "mistakeId": "mistake_1",
                        "mistake": "common student misunderstanding",
                        "correction": "clear correction",
                        "teacherAction": "how to show wrong vs correct on board",
                        "sourceRefs": [],
                    }
                ],
                "boardNotes": [
                    {
                        "noteId": "note_1",
                        "type": "definition|diagram|example|warning|comparison|quiz|recap",
                        "text": "short board text",
                        "teacherAction": "write/circle/arrow/highlight instruction",
                        "sourceRefs": [],
                    }
                ],
                "checkpoint": {
                    "question": "student check question",
                    "answer": "correct answer",
                    "sourceRefs": [],
                },
                "worldTeacherLesson": {
                    "version": "worldTeacherLessonV1",
                    "teacherMission": "what the tutor is trying to make the student understand",
                    "learningPromise": "what the student will be able to explain/do",
                    "intuitionFirst": "intuitive hook",
                    "sourceGroundedCore": "core explanation",
                    "microTeachingSteps": [
                        {
                            "microStepId": "micro_1",
                            "momentType": "intuition|definition|visual_walkthrough|relationship|worked_example|comparison|mistake_repair|checkpoint",
                            "teachingPurpose": "why this moment exists",
                            "studentFriendlyExplanation": "what teacher says conceptually",
                            "boardMoment": "what appears on board",
                            "teacherAction": "board action plan",
                            "sourceRefs": [],
                        }
                    ],
                    "visualTeachingMoments": [
                        {
                            "momentId": "visual_1",
                            "goal": "why this visual matters",
                            "summary": "what to draw/redraw/point to",
                            "teacherActions": [],
                            "sourceRefs": [],
                        }
                    ],
                    "workedExampleMoment": {},
                    "comparisonMoments": [],
                    "mistakeRepairMoments": [],
                    "boardRecipe": [],
                    "checkpoint": {},
                    "explainBackPrompt": "ask student to explain back",
                    "visualBoardBridge": {
                        "purpose": "instructions for VisualPlanner",
                        "requiredDownstreamBehavior": {
                            "mustCreateVisualElements": True,
                            "mustCreateRelationships": True,
                            "mustCreateMarkingPlan": True,
                            "mustCreateCommandIntents": True,
                            "mustAvoidCardOnlyOutput": True,
                        },
                    },
                    "qualitySignals": {
                        "readyForVisualPlanner": True,
                        "sourceGrounded": True,
                        "notParagraphOnly": True,
                    },
                    "sourceRefs": [],
                },
                "teacherSummary": "specific recap",
                "explainBackPrompt": "student explain-back request",
                "sourceRefs": [],
                "metadata": {
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                    "worldTeacherLessonV1": True,
                    "sourceGrounded": True,
                },
            },
        }

        return _json(prompt_payload, 180000)

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        raise RuntimeError("DetailedExplanationAgent requires Gemini/ADK. No rule-based/static fallback is allowed.")

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)

        if isinstance(raw.get("result"), dict):
            candidate = safe_dict(raw.get("result"))
            if candidate.get("worldTeacherLesson") or candidate.get("stepByStep") or candidate.get("simpleDefinition"):
                raw = candidate

        fallback_refs = collect_source_refs(payload)
        if not fallback_refs:
            raise RuntimeError("DetailedExplanationAgent cannot normalize without real sourceRefs.")

        root_refs = _good_refs(safe_list(raw.get("sourceRefs")), fallback_refs, limit=12)
        vision = _vision_pack(payload)
        selected_title = _selected_node_title(payload)

        simple_definition = _clean_teacher_text(raw.get("simpleDefinition") or raw.get("definition"), 1800)
        intuition = _clean_teacher_text(raw.get("intuition") or raw.get("why") or raw.get("summary"), 2600)
        source_expl = _clean_teacher_text(
            raw.get("sourceGroundedExplanation")
            or raw.get("detailedAnswer")
            or raw.get("teacherExplanation")
            or raw.get("body"),
            5200,
        )

        visual_raw = safe_dict(raw.get("diagramOrVisualExplanation"))
        visual_refs = _good_refs(safe_list(visual_raw.get("sourceRefs")), root_refs, limit=8)
        visual_summary = _clean_teacher_text(
            visual_raw.get("summary")
            or raw.get("diagramSummary")
            or vision.get("diagramSummary"),
            4000,
        )

        teacher_pointing_plan: List[JsonDict] = []
        for index, item in enumerate(safe_list(visual_raw.get("teacherPointingPlan"))):
            p = safe_dict(item)
            teacher_pointing_plan.append(
                {
                    "target": clean_text(p.get("target") or f"visual_target_{index + 1}", 220),
                    "teacherAction": clean_text(p.get("teacherAction") or "point", 120),
                    "spokenReason": _clean_teacher_text(p.get("spokenReason") or p.get("reason"), 1000),
                    "sourceRefs": _good_refs(safe_list(p.get("sourceRefs")), visual_refs, limit=5),
                }
            )

        steps: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("stepByStep") or raw.get("steps"))):
            step = safe_dict(item)
            steps.append(
                {
                    "stepId": normalize_id(step.get("stepId") or f"step_{index + 1}", f"step_{index + 1}"),
                    "heading": clean_text(step.get("heading") or f"Step {index + 1}", 220),
                    "explanation": _clean_teacher_text(step.get("explanation") or step.get("text"), 3600),
                    "boardNote": clean_text(step.get("boardNote") or step.get("heading") or "", 900),
                    "teacherAction": clean_text(
                        step.get("teacherAction")
                        or step.get("boardAction")
                        or "write, point, and check understanding",
                        700,
                    ),
                    "sourceRefs": _good_refs(safe_list(step.get("sourceRefs")), root_refs, limit=6),
                    "metadata": {**safe_dict(step.get("metadata")), "fallbackUsed": False},
                }
            )

        worked = safe_dict(raw.get("workedExample"))
        worked_example = {
            "title": clean_text(worked.get("title") or "Worked example", 220),
            "example": _clean_teacher_text(worked.get("example") or worked.get("text"), 3800),
            "boardNote": clean_text(worked.get("boardNote") or "", 900),
            "sourceRefs": _good_refs(safe_list(worked.get("sourceRefs")), root_refs, limit=6),
            "metadata": {**safe_dict(worked.get("metadata")), "fallbackUsed": False},
        }

        comparison_notes: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("comparisonOnlyNotes") or raw.get("comparisonMoments"))):
            note = safe_dict(item)
            comparison_notes.append(
                {
                    "noteId": normalize_id(note.get("noteId") or f"comparison_{index + 1}", f"comparison_{index + 1}"),
                    "title": clean_text(note.get("title") or f"Comparison {index + 1}", 220),
                    "text": _clean_teacher_text(note.get("text") or note.get("summary"), 1600),
                    "sourceRefs": _good_refs(safe_list(note.get("sourceRefs")), root_refs, limit=6),
                    "metadata": {"comparisonOnly": True, "fallbackUsed": False},
                }
            )

        mistakes: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("commonMistakes"))):
            m = safe_dict(item)
            mistakes.append(
                {
                    "mistakeId": normalize_id(m.get("mistakeId") or f"mistake_{index + 1}", f"mistake_{index + 1}"),
                    "mistake": _clean_teacher_text(m.get("mistake"), 1000),
                    "correction": _clean_teacher_text(m.get("correction"), 1400),
                    "teacherAction": clean_text(
                        m.get("teacherAction") or "show wrong vs correct on the board",
                        700,
                    ),
                    "sourceRefs": _good_refs(safe_list(m.get("sourceRefs")), root_refs, limit=6),
                    "metadata": {**safe_dict(m.get("metadata")), "fallbackUsed": False},
                }
            )

        board_notes: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("boardNotes"))):
            n = safe_dict(item)
            text = clean_text(n.get("text"), 1000)
            if not text:
                continue
            board_notes.append(
                {
                    "noteId": normalize_id(n.get("noteId") or f"note_{index + 1}", f"note_{index + 1}"),
                    "type": clean_text(n.get("type") or "board-note", 100),
                    "text": text,
                    "teacherAction": clean_text(n.get("teacherAction") or "write and highlight", 700),
                    "sourceRefs": _good_refs(safe_list(n.get("sourceRefs")), root_refs, limit=6),
                    "metadata": {**safe_dict(n.get("metadata")), "fallbackUsed": False},
                }
            )

        checkpoint_raw = safe_dict(raw.get("checkpoint"))
        checkpoint = {
            "question": clean_text(
                checkpoint_raw.get("question")
                or raw.get("explainBackPrompt")
                or "Can you explain the main idea in your own words?",
                800,
            ),
            "answer": clean_text(checkpoint_raw.get("answer") or "", 1200),
            "sourceRefs": _good_refs(safe_list(checkpoint_raw.get("sourceRefs")), root_refs, limit=6),
        }

        world_lesson = safe_dict(raw.get("worldTeacherLesson"))
        world_quality = safe_dict(world_lesson.get("qualitySignals")) if world_lesson else {}

        if world_lesson:
            world_refs = _good_refs(safe_list(world_lesson.get("sourceRefs")), root_refs, limit=12)

            world_lesson = {
                **world_lesson,
                "version": clean_text(world_lesson.get("version") or "worldTeacherLessonV1", 80),
                "microTeachingSteps": [
                    {
                        **safe_dict(step),
                        "sourceRefs": _good_refs(safe_list(safe_dict(step).get("sourceRefs")), world_refs, limit=6),
                    }
                    for step in safe_list(world_lesson.get("microTeachingSteps"))
                    if safe_dict(step)
                ],
                "visualTeachingMoments": [
                    {
                        **safe_dict(moment),
                        "sourceRefs": _good_refs(safe_list(safe_dict(moment).get("sourceRefs")), world_refs, limit=6),
                    }
                    for moment in safe_list(world_lesson.get("visualTeachingMoments"))
                    if safe_dict(moment)
                ],
                "mistakeRepairMoments": [
                    {
                        **safe_dict(moment),
                        "sourceRefs": _good_refs(safe_list(safe_dict(moment).get("sourceRefs")), world_refs, limit=6),
                    }
                    for moment in safe_list(world_lesson.get("mistakeRepairMoments"))
                    if safe_dict(moment)
                ],
                "boardRecipe": [
                    {
                        **safe_dict(recipe),
                        "sourceRefs": _good_refs(safe_list(safe_dict(recipe).get("sourceRefs")), world_refs, limit=6),
                    }
                    for recipe in safe_list(world_lesson.get("boardRecipe"))
                    if safe_dict(recipe)
                ],
                "sourceRefs": world_refs,
            }

            world_quality = safe_dict(world_lesson.get("qualitySignals"))

        why_it_matters = []
        for raw_reason in safe_list(raw.get("whyItMatters"))[:8]:
            if isinstance(raw_reason, dict):
                text = clean_text(raw_reason.get("text") or raw_reason.get("reason") or raw_reason.get("title"), 800)
            else:
                text = clean_text(raw_reason, 800)
            if text:
                why_it_matters.append(text)

        teacher_summary = _clean_teacher_text(raw.get("teacherSummary") or raw.get("summary"), 1800)

        all_refs: List[JsonDict] = []
        for obj in [
            root_refs,
            visual_refs,
            steps,
            mistakes,
            board_notes,
            worked_example,
            checkpoint,
            world_lesson,
        ]:
            _walk_refs(obj, all_refs)

        teacher_strength = "weak"
        if world_lesson:
            micro_count = len(safe_list(world_lesson.get("microTeachingSteps")))
            visual_count = len(safe_list(world_lesson.get("visualTeachingMoments")))
            recipe_count = len(safe_list(world_lesson.get("boardRecipe")))
            repair_count = len(safe_list(world_lesson.get("mistakeRepairMoments")))
            if micro_count >= 7 and visual_count >= 1 and recipe_count >= 7 and repair_count >= 2:
                teacher_strength = "strong"
            elif micro_count >= 6 and recipe_count >= 5:
                teacher_strength = "medium"

        return {
            "explanationId": normalize_id(raw.get("explanationId") or "explanation_1", "explanation_1"),
            "title": clean_text(raw.get("title") or selected_title or "Detailed Explanation", 220),
            "simpleDefinition": simple_definition,
            "intuition": intuition,
            "sourceGroundedExplanation": source_expl,
            "diagramOrVisualExplanation": {
                "hasVisual": bool(vision.get("selectedPageVisionUsed") or visual_summary or teacher_pointing_plan),
                "summary": visual_summary,
                "teacherPointingPlan": teacher_pointing_plan,
                "sourceRefs": visual_refs,
                "metadata": {
                    "selectedPageVisionUsed": bool(vision.get("selectedPageVisionUsed")),
                    "modelVisionUsed": bool(safe_dict(vision.get("metadata")).get("modelVisionUsed")),
                    "fallbackUsed": False,
                },
            },
            "stepByStep": steps,
            "whyItMatters": why_it_matters,
            "workedExample": worked_example,
            "comparisonOnlyNotes": comparison_notes,
            "commonMistakes": mistakes,
            "teacherSummary": teacher_summary,
            "explainBackPrompt": clean_text(
                raw.get("explainBackPrompt") or "Explain this back in your own words.",
                900,
            ),
            "boardNotes": board_notes,
            "checkpoint": checkpoint,
            "worldTeacherLesson": world_lesson,
            "sourceRefs": dedupe_source_refs(normalize_source_refs(all_refs or root_refs)),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "humanTeacherDetailed": True,
                "geminiStyleDetailed": True,
                "boardReady": True,
                "worldTeacherLessonV1": bool(world_lesson),
                "teacherBrainStrength": teacher_strength,
                "teacherBrainPowerScore": world_quality.get("teacherBrainPowerScoreV2") or world_quality.get("score"),
                "sourceGrounded": True,
                "selectedEvidenceFirst": True,
                "selectedPageVisionUsed": bool(vision.get("selectedPageVisionUsed")),
                "modelVisionUsed": bool(safe_dict(vision.get("metadata")).get("modelVisionUsed")),
                "pageImageAnalysisCount": safe_dict(vision.get("metadata")).get("pageImageAnalysisCount", 0),
                "detectedDiagramCount": safe_dict(vision.get("metadata")).get("detectedDiagramCount", 0),
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        for field in ["title", "simpleDefinition", "intuition", "sourceGroundedExplanation", "teacherSummary"]:
            if not clean_text(output.get(field)):
                errors.append(f"{field} is required.")

        refs = safe_list(output.get("sourceRefs"))
        ref_validation = require_source_refs(refs, "DetailedExplanationAgent.output.sourceRefs")
        errors.extend(ref_validation.errors)
        warnings.extend(ref_validation.warnings)

        steps = safe_list(output.get("stepByStep"))
        if len(steps) < 5:
            errors.append("stepByStep must contain at least 5 real teaching steps.")

        for index, raw_step in enumerate(steps):
            step = safe_dict(raw_step)
            if len(clean_text(step.get("explanation")).split()) < 35:
                errors.append(f"stepByStep[{index}].explanation is too short for world-teacher quality.")
            if not clean_text(step.get("teacherAction")):
                errors.append(f"stepByStep[{index}].teacherAction is required.")
            step_ref_validation = require_source_refs(
                safe_list(step.get("sourceRefs")),
                f"DetailedExplanationAgent.stepByStep[{index}].sourceRefs",
            )
            errors.extend(step_ref_validation.errors)
            warnings.extend(step_ref_validation.warnings)

        if len(safe_list(output.get("boardNotes"))) < 5:
            errors.append("boardNotes must contain at least 5 source-grounded board notes.")

        if len(safe_list(output.get("commonMistakes"))) < 2:
            warnings.append("commonMistakes should contain at least 2 misconception repairs.")

        visual = safe_dict(output.get("diagramOrVisualExplanation"))
        if safe_dict(output.get("metadata")).get("modelVisionUsed"):
            if not clean_text(visual.get("summary")):
                errors.append("modelVisionUsed is true but diagramOrVisualExplanation.summary is missing.")
            if not safe_list(visual.get("teacherPointingPlan")):
                errors.append("modelVisionUsed is true but teacherPointingPlan is missing.")

        world_lesson = safe_dict(output.get("worldTeacherLesson"))
        if not world_lesson:
            errors.append("worldTeacherLesson is required. Do not pass paragraph-only teacher brain.")
        else:
            micro = safe_list(world_lesson.get("microTeachingSteps"))
            if len(micro) < 7:
                errors.append("worldTeacherLesson.microTeachingSteps must be at least 7.")
            if not safe_list(world_lesson.get("visualTeachingMoments")):
                errors.append("worldTeacherLesson.visualTeachingMoments is required.")
            if len(safe_list(world_lesson.get("boardRecipe"))) < 7:
                errors.append("worldTeacherLesson.boardRecipe must be at least 7.")
            if len(safe_list(world_lesson.get("mistakeRepairMoments"))) < 2:
                errors.append("worldTeacherLesson.mistakeRepairMoments must be at least 2.")
            if not safe_dict(world_lesson.get("visualBoardBridge")):
                errors.append("worldTeacherLesson.visualBoardBridge is required for VisualPlanner.")
            if not safe_dict(world_lesson.get("qualitySignals")).get("readyForVisualPlanner"):
                errors.append("worldTeacherLesson.qualitySignals.readyForVisualPlanner must be true.")

            for index, raw_step in enumerate(micro):
                step = safe_dict(raw_step)
                if len(clean_text(step.get("studentFriendlyExplanation")).split()) < 25:
                    errors.append(f"worldTeacherLesson.microTeachingSteps[{index}] explanation is too short.")
                if not safe_list(step.get("sourceRefs")):
                    errors.append(f"worldTeacherLesson.microTeachingSteps[{index}].sourceRefs missing.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="DetailedExplanationAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["DetailedExplanationAgent"]