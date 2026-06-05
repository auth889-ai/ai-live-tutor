"""
google_agent/planning/teaching_strategy_agent.py
===============================================================================
Teaching Strategy Agent.

Separate strong agent responsibility:
- Decide HOW to teach a segment or selected node like a human tutor.
- Use source truth, selected-page vision, concept extraction, and knowledge graph.
- Plan teacher behavior: intuition -> visual -> source evidence -> example -> check.
- Predict confusions and repair routes.
- Prepare strategy for DetailedExplanationAgent, VisualPlannerAgent, BoardSceneAgent,
  BoardCommandAgent, and VoiceScriptAgent.

Phase 1 fix:
- This agent no longer depends on Gemini to repeat sourceRefs perfectly.
- If Gemini produces good teachingSteps but omits step-level sourceRefs, normalize_output
  repairs each step with the real grounded sourceRefs already present in payload.
- This is NOT fake grounding. It uses selectedEvidence/sourceRefs/chunks from the current
  selected node.
===============================================================================
"""

from __future__ import annotations

from typing import List

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
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


class TeachingStrategyAgent(BaseLiveTutorAgent):
    agent_name = "TeachingStrategyAgent"
    agent_group = "planning"
    default_mode = "plan_teaching_strategy"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the Teaching Strategy Agent for a human-like Live Tutor.

Your job:
- Decide the best human teaching approach for a selected segment/node.
- Use source evidence as truth.
- Use selected page vision only for visual/diagram/marking guidance.
- Use conceptExtraction to know what must be taught.
- Use knowledgeGraph to know how concepts connect.
- Use fullPdfSummary/fullPdfOutline only as course/chapter background.
- Plan teacher behavior: first simple explanation, then visual drawing, then example, then check.
- Choose board style: diagram, table, flowchart, comparison, timeline, dry-run, recap.
- Predict likely confusion and create repair routes.
- Every teaching step MUST include sourceRefs.
- Do not invent unsupported facts.
- Do not make a final board. Only make teaching strategy.
- Output ONLY valid JSON.
"""

    def _payload_source_refs(self, payload: JsonDict) -> List[JsonDict]:
        """
        Collect real sourceRefs from the payload.

        This is used only to repair missing step-level sourceRefs when the model
        omits them. It does not invent sources.
        """
        refs: List[JsonDict] = []

        refs.extend([safe_dict(x) for x in safe_list(payload.get("sourceRefs"))])
        refs.extend([safe_dict(x) for x in safe_list(safe_dict(payload.get("sourceTruth")).get("sourceRefs"))])
        refs.extend([safe_dict(x) for x in safe_list(safe_dict(payload.get("selectedNode")).get("sourceRefs"))])
        refs.extend([safe_dict(x) for x in safe_list(safe_dict(payload.get("conceptExtraction")).get("sourceRefs"))])
        refs.extend([safe_dict(x) for x in safe_list(safe_dict(payload.get("knowledgeGraph")).get("sourceRefs"))])

        for evidence_key in [
            "selectedEvidence",
            "samePageEvidence",
            "nearbyEvidence",
            "relatedEvidence",
            "comparisonEvidence",
        ]:
            for evidence in safe_list(payload.get(evidence_key)):
                item = safe_dict(evidence)
                refs.extend([safe_dict(x) for x in safe_list(item.get("sourceRefs"))])
                if item.get("sourceRef") or item.get("pageRef") or item.get("chunkId"):
                    refs.append(item)

        source_truth = safe_dict(payload.get("sourceTruth"))
        for evidence_key in [
            "selectedEvidence",
            "samePageEvidence",
            "nearbyEvidence",
            "relatedEvidence",
            "comparisonEvidence",
        ]:
            for evidence in safe_list(source_truth.get(evidence_key)):
                item = safe_dict(evidence)
                refs.extend([safe_dict(x) for x in safe_list(item.get("sourceRefs"))])
                if item.get("sourceRef") or item.get("pageRef") or item.get("chunkId"):
                    refs.append(item)

        for chunk in safe_list(payload.get("chunks")):
            item = safe_dict(chunk)
            if item.get("sourceRef") or item.get("pageRef") or item.get("chunkId") or item.get("quote") or item.get("text"):
                refs.append(
                    {
                        "chunkId": clean_text(item.get("chunkId") or item.get("id") or "", 220),
                        "sourceRef": clean_text(
                            item.get("sourceRef")
                            or item.get("pageRef")
                            or item.get("chunkId")
                            or item.get("id")
                            or "",
                            300,
                        ),
                        "pageRef": clean_text(item.get("pageRef") or item.get("sourceRef") or "", 300),
                        "page": item.get("page") or item.get("pageNumber"),
                        "quote": clean_text(
                            item.get("quote")
                            or item.get("textPreview")
                            or item.get("text")
                            or "",
                            900,
                        ),
                        "confidence": item.get("confidence") or 0.8,
                        "resourceId": clean_text(item.get("resourceId") or "", 180),
                    }
                )

        return dedupe_source_refs([x for x in refs if safe_dict(x)])

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []

        segment_plan = safe_dict(payload.get("segmentPlan") or payload.get("segment"))
        selected_node = safe_dict(payload.get("selectedNode") or payload.get("node"))
        chunks = safe_list(payload.get("chunks"))
        source_refs = self._payload_source_refs(payload)

        if not segment_plan and not selected_node:
            errors.append("TeachingStrategyAgent requires segmentPlan/segment or selectedNode/node.")

        if not chunks and not source_refs:
            errors.append("TeachingStrategyAgent requires chunks or existing sourceRefs.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="TeachingStrategyAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        segment_plan = safe_dict(payload.get("segmentPlan") or payload.get("segment"))
        selected_node = safe_dict(payload.get("selectedNode") or payload.get("node"))
        course_plan = safe_dict(payload.get("coursePlan"))
        source_truth = safe_dict(payload.get("sourceTruth"))
        pdf_background = safe_dict(payload.get("pdfBackground"))
        selected_page_vision = safe_dict(payload.get("selectedPageVision"))
        concept_extraction = safe_dict(payload.get("conceptExtraction"))
        graph = safe_dict(payload.get("knowledgeGraph") or payload.get("conceptTree"))
        chunks_text = self.compact_chunks_for_prompt(safe_list(payload.get("chunks")), max_chars=45000)

        source_refs = self._payload_source_refs(payload)
        selected_evidence = (
            source_truth.get("selectedEvidence")
            or payload.get("selectedEvidence")
            or []
        )
        same_page_evidence = (
            source_truth.get("samePageEvidence")
            or payload.get("samePageEvidence")
            or []
        )
        nearby_evidence = (
            source_truth.get("nearbyEvidence")
            or payload.get("nearbyEvidence")
            or []
        )
        comparison_evidence = (
            source_truth.get("comparisonEvidence")
            or payload.get("comparisonEvidence")
            or []
        )
        selected_page_text = (
            source_truth.get("selectedPageFullTextExcerpt")
            or payload.get("selectedPageFullText")
            or ""
        )

        page_image_analyses = (
            payload.get("pageImageAnalyses")
            or safe_dict(payload.get("visualTruth")).get("pageImageAnalyses")
            or []
        )
        detected_diagrams = (
            payload.get("detectedVisualDiagrams")
            or safe_dict(payload.get("visualTruth")).get("detectedDiagrams")
            or []
        )
        diagram_elements = (
            payload.get("diagramElements")
            or safe_dict(payload.get("visualTruth")).get("diagramElements")
            or []
        )
        relationships = (
            payload.get("relationships")
            or safe_dict(payload.get("visualTruth")).get("relationships")
            or []
        )
        board_redraw_hints = (
            payload.get("boardRedrawHints")
            or safe_dict(payload.get("visualTruth")).get("boardRedrawHints")
            or []
        )
        teacher_marking_hints = (
            payload.get("teacherMarkingHints")
            or safe_dict(payload.get("visualTruth")).get("teacherMarkingHints")
            or []
        )
        common_confusions = (
            payload.get("commonConfusions")
            or safe_dict(payload.get("visualTruth")).get("commonConfusions")
            or []
        )

        return f"""
Create a human teaching strategy for this Live Tutor selected node.

Student level: {context.studentLevel}
Language: {context.language}
Student question/focus: {context.question}

VERY IMPORTANT RULES:
1. PDF extracted text / selectedEvidence is the truth.
2. Page image/vision is only visual guidance for diagrams, layout, arrows, marks.
3. fullPdfSummary and fullPdfOutline are only background/course map.
4. Every teachingSteps[i] MUST include real sourceRefs from the given sourceRefs list.
5. Every repairRoutes[i] SHOULD include real sourceRefs.
6. Do NOT make a tiny generic strategy.
7. Do NOT create final boardCommands.
8. Plan for a rich board lesson: draw, circle, underline, highlight, compare, quiz.
9. Preserve source grounding.

Return JSON exactly:
{{
  "strategyId": "strategy_1",
  "title": "teaching strategy title",
  "teachingGoal": "what the tutor should make clear",
  "studentModel": {{
    "level": "{context.studentLevel}",
    "likelyPriorKnowledge": [],
    "likelyConfusions": [],
    "preferredLanguage": "{context.language}"
  }},
  "teachingSteps": [
    {{
      "stepId": "step_1",
      "name": "Start from intuition",
      "teacherMove": "what teacher says/does in human tutor style",
      "boardMove": "what appears on board: write/draw/circle/arrow/highlight/compare",
      "visualType": "none|tree|flowchart|table|diagram|code-trace|timeline|comparison|quiz|recap",
      "reason": "why this step helps the student",
      "sourceRefs": []
    }}
  ],
  "pacingPlan": {{
    "pace": "slow|normal|fast",
    "pausePoints": ["after definition"],
    "interruptChecks": ["ask if the definition is clear"]
  }},
  "repairRoutes": [
    {{
      "routeId": "repair_1",
      "trigger": "student confused about X",
      "repairMove": "explain using simpler analogy or source evidence",
      "boardMove": "draw/circle/compare a smaller repair diagram",
      "sourceRefs": []
    }}
  ],
  "voiceStyle": {{
    "tone": "warm private tutor",
    "pace": "normal",
    "emphasisWords": []
  }},
  "sourceRefs": [],
  "metadata": {{
    "fallbackUsed": false,
    "agent": "TeachingStrategyAgent",
    "humanTutorStyle": true
  }}
}}

Available real sourceRefs:
{source_refs}

Course plan:
{course_plan}

Segment plan:
{segment_plan}

Selected node:
{selected_node}

Source truth:
selectedEvidence:
{selected_evidence}

samePageEvidence:
{same_page_evidence}

nearbyEvidence:
{nearby_evidence}

comparisonEvidence:
{comparison_evidence}

selectedPageFullTextExcerpt:
{clean_text(selected_page_text, 9000)}

PDF background:
{pdf_background}

Selected page vision:
{selected_page_vision}

Page image analyses:
{page_image_analyses}

Detected diagrams:
{detected_diagrams}

Diagram elements:
{diagram_elements}

Visual relationships:
{relationships}

Board redraw hints:
{board_redraw_hints}

Teacher marking hints:
{teacher_marking_hints}

Common confusions:
{common_confusions}

Concept extraction:
{concept_extraction}

Knowledge graph:
{graph}

Source chunks:
{chunks_text}
"""

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        fallback_refs = self._payload_source_refs(payload)

        steps: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("teachingSteps") or raw.get("steps"))):
            step = safe_dict(item)
            step_refs = dedupe_source_refs([safe_dict(x) for x in safe_list(step.get("sourceRefs"))])
            repaired = False

            if not step_refs and fallback_refs:
                step_refs = fallback_refs[:4]
                repaired = True

            steps.append(
                {
                    "stepId": normalize_id(step.get("stepId") or f"step_{index + 1}", f"step_{index + 1}"),
                    "name": clean_text(step.get("name") or f"Step {index + 1}", 160),
                    "teacherMove": clean_text(step.get("teacherMove") or "", 1600),
                    "boardMove": clean_text(step.get("boardMove") or "", 1600),
                    "visualType": clean_text(step.get("visualType") or "none", 80),
                    "reason": clean_text(step.get("reason") or "", 1000),
                    "sourceRefs": step_refs,
                    "metadata": {
                        **safe_dict(step.get("metadata")),
                        "sourceRefsRepairedFromPayload": repaired,
                    },
                }
            )

        repair_routes: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("repairRoutes"))):
            route = safe_dict(item)
            route_refs = dedupe_source_refs([safe_dict(x) for x in safe_list(route.get("sourceRefs"))])
            repaired = False

            if not route_refs and fallback_refs:
                route_refs = fallback_refs[:4]
                repaired = True

            repair_routes.append(
                {
                    "routeId": normalize_id(route.get("routeId") or f"repair_{index + 1}", f"repair_{index + 1}"),
                    "trigger": clean_text(route.get("trigger") or "", 700),
                    "repairMove": clean_text(route.get("repairMove") or "", 1600),
                    "boardMove": clean_text(route.get("boardMove") or "", 1600),
                    "sourceRefs": route_refs,
                    "metadata": {
                        **safe_dict(route.get("metadata")),
                        "sourceRefsRepairedFromPayload": repaired,
                    },
                }
            )

        all_refs: List[JsonDict] = []
        all_refs.extend([safe_dict(x) for x in safe_list(raw.get("sourceRefs"))])
        all_refs.extend(fallback_refs)
        for step in steps:
            all_refs.extend(safe_list(step.get("sourceRefs")))
        for route in repair_routes:
            all_refs.extend(safe_list(route.get("sourceRefs")))

        student_model = safe_dict(raw.get("studentModel"))
        pacing_plan = safe_dict(raw.get("pacingPlan"))
        voice_style = safe_dict(raw.get("voiceStyle"))

        return {
            "strategyId": normalize_id(raw.get("strategyId") or "strategy_1", "strategy_1"),
            "title": clean_text(raw.get("title") or "Teaching Strategy", 180),
            "teachingGoal": clean_text(raw.get("teachingGoal") or raw.get("goal") or "", 1200),
            "studentModel": {
                "level": clean_text(student_model.get("level") or context.studentLevel, 80),
                "likelyPriorKnowledge": [
                    clean_text(x, 260)
                    for x in safe_list(student_model.get("likelyPriorKnowledge"))
                ],
                "likelyConfusions": [
                    clean_text(x, 360)
                    for x in safe_list(student_model.get("likelyConfusions"))
                ],
                "preferredLanguage": clean_text(student_model.get("preferredLanguage") or context.language, 80),
            },
            "teachingSteps": steps,
            "pacingPlan": {
                "pace": clean_text(pacing_plan.get("pace") or "normal", 60),
                "pausePoints": [
                    clean_text(x, 260)
                    for x in safe_list(pacing_plan.get("pausePoints"))
                ],
                "interruptChecks": [
                    clean_text(x, 260)
                    for x in safe_list(pacing_plan.get("interruptChecks"))
                ],
            },
            "repairRoutes": repair_routes,
            "voiceStyle": {
                "tone": clean_text(voice_style.get("tone") or "warm private tutor", 120),
                "pace": clean_text(voice_style.get("pace") or "normal", 60),
                "emphasisWords": [
                    clean_text(x, 100)
                    for x in safe_list(voice_style.get("emphasisWords"))
                ],
            },
            "sourceRefs": dedupe_source_refs(all_refs),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "humanTutorStyle": True,
                "interruptRepairReady": True,
                "sourceRefsRepairedFromPayload": any(
                    safe_dict(step.get("metadata")).get("sourceRefsRepairedFromPayload")
                    for step in steps
                ),
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        if not clean_text(output.get("teachingGoal")):
            errors.append("teachingGoal is required.")

        if not safe_list(output.get("teachingSteps")):
            errors.append("teachingSteps are required.")

        ref_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "TeachingStrategyAgent.output.sourceRefs",
        )
        errors.extend(ref_validation.errors)

        for index, step in enumerate(safe_list(output.get("teachingSteps"))):
            item = safe_dict(step)
            if not clean_text(item.get("teacherMove")):
                errors.append(f"teachingSteps[{index}].teacherMove is required.")
            if not clean_text(item.get("boardMove")):
                warnings.append(f"teachingSteps[{index}] should include boardMove.")
            if not safe_list(item.get("sourceRefs")):
                errors.append(f"teachingSteps[{index}].sourceRefs are required.")

        if not safe_list(output.get("repairRoutes")):
            warnings.append("repairRoutes missing; interrupt repair may be weaker.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="TeachingStrategyAgent.validate_output",
            fallbackUsed=False,
        )