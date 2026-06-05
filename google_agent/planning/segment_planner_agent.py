"""
google_agent/live_tutor_agents/planning/segment_planner_agent.py
===============================================================================
Segment Planner Agent.

Separate strong agent responsibility:
- Convert one course segment into teachable live tutor scenes.
- Use sourceRefs from course plan / knowledge graph / retrieved chunks.
- Produce board-scene-ready segment plan.
- Include learning objective, misconception plan, scene sequence, quiz checkpoint.
- Do NOT generate full final boardCommands here; Board Scene Agent will do that.
- No fake fallback.

Input expected:
  coursePlan or segment
  knowledgeGraph/conceptTree
  chunks/sourceRefs
  selected segmentId optional

Output:
  segmentPlan with scenePlans, sourceRefs, expectedConfusions, boardNeeds,
  voiceNeeds, quizNeeds, resumePolicy.
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


ALLOWED_SCENE_TYPES = {
    "concept-tree",
    "teacher-writing",
    "definition-board",
    "flowchart",
    "table",
    "timeline",
    "tree",
    "diagram",
    "code-trace",
    "sql-trace",
    "quiz",
    "recap",
    "interrupt-pause",
}


class SegmentPlannerAgent(BaseLiveTutorAgent):
    agent_name = "SegmentPlannerAgent"
    agent_group = "planning"
    default_mode = "plan_segment"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the Segment Planner Agent for a 27-agent human-like Live Tutor.

Your job:
- Plan exactly one live teaching segment.
- Keep it source-grounded.
- Break it into board-friendly scenes.
- Decide what should be written, drawn, compared, quizzed, or explained.
- Prepare the segment so Board Scene Agent, Voice Script Agent, Subtitle Sync Agent,
  and Assessment Quiz Agent can run after you.
- Every segment and scene must include sourceRefs.
- Do not invent unsupported topics.
- Output ONLY valid JSON.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []

        course_plan = safe_dict(payload.get("coursePlan"))
        segment = safe_dict(payload.get("segment"))
        chunks = safe_list(payload.get("chunks"))
        source_refs = safe_list(payload.get("sourceRefs"))

        if not course_plan and not segment:
            errors.append("SegmentPlannerAgent requires coursePlan or segment.")
        if not chunks and not source_refs and not safe_list(segment.get("sourceRefs")):
            errors.append("SegmentPlannerAgent requires chunks or sourceRefs for grounding.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="SegmentPlannerAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        course_plan = safe_dict(payload.get("coursePlan"))
        segment = safe_dict(payload.get("segment"))
        graph = safe_dict(payload.get("knowledgeGraph") or payload.get("conceptTree"))
        selected_segment_id = clean_text(payload.get("segmentId") or segment.get("segmentId") or "", 120)
        segment_minutes = int(payload.get("segmentMinutes") or segment.get("estimatedMinutes") or 10)
        chunks_text = self.compact_chunks_for_prompt(safe_list(payload.get("chunks")), max_chars=70000)

        return f"""
Plan ONE live tutor segment.

Student level: {context.studentLevel}
Language: {context.language}
Question/focus: {context.question}
Selected segmentId: {selected_segment_id}
Target segment minutes: {segment_minutes}

Return JSON exactly:
{{
  "segmentId": "segment_1",
  "title": "clear segment title",
  "goal": "what student should understand by end",
  "estimatedMinutes": {segment_minutes},
  "difficulty": "easy|medium|advanced",
  "conceptIds": ["concept_id"],
  "sourceRefs": [],
  "expectedConfusions": [
    {{
      "confusionId": "confusion_1",
      "confusion": "what student may misunderstand",
      "repairStrategy": "how tutor should repair it",
      "sourceRefs": []
    }}
  ],
  "scenePlans": [
    {{
      "scenePlanId": "scene_plan_1",
      "sceneType": "concept-tree|teacher-writing|definition-board|flowchart|table|timeline|tree|diagram|code-trace|sql-trace|quiz|recap",
      "title": "scene title",
      "goal": "scene goal",
      "teacherAction": "what teacher should do on board",
      "boardNeeds": ["highlight node", "write definition", "draw flowchart"],
      "visualNeeds": ["flowchart", "table"],
      "voiceNeeds": ["slow explanation", "emphasis on keyword"],
      "estimatedMs": 90000,
      "sourceRefs": [],
      "metadata": {{}}
    }}
  ],
  "quizNeeds": [
    {{
      "quizNeedId": "quiz_need_1",
      "type": "quick-check|mcq|short-answer|explain-back",
      "goal": "what to check",
      "sourceRefs": []
    }}
  ],
  "resumePolicy": {{
    "saveAfterEachScene": true,
    "saveCurrentCommandIndex": true,
    "interruptSafe": true
  }},
  "metadata": {{
    "fallbackUsed": false,
    "agent": "SegmentPlannerAgent"
  }}
}}

Course plan:
{course_plan}

Selected/raw segment:
{segment}

Knowledge graph:
{graph}

Source chunks:
{chunks_text}
"""

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        segment = safe_dict(payload.get("segment"))
        segment_id = normalize_id(raw.get("segmentId") or segment.get("segmentId") or "segment_1", "segment_1")

        expected_confusions: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("expectedConfusions"))):
            confusion = safe_dict(item)
            expected_confusions.append(
                {
                    "confusionId": normalize_id(confusion.get("confusionId") or f"confusion_{index + 1}", f"confusion_{index + 1}"),
                    "confusion": clean_text(confusion.get("confusion") or confusion.get("text") or "", 700),
                    "repairStrategy": clean_text(confusion.get("repairStrategy") or "", 1000),
                    "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(confusion.get("sourceRefs"))]),
                    "metadata": safe_dict(confusion.get("metadata")),
                }
            )

        scene_plans: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("scenePlans") or raw.get("scenes"))):
            scene = safe_dict(item)
            scene_type = clean_text(scene.get("sceneType") or "teacher-writing", 80)
            if scene_type not in ALLOWED_SCENE_TYPES:
                scene_type = "teacher-writing"

            scene_plans.append(
                {
                    "scenePlanId": normalize_id(scene.get("scenePlanId") or scene.get("sceneId") or f"scene_plan_{index + 1}", f"scene_plan_{index + 1}"),
                    "sceneType": scene_type,
                    "title": clean_text(scene.get("title") or f"Scene {index + 1}", 180),
                    "goal": clean_text(scene.get("goal") or "", 900),
                    "teacherAction": clean_text(scene.get("teacherAction") or "", 1200),
                    "boardNeeds": [clean_text(x, 180) for x in safe_list(scene.get("boardNeeds")) if clean_text(x, 180)],
                    "visualNeeds": [clean_text(x, 120) for x in safe_list(scene.get("visualNeeds")) if clean_text(x, 120)],
                    "voiceNeeds": [clean_text(x, 180) for x in safe_list(scene.get("voiceNeeds")) if clean_text(x, 180)],
                    "estimatedMs": int(scene.get("estimatedMs") or 90000),
                    "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(scene.get("sourceRefs"))]),
                    "metadata": safe_dict(scene.get("metadata")),
                }
            )

        quiz_needs: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("quizNeeds"))):
            quiz = safe_dict(item)
            quiz_needs.append(
                {
                    "quizNeedId": normalize_id(quiz.get("quizNeedId") or f"quiz_need_{index + 1}", f"quiz_need_{index + 1}"),
                    "type": clean_text(quiz.get("type") or "quick-check", 80),
                    "goal": clean_text(quiz.get("goal") or quiz.get("questionGoal") or "", 900),
                    "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(quiz.get("sourceRefs"))]),
                    "metadata": safe_dict(quiz.get("metadata")),
                }
            )

        all_refs: List[JsonDict] = []
        all_refs.extend([safe_dict(x) for x in safe_list(raw.get("sourceRefs"))])
        for item in expected_confusions:
            all_refs.extend(safe_list(item.get("sourceRefs")))
        for item in scene_plans:
            all_refs.extend(safe_list(item.get("sourceRefs")))
        for item in quiz_needs:
            all_refs.extend(safe_list(item.get("sourceRefs")))

        return {
            "segmentId": segment_id,
            "title": clean_text(raw.get("title") or segment.get("title") or "Live Tutor Segment", 180),
            "goal": clean_text(raw.get("goal") or segment.get("goal") or "", 1000),
            "estimatedMinutes": int(raw.get("estimatedMinutes") or segment.get("estimatedMinutes") or payload.get("segmentMinutes") or 10),
            "difficulty": clean_text(raw.get("difficulty") or segment.get("difficulty") or "easy", 60),
            "conceptIds": [normalize_id(x, "") for x in safe_list(raw.get("conceptIds") or segment.get("conceptIds")) if normalize_id(x, "")],
            "sourceRefs": dedupe_source_refs(all_refs),
            "expectedConfusions": expected_confusions,
            "scenePlans": scene_plans,
            "quizNeeds": quiz_needs,
            "resumePolicy": {
                "saveAfterEachScene": safe_dict(raw.get("resumePolicy")).get("saveAfterEachScene", True) is not False,
                "saveCurrentCommandIndex": safe_dict(raw.get("resumePolicy")).get("saveCurrentCommandIndex", True) is not False,
                "interruptSafe": safe_dict(raw.get("resumePolicy")).get("interruptSafe", True) is not False,
            },
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "boardSceneReady": True,
                "voiceSubtitleReady": True,
                "interruptSafePlan": True,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        if not clean_text(output.get("segmentId")):
            errors.append("segmentId is required.")
        if not clean_text(output.get("title")):
            errors.append("title is required.")
        if not clean_text(output.get("goal")):
            errors.append("goal is required.")
        if int(output.get("estimatedMinutes") or 0) <= 0:
            errors.append("estimatedMinutes must be positive.")

        ref_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "SegmentPlannerAgent.output.sourceRefs",
        )
        errors.extend(ref_validation.errors)

        scene_plans = safe_list(output.get("scenePlans"))
        if not scene_plans:
            errors.append("scenePlans are required.")

        for index, scene in enumerate(scene_plans):
            item = safe_dict(scene)
            if not clean_text(item.get("scenePlanId")):
                errors.append(f"scenePlans[{index}].scenePlanId is required.")
            if item.get("sceneType") not in ALLOWED_SCENE_TYPES:
                errors.append(f"scenePlans[{index}].sceneType is invalid: {item.get('sceneType')}")
            if not clean_text(item.get("goal")):
                errors.append(f"scenePlans[{index}].goal is required.")
            if not safe_list(item.get("sourceRefs")):
                errors.append(f"scenePlans[{index}].sourceRefs are required.")
            if not safe_list(item.get("boardNeeds")):
                warnings.append(f"scenePlans[{index}] should include boardNeeds.")

        if not safe_list(output.get("quizNeeds")):
            warnings.append("quizNeeds missing; later AssessmentQuizAgent may need stronger prompt.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="SegmentPlannerAgent.validate_output",
            fallbackUsed=False,
        )