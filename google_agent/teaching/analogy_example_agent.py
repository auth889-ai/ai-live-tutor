"""
google_agent/teaching/analogy_example_agent.py
===============================================================================
Analogy / Example Agent.

Problem fixed:
- Gemini may return examples with sourceDerived=true but sourceRefs=[].
- Old strict validation stopped the whole Stage 2 pipeline.
- This file repairs only safe citation plumbing:
  if selected node / RAG / SourceGrounding already has verified sourceRefs,
  source-derived examples inherit those refs.
- If no verified refs exist, sourceDerived is downgraded to false instead of fake citation.
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


def _walk_collect_source_refs(value: Any, refs: List[JsonDict]) -> None:
    if isinstance(value, list):
        for item in value:
            _walk_collect_source_refs(item, refs)
        return

    if isinstance(value, dict):
        local_refs = value.get("sourceRefs")
        if isinstance(local_refs, list):
            refs.extend([safe_dict(item) for item in local_refs if safe_dict(item)])

        for nested in value.values():
            _walk_collect_source_refs(nested, refs)


def collect_verified_refs_from_payload(payload: JsonDict) -> List[JsonDict]:
    """
    Collect already-verified refs from selected node, RAG, grounding, explanation,
    and chunks. This does not invent citations.
    """

    refs: List[JsonDict] = []

    priority_keys = [
        "sourceRefs",
        "groundedRefs",
        "verifiedSourceRefs",
        "selectedNode",
        "node",
        "sourceGrounding",
        "grounding",
        "explanation",
        "detailedExplanation",
        "ragResult",
        "retrieval",
        "chunks",
        "retrievedChunks",
    ]

    for key in priority_keys:
        _walk_collect_source_refs(payload.get(key), refs)

    for chunk in safe_list(payload.get("chunks") or payload.get("retrievedChunks")):
        item = safe_dict(chunk)
        chunk_id = clean_text(item.get("chunkId") or item.get("id") or "", 220)
        page = item.get("page") or item.get("pageNumber") or 1

        if not chunk_id:
            continue

        refs.append(
            {
                "chunkId": chunk_id,
                "sourceRef": clean_text(item.get("sourceRef") or item.get("ref") or chunk_id, 300),
                "pageRef": clean_text(item.get("pageRef") or item.get("sourceRef") or chunk_id, 300),
                "page": page,
                "quote": clean_text(item.get("textPreview") or item.get("text") or "", 700),
                "confidence": item.get("confidence") or 0.75,
                "resourceId": clean_text(item.get("resourceId") or "", 180),
            }
        )

    return dedupe_source_refs(refs)


def refs_for_item(item: JsonDict, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    own_refs = dedupe_source_refs([safe_dict(x) for x in safe_list(item.get("sourceRefs"))])
    if own_refs:
        return own_refs
    return fallback_refs[:4]


class AnalogyExampleAgent(BaseLiveTutorAgent):
    agent_name = "AnalogyExampleAgent"
    agent_group = "teaching"
    default_mode = "make_analogy_examples"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the Analogy / Example Agent for a human-like AI Live Tutor.

Your job:
- Create simple analogies and examples that make the topic intuitive.
- If an example comes directly from source, include sourceRefs and mark sourceDerived=true.
- If it is a teacher-created analogy, mark sourceDerived=false and keep it consistent with source facts.
- Make examples board-friendly.
- Do not invent unsupported factual claims.
- Output ONLY valid JSON.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        explanation = safe_dict(payload.get("explanation") or payload.get("detailedExplanation"))
        node = safe_dict(payload.get("selectedNode") or payload.get("node"))
        chunks = safe_list(payload.get("chunks") or payload.get("retrievedChunks"))
        refs = collect_verified_refs_from_payload(payload)

        if not explanation and not node and not clean_text(payload.get("topic") or payload.get("question")):
            errors.append("AnalogyExampleAgent requires explanation, node, topic, or question.")

        if not chunks and not refs:
            errors.append("AnalogyExampleAgent requires chunks or sourceRefs.")

        if refs:
            warnings.append(f"AnalogyExampleAgent received {len(refs)} reusable verified sourceRefs.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="AnalogyExampleAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        explanation = safe_dict(payload.get("explanation") or payload.get("detailedExplanation"))
        node = safe_dict(payload.get("selectedNode") or payload.get("node"))
        strategy = safe_dict(payload.get("teachingStrategy") or payload.get("strategy"))
        grounding = safe_dict(payload.get("sourceGrounding") or payload.get("grounding"))
        fallback_refs = collect_verified_refs_from_payload(payload)
        chunks_text = self.compact_chunks_for_prompt(
            safe_list(payload.get("chunks") or payload.get("retrievedChunks")),
            max_chars=65000,
        )

        return f"""
Create analogies and examples for this Live Tutor concept.

Student level: {context.studentLevel}
Language: {context.language}
Student question: {context.question}

STRICT SOURCE RULES:
- sourceDerived=true means the example is directly supported by the provided sourceRefs.
- If you mark sourceDerived=true, copy one or more sourceRefs from AVAILABLE VERIFIED SOURCE REFS.
- If you cannot attach sourceRefs, mark sourceDerived=false.
- Teacher-created analogies should normally be sourceDerived=false.
- Do not output sourceDerived=true with empty sourceRefs.
- All factual teaching claims need sourceRefs.
- Make boardMiniExample very short.

Return JSON exactly:
{{
  "analogySetId": "analogy_set_1",
  "title": "string",
  "analogies": [
    {{
      "analogyId": "analogy_1",
      "analogy": "simple analogy",
      "mapping": [
        {{
          "conceptPart": "source concept part",
          "analogyPart": "analogy part",
          "why": "why mapping helps"
        }}
      ],
      "sourceDerived": false,
      "sourceRefs": [],
      "boardMiniExample": "short board text",
      "caution": "where analogy can break"
    }}
  ],
  "examples": [
    {{
      "exampleId": "example_1",
      "title": "example title",
      "example": "clear example",
      "steps": ["step"],
      "sourceDerived": true,
      "sourceRefs": ["copy exact sourceRef object here when sourceDerived is true"],
      "boardMiniExample": "short board text"
    }}
  ],
  "sourceRefs": ["copy sourceRef objects used by source-derived examples"],
  "metadata": {{
    "fallbackUsed": false,
    "agent": "AnalogyExampleAgent"
  }}
}}

Selected node:
{node}

Detailed explanation:
{explanation}

Source grounding result:
{grounding}

Teaching strategy:
{strategy}

AVAILABLE VERIFIED SOURCE REFS, reuse these exactly when sourceDerived=true:
{fallback_refs}

Source chunks:
{chunks_text}
"""

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        fallback_refs = collect_verified_refs_from_payload(payload)

        analogies: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("analogies"))):
            analogy = safe_dict(item)

            requested_source_derived = bool(analogy.get("sourceDerived", False))
            item_refs = (
                refs_for_item(analogy, fallback_refs)
                if requested_source_derived
                else dedupe_source_refs([safe_dict(x) for x in safe_list(analogy.get("sourceRefs"))])
            )

            source_derived = bool(requested_source_derived and item_refs)

            analogies.append(
                {
                    "analogyId": normalize_id(
                        analogy.get("analogyId") or f"analogy_{index + 1}",
                        f"analogy_{index + 1}",
                    ),
                    "analogy": clean_text(analogy.get("analogy") or "", 1800),
                    "mapping": [
                        {
                            "conceptPart": clean_text(safe_dict(m).get("conceptPart") or "", 300),
                            "analogyPart": clean_text(safe_dict(m).get("analogyPart") or "", 300),
                            "why": clean_text(safe_dict(m).get("why") or "", 500),
                        }
                        for m in safe_list(analogy.get("mapping"))
                    ],
                    "sourceDerived": source_derived,
                    "sourceRefs": item_refs if source_derived else [],
                    "boardMiniExample": clean_text(
                        analogy.get("boardMiniExample") or analogy.get("analogy") or "",
                        500,
                    ),
                    "caution": clean_text(analogy.get("caution") or "", 700),
                    "metadata": {
                        **safe_dict(analogy.get("metadata")),
                        "sourceRefsInherited": bool(
                            requested_source_derived
                            and not safe_list(analogy.get("sourceRefs"))
                            and item_refs
                        ),
                    },
                }
            )

        examples: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("examples"))):
            example = safe_dict(item)

            requested_source_derived = bool(example.get("sourceDerived", True))
            item_refs = (
                refs_for_item(example, fallback_refs)
                if requested_source_derived
                else dedupe_source_refs([safe_dict(x) for x in safe_list(example.get("sourceRefs"))])
            )

            source_derived = bool(requested_source_derived and item_refs)

            examples.append(
                {
                    "exampleId": normalize_id(
                        example.get("exampleId") or f"example_{index + 1}",
                        f"example_{index + 1}",
                    ),
                    "title": clean_text(example.get("title") or f"Example {index + 1}", 180),
                    "example": clean_text(example.get("example") or "", 2200),
                    "steps": [clean_text(x, 500) for x in safe_list(example.get("steps"))],
                    "sourceDerived": source_derived,
                    "sourceRefs": item_refs if source_derived else [],
                    "boardMiniExample": clean_text(
                        example.get("boardMiniExample")
                        or example.get("title")
                        or example.get("example")
                        or "",
                        500,
                    ),
                    "metadata": {
                        **safe_dict(example.get("metadata")),
                        "sourceRefsInherited": bool(
                            requested_source_derived
                            and not safe_list(example.get("sourceRefs"))
                            and item_refs
                        ),
                    },
                }
            )

        all_refs: List[JsonDict] = []
        all_refs.extend([safe_dict(x) for x in safe_list(raw.get("sourceRefs"))])
        all_refs.extend(fallback_refs[:4])

        for analogy in analogies:
            all_refs.extend(safe_list(analogy.get("sourceRefs")))

        for example in examples:
            all_refs.extend(safe_list(example.get("sourceRefs")))

        return {
            "analogySetId": normalize_id(
                raw.get("analogySetId") or "analogy_set_1",
                "analogy_set_1",
            ),
            "title": clean_text(raw.get("title") or "Analogies and Examples", 180),
            "analogies": analogies,
            "examples": examples,
            "sourceRefs": dedupe_source_refs(all_refs),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "boardReady": True,
                "sourceRefsInheritedWhereSafe": True,
                "verifiedFallbackRefCount": len(fallback_refs),
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        if not safe_list(output.get("analogies")) and not safe_list(output.get("examples")):
            errors.append("At least one analogy or example is required.")

        ref_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "AnalogyExampleAgent.output.sourceRefs",
        )
        errors.extend(ref_validation.errors)
        warnings.extend(ref_validation.warnings)

        for index, analogy in enumerate(safe_list(output.get("analogies"))):
            item = safe_dict(analogy)

            if not clean_text(item.get("analogy")):
                errors.append(f"analogies[{index}].analogy is required.")

            if not clean_text(item.get("boardMiniExample")):
                warnings.append(f"analogies[{index}] should include boardMiniExample.")

            if item.get("sourceDerived") is True and not safe_list(item.get("sourceRefs")):
                errors.append(f"analogies[{index}] is sourceDerived but has no sourceRefs.")

        for index, example in enumerate(safe_list(output.get("examples"))):
            item = safe_dict(example)

            if not clean_text(item.get("example")):
                errors.append(f"examples[{index}].example is required.")

            if item.get("sourceDerived") is True and not safe_list(item.get("sourceRefs")):
                errors.append(f"examples[{index}] is sourceDerived but has no sourceRefs.")

            if not clean_text(item.get("boardMiniExample")):
                warnings.append(f"examples[{index}] should include boardMiniExample.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="AnalogyExampleAgent.validate_output",
            fallbackUsed=False,
        )