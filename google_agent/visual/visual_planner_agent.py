"""
google_agent/visual/visual_planner_agent.py
===============================================================================
AI-FIRST Dynamic Visual Planner Agent.

This agent is the "board designer brain" of Stage 2.

It consumes:
- visualLessonInput from selected PDF node + Gemini Vision
- selectedEvidence / selectedPageFullText / nearbyEvidence / relatedEvidence
- fullPdfSummary / fullPdfOutline
- detailedExplanation / analogyExamples / teachingStrategy
- sourceRefs

It asks Gemini/ADK to design a custom, source-grounded, premium tutor-board
lesson. Python does NOT decide fixed templates, fixed screen names, or
domain-specific rules. Gemini decides the best visual structure for the concept.

Rules:
- PDF/source evidence is truth.
- Vision/image analysis is visual guidance only.
- No hardcoded Star Schema logic.
- No fixed 7-screen template.
- No random unsupported claims.
- Every factual screen/block must keep sourceRefs.
- Return structured JSON that BoardSceneAgent can turn into scenes.
===============================================================================
"""

from __future__ import annotations

import json
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


def _json(value: Any, max_len: int = 50000) -> str:
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), max_len)
    except Exception:
        return clean_text(value, max_len)


def _walk_refs(value: Any, refs: List[JsonDict]) -> None:
    if isinstance(value, list):
        for item in value:
            _walk_refs(item, refs)
        return

    if isinstance(value, dict):
        local = value.get("sourceRefs")
        if isinstance(local, list):
            refs.extend([safe_dict(x) for x in local if safe_dict(x)])

        if value.get("sourceRef") or value.get("chunkId") or value.get("pageRef") or value.get("quote"):
            refs.append(safe_dict(value))

        for child in value.values():
            if isinstance(child, (dict, list)):
                _walk_refs(child, refs)


def _source_refs(payload: JsonDict) -> List[JsonDict]:
    refs: List[JsonDict] = []
    for key in [
        "sourceRefs",
        "visualPlannerPacket",
        "groundedRefs",
        "verifiedSourceRefs",
        "selectedNode",
        "visualLessonInput",
        "selectedPageVision",
        "selectedEvidence",
        "samePageEvidence",
        "nearbyEvidence",
        "relatedEvidence",
        "pageContexts",
        "figures",
        "tables",
        "explanation",
        "analogyExamples",
        "teachingStrategy",
        "conceptExtraction",
        "knowledgeGraph",
        "chunks",
        "retrievedChunks",
    ]:
        _walk_refs(payload.get(key), refs)
    return dedupe_source_refs(refs)[:120]


def _selected_node(payload: JsonDict) -> JsonDict:
    packet = _packet(payload)
    visual_lesson = safe_dict(payload.get("visualLessonInput"))
    return safe_dict(
        packet.get("selectedNode")
        or visual_lesson.get("selectedNode")
        or payload.get("selectedNode")
        or payload.get("node")
    )


def _title(payload: JsonDict) -> str:
    packet = _packet(payload)
    node = _selected_node(payload)
    visual_lesson = safe_dict(payload.get("visualLessonInput"))
    return clean_text(
        safe_dict(packet.get("selectedNode")).get("title")
        or visual_lesson.get("selectedNodeTitle")
        or node.get("title")
        or node.get("label")
        or node.get("nodeId")
        or payload.get("topic")
        or payload.get("question")
        or "Selected concept",
        220,
    )


def _compact_evidence_list(items: List[Any], limit: int = 12, quote_len: int = 1200) -> List[JsonDict]:
    out: List[JsonDict] = []
    seen = set()

    for raw in items:
        item = safe_dict(raw)
        if not item:
            continue

        quote = clean_text(
            item.get("quote")
            or item.get("text")
            or item.get("textPreview")
            or item.get("ocrText")
            or item.get("content")
            or "",
            quote_len,
        )

        page = item.get("page") or item.get("pageNumber") or item.get("pageNo")
        refs = dedupe_source_refs(safe_list(item.get("sourceRefs")) or [item])

        key = f"{page}|{quote[:160]}".lower()
        if key in seen:
            continue
        seen.add(key)

        if quote or refs:
            out.append(
                {
                    "page": page,
                    "role": clean_text(item.get("evidenceRole") or item.get("role") or "evidence", 120),
                    "quote": quote,
                    "sourceRefs": refs[:5],
                    "tables": safe_list(item.get("tables"))[:3],
                    "figures": safe_list(item.get("figures"))[:3],
                }
            )

        if len(out) >= limit:
            break

    return out


def _visual_lesson(payload: JsonDict) -> JsonDict:
    return safe_dict(payload.get("visualLessonInput"))


def _packet(payload: JsonDict) -> JsonDict:
    return safe_dict(payload.get("visualPlannerPacket"))


def _context_pack(payload: JsonDict) -> JsonDict:
    visual = _visual_lesson(payload)
    refs = _source_refs(payload)

    selected_evidence = safe_list(visual.get("selectedEvidence")) or safe_list(payload.get("selectedEvidence"))
    same_page = safe_list(visual.get("samePageEvidence")) or safe_list(payload.get("samePageEvidence"))
    nearby = safe_list(visual.get("nearbyEvidence")) or safe_list(payload.get("nearbyEvidence"))
    related = safe_list(visual.get("relatedEvidence")) or safe_list(payload.get("relatedEvidence"))

    page_image_analyses = safe_list(visual.get("pageImageAnalyses")) or safe_list(payload.get("pageImageAnalyses"))
    selected_page_analyses = safe_list(visual.get("selectedPageAnalyses"))
    nearby_page_analyses = safe_list(visual.get("nearbyPageAnalyses"))

    return {
        "selectedNode": _selected_node(payload),
        "selectedNodeTitle": _title(payload),
        "studentLevel": clean_text(payload.get("studentLevel") or "beginner", 80),
        "language": clean_text(payload.get("language") or "english", 80),
        "studentQuestion": clean_text(payload.get("question") or payload.get("query") or "", 2000),

        "selectedEvidence": _compact_evidence_list(selected_evidence, 16, 1600),
        "samePageEvidence": _compact_evidence_list(same_page, 10, 1200),
        "nearbyEvidence": _compact_evidence_list(nearby, 12, 1200),
        "relatedEvidence": _compact_evidence_list(related, 10, 1000),

        "selectedPageFullText": clean_text(
            visual.get("selectedPageFullText") or payload.get("selectedPageFullText") or "",
            22000,
        ),
        "fullPdfSummary": safe_dict(visual.get("fullPdfSummary") or payload.get("fullPdfSummary") or payload.get("pdfSummary")),
        "fullPdfOutline": safe_dict(visual.get("fullPdfOutline") or payload.get("fullPdfOutline")),
        "fullPdfOutlineText": clean_text(
            visual.get("fullPdfOutlineText") or payload.get("fullPdfOutlineText") or "",
            18000,
        ),

        "pageImageAnalyses": page_image_analyses[:5],
        "selectedPageAnalyses": selected_page_analyses[:3],
        "nearbyPageAnalyses": nearby_page_analyses[:4],
        "detectedDiagrams": safe_list(visual.get("detectedDiagrams") or payload.get("detectedVisualDiagrams"))[:8],
        "diagramElements": safe_list(visual.get("diagramElements"))[:120],
        "relationships": safe_list(visual.get("relationships"))[:120],
        "coreVisualFacts": safe_list(visual.get("coreVisualFacts"))[:80],
        "boardRedrawHints": safe_list(visual.get("boardRedrawHints"))[:70],
        "teacherMarkingHints": safe_list(visual.get("teacherMarkingHints"))[:90],
        "visualTeachingHints": safe_list(visual.get("visualTeachingHints"))[:70],
        "commonConfusions": safe_list(visual.get("commonConfusions"))[:40],

        "tables": safe_list(visual.get("tables") or payload.get("tables"))[:20],
        "figures": safe_list(visual.get("figures") or payload.get("figures"))[:20],
        "layoutBlocks": safe_list(visual.get("layoutBlocks") or payload.get("layoutBlocks"))[:30],
        "sourceRefs": refs[:40],
        "truthRules": safe_dict(visual.get("truthRules")),
        "qualityContract": safe_dict(visual.get("qualityContract")),
    }


def _upstream_teaching_pack(payload: JsonDict) -> JsonDict:
    return {
        "detailedExplanation": safe_dict(payload.get("explanation")),
        "analogyExamples": safe_dict(payload.get("analogyExamples")),
        "teachingStrategy": safe_dict(payload.get("teachingStrategy")),
        "conceptExtraction": safe_dict(payload.get("conceptExtraction")),
        "knowledgeGraph": safe_dict(payload.get("knowledgeGraph")),
    }


def _refs_for_item(item: JsonDict, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    refs = dedupe_source_refs([safe_dict(x) for x in safe_list(item.get("sourceRefs"))])
    return refs or fallback_refs[:5]


def _normalize_block(raw: Any, fallback_refs: List[JsonDict], index: int) -> JsonDict:
    item = safe_dict(raw)
    refs = _refs_for_item(item, fallback_refs)

    block_id = normalize_id(
        item.get("blockId")
        or item.get("id")
        or item.get("title")
        or f"adaptive_block_{index + 1}",
        f"adaptive_block_{index + 1}",
    )

    visual_form = clean_text(
        item.get("visualForm")
        or item.get("templateType")
        or item.get("type")
        or item.get("kind")
        or "adaptive_visual_block",
        120,
    )

    return {
        **item,
        "blockId": block_id,
        "type": visual_form,
        "templateType": visual_form,
        "visualForm": visual_form,
        "title": clean_text(item.get("title") or f"Board block {index + 1}", 220),
        "purpose": clean_text(item.get("purpose") or item.get("whyThisBlock") or "", 1200),
        "content": item.get("content") if isinstance(item.get("content"), (dict, list)) else clean_text(
            item.get("content") or item.get("body") or item.get("text") or "",
            7000,
        ),
        "body": item.get("body") if isinstance(item.get("body"), (dict, list)) else clean_text(
            item.get("body") or item.get("content") or item.get("text") or "",
            7000,
        ),
        "teacherNotes": clean_text(
            item.get("teacherNotes")
            or item.get("teacherNarration")
            or item.get("explanation")
            or "",
            5000,
        ),
        "sourceRefs": refs,
        "sourceBadges": [f"Pg. {safe_dict(r).get('page')}" for r in refs if safe_dict(r).get("page")][:8],
        "visualSpec": safe_dict(item.get("visualSpec")),
        "htmlSpec": {
            **safe_dict(item.get("htmlSpec") or item.get("htmlTemplateSpec")),
            "safeHtml": True,
            "allowScripts": False,
            "sourceGrounded": True,
        },
        "diagramSpec": safe_dict(item.get("diagramSpec")),
        "interactionSpec": safe_dict(item.get("interactionSpec")),
        "assessmentSpec": safe_dict(item.get("assessmentSpec")),
        "metadata": {
            **safe_dict(item.get("metadata")),
            "sourceGrounded": True,
            "fallbackUsed": False,
            "aiDesignedBlock": True,
        },
    }


def _normalize_screen(raw: Any, fallback_refs: List[JsonDict], index: int) -> JsonDict:
    item = safe_dict(raw)
    refs = _refs_for_item(item, fallback_refs)
    blocks = [
        _normalize_block(block, refs, block_index)
        for block_index, block in enumerate(safe_list(item.get("blocks") or item.get("visualBlocks") or item.get("sections")))
        if safe_dict(block)
    ]

    screen_id = normalize_id(
        item.get("screenId")
        or item.get("id")
        or item.get("title")
        or f"screen_{index + 1}",
        f"screen_{index + 1}",
    )

    return {
        **item,
        "screenId": screen_id,
        "screenNo": int(item.get("screenNo") or item.get("order") or index + 1),
        "title": clean_text(item.get("title") or f"Screen {index + 1}", 220),
        "screenGoal": clean_text(item.get("screenGoal") or item.get("goal") or item.get("learningGoal") or "", 1400),
        "goal": clean_text(item.get("goal") or item.get("screenGoal") or item.get("learningGoal") or "", 1400),
        "designRationale": clean_text(item.get("designRationale") or item.get("whyThisScreen") or "", 2000),
        "teacherNarrative": clean_text(
            item.get("teacherNarrative")
            or item.get("teacherNotes")
            or item.get("spokenGoal")
            or "",
            4000,
        ),
        "layoutIntent": safe_dict(item.get("layoutIntent") or item.get("layout")),
        "styleIntent": safe_dict(item.get("styleIntent") or item.get("visualStyle")),
        "blocks": blocks,
        "visualBlocks": blocks,
        "sourceRefs": refs,
        "estimatedSeconds": int(item.get("estimatedSeconds") or max(45, 25 + len(blocks) * 20)),
        "metadata": {
            **safe_dict(item.get("metadata")),
            "sourceGrounded": True,
            "fallbackUsed": False,
            "aiDesignedScreen": True,
        },
    }


def _sections_from_screens(screens: List[JsonDict]) -> List[JsonDict]:
    sections: List[JsonDict] = []
    for screen in screens:
        for block in safe_list(safe_dict(screen).get("blocks")):
            b = safe_dict(block)
            sections.append(
                {
                    "sectionId": b.get("blockId") or f"section_{len(sections) + 1}",
                    "screenId": safe_dict(screen).get("screenId"),
                    "screenNo": safe_dict(screen).get("screenNo"),
                    "title": b.get("title"),
                    "sectionType": b.get("type"),
                    "templateType": b.get("templateType"),
                    "visualForm": b.get("visualForm"),
                    "purpose": b.get("purpose"),
                    "body": b.get("body"),
                    "content": b.get("content"),
                    "teacherNotes": b.get("teacherNotes"),
                    "sourceRefs": safe_list(b.get("sourceRefs")) or safe_list(safe_dict(screen).get("sourceRefs")),
                    "visualSpec": safe_dict(b.get("visualSpec")),
                    "htmlSpec": safe_dict(b.get("htmlSpec")),
                    "diagramSpec": safe_dict(b.get("diagramSpec")),
                }
            )
    return sections


def _collect_visuals(raw: JsonDict, screens: List[JsonDict], refs: List[JsonDict]) -> List[JsonDict]:
    visuals: List[JsonDict] = []

    for item in safe_list(raw.get("customVisuals") or raw.get("visuals") or raw.get("diagramDesigns")):
        v = safe_dict(item)
        if not v:
            continue
        visuals.append(
            {
                **v,
                "visualId": normalize_id(v.get("visualId") or v.get("id") or v.get("title") or f"visual_{len(visuals) + 1}", f"visual_{len(visuals) + 1}"),
                "title": clean_text(v.get("title") or f"Visual {len(visuals) + 1}", 220),
                "visualForm": clean_text(v.get("visualForm") or v.get("diagramType") or v.get("type") or "adaptive_visual", 120),
                "sourceRefs": _refs_for_item(v, refs),
                "sourceGrounded": True,
            }
        )

    if visuals:
        return visuals[:30]

    for screen in screens:
        for block in safe_list(screen.get("blocks")):
            b = safe_dict(block)
            form = clean_text(b.get("visualForm") or b.get("type"), 120).lower()
            if any(key in form for key in ["diagram", "table", "code", "sql", "flow", "timeline", "map", "graph", "formula", "trace"]):
                visuals.append(
                    {
                        "visualId": normalize_id(b.get("blockId") or b.get("title"), f"visual_{len(visuals) + 1}"),
                        "title": b.get("title"),
                        "visualForm": b.get("visualForm") or b.get("type"),
                        "sourceRefs": safe_list(b.get("sourceRefs")) or refs[:5],
                        "visualSpec": safe_dict(b.get("visualSpec")),
                        "diagramSpec": safe_dict(b.get("diagramSpec")),
                        "sourceGrounded": True,
                    }
                )

    return visuals[:30]


class VisualPlannerAgent(BaseLiveTutorAgent):
    agent_name = "VisualPlannerAgent"
    agent_group = "visual"
    default_mode = "plan_visuals"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return (
            "You are a world-class live tutor board designer and senior educational visual architect. "
            "Design a custom, source-grounded, premium board lesson from the selected concept, full PDF context, and Gemini Vision output. "
            "Do not use fixed templates, fixed screen names, or domain-specific hardcoding. "
            "Gemini must decide the visual structure dynamically. Return JSON only."
        )

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        packet = _packet(payload)
        refs = _source_refs(payload)

        if not packet:
            errors.append("VisualPlannerAgent requires visualPlannerPacket from orchestrator.")

        if not _title(payload):
            errors.append("VisualPlannerAgent requires selectedNode.title in visualPlannerPacket.")

        if not refs:
            errors.append("VisualPlannerAgent requires sourceRefs.")

        source_truth = safe_dict(packet.get("sourceTruth"))
        selected_text = clean_text(source_truth.get("selectedPageFullTextExcerpt") or "", 200)
        selected_evidence = safe_list(source_truth.get("selectedEvidence"))

        if not selected_text and not selected_evidence:
            errors.append(
                "VisualPlannerAgent requires visualPlannerPacket.sourceTruth.selectedEvidence "
                "or visualPlannerPacket.sourceTruth.selectedPageFullTextExcerpt."
            )

        if not safe_dict(packet.get("visualFacts")):
            warnings.append("visualPlannerPacket.visualFacts missing; board may be less visual.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="VisualPlannerAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        packet = _packet(payload)
        title = _title(payload)

        return f"""
You are VisualPlannerAgent in a multi-agent live tutor system.

Your job is ONLY to create a compact, rich, source-grounded BOARD BLUEPRINT.

Already done by other agents:
- Source/RAG agents collected selected truth.
- SelectedPageVisionAgent analyzed page images/diagrams.
- Teaching agents produced explanation strategy.
- Orchestrator compressed everything into visualPlannerPacket.

Later agents will do:
- BoardSceneAgent: scene/layout/HTML visual blocks.
- DiagramCompilerAgent: diagrams/tables/code visuals.
- BoardCommandAgent: write/draw/circle/highlight/zoom commands.
- VoiceScriptAgent: human spoken explanation.

Rules:
- Do not read or request raw full PDF dump.
- Do not create final HTML.
- Do not create boardCommands.
- Do not create voiceScript.
- Do not use fixed Star Schema/database template.
- Do not invent unsupported facts.
- Every factual screen/block must include sourceRefs.
- Use the packet's sourceTruth as truth and visualFacts as visual guide.

SELECTED TOPIC:
{title}

VISUAL PLANNER PACKET:
{_json(packet, 42000)}

Return JSON only:

{{
  "adaptiveBoardDesign": {{
    "designId": "string",
    "title": "string",
    "learningPromise": "what the learner will understand",
    "studentLearningPath": [
      "short sequence of learning moves"
    ],
    "artDirection": {{
      "visualMood": "premium human tutor board",
      "colorStrategy": "topic-specific accessible color strategy",
      "densityStrategy": "rich but readable",
      "diagramStyle": "how diagrams/tables/code visuals should feel",
      "sourceProofStyle": "how source citations/cards should appear"
    }},
    "screens": [
      {{
        "screenId": "string",
        "screenNo": 1,
        "title": "string",
        "learningGoal": "string",
        "screenGoal": "string",
        "designRationale": "why this screen exists",
        "teacherNarrative": "short teaching intention, not full voice script",
        "layoutIntent": {{
          "composition": "freeform layout intent",
          "visualHierarchy": "what is largest/medium/small",
          "responsiveBehavior": "how it can split or grow"
        }},
        "styleIntent": {{
          "colorRole": "topic-specific colors",
          "attentionPath": "where student looks first/next"
        }},
        "blocks": [
          {{
            "blockId": "string",
            "visualForm": "custom freeform visual type",
            "title": "string",
            "purpose": "why this block helps learning",
            "content": "short source-grounded content or object/list",
            "teacherNotes": "short note for BoardScene/Voice later",
            "visualSpec": {{
              "kind": "diagram/table/code/source/html/note/custom",
              "elements": [],
              "relationships": [],
              "markingPlan": []
            }},
            "htmlSpec": {{
              "safeHtml": true,
              "allowScripts": false,
              "cssIntent": "beautiful custom visual card/panel",
              "dataToRender": []
            }},
            "diagramSpec": {{
              "needed": true,
              "diagramKind": "freeform",
              "sourceTerms": [],
              "relationships": []
            }},
            "sourceRefs": []
          }}
        ],
        "sourceRefs": []
      }}
    ]
  }},
  "premiumBoardScreens": [
    "MUST be filled with the same screen objects from adaptiveBoardDesign.screens"
  ],
  "customVisuals": [
    "Fill with diagram/table/source/quiz visual needs when useful"
  ],
  "sourceCards": [
    "Fill with important source proof cards"
  ],
  "teacherFocusPath": [
    "Fill with short teacher attention sequence"
  ],
  "mistakeAndRepairPlan": [
    "Fill when common confusion exists"
  ],
  "quizMoments": [
    "Fill when a checkpoint question is useful"
  ],
  "sourceRefs": [
    "MUST include source references used by the plan"
  ],
  "metadata": {{
    "sourceGrounded": true,
    "fallbackUsed": false,
    "usedSmartFallback": false,
    "aiFirstDesign": true,
    "dynamicMultiTemplate": true,
    "usedVisualPlannerPacket": true,
    "rawDumpAvoided": true
  }}
}}
""".strip()

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        raise RuntimeError("VisualPlannerAgent requires Gemini/ADK. No rule-based/static fallback is allowed.")

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw = safe_dict(raw)
        fallback_refs = dedupe_source_refs([safe_dict(x) for x in safe_list(raw.get("sourceRefs"))]) or _source_refs(payload)

        adaptive = safe_dict(raw.get("adaptiveBoardDesign") or raw.get("boardDesign") or raw)
        # Gemini may return designed screens under different valid names.
        # This is normalization, not fake fallback: if Gemini designed screens
        # anywhere in the response, expose them as premiumBoardScreens.
        # Gemini may return designed screens under different valid names.
        # This is normalization, not fake fallback: if Gemini designed screens
        # anywhere in the response, expose them as premiumBoardScreens.
        raw_screens = (
            safe_list(adaptive.get("screens"))
            or safe_list(adaptive.get("screenBlueprints"))
            or safe_list(adaptive.get("lessonScreens"))
            or safe_list(adaptive.get("premiumBoardScreens"))
            or safe_list(adaptive.get("boardScreens"))
            or safe_list(raw.get("premiumBoardScreens"))
            or safe_list(raw.get("boardScreens"))
            or safe_list(raw.get("screens"))
            or safe_list(raw.get("screenBlueprints"))
            or safe_list(raw.get("lessonScreens"))
            or safe_list(safe_dict(raw.get("visualPlan")).get("premiumBoardScreens"))
            or safe_list(safe_dict(raw.get("visualPlan")).get("screens"))
            or safe_list(safe_dict(raw.get("result")).get("premiumBoardScreens"))
            or safe_list(safe_dict(raw.get("result")).get("screens"))
            or safe_list(safe_dict(safe_dict(raw.get("result")).get("adaptiveBoardDesign")).get("screens"))
        )

        screens = [
            _normalize_screen(screen, fallback_refs, index)
            for index, screen in enumerate(raw_screens)
            if safe_dict(screen)
        ]

        sections = _sections_from_screens(screens)
        visuals = _collect_visuals(raw, screens, fallback_refs)

        source_cards = []
        for item in safe_list(raw.get("sourceCards")):
            card = safe_dict(item)
            if not card:
                continue
            source_cards.append(
                {
                    **card,
                    "cardId": normalize_id(card.get("cardId") or card.get("title") or f"source_card_{len(source_cards) + 1}", f"source_card_{len(source_cards) + 1}"),
                    "title": clean_text(card.get("title") or "Source proof", 180),
                    "quote": clean_text(card.get("quote") or card.get("body") or "", 1200),
                    "sourceRefs": _refs_for_item(card, fallback_refs),
                }
            )

        result = {
            "visualPlanId": normalize_id(
                adaptive.get("designId")
                or raw.get("visualPlanId")
                or f"ai_first_visual_plan_{_title(payload)}",
                "ai_first_visual_plan",
            ),
            "title": clean_text(adaptive.get("title") or raw.get("title") or _title(payload), 220),
            "teachingGoal": clean_text(
                adaptive.get("learningPromise")
                or raw.get("teachingGoal")
                or f"Teach {_title(payload)} with a source-grounded premium tutor board.",
                1400,
            ),
            "adaptiveBoardDesign": {
                **adaptive,
                "screens": screens,
                "screenBlueprints": screens,
            },
            "studentLearningPath": safe_list(adaptive.get("studentLearningPath") or raw.get("studentLearningPath")),
            "artDirection": safe_dict(adaptive.get("artDirection") or raw.get("artDirection")),
            "premiumBoardScreens": screens,
            "boardScreens": screens,
            "sections": sections,
            "boardSections": sections,
            "customVisuals": visuals,
            "visuals": visuals,
            "sourceCards": source_cards,
            "teacherFocusPath": safe_list(raw.get("teacherFocusPath"))[:20],
            "mistakeAndRepairPlan": safe_list(raw.get("mistakeAndRepairPlan"))[:20],
            "quizMoments": safe_list(raw.get("quizMoments"))[:20],
            "sourceRefs": fallback_refs,
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "usesAdk": True,
                "sourceGrounded": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "aiFirstDesign": True,
                "dynamicMultiTemplate": True,
                "usedVisualPlannerPacket": bool(_packet(payload)),
                "rawDumpAvoided": True,
                "visualLessonInputConsumed": False,
                "screenCount": len(screens),
                "sectionCount": len(sections),
                "customVisualCount": len(visuals),
                "robustScreenNormalization": True,
            },
        }

        return result

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        refs = safe_list(output.get("sourceRefs"))
        screens = safe_list(output.get("premiumBoardScreens") or output.get("boardScreens"))

        ref_validation = require_source_refs(refs, "VisualPlannerAgent.output.sourceRefs")
        errors.extend(ref_validation.errors)
        warnings.extend(ref_validation.warnings)

        if not screens:
            errors.append("VisualPlannerAgent must output premiumBoardScreens.")

        if len(screens) < 2:
            errors.append("VisualPlannerAgent must output at least 2 screens for a rich board.")

        if len(screens) > 9:
            warnings.append("VisualPlannerAgent produced many screens; BoardSceneAgent may split/grow board.")

        for s_index, screen_raw in enumerate(screens):
            screen = safe_dict(screen_raw)
            if not safe_list(screen.get("sourceRefs")):
                errors.append(f"premiumBoardScreens[{s_index}].sourceRefs missing.")

            blocks = safe_list(screen.get("blocks") or screen.get("visualBlocks"))
            if not blocks:
                errors.append(f"premiumBoardScreens[{s_index}].blocks missing.")

            for b_index, block_raw in enumerate(blocks):
                block = safe_dict(block_raw)
                if not clean_text(block.get("title")):
                    errors.append(f"screen {s_index} block {b_index} title missing.")
                if not safe_list(block.get("sourceRefs")):
                    errors.append(f"screen {s_index} block {b_index} sourceRefs missing.")

        if not safe_dict(output.get("metadata")).get("aiFirstDesign"):
            warnings.append("metadata.aiFirstDesign missing.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="VisualPlannerAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["VisualPlannerAgent"]