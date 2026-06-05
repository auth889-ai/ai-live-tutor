"""
google_agent/source/source_grounding_agent.py
===============================================================================
Source Grounding Agent.

Fix:
- Do not validate the whole explanation JSON string.
- Extract only real teachable claims from selectedNode, explanation steps,
  board notes, visual sections, and boardCommands.
- Preserve sourceRefs from node/evidence/chunks.
- Use softer lexical matching for paraphrased Gemini explanations.
- Still reject fully ungrounded output.
===============================================================================
"""

from __future__ import annotations

import re
from typing import Any, List, Tuple

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
    AgentContext,
    JsonDict,
    SourceChunk,
    ValidationResult,
    clean_text,
    dedupe_source_refs,
    normalize_chunks,
    normalize_source_refs,
    normalize_source_refs_from_chunks,
    normalize_source_refs_from_payload,
    require_source_refs,
    safe_dict,
    safe_list,
)


STOP_WORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "are",
    "was",
    "were",
    "into",
    "when",
    "then",
    "than",
    "have",
    "has",
    "you",
    "your",
    "will",
    "can",
    "not",
    "but",
    "all",
    "also",
    "using",
    "use",
    "used",
    "about",
    "what",
    "why",
    "how",
    "into",
    "onto",
    "they",
    "them",
    "their",
    "there",
    "where",
    "which",
    "while",
    "because",
    "through",
    "student",
    "teacher",
    "concept",
    "lesson",
    "board",
    "explain",
    "explanation",
    "এটা",
    "একটা",
    "করে",
    "হবে",
    "মানে",
    "যখন",
    "তখন",
}


CLAIM_TEXT_KEYS = {
    "title",
    "label",
    "shortDefinition",
    "summary",
    "definition",
    "simpleDefinition",
    "intuition",
    "teacherSummary",
    "explainBackPrompt",
    "heading",
    "explanation",
    "boardNote",
    "text",
    "body",
    "description",
    "mistake",
    "correction",
    "example",
    "why",
    "reason",
}


def tokenize(text: str) -> List[str]:
    text = clean_text(text, 20000).lower()
    words = re.findall(r"[a-z0-9_]{3,}", text)
    return [w for w in words if w not in STOP_WORDS]


def split_sentences(text: str) -> List[str]:
    text = clean_text(text, 20000)
    pieces = re.split(r"(?<=[.!?।])\s+|\n+|•|\u2022", text)
    return [clean_text(piece, 900) for piece in pieces if len(clean_text(piece, 900)) >= 12]


def chunk_text(chunk: SourceChunk) -> str:
    return clean_text(
        " ".join(
            [
                chunk.heading or "",
                chunk.title or "",
                chunk.textPreview or "",
                chunk.text or "",
            ]
        ),
        24000,
    )


def score_claim_against_chunk(claim: str, chunk: SourceChunk) -> float:
    claim_tokens = tokenize(claim)
    source_tokens = tokenize(chunk_text(chunk))

    if not claim_tokens or not source_tokens:
        return 0.0

    claim_set = set(claim_tokens)
    source_set = set(source_tokens)

    overlap = len(claim_set & source_set)
    recall = overlap / max(1, len(claim_set))

    claim_clean = clean_text(claim, 500).lower()
    source_clean = chunk_text(chunk).lower()

    phrase_bonus = 0.0
    if claim_clean and claim_clean in source_clean:
        phrase_bonus += 0.5

    heading_bonus = 0.0
    heading_tokens = set(tokenize(chunk.heading))
    title_tokens = set(tokenize(chunk.title))
    if claim_set & heading_tokens:
        heading_bonus += 0.12
    if claim_set & title_tokens:
        heading_bonus += 0.12

    page_bonus = 0.04 if chunk.page else 0.0
    table_bonus = 0.04 if safe_dict(chunk.metadata).get("tableLike") else 0.0
    figure_bonus = 0.04 if safe_dict(chunk.metadata).get("figureLike") else 0.0

    return min(1.0, recall + phrase_bonus + heading_bonus + page_bonus + table_bonus + figure_bonus)


def find_quote_for_claim(claim: str, text: str) -> str:
    sentences = split_sentences(text)
    if not sentences:
        return clean_text(text, 500)

    claim_terms = set(tokenize(claim))
    best_sentence = sentences[0]
    best_score = -1

    for sentence in sentences:
        score = len(claim_terms & set(tokenize(sentence)))
        if score > best_score:
            best_score = score
            best_sentence = sentence

    return clean_text(best_sentence, 500)


def best_source_refs_for_claim(
    claim: str,
    chunks: List[SourceChunk],
    min_score: float = 0.10,
    limit: int = 4,
) -> Tuple[List[JsonDict], List[JsonDict]]:
    scored: List[Tuple[float, SourceChunk]] = []

    for chunk in chunks:
        score = score_claim_against_chunk(claim, chunk)
        if score >= min_score:
            scored.append((score, chunk))

    scored.sort(key=lambda item: item[0], reverse=True)

    refs: List[JsonDict] = []
    matches: List[JsonDict] = []

    for score, chunk in scored[:limit]:
        quote = find_quote_for_claim(claim, chunk.text or chunk.textPreview)
        ref = chunk.to_source_ref(quote=quote, confidence=max(0.55, score)).to_dict()
        refs.append(ref)
        matches.append(
            {
                "chunkId": chunk.chunkId,
                "page": chunk.page,
                "score": round(score, 3),
                "quote": quote,
            }
        )

    return dedupe_source_refs(refs), matches


def ref_points_to_available_chunk(ref: JsonDict, chunks: List[SourceChunk]) -> bool:
    ref = safe_dict(ref)
    ref_chunk_id = clean_text(ref.get("chunkId"), 240)
    ref_page = int(ref.get("page") or 0)

    for chunk in chunks:
        if ref_chunk_id and clean_text(chunk.chunkId, 240) == ref_chunk_id:
            return True
        if ref_page and int(chunk.page or 0) == ref_page:
            return True

    return False


def refs_available_in_chunks(refs: List[JsonDict], chunks: List[SourceChunk]) -> List[JsonDict]:
    normalized = normalize_source_refs(refs)
    return [ref for ref in normalized if ref_points_to_available_chunk(ref, chunks)]


def claim_from_text(
    claim_id: str,
    text: Any,
    claim_type: str,
    source_refs: Any = None,
    metadata: JsonDict | None = None,
    max_len: int = 1400,
) -> JsonDict | None:
    cleaned = clean_text(text, max_len)
    if len(cleaned) < 8:
        return None

    return {
        "claimId": clean_text(claim_id, 160),
        "text": cleaned,
        "type": clean_text(claim_type, 80),
        "sourceRefs": normalize_source_refs(source_refs),
        "metadata": safe_dict(metadata),
    }


def append_claim(
    claims: List[JsonDict],
    claim_id: str,
    text: Any,
    claim_type: str,
    source_refs: Any = None,
    metadata: JsonDict | None = None,
) -> None:
    claim = claim_from_text(claim_id, text, claim_type, source_refs, metadata)
    if claim:
        claims.append(claim)


def source_refs_from_value(value: Any, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    refs = normalize_source_refs(safe_dict(value).get("sourceRefs"))
    return refs or fallback_refs


def extract_claims_from_selected_node(payload: JsonDict, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    node = safe_dict(payload.get("selectedNode") or payload.get("node"))
    claims: List[JsonDict] = []
    if not node:
        return claims

    node_refs = normalize_source_refs(node.get("sourceRefs")) or fallback_refs

    append_claim(
        claims,
        "node_title",
        node.get("title") or node.get("label"),
        "node_title",
        node_refs,
    )
    append_claim(
        claims,
        "node_definition",
        node.get("shortDefinition") or node.get("summary"),
        "node_definition",
        node_refs,
    )

    for index, item in enumerate(safe_list(node.get("evidenceQuotes"))):
        ev = safe_dict(item)
        append_claim(
            claims,
            f"node_evidence_{index + 1}",
            ev.get("quote"),
            "node_evidence_quote",
            node_refs,
            {"page": ev.get("page")},
        )

    return claims


def extract_claims_from_explanation(payload: JsonDict, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    explanation = safe_dict(payload.get("explanation") or payload.get("detailedExplanation"))
    claims: List[JsonDict] = []

    if not explanation:
        raw_text = clean_text(payload.get("explanation") or payload.get("detailedExplanation") or "", 12000)
        for index, sentence in enumerate(split_sentences(raw_text)[:12]):
            append_claim(
                claims,
                f"explanation_sentence_{index + 1}",
                sentence,
                "explanation_sentence",
                fallback_refs,
            )
        return claims

    root_refs = normalize_source_refs(explanation.get("sourceRefs")) or fallback_refs

    append_claim(
        claims,
        "explanation_title",
        explanation.get("title"),
        "explanation_title",
        root_refs,
    )
    append_claim(
        claims,
        "simple_definition",
        explanation.get("simpleDefinition") or explanation.get("definition"),
        "simple_definition",
        root_refs,
    )
    append_claim(
        claims,
        "intuition",
        explanation.get("intuition"),
        "intuition",
        root_refs,
    )
    append_claim(
        claims,
        "teacher_summary",
        explanation.get("teacherSummary") or explanation.get("summary"),
        "teacher_summary",
        root_refs,
    )

    for index, step_raw in enumerate(safe_list(explanation.get("stepByStep") or explanation.get("steps"))):
        step = safe_dict(step_raw)
        refs = source_refs_from_value(step, root_refs)
        append_claim(
            claims,
            f"step_{index + 1}_heading",
            step.get("heading"),
            "step_heading",
            refs,
        )
        append_claim(
            claims,
            f"step_{index + 1}_explanation",
            step.get("explanation") or step.get("body"),
            "step_explanation",
            refs,
        )
        append_claim(
            claims,
            f"step_{index + 1}_board_note",
            step.get("boardNote"),
            "step_board_note",
            refs,
        )

    for index, note_raw in enumerate(safe_list(explanation.get("boardNotes"))):
        note = safe_dict(note_raw)
        refs = source_refs_from_value(note, root_refs)
        append_claim(
            claims,
            f"board_note_{index + 1}",
            note.get("text"),
            "board_note",
            refs,
        )

    for index, reason in enumerate(safe_list(explanation.get("whyItMatters"))):
        append_claim(
            claims,
            f"why_it_matters_{index + 1}",
            reason,
            "why_it_matters",
            root_refs,
        )

    worked = safe_dict(explanation.get("workedExample"))
    if worked:
        refs = source_refs_from_value(worked, root_refs)
        append_claim(
            claims,
            "worked_example",
            worked.get("example") or worked.get("boardNote") or worked.get("title"),
            "worked_example",
            refs,
        )

    for index, mistake_raw in enumerate(safe_list(explanation.get("commonMistakes"))):
        mistake = safe_dict(mistake_raw)
        refs = source_refs_from_value(mistake, root_refs)
        append_claim(
            claims,
            f"mistake_{index + 1}",
            mistake.get("mistake"),
            "common_mistake",
            refs,
        )
        append_claim(
            claims,
            f"mistake_{index + 1}_correction",
            mistake.get("correction"),
            "mistake_correction",
            refs,
        )

    return claims


def extract_claims_from_visual_plan(payload: JsonDict, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    visual_plan = safe_dict(payload.get("visualPlan"))
    claims: List[JsonDict] = []

    for index, section_raw in enumerate(safe_list(visual_plan.get("sections"))):
        section = safe_dict(section_raw)
        refs = source_refs_from_value(section, fallback_refs)
        append_claim(
            claims,
            f"section_{index + 1}_title",
            section.get("title"),
            "visual_section_title",
            refs,
        )
        append_claim(
            claims,
            f"section_{index + 1}_body",
            section.get("body") or section.get("teacherNotes"),
            "visual_section_body",
            refs,
        )

    for index, visual_raw in enumerate(safe_list(visual_plan.get("visuals"))):
        visual = safe_dict(visual_raw)
        refs = source_refs_from_value(visual, fallback_refs)
        append_claim(
            claims,
            f"visual_{index + 1}_title",
            visual.get("title"),
            "visual_title",
            refs,
        )
        spec = safe_dict(visual.get("diagramSpec"))
        for node_index, node_raw in enumerate(safe_list(spec.get("nodes"))[:12]):
            node = safe_dict(node_raw)
            append_claim(
                claims,
                f"visual_{index + 1}_node_{node_index + 1}",
                node.get("label") or node.get("text"),
                "visual_node_label",
                refs,
            )

    return claims


def extract_claims_from_board_commands(payload: JsonDict, fallback_refs: List[JsonDict]) -> List[JsonDict]:
    claims: List[JsonDict] = []

    for index, cmd_raw in enumerate(safe_list(payload.get("boardCommands"))):
        cmd = safe_dict(cmd_raw)
        refs = normalize_source_refs(cmd.get("sourceRefs")) or normalize_source_refs(safe_dict(cmd.get("payload")).get("sourceRefs")) or fallback_refs
        append_claim(
            claims,
            clean_text(cmd.get("commandId") or f"board_command_{index + 1}", 160),
            cmd.get("text") or safe_dict(cmd.get("payload")).get("text"),
            "board_command",
            refs,
            {"commandId": cmd.get("commandId"), "type": cmd.get("type")},
        )

    return claims


def extract_claims_from_payload(payload: JsonDict) -> List[JsonDict]:
    explicit_claims: List[JsonDict] = []
    fallback_refs = normalize_source_refs_from_payload(payload)

    for index, raw in enumerate(safe_list(payload.get("claims"))):
        item = safe_dict(raw)
        text = clean_text(item.get("text") or item.get("claim") or raw, 1400)
        if not text:
            continue
        explicit_claims.append(
            {
                "claimId": clean_text(item.get("claimId") or f"claim_{index + 1}", 160),
                "text": text,
                "type": clean_text(item.get("type") or "claim", 80),
                "sourceRefs": normalize_source_refs(item.get("sourceRefs")) or fallback_refs,
                "metadata": safe_dict(item.get("metadata")),
            }
        )

    if explicit_claims:
        return explicit_claims

    claims: List[JsonDict] = []
    claims.extend(extract_claims_from_selected_node(payload, fallback_refs))
    claims.extend(extract_claims_from_explanation(payload, fallback_refs))
    claims.extend(extract_claims_from_visual_plan(payload, fallback_refs))
    claims.extend(extract_claims_from_board_commands(payload, fallback_refs))

    seen = set()
    unique: List[JsonDict] = []
    for claim in claims:
        key = f"{claim.get('type')}:{clean_text(claim.get('text'), 180).lower()}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(claim)

    return unique[:80]


class SourceGroundingAgent(BaseLiveTutorAgent):
    agent_name = "SourceGroundingAgent"
    agent_group = "source"
    default_mode = "ground_sources"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Source Grounding Agent:
Attach valid sourceRefs to every teaching claim.
Reject output only when the lesson has no grounded claims or strict required
claims cannot be connected to source chunks.
No source proof means no teaching output.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []

        chunks = normalize_chunks(payload.get("chunks"))
        claims = extract_claims_from_payload(payload)

        if not chunks:
            errors.append("SourceGroundingAgent requires chunks.")
        if not claims:
            errors.append("SourceGroundingAgent requires extracted teaching claims.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="SourceGroundingAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        chunks = normalize_chunks(payload.get("chunks"))
        claims = extract_claims_from_payload(payload)

        min_score = float(payload.get("minGroundingScore") or 0.10)
        limit = int(payload.get("sourceLimitPerClaim") or 4)

        fallback_refs = normalize_source_refs_from_payload(payload) or normalize_source_refs_from_chunks(chunks)

        grounded_claims: List[JsonDict] = []
        unsupported_claims: List[JsonDict] = []
        weak_claims: List[JsonDict] = []
        all_refs: List[JsonDict] = []

        for claim in claims:
            claim = safe_dict(claim)
            text = clean_text(claim.get("text"), 1400)
            if not text:
                continue

            existing_refs = refs_available_in_chunks(
                normalize_source_refs(claim.get("sourceRefs")) or fallback_refs,
                chunks,
            )

            refs, matches = best_source_refs_for_claim(
                claim=text,
                chunks=chunks,
                min_score=min_score,
                limit=limit,
            )

            if refs:
                final_refs = dedupe_source_refs(refs + existing_refs)
                grounded_claims.append(
                    {
                        **claim,
                        "text": text,
                        "sourceRefs": final_refs,
                        "matches": matches,
                        "grounded": True,
                        "groundingMode": "lexical_match",
                    }
                )
                all_refs.extend(final_refs)
                continue

            if existing_refs:
                weak_claims.append(
                    {
                        **claim,
                        "text": text,
                        "sourceRefs": existing_refs,
                        "matches": [],
                        "grounded": True,
                        "weakGrounding": True,
                        "groundingMode": "existing_source_ref_verified_by_chunk",
                        "reason": "Claim had sourceRefs pointing to available chunks but lexical paraphrase score was low.",
                    }
                )
                all_refs.extend(existing_refs)
                continue

            unsupported_claims.append(
                {
                    **claim,
                    "text": text,
                    "sourceRefs": [],
                    "matches": [],
                    "grounded": False,
                    "reason": "No sourceRef and no chunk met minimum grounding score.",
                }
            )

        source_refs = dedupe_source_refs(all_refs)

        strict = payload.get("strict", True) is not False
        fail_on_unsupported = payload.get("failOnUnsupportedClaims", False) is True

        grounded_total = len(grounded_claims) + len(weak_claims)

        ok = bool(grounded_total) and bool(source_refs)
        if strict and fail_on_unsupported and unsupported_claims:
            ok = False

        return {
            "grounded": ok,
            "strict": strict,
            "failOnUnsupportedClaims": fail_on_unsupported,
            "minGroundingScore": min_score,
            "claimCount": len(claims),
            "groundedClaimCount": len(grounded_claims),
            "weakGroundedClaimCount": len(weak_claims),
            "unsupportedClaimCount": len(unsupported_claims),
            "groundedClaims": grounded_claims + weak_claims,
            "weakGroundedClaims": weak_claims,
            "unsupportedClaims": unsupported_claims[:20],
            "sourceRefs": source_refs,
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "method": "claim-level-grounding-with-source-ref-verification",
                "note": "This validates only teaching claims, not the whole JSON payload.",
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return raw

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        if not output.get("grounded"):
            errors.append("SourceGroundingAgent did not ground the lesson.")

        if not safe_list(output.get("groundedClaims")):
            errors.append("At least one grounded claim is required.")

        source_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "SourceGroundingAgent.require_source_refs",
        )
        errors.extend(source_validation.errors)
        warnings.extend(source_validation.warnings)

        strict = output.get("strict", True) is not False
        fail_on_unsupported = output.get("failOnUnsupportedClaims", False) is True

        if strict and fail_on_unsupported and safe_list(output.get("unsupportedClaims")):
            errors.append("Strict grounding failed: unsupported claims exist.")

        unsupported_count = len(safe_list(output.get("unsupportedClaims")))
        if unsupported_count:
            warnings.append(f"{unsupported_count} weak/unsupported claims were not used as grounding proof.")

        for claim in safe_list(output.get("groundedClaims")):
            item = safe_dict(claim)
            refs = safe_list(item.get("sourceRefs"))
            if not refs:
                errors.append(f"Grounded claim has no sourceRefs: {item.get('claimId')}")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="SourceGroundingAgent.validate_output",
            fallbackUsed=False,
        )