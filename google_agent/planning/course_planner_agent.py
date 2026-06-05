"""
google_agent/live_tutor_agents/planning/course_planner_agent.py
===============================================================================
Course Planner Agent.

Separate strong agent responsibility:
- Build a long lesson/course plan, including 6-hour mode.
- Split into modules and 8-12 minute segments.
- Every module/segment must have sourceRefs.
- Output is used by SegmentPlannerAgent and Live Tutor Orchestrator.
- No fake fallback.
===============================================================================
"""

from __future__ import annotations

import math
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


class CoursePlannerAgent(BaseLiveTutorAgent):
    agent_name = "CoursePlannerAgent"
    agent_group = "planning"
    default_mode = "plan_course"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the Course Planner Agent for a 27-agent human-like AI tutor.

Your job:
- Build a long-running lesson plan from source-grounded concepts and chunks.
- Support 6-hour lessons without generating everything at once.
- Divide the course into modules and 8-12 minute segments.
- Every module and segment MUST include sourceRefs.
- Add expected confusions, board scene types, and quiz checkpoints.
- Output ONLY JSON.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []

        graph = safe_dict(payload.get("knowledgeGraph") or payload.get("conceptTree"))
        concepts = safe_list(payload.get("concepts"))
        chunks = safe_list(payload.get("chunks"))

        if not graph and not concepts:
            errors.append("CoursePlannerAgent requires knowledgeGraph/conceptTree or concepts.")
        if not chunks and not graph.get("sourceRefs"):
            errors.append("CoursePlannerAgent requires chunks or graph sourceRefs.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="CoursePlannerAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        target_minutes = int(payload.get("targetMinutes") or 360)
        segment_minutes = int(payload.get("segmentMinutes") or 10)
        total_segments = max(1, math.ceil(target_minutes / max(1, segment_minutes)))

        graph = safe_dict(payload.get("knowledgeGraph") or payload.get("conceptTree"))
        concepts = safe_list(payload.get("concepts"))
        chunks_text = self.compact_chunks_for_prompt(safe_list(payload.get("chunks")), max_chars=65000)

        return f"""
Build a source-grounded course plan for the Live Tutor.

Goal:
- Human-like private tutor.
- Long lesson capable.
- Do not generate all board scenes now.
- Plan modules and segments only.
- Each segment later becomes board scene + voice + subtitle + quiz.

Student level: {context.studentLevel}
Language: {context.language}
Target minutes: {target_minutes}
Segment minutes: {segment_minutes}
Expected total segments: {total_segments}

Return JSON exactly:
{{
  "courseTitle": "string",
  "targetMinutes": {target_minutes},
  "segmentMinutes": {segment_minutes},
  "totalSegments": {total_segments},
  "modules": [
    {{
      "moduleId": "module_1",
      "title": "string",
      "goal": "string",
      "estimatedMinutes": 60,
      "difficulty": "easy|medium|advanced",
      "conceptIds": ["concept_id"],
      "sourceRefs": [],
      "metadata": {{}}
    }}
  ],
  "segments": [
    {{
      "segmentId": "segment_1",
      "moduleId": "module_1",
      "title": "string",
      "goal": "string",
      "estimatedMinutes": {segment_minutes},
      "difficulty": "easy|medium|advanced",
      "conceptIds": ["concept_id"],
      "sourceRefs": [],
      "expectedConfusions": ["student may confuse ..."],
      "boardSceneTypes": ["concept-tree", "teacher-writing", "flowchart", "quiz"],
      "quizCheckpoint": "one quick understanding check",
      "resumePolicy": "save currentSegment and currentCommandIndex after this segment",
      "metadata": {{}}
    }}
  ],
  "sourceRefs": [],
  "metadata": {{
    "fallbackUsed": false,
    "coursePlannerAgent": true
  }}
}}

Knowledge graph:
{graph}

Concepts:
{concepts}

Source chunks:
{chunks_text}
"""

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        target_minutes = int(raw.get("targetMinutes") or payload.get("targetMinutes") or 360)
        segment_minutes = int(raw.get("segmentMinutes") or payload.get("segmentMinutes") or 10)

        modules: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("modules"))):
            module = safe_dict(item)
            module_id = normalize_id(module.get("moduleId") or module.get("id") or f"module_{index + 1}", f"module_{index + 1}")
            modules.append(
                {
                    "moduleId": module_id,
                    "title": clean_text(module.get("title") or f"Module {index + 1}", 180),
                    "goal": clean_text(module.get("goal") or "", 1000),
                    "estimatedMinutes": int(module.get("estimatedMinutes") or 60),
                    "difficulty": clean_text(module.get("difficulty") or "easy", 40),
                    "conceptIds": [normalize_id(x, "") for x in safe_list(module.get("conceptIds")) if normalize_id(x, "")],
                    "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(module.get("sourceRefs"))]),
                    "metadata": safe_dict(module.get("metadata")),
                }
            )

        segments: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("segments"))):
            segment = safe_dict(item)
            segment_id = normalize_id(segment.get("segmentId") or segment.get("id") or f"segment_{index + 1}", f"segment_{index + 1}")
            module_id = normalize_id(segment.get("moduleId") or (modules[0]["moduleId"] if modules else ""), "")
            segments.append(
                {
                    "segmentId": segment_id,
                    "moduleId": module_id,
                    "title": clean_text(segment.get("title") or f"Segment {index + 1}", 180),
                    "goal": clean_text(segment.get("goal") or "", 1000),
                    "estimatedMinutes": int(segment.get("estimatedMinutes") or segment_minutes),
                    "difficulty": clean_text(segment.get("difficulty") or "easy", 40),
                    "conceptIds": [normalize_id(x, "") for x in safe_list(segment.get("conceptIds")) if normalize_id(x, "")],
                    "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(segment.get("sourceRefs"))]),
                    "expectedConfusions": [clean_text(x, 400) for x in safe_list(segment.get("expectedConfusions"))],
                    "boardSceneTypes": [clean_text(x, 80) for x in safe_list(segment.get("boardSceneTypes"))],
                    "quizCheckpoint": clean_text(segment.get("quizCheckpoint") or "", 800),
                    "resumePolicy": clean_text(segment.get("resumePolicy") or "save currentSegment and currentCommandIndex", 500),
                    "metadata": safe_dict(segment.get("metadata")),
                }
            )

        all_refs: List[JsonDict] = []
        for module in modules:
            all_refs.extend(safe_list(module.get("sourceRefs")))
        for segment in segments:
            all_refs.extend(safe_list(segment.get("sourceRefs")))
        all_refs.extend([safe_dict(x) for x in safe_list(raw.get("sourceRefs"))])

        return {
            "courseTitle": clean_text(raw.get("courseTitle") or raw.get("title") or "Live Tutor Course", 180),
            "targetMinutes": target_minutes,
            "segmentMinutes": segment_minutes,
            "totalSegments": int(raw.get("totalSegments") or len(segments) or math.ceil(target_minutes / max(1, segment_minutes))),
            "modules": modules,
            "segments": segments,
            "sourceRefs": dedupe_source_refs(all_refs),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "longLessonCapable": True,
                "saveResumeRequired": True,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        modules = safe_list(output.get("modules"))
        segments = safe_list(output.get("segments"))

        if not modules:
            errors.append("CoursePlannerAgent output must include modules.")
        if not segments:
            errors.append("CoursePlannerAgent output must include segments.")

        module_ids = {clean_text(m.get("moduleId"), 120) for m in modules if safe_dict(m).get("moduleId")}

        for index, module_raw in enumerate(modules):
            module = safe_dict(module_raw)
            if not clean_text(module.get("title")):
                errors.append(f"modules[{index}].title is required.")
            if int(module.get("estimatedMinutes") or 0) <= 0:
                errors.append(f"modules[{index}].estimatedMinutes must be positive.")

            ref_validation = require_source_refs(
                safe_list(module.get("sourceRefs")),
                f"CoursePlannerAgent.modules[{index}].sourceRefs",
            )
            errors.extend(ref_validation.errors)

        for index, segment_raw in enumerate(segments):
            segment = safe_dict(segment_raw)
            if not clean_text(segment.get("segmentId")):
                errors.append(f"segments[{index}].segmentId is required.")
            if not clean_text(segment.get("title")):
                errors.append(f"segments[{index}].title is required.")
            if module_ids and clean_text(segment.get("moduleId")) not in module_ids:
                errors.append(f"segments[{index}].moduleId does not match any module.")
            if int(segment.get("estimatedMinutes") or 0) <= 0:
                errors.append(f"segments[{index}].estimatedMinutes must be positive.")
            if not safe_list(segment.get("boardSceneTypes")):
                warnings.append(f"segments[{index}] should include boardSceneTypes.")
            if not clean_text(segment.get("quizCheckpoint")):
                warnings.append(f"segments[{index}] should include quizCheckpoint.")

            ref_validation = require_source_refs(
                safe_list(segment.get("sourceRefs")),
                f"CoursePlannerAgent.segments[{index}].sourceRefs",
            )
            errors.extend(ref_validation.errors)

        top_refs = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "CoursePlannerAgent.output.sourceRefs",
        )
        errors.extend(top_refs.errors)

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="CoursePlannerAgent.validate_output",
            fallbackUsed=False,
        )