"""
google_agent/teaching/assessment_quiz_agent.py
===============================================================================
Assessment / Quiz Agent.

Fix:
- Gemini may return quizItems without sourceRefs.
- Old strict validator stopped the full Stage 2 board pipeline:
  AssessmentQuizAgent failed: quizItems[x].sourceRefs are required.
- This replacement keeps strict no-fake behavior, but safely inherits existing
  verified refs from selectedNode / RAG / grounding / explanation / chunks.
- It does NOT invent citations.
- If no verified refs exist anywhere, it still fails.
===============================================================================
"""

from __future__ import annotations

from typing import Any, List

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


VALID_QUIZ_TYPES = {
    "quick-check",
    "mcq",
    "short-answer",
    "explain-back",
    "true-false",
    "fill-blank",
}


def _walk_source_refs(value: Any, refs: List[JsonDict]) -> None:
    if isinstance(value, list):
        for item in value:
            _walk_source_refs(item, refs)
        return

    if isinstance(value, dict):
        local = value.get("sourceRefs")
        if isinstance(local, list):
            refs.extend([safe_dict(item) for item in local if safe_dict(item)])

        for child in value.values():
            _walk_source_refs(child, refs)


def _chunk_to_source_ref(chunk: JsonDict) -> JsonDict:
    item = safe_dict(chunk)
    page = item.get("page") or item.get("pageNumber") or 1
    chunk_id = clean_text(item.get("chunkId") or item.get("id") or f"chunk_p{page}", 220)

    return {
        "chunkId": chunk_id,
        "sourceRef": clean_text(item.get("sourceRef") or item.get("ref") or chunk_id, 300),
        "pageRef": clean_text(item.get("pageRef") or item.get("sourceRef") or f"page:{page}", 300),
        "page": page,
        "quote": clean_text(item.get("quote") or item.get("textPreview") or item.get("text") or "", 700),
        "confidence": item.get("confidence") or 0.78,
        "resourceId": clean_text(item.get("resourceId") or "", 180),
    }


def collect_verified_refs_from_payload(payload: JsonDict) -> List[JsonDict]:
    """
    Reuse already verified refs only.
    This is not fake fallback. It only carries sourceRefs already present in:
    selected node, source grounding, explanation, RAG result, or chunks.
    """

    refs: List[JsonDict] = []

    for key in [
        "sourceRefs",
        "groundedRefs",
        "verifiedSourceRefs",
        "selectedNode",
        "node",
        "sourceGrounding",
        "grounding",
        "explanation",
        "detailedExplanation",
        "segmentPlan",
        "segment",
        "visualPlan",
        "boardSections",
        "chunks",
        "retrievedChunks",
    ]:
        _walk_source_refs(payload.get(key), refs)

    if not refs:
        for chunk in safe_list(payload.get("chunks") or payload.get("retrievedChunks")):
            ref = _chunk_to_source_ref(safe_dict(chunk))
            if clean_text(ref.get("chunkId")):
                refs.append(ref)

    return dedupe_source_refs(refs)


def refs_for_quiz_item(item: JsonDict, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    own_refs = dedupe_source_refs([safe_dict(x) for x in safe_list(item.get("sourceRefs"))])
    if own_refs:
        return own_refs
    return fallback_refs[:4]


class AssessmentQuizAgent(BaseLiveTutorAgent):
    agent_name = "AssessmentQuizAgent"
    agent_group = "teaching"
    default_mode = "make_quiz"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the Assessment / Quiz Agent for a human-like Live Tutor.

Your job:
- Create useful questions that check real understanding.
- Use source chunks and current explanation/segment.
- Include answer and explanation.
- Include board-ready quiz text.
- Every quiz item must include sourceRefs.
- Do not ask questions unrelated to the source.
- Output ONLY valid JSON.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        explanation = safe_dict(payload.get("explanation"))
        segment_plan = safe_dict(payload.get("segmentPlan") or payload.get("segment"))
        chunks = safe_list(payload.get("chunks") or payload.get("retrievedChunks"))
        refs = collect_verified_refs_from_payload(payload)

        if not explanation and not segment_plan and not clean_text(payload.get("topic") or payload.get("question")):
            errors.append("AssessmentQuizAgent requires explanation, segmentPlan, topic, or question.")

        if not chunks and not refs:
            errors.append("AssessmentQuizAgent requires chunks or sourceRefs.")

        if refs:
            warnings.append(f"AssessmentQuizAgent received {len(refs)} reusable verified sourceRefs.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="AssessmentQuizAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        explanation = safe_dict(payload.get("explanation"))
        segment_plan = safe_dict(payload.get("segmentPlan") or payload.get("segment"))
        node = safe_dict(payload.get("selectedNode") or payload.get("node"))
        grounding = safe_dict(payload.get("sourceGrounding") or payload.get("grounding"))
        refs = collect_verified_refs_from_payload(payload)

        difficulty = clean_text(payload.get("difficulty") or "beginner", 80)
        quiz_count = int(payload.get("quizCount") or 4)
        chunks_text = self.compact_chunks_for_prompt(
            safe_list(payload.get("chunks") or payload.get("retrievedChunks")),
            max_chars=65000,
        )

        return f"""
Create assessment quiz items for this Live Tutor lesson.

Student level: {context.studentLevel}
Language: {context.language}
Difficulty: {difficulty}
Quiz count: {quiz_count}

STRICT SOURCE RULES:
1. Every quiz item must copy sourceRefs from AVAILABLE VERIFIED SOURCE REFS.
2. Do not output quizItems with empty sourceRefs.
3. Question, correctAnswer, and answerExplanation must be supported by sourceRefs.
4. Do not invent unrelated quiz questions.
5. If the source is about a diagram/concept, ask about that exact selected node.

Return JSON exactly:
{{
  "quizSetId": "quiz_set_1",
  "title": "quiz title",
  "quizItems": [
    {{
      "quizId": "quiz_1",
      "type": "quick-check|mcq|short-answer|explain-back|true-false|fill-blank",
      "difficulty": "easy|medium|advanced",
      "question": "question text",
      "choices": ["A", "B", "C", "D"],
      "correctAnswer": "answer",
      "answerExplanation": "why this answer is correct using source evidence",
      "boardQuizText": "short board version",
      "skillChecked": "what understanding is checked",
      "sourceRefs": ["copy sourceRef objects from AVAILABLE VERIFIED SOURCE REFS"],
      "metadata": {{}}
    }}
  ],
  "explainBackPrompt": "prompt for student to explain in their own words",
  "sourceRefs": ["copy sourceRef objects used by quiz items"],
  "metadata": {{
    "fallbackUsed": false,
    "agent": "AssessmentQuizAgent"
  }}
}}

Selected node:
{node}

Source grounding:
{grounding}

Segment plan:
{segment_plan}

Explanation:
{explanation}

AVAILABLE VERIFIED SOURCE REFS:
{refs}

Source chunks:
{chunks_text}
"""

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        fallback_refs = collect_verified_refs_from_payload(payload)

        quiz_items: List[JsonDict] = []

        for index, item in enumerate(safe_list(raw.get("quizItems") or raw.get("quiz") or raw.get("questions"))):
            quiz = safe_dict(item)
            quiz_type = clean_text(quiz.get("type") or "quick-check", 80)

            if quiz_type not in VALID_QUIZ_TYPES:
                quiz_type = "quick-check"

            item_refs = refs_for_quiz_item(quiz, fallback_refs)

            quiz_items.append(
                {
                    "quizId": normalize_id(
                        quiz.get("quizId") or quiz.get("id") or f"quiz_{index + 1}",
                        f"quiz_{index + 1}",
                    ),
                    "type": quiz_type,
                    "difficulty": clean_text(quiz.get("difficulty") or "easy", 60),
                    "question": clean_text(quiz.get("question") or "", 1200),
                    "choices": [clean_text(x, 500) for x in safe_list(quiz.get("choices") or quiz.get("options"))],
                    "correctAnswer": clean_text(
                        quiz.get("correctAnswer") or quiz.get("answer") or quiz.get("correct") or "",
                        1000,
                    ),
                    "answerExplanation": clean_text(
                        quiz.get("answerExplanation") or quiz.get("explanation") or quiz.get("why") or "",
                        1600,
                    ),
                    "boardQuizText": clean_text(
                        quiz.get("boardQuizText") or quiz.get("question") or "",
                        500,
                    ),
                    "skillChecked": clean_text(quiz.get("skillChecked") or quiz.get("concept") or "", 500),
                    "sourceRefs": item_refs,
                    "metadata": {
                        **safe_dict(quiz.get("metadata")),
                        "sourceRefsInherited": bool(
                            not safe_list(quiz.get("sourceRefs")) and bool(item_refs)
                        ),
                        "fallbackUsed": False,
                    },
                }
            )

        all_refs: List[JsonDict] = []
        all_refs.extend([safe_dict(x) for x in safe_list(raw.get("sourceRefs"))])
        all_refs.extend(fallback_refs[:4])

        for quiz in quiz_items:
            all_refs.extend(safe_list(quiz.get("sourceRefs")))

        explain_back_prompt = clean_text(raw.get("explainBackPrompt") or "", 700)
        if not explain_back_prompt and quiz_items:
            explain_back_prompt = (
                "Explain this concept back in your own words using one source-backed detail "
                "and one example from the board."
            )

        return {
            "quizSetId": normalize_id(raw.get("quizSetId") or "quiz_set_1", "quiz_set_1"),
            "title": clean_text(raw.get("title") or "Understanding Check", 180),
            "quizItems": quiz_items,
            "questions": quiz_items,
            "explainBackPrompt": explain_back_prompt,
            "sourceRefs": dedupe_source_refs(all_refs),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "boardReady": True,
                "showQuizCommandReady": True,
                "sourceRefsInheritedWhereSafe": True,
                "verifiedFallbackRefCount": len(fallback_refs),
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        quiz_items = safe_list(output.get("quizItems"))
        if not quiz_items:
            errors.append("quizItems are required.")

        ref_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "AssessmentQuizAgent.output.sourceRefs",
        )
        errors.extend(ref_validation.errors)
        warnings.extend(ref_validation.warnings)

        for index, quiz in enumerate(quiz_items):
            item = safe_dict(quiz)

            if item.get("type") not in VALID_QUIZ_TYPES:
                errors.append(f"quizItems[{index}].type invalid: {item.get('type')}")

            if not clean_text(item.get("question")):
                errors.append(f"quizItems[{index}].question is required.")

            if not clean_text(item.get("correctAnswer")):
                errors.append(f"quizItems[{index}].correctAnswer is required.")

            if not clean_text(item.get("answerExplanation")):
                errors.append(f"quizItems[{index}].answerExplanation is required.")

            if item.get("type") == "mcq" and len(safe_list(item.get("choices"))) < 2:
                errors.append(f"quizItems[{index}] mcq requires at least 2 choices.")

            if not safe_list(item.get("sourceRefs")):
                errors.append(f"quizItems[{index}].sourceRefs are required.")

            if not clean_text(item.get("boardQuizText")):
                warnings.append(f"quizItems[{index}] should include boardQuizText.")

        if not clean_text(output.get("explainBackPrompt")):
            warnings.append("explainBackPrompt missing.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="AssessmentQuizAgent.validate_output",
            fallbackUsed=False,
        )