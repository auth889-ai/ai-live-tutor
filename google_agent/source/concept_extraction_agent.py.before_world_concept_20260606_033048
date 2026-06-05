"""
google_agent/live_tutor_agents/source/concept_extraction_agent.py
===============================================================================
Concept Extraction Agent.

Separate strong agent responsibility:
- Extract main concepts, sub-concepts, definitions, examples, mistakes.
- Every concept must include sourceRefs from chunks.
- No unsupported concepts.
- Output is used by KnowledgeGraphAgent and CoursePlannerAgent.
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


class ConceptExtractionAgent(BaseLiveTutorAgent):
    agent_name = "ConceptExtractionAgent"
    agent_group = "source"
    default_mode = "extract_concepts"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the Concept Extraction Agent for a human-like source-grounded Live Tutor.

Your job:
- Extract the important teachable concepts from source chunks.
- Include definitions, examples, dependencies, common mistakes, and visual hints.
- Every concept MUST include sourceRefs with exact chunkId/sourceRef/page from provided chunks.
- Do not invent unsupported concepts.
- Prefer accurate concepts over many weak concepts.
- Output ONLY JSON.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        if not safe_list(payload.get("chunks")):
            errors.append("ConceptExtractionAgent requires chunks.")
        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="ConceptExtractionAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        chunks_text = self.compact_chunks_for_prompt(safe_list(payload.get("chunks")), max_chars=90000)
        max_concepts = int(payload.get("maxConcepts") or 40)

        return f"""
Extract source-grounded teachable concepts for the Live Tutor.

Student level: {context.studentLevel}
Language: {context.language}
Question/topic: {context.question}
Max concepts: {max_concepts}

Return JSON exactly:
{{
  "title": "resource/concept map title",
  "concepts": [
    {{
      "conceptId": "stable_snake_case",
      "label": "short label",
      "definition": "clear source-grounded definition",
      "summary": "one simple teaching sentence",
      "conceptType": "root|topic|definition|process|example|warning|tool|question",
      "importance": 0.8,
      "parentHint": "optional parent label",
      "dependsOn": ["conceptId_or_label"],
      "examples": ["short examples"],
      "commonMistakes": ["mistake"],
      "visualHints": ["tree", "flowchart", "table", "timeline", "diagram"],
      "sourceRefs": [
        {{
          "chunkId": "exact chunkId from chunks",
          "sourceRef": "exact sourceRef from chunks",
          "page": 1,
          "quote": "short evidence"
        }}
      ]
    }}
  ],
  "metadata": {{
    "fallbackUsed": false
  }}
}}

Source chunks:
{chunks_text}
"""

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        concepts: List[JsonDict] = []

        for index, item in enumerate(safe_list(raw.get("concepts"))):
            raw_concept = safe_dict(item)
            label = clean_text(raw_concept.get("label") or raw_concept.get("title") or raw_concept.get("name"), 120)
            concept_id = normalize_id(raw_concept.get("conceptId") or raw_concept.get("id") or label, f"concept_{index + 1}")

            concepts.append(
                {
                    "conceptId": concept_id,
                    "label": label,
                    "definition": clean_text(raw_concept.get("definition") or "", 1200),
                    "summary": clean_text(raw_concept.get("summary") or "", 700),
                    "conceptType": clean_text(raw_concept.get("conceptType") or "topic", 80),
                    "importance": max(0.0, min(1.0, float(raw_concept.get("importance") or 0.5))),
                    "parentHint": clean_text(raw_concept.get("parentHint") or raw_concept.get("parent") or "", 120),
                    "dependsOn": [clean_text(x, 120) for x in safe_list(raw_concept.get("dependsOn"))],
                    "examples": [clean_text(x, 500) for x in safe_list(raw_concept.get("examples"))],
                    "commonMistakes": [clean_text(x, 500) for x in safe_list(raw_concept.get("commonMistakes"))],
                    "visualHints": [clean_text(x, 80) for x in safe_list(raw_concept.get("visualHints"))],
                    "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(raw_concept.get("sourceRefs"))]),
                    "metadata": safe_dict(raw_concept.get("metadata")),
                }
            )

        all_refs: List[JsonDict] = []
        for concept in concepts:
            all_refs.extend(safe_list(concept.get("sourceRefs")))

        return {
            "title": clean_text(raw.get("title") or "Extracted Concepts", 180),
            "conceptCount": len(concepts),
            "concepts": concepts,
            "sourceRefs": dedupe_source_refs(all_refs),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        concepts = safe_list(output.get("concepts"))
        if not concepts:
            errors.append("ConceptExtractionAgent output must include concepts.")

        seen = set()
        for index, concept in enumerate(concepts):
            item = safe_dict(concept)
            concept_id = clean_text(item.get("conceptId"), 120)
            if not concept_id:
                errors.append(f"concepts[{index}].conceptId is required.")
            if concept_id in seen:
                errors.append(f"Duplicate conceptId: {concept_id}")
            seen.add(concept_id)

            if not clean_text(item.get("label")):
                errors.append(f"concepts[{index}].label is required.")
            if not clean_text(item.get("definition")) and not clean_text(item.get("summary")):
                warnings.append(f"concepts[{index}] should include definition or summary.")

            ref_validation = require_source_refs(
                safe_list(item.get("sourceRefs")),
                f"ConceptExtractionAgent.concepts[{index}].sourceRefs",
            )
            errors.extend(ref_validation.errors)

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