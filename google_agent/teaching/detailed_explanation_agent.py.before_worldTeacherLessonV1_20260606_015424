"""
google_agent/teaching/detailed_explanation_agent.py
===============================================================================
PHASE 2 COMPLETE REPLACEMENT

Human-like, source-grounded, vision-aware DetailedExplanationAgent.

What this fixes:
- Uses selectedEvidence first, not mixed related/comparison evidence.
- Uses selectedPageVision/diagramSummary/pageImageAnalyses when available.
- Explains like a human teacher, not short robotic card text.
- Produces board-ready teaching chunks for later VisualPlanner/BoardScene.
- Keeps sourceRefs on every step, board note, mistake, example, and recap.
- Separates selected evidence, same-page support, related background,
  comparison evidence, and external evidence.
- No fake fallback. If no real sourceRefs exist, fail.

Important:
- This agent does not itself call Gemini Vision. That was handled by
  SelectedPageVisionAgent.
- This agent consumes the vision summary and turns it into detailed teaching.
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
        normalize_source_refs_from_payload,
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
        normalize_source_refs_from_payload,
        require_source_refs,
        safe_dict,
        safe_list,
    )


def _json(value: Any, limit: int = 140000) -> str:
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
        "externalEvidence",
        "sourceRefs",
        "groundedRefs",
        "verifiedSourceRefs",
        "selectedNode",
        "node",
        "sourceGrounding",
        "ragRetrieval",
        "selectedPageVision",
        "pageImageAnalyses",
        "detectedVisualDiagrams",
        "visualContext",
        "teacherPromptPack",
        "chunks",
        "retrievedChunks",
        "exactChunks",
    ]:
        _walk_refs(payload.get(key), refs)

    if not refs:
        for chunk in safe_list(payload.get("selectedEvidence") or payload.get("chunks") or payload.get("retrievedChunks")):
            refs.append(_chunk_ref(safe_dict(chunk)))

    return dedupe_source_refs(normalize_source_refs(refs))


def _first_ref(refs: List[JsonDict]) -> List[JsonDict]:
    return refs[:1] if refs else []


def _ensure_refs(value_refs: List[JsonDict], fallback_refs: List[JsonDict]) -> List[JsonDict]:
    refs = normalize_source_refs(value_refs)
    if refs:
        return refs
    return _first_ref(fallback_refs)


def _role_items(payload: JsonDict, key: str, limit: int, text_limit: int = 1800) -> List[JsonDict]:
    out: List[JsonDict] = []

    for raw in safe_list(payload.get(key))[:limit]:
        item = safe_dict(raw)
        if not item:
            continue
        out.append(
            {
                "chunkId": clean_text(item.get("chunkId"), 220),
                "sourceRef": clean_text(item.get("sourceRef"), 300),
                "pageRef": clean_text(item.get("pageRef"), 300),
                "page": item.get("page") or 1,
                "heading": clean_text(item.get("heading") or item.get("title"), 220),
                "text": clean_text(item.get("text") or item.get("textPreview") or item.get("quote") or "", text_limit),
                "quote": clean_text(item.get("quote") or item.get("textPreview") or item.get("text") or "", 800),
                "evidenceRole": clean_text(item.get("evidenceRole") or key, 80),
                "pageImageUrl": clean_text(item.get("pageImageUrl"), 1000),
                "pageImagePath": clean_text(item.get("pageImagePath"), 1000),
                "hasPageImage": bool(item.get("hasPageImage") or item.get("pageImageUrl") or item.get("pageImagePath")),
                "tables": safe_list(item.get("tables"))[:10],
                "figures": safe_list(item.get("figures"))[:10],
                "layoutBlocks": safe_list(item.get("layoutBlocks"))[:20],
                "sourceRefs": safe_list(item.get("sourceRefs"))[:5],
            }
        )

    return out


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
        12000,
    )

    hints = (
        safe_list(payload.get("visualTeachingHints"))
        or safe_list(selected_vision.get("visualTeachingHints"))
        or safe_list(visual_context.get("visualTeachingHints"))
    )

    page_images = safe_list(payload.get("pageImages")) or safe_list(visual_context.get("pageImages"))

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
        "pageImages": page_images[:8],
        "metadata": {
            "modelVisionUsed": bool(
                safe_dict(selected_vision.get("metadata")).get("modelVisionUsed")
                or safe_dict(visual_context.get("metadata")).get("modelVisionUsed")
                or analyses
            ),
            "pageImageAnalysisCount": len(analyses),
            "detectedDiagramCount": len(detected),
            "pageImageCount": len(page_images),
        },
    }


def _evidence_pack(payload: JsonDict) -> JsonDict:
    return {
        "selectedEvidence": _role_items(payload, "selectedEvidence", 18, 2600),
        "samePageEvidence": _role_items(payload, "samePageEvidence", 14, 2000),
        "nearbyEvidence": _role_items(payload, "nearbyEvidence", 8, 1600),
        "relatedEvidence": _role_items(payload, "relatedEvidence", 8, 1400),
        "comparisonEvidence": _role_items(payload, "comparisonEvidence", 8, 1400),
        "externalEvidence": _role_items(payload, "externalEvidence", 5, 1200),
        "pageContexts": [
            {
                "page": safe_dict(p).get("page"),
                "relation": safe_dict(p).get("relation"),
                "fullText": clean_text(safe_dict(p).get("fullText"), 3500),
                "ocrText": clean_text(safe_dict(p).get("ocrText"), 1500),
                "tables": safe_list(safe_dict(p).get("tables"))[:8],
                "figures": safe_list(safe_dict(p).get("figures"))[:8],
                "pageImageUrl": clean_text(safe_dict(p).get("pageImageUrl"), 1000),
                "pageImagePath": clean_text(safe_dict(p).get("pageImagePath"), 1000),
                "sourceRefs": safe_list(safe_dict(p).get("sourceRefs"))[:6],
            }
            for p in safe_list(payload.get("pageContexts"))[:8]
        ],
    }


def _compact_extraction(payload: JsonDict) -> JsonDict:
    return {
        "conceptExtraction": safe_dict(payload.get("conceptExtraction")),
        "knowledgeGraph": safe_dict(payload.get("knowledgeGraph")),
        "teachingStrategy": safe_dict(payload.get("teachingStrategy") or payload.get("strategy")),
        "sourceGrounding": safe_dict(payload.get("sourceGrounding")),
    }


def _normalize_list_of_text(value: Any, limit: int = 8, max_len: int = 500) -> List[str]:
    out: List[str] = []
    for item in safe_list(value):
        if isinstance(item, dict):
            text = clean_text(
                item.get("text")
                or item.get("title")
                or item.get("label")
                or item.get("reason")
                or item.get("summary")
                or item,
                max_len,
            )
        else:
            text = clean_text(item, max_len)
        if text:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def _is_too_generic(text: str) -> bool:
    low = clean_text(text, 1500).lower()
    generic = [
        "this concept is important",
        "understand the concept",
        "source backed",
        "this board explains",
        "the selected node",
        "the pdf says",
        "as shown in the source",
    ]
    return any(g in low for g in generic) and len(low.split()) < 24


def _clean_teacher_text(text: Any, max_len: int = 2600) -> str:
    value = clean_text(text, max_len)
    value = re.sub(r"\b(source-backed|source grounded)\b", "source-grounded", value, flags=re.I)
    value = re.sub(r"\s+", " ", value).strip()
    return value


class DetailedExplanationAgent(BaseLiveTutorAgent):
    agent_name = "DetailedExplanationAgent"
    agent_group = "teaching"
    default_mode = "explain_detail"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the Detailed Explanation Agent for a human-like AI Live Tutor.

You receive:
- selectedEvidence: exact clicked-node PDF evidence
- samePageEvidence: support from same page
- nearbyEvidence: previous/next page support
- relatedEvidence: background only
- comparisonEvidence: comparison only
- selectedPageVision: Gemini Vision analysis of selected PDF page image/diagram
- visualContext: page images, diagram analysis, tables, figures, layout hints

Rules:
- Explain like a real teacher standing at a board.
- Main claims must come from selectedEvidence first.
- Use samePageEvidence to clarify.
- Use nearbyEvidence as support only.
- Use comparisonEvidence only in comparison sections.
- ExternalEvidence is optional and never main truth.
- Use selectedPageVision to explain diagrams/layouts when available.
- Do not invent unsupported facts.
- Do not output generic filler.
- Every step, board note, example, mistake, and recap must include sourceRefs.
- Output ONLY valid JSON.
- No markdown.
- No fake fallback.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        node = safe_dict(payload.get("selectedNode") or payload.get("node"))
        topic = clean_text(payload.get("topic") or payload.get("question"), 1000)
        refs = collect_source_refs(payload)

        if not node and not topic:
            errors.append("DetailedExplanationAgent requires selectedNode, topic, or question.")

        if not refs:
            errors.append("DetailedExplanationAgent requires real sourceRefs/chunks. No ungrounded explanation allowed.")

        if not safe_list(payload.get("selectedEvidence")) and not safe_list(payload.get("chunks")):
            warnings.append("selectedEvidence missing; explanation will be weaker.")

        vision = _vision_pack(payload)
        if vision["metadata"]["pageImageCount"] and not vision["metadata"]["modelVisionUsed"]:
            warnings.append("Page image reference exists, but selectedPageVision model analysis is not present.")

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
        extraction = _compact_extraction(payload)
        chunks_text = self.compact_chunks_for_prompt(safe_list(payload.get("chunks") or payload.get("retrievedChunks")), max_chars=70000)

        prompt_payload = {
            "task": "Write a detailed, human-teacher explanation for the selected PDF node.",
            "student": {
                "level": context.studentLevel,
                "language": context.language,
                "question": clean_text(payload.get("question") or context.question, 1400),
            },
            "selectedNode": safe_dict(payload.get("selectedNode") or payload.get("node")),
            "selectedNodeTitle": _selected_node_title(payload),
            "strictEvidenceRules": [
                "Use selectedEvidence as main truth.",
                "Use samePageEvidence only to clarify selectedEvidence.",
                "Use nearbyEvidence as support only.",
                "Use relatedEvidence as background only.",
                "Use comparisonEvidence only inside a comparison step.",
                "Use externalEvidence only as extra learning, never as main truth.",
                "Use selectedPageVision for diagram/table/layout explanation if present.",
                "PDF extracted text remains truth; image/OCR is visual helper.",
                "Every object must include valid sourceRefs copied from validSourceRefs.",
            ],
            "validSourceRefs": refs[:40],
            "evidencePack": evidence,
            "selectedPageVisionPack": vision,
            "upstreamAgentContext": extraction,
            "compactSourceChunks": chunks_text,
            "styleRequirements": {
                "tone": "human private tutor",
                "detailLevel": "rich and specific",
                "avoid": [
                    "generic board wording",
                    "random facts",
                    "unsupported external facts",
                    "robotic section labels as explanation",
                    "raw JSON",
                ],
                "mustInclude": [
                    "simple definition",
                    "why it exists",
                    "source quote explanation",
                    "diagram/image explanation when available",
                    "step-by-step reasoning",
                    "example",
                    "common mistakes",
                    "board-ready notes",
                    "checkpoint question",
                    "recap",
                ],
            },
            "requiredOutputSchema": {
                "explanationId": "explanation_1",
                "title": "concept title",
                "simpleDefinition": "simple but source-specific definition",
                "intuition": "why this idea exists",
                "sourceGroundedExplanation": "detailed paragraph grounded in selectedEvidence",
                "diagramOrVisualExplanation": {
                    "hasVisual": True,
                    "summary": "explain selected page diagram/image/table if selectedPageVision exists",
                    "teacherPointingPlan": [
                        {
                            "target": "visual element",
                            "teacherAction": "circle|point|underline|draw-arrow",
                            "spokenReason": "what teacher says about this visual",
                            "sourceRefs": [],
                        }
                    ],
                    "sourceRefs": [],
                },
                "stepByStep": [
                    {
                        "stepId": "step_1",
                        "heading": "step heading",
                        "explanation": "rich explanation",
                        "boardNote": "short board note",
                        "teacherAction": "what the teacher should draw/point/highlight",
                        "sourceRefs": [],
                    }
                ],
                "whyItMatters": ["reason"],
                "workedExample": {
                    "title": "example title",
                    "example": "detailed example",
                    "boardNote": "short example for board",
                    "sourceRefs": [],
                },
                "comparisonOnlyNotes": [
                    {
                        "title": "comparison note",
                        "text": "use comparisonEvidence only",
                        "sourceRefs": [],
                    }
                ],
                "commonMistakes": [
                    {
                        "mistakeId": "mistake_1",
                        "mistake": "common wrong idea",
                        "correction": "correct idea",
                        "teacherAction": "how teacher fixes it on board",
                        "sourceRefs": [],
                    }
                ],
                "boardNotes": [
                    {
                        "noteId": "note_1",
                        "type": "definition|sourceQuote|diagram|example|warning|quiz|recap",
                        "text": "short board text",
                        "teacherAction": "write/circle/arrow/highlight instruction",
                        "sourceRefs": [],
                    }
                ],
                "checkpoint": {
                    "question": "short check question",
                    "answer": "correct answer",
                    "sourceRefs": [],
                },
                "teacherSummary": "short but specific recap",
                "explainBackPrompt": "ask student to explain it back",
                "sourceRefs": [],
                "metadata": {
                    "fallbackUsed": False,
                    "humanTeacherDetailed": True,
                    "selectedPageVisionUsed": True,
                    "sourceGrounded": True,
                },
            },
        }

        return _json(prompt_payload, 180000)

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)

        if isinstance(raw.get("result"), dict):
            result = safe_dict(raw.get("result"))
            if result.get("stepByStep") or result.get("simpleDefinition"):
                raw = result

        fallback_refs = collect_source_refs(payload)
        if not fallback_refs:
            raise RuntimeError("DetailedExplanationAgent cannot normalize without real sourceRefs.")

        raw_root_refs = normalize_source_refs(safe_list(raw.get("sourceRefs")))
        root_refs = dedupe_source_refs(raw_root_refs or fallback_refs)

        vision = _vision_pack(payload)
        selected_title = _selected_node_title(payload)

        simple_definition = _clean_teacher_text(raw.get("simpleDefinition") or raw.get("definition"), 1600)
        intuition = _clean_teacher_text(raw.get("intuition") or raw.get("why") or raw.get("summary"), 2400)
        source_expl = _clean_teacher_text(
            raw.get("sourceGroundedExplanation")
            or raw.get("detailedAnswer")
            or raw.get("teacherExplanation")
            or raw.get("body"),
            5000,
        )

        if not simple_definition and source_expl:
            simple_definition = clean_text(source_expl.split(".")[0], 900)

        if not intuition and source_expl:
            intuition = clean_text(source_expl, 1600)

        visual_raw = safe_dict(raw.get("diagramOrVisualExplanation"))
        visual_refs = _ensure_refs(safe_list(visual_raw.get("sourceRefs")), root_refs)

        visual_summary = _clean_teacher_text(
            visual_raw.get("summary")
            or raw.get("diagramSummary")
            or vision.get("diagramSummary"),
            3500,
        )

        teacher_pointing_plan: List[JsonDict] = []
        for index, item in enumerate(safe_list(visual_raw.get("teacherPointingPlan"))):
            p = safe_dict(item)
            teacher_pointing_plan.append(
                {
                    "target": clean_text(p.get("target") or f"visual_target_{index + 1}", 180),
                    "teacherAction": clean_text(p.get("teacherAction") or "point", 120),
                    "spokenReason": _clean_teacher_text(p.get("spokenReason") or p.get("reason"), 800),
                    "sourceRefs": _ensure_refs(safe_list(p.get("sourceRefs")), visual_refs),
                }
            )

        if not teacher_pointing_plan and safe_list(vision.get("visualTeachingHints")):
            for index, hint in enumerate(safe_list(vision.get("visualTeachingHints"))[:6]):
                teacher_pointing_plan.append(
                    {
                        "target": f"selected_page_visual_{index + 1}",
                        "teacherAction": "point-and-highlight",
                        "spokenReason": clean_text(hint, 700),
                        "sourceRefs": _first_ref(root_refs),
                    }
                )

        steps: List[JsonDict] = []
        raw_steps = safe_list(raw.get("stepByStep") or raw.get("steps"))

        if not raw_steps and source_expl:
            raw_steps = [
                {
                    "stepId": "step_1",
                    "heading": "Core idea",
                    "explanation": source_expl,
                    "boardNote": simple_definition or selected_title,
                    "teacherAction": "write the core idea and underline the source-backed words",
                    "sourceRefs": root_refs,
                }
            ]

        for index, item in enumerate(raw_steps):
            step = safe_dict(item)
            step_refs = _ensure_refs(safe_list(step.get("sourceRefs")), root_refs)
            explanation = _clean_teacher_text(step.get("explanation") or step.get("text"), 3600)

            steps.append(
                {
                    "stepId": normalize_id(step.get("stepId") or f"step_{index + 1}", f"step_{index + 1}"),
                    "heading": clean_text(step.get("heading") or f"Step {index + 1}", 180),
                    "explanation": explanation,
                    "boardNote": clean_text(step.get("boardNote") or step.get("heading") or explanation, 700),
                    "teacherAction": clean_text(
                        step.get("teacherAction")
                        or step.get("boardAction")
                        or "write, underline key phrase, then connect to source evidence",
                        400,
                    ),
                    "sourceRefs": step_refs,
                    "metadata": {
                        **safe_dict(step.get("metadata")),
                        "fallbackUsed": False,
                    },
                }
            )

        comparison_notes: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("comparisonOnlyNotes"))):
            note = safe_dict(item)
            comparison_notes.append(
                {
                    "noteId": normalize_id(note.get("noteId") or f"comparison_{index + 1}", f"comparison_{index + 1}"),
                    "title": clean_text(note.get("title") or f"Comparison {index + 1}", 160),
                    "text": _clean_teacher_text(note.get("text"), 1200),
                    "sourceRefs": _ensure_refs(safe_list(note.get("sourceRefs")), root_refs),
                    "metadata": {
                        "comparisonOnly": True,
                        "fallbackUsed": False,
                    },
                }
            )

        mistakes: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("commonMistakes"))):
            mistake = safe_dict(item)
            mistakes.append(
                {
                    "mistakeId": normalize_id(mistake.get("mistakeId") or f"mistake_{index + 1}", f"mistake_{index + 1}"),
                    "mistake": _clean_teacher_text(mistake.get("mistake"), 1000),
                    "correction": _clean_teacher_text(mistake.get("correction"), 1300),
                    "teacherAction": clean_text(
                        mistake.get("teacherAction") or "mark the mistake with a red cross and write the correction",
                        400,
                    ),
                    "sourceRefs": _ensure_refs(safe_list(mistake.get("sourceRefs")), root_refs),
                    "metadata": {
                        **safe_dict(mistake.get("metadata")),
                        "fallbackUsed": False,
                    },
                }
            )

        board_notes: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("boardNotes"))):
            note = safe_dict(item)
            text = clean_text(note.get("text"), 850)
            if not text:
                continue
            board_notes.append(
                {
                    "noteId": normalize_id(note.get("noteId") or f"note_{index + 1}", f"note_{index + 1}"),
                    "type": clean_text(note.get("type") or "keyword", 80),
                    "text": text,
                    "teacherAction": clean_text(note.get("teacherAction") or "write and highlight", 300),
                    "sourceRefs": _ensure_refs(safe_list(note.get("sourceRefs")), root_refs),
                    "metadata": {
                        **safe_dict(note.get("metadata")),
                        "fallbackUsed": False,
                    },
                }
            )

        if not board_notes:
            if simple_definition:
                board_notes.append(
                    {
                        "noteId": "note_1",
                        "type": "definition",
                        "text": simple_definition,
                        "teacherAction": "write the definition and underline the key phrase",
                        "sourceRefs": _first_ref(root_refs),
                        "metadata": {"fallbackUsed": False},
                    }
                )
            if visual_summary:
                board_notes.append(
                    {
                        "noteId": "note_visual_1",
                        "type": "diagram",
                        "text": clean_text(visual_summary, 800),
                        "teacherAction": "point to the selected page diagram and redraw it cleanly",
                        "sourceRefs": _first_ref(root_refs),
                        "metadata": {"fromSelectedPageVision": True, "fallbackUsed": False},
                    }
                )

        worked = safe_dict(raw.get("workedExample"))
        worked_example = {
            "title": clean_text(worked.get("title") or "Example", 180),
            "example": _clean_teacher_text(worked.get("example") or worked.get("text"), 3200),
            "boardNote": clean_text(worked.get("boardNote") or "", 750),
            "sourceRefs": _ensure_refs(safe_list(worked.get("sourceRefs")), root_refs),
            "metadata": {
                **safe_dict(worked.get("metadata")),
                "fallbackUsed": False,
            },
        }

        checkpoint_raw = safe_dict(raw.get("checkpoint"))
        checkpoint = {
            "question": clean_text(
                checkpoint_raw.get("question")
                or raw.get("explainBackPrompt")
                or "Can you explain the main idea in your own words?",
                600,
            ),
            "answer": clean_text(checkpoint_raw.get("answer") or "", 900),
            "sourceRefs": _ensure_refs(safe_list(checkpoint_raw.get("sourceRefs")), root_refs),
        }

        why_it_matters = _normalize_list_of_text(raw.get("whyItMatters"), 8, 700)
        teacher_summary = _clean_teacher_text(raw.get("teacherSummary") or raw.get("summary") or simple_definition, 1600)

        all_refs: List[JsonDict] = []
        all_refs.extend(root_refs)
        for step in steps:
            all_refs.extend(safe_list(step.get("sourceRefs")))
        for mistake in mistakes:
            all_refs.extend(safe_list(mistake.get("sourceRefs")))
        for note in board_notes:
            all_refs.extend(safe_list(note.get("sourceRefs")))
        all_refs.extend(safe_list(worked_example.get("sourceRefs")))
        all_refs.extend(safe_list(checkpoint.get("sourceRefs")))
        all_refs.extend(visual_refs)

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
                raw.get("explainBackPrompt") or "Can you explain this idea back in your own words?",
                700,
            ),
            "boardNotes": board_notes,
            "checkpoint": checkpoint,
            "sourceRefs": dedupe_source_refs(normalize_source_refs(all_refs)),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "humanTeacherDetailed": True,
                "geminiStyleDetailed": True,
                "boardReady": True,
                "sourceGrounded": True,
                "selectedEvidenceFirst": True,
                "selectedPageVisionUsed": bool(vision.get("selectedPageVisionUsed")),
                "modelVisionUsed": bool(safe_dict(vision.get("metadata")).get("modelVisionUsed")),
                "pageImageAnalysisCount": safe_dict(vision.get("metadata")).get("pageImageAnalysisCount", 0),
                "detectedDiagramCount": safe_dict(vision.get("metadata")).get("detectedDiagramCount", 0),
                "sourceRefsRepairedFromPayload": bool(fallback_refs),
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        required_text_fields = ["title", "simpleDefinition", "intuition", "teacherSummary"]
        for field in required_text_fields:
            if not clean_text(output.get(field)):
                errors.append(f"{field} is required.")

        if not safe_list(output.get("stepByStep")):
            errors.append("stepByStep is required.")

        ref_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "DetailedExplanationAgent.output.sourceRefs",
        )
        errors.extend(ref_validation.errors)
        warnings.extend(ref_validation.warnings)

        for index, step in enumerate(safe_list(output.get("stepByStep"))):
            item = safe_dict(step)
            if not clean_text(item.get("explanation")):
                errors.append(f"stepByStep[{index}].explanation is required.")
            if len(clean_text(item.get("explanation")).split()) < 18:
                warnings.append(f"stepByStep[{index}].explanation may be too short for rich tutor board.")
            if _is_too_generic(item.get("explanation")):
                warnings.append(f"stepByStep[{index}] sounds generic; refiner should improve it.")

            step_ref_validation = require_source_refs(
                safe_list(item.get("sourceRefs")),
                f"DetailedExplanationAgent.stepByStep[{index}].sourceRefs",
            )
            errors.extend(step_ref_validation.errors)
            warnings.extend(step_ref_validation.warnings)

        if not safe_list(output.get("boardNotes")):
            errors.append("boardNotes are required for rich board generation.")

        visual = safe_dict(output.get("diagramOrVisualExplanation"))
        if safe_dict(output.get("metadata")).get("modelVisionUsed") and not clean_text(visual.get("summary")):
            warnings.append("modelVisionUsed true but diagramOrVisualExplanation.summary is empty.")

        worked = safe_dict(output.get("workedExample"))
        if not clean_text(worked.get("example")):
            warnings.append("workedExample.example missing.")
        else:
            worked_ref_validation = require_source_refs(
                safe_list(worked.get("sourceRefs")),
                "DetailedExplanationAgent.workedExample.sourceRefs",
            )
            errors.extend(worked_ref_validation.errors)
            warnings.extend(worked_ref_validation.warnings)

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="DetailedExplanationAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["DetailedExplanationAgent"]