"""
google_agent/source/rag_retrieval_agent.py
===============================================================================
Strict source-grounded RAG Retrieval Agent for Live Tutor.

Fixes:
- Retrieves real chunks from provided PDF/resource chunks.
- Preserves chunkId/sourceRef/page/quote.
- Gives selected-node sourceRefs strong priority.
- Does NOT invent text.
- Diagram hints are now based ONLY on source chunk text, not the user's requested
  wish-list. This prevents random ER/architecture/sequence hints.
- Atlas mode fails clearly unless actually configured.

Output:
{
  "chunks": [...ranked source chunks...],
  "sourceRefs": [...deduped evidence refs...],
  "query": "...",
  "diagramHints": [...strict hints from evidence...],
  "metadata": { "fallbackUsed": false }
}
===============================================================================
"""

from __future__ import annotations

import math
import os
import re
from collections import Counter, defaultdict
from typing import Any, Dict, List, Tuple


try:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        SourceChunk,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_chunks,
        safe_dict,
        safe_list,
    )
except Exception:
    from ..base_agent import BaseLiveTutorAgent
    from ..contracts import (
        AgentContext,
        JsonDict,
        SourceChunk,
        ValidationResult,
        clean_text,
        dedupe_source_refs,
        normalize_chunks,
        safe_dict,
        safe_list,
    )


STOP_WORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "about",
    "what", "when", "then", "than", "your", "you", "are", "was", "were",
    "can", "will", "how", "why", "all", "also", "use", "used", "using",
    "have", "has", "had", "not", "but", "or", "of", "to", "in", "on",
    "a", "an", "is", "it", "as", "by", "be", "if", "so", "we", "they",
    "their", "them", "our", "us", "i", "me", "my", "do", "does", "did",
    "teach", "explain", "selected", "node", "human", "private", "tutor",
    "details", "detailed", "board", "voice", "quiz", "flowchart", "tree",
    "diagram", "diagrams", "er", "sequence", "architecture", "gantt",
    "mindmap", "timeline", "requirement", "journey", "graph",
}


def tokenize(text: Any) -> List[str]:
    text = clean_text(text, 50000).lower()
    words = re.findall(r"[a-z0-9_]{2,}", text)
    return [w for w in words if w not in STOP_WORDS]


def phrase_tokens(text: Any) -> List[str]:
    text = clean_text(text, 50000).lower()
    phrases: List[str] = []

    for piece in re.split(r"[\n.;:!?()\[\]{}]+", text):
        piece = re.sub(r"\s+", " ", piece).strip()
        if 3 <= len(piece) <= 90:
            phrases.append(piece)

    return phrases


def normalize_query(payload: JsonDict, context: AgentContext) -> str:
    selected_node = safe_dict(payload.get("selectedNode") or payload.get("node"))

    pieces = [
        payload.get("query"),
        payload.get("question"),
        selected_node.get("label"),
        selected_node.get("title"),
        selected_node.get("summary"),
        selected_node.get("definition"),
        context.question,
    ]

    # Keep selected-node source quotes because they are actual evidence.
    for ref in safe_list(selected_node.get("sourceRefs")):
        quote = clean_text(safe_dict(ref).get("quote"), 1000)
        if quote:
            pieces.append(quote)

    query = " ".join(clean_text(x, 1000) for x in pieces if clean_text(x, 1000))
    query = re.sub(r"\s+", " ", query).strip()
    return query or "source grounded live tutor lesson"


def selected_source_ref_ids(payload: JsonDict) -> Tuple[set, set, set]:
    selected_node = safe_dict(payload.get("selectedNode") or payload.get("node"))
    refs = safe_list(payload.get("sourceRefs")) + safe_list(selected_node.get("sourceRefs"))

    chunk_ids = set()
    source_refs = set()
    pages = set()

    for raw in refs:
        ref = safe_dict(raw)
        chunk_id = clean_text(ref.get("chunkId"), 240)
        source_ref = clean_text(ref.get("sourceRef"), 300)

        try:
            page = int(ref.get("page") or 0)
        except Exception:
            page = 0

        if chunk_id:
            chunk_ids.add(chunk_id)
        if source_ref:
            source_refs.add(source_ref)
        if page > 0:
            pages.add(page)

    return chunk_ids, source_refs, pages


def chunk_text(chunk: SourceChunk) -> str:
    return " ".join(
        [
            clean_text(chunk.title, 500),
            clean_text(chunk.heading, 500),
            clean_text(chunk.textPreview, 1500),
            clean_text(chunk.text, 25000),
        ]
    )


def detect_content_flags(text: str, metadata: JsonDict) -> JsonDict:
    lower = text.lower()

    looks_like_sql = bool(
        re.search(r"\b(create|alter|drop|select|insert|update|delete)\b", lower)
        and re.search(r"\b(table|column|database|schema|from|where)\b", lower)
    )

    looks_like_code = looks_like_sql or bool(
        re.search(r"\b(def|function|class|for|while|if|return|public static|console\.log|print)\b", lower)
    )

    table_like = bool(metadata.get("tableLike")) or lower.count("|") >= 4 or bool(
        re.search(r"\b(row|column|field|attribute|compare|comparison|versus|difference)\b", lower)
    )

    figure_like = bool(metadata.get("figureLike")) or bool(
        re.search(r"\b(diagram|figure|flow|chart|tree|graph|timeline|sequence|workflow)\b", lower)
    )

    destructive_change = bool(
        re.search(r"\b(drop|rename|remove|delete|destructive|break|not null|backfill)\b", lower)
    )

    return {
        "looksLikeSql": looks_like_sql,
        "looksLikeCode": looks_like_code,
        "tableLike": table_like,
        "figureLike": figure_like,
        "destructiveChange": destructive_change,
    }


def find_best_quote(query: str, text: str, max_len: int = 520) -> str:
    text = clean_text(text, 30000)
    if not text:
        return ""

    query_terms = set(tokenize(query))
    sentences = [
        clean_text(x, 900)
        for x in re.split(r"(?<=[.!?।])\s+|\n+", text)
        if clean_text(x, 900)
    ]

    if not sentences:
        return clean_text(text, max_len)

    best = sentences[0]
    best_score = -1.0

    for sentence in sentences:
        st = set(tokenize(sentence))
        overlap = len(query_terms & st)
        density = overlap / max(1, len(st))
        score = overlap + density
        if score > best_score:
            best = sentence
            best_score = score

    if best_score <= 0 and len(text) > max_len:
        return clean_text(text, max_len)

    return clean_text(best, max_len)


def make_source_ref(chunk: SourceChunk, query: str, score: float) -> JsonDict:
    return chunk.to_source_ref(
        quote=find_best_quote(query, chunk.text or chunk.textPreview),
        confidence=max(0.0, min(1.0, score)),
    ).to_dict()


def bm25_like_score(query: str, chunk: SourceChunk, doc_freq: Dict[str, int], total_docs: int) -> float:
    q_terms = tokenize(query)
    c_terms = tokenize(chunk_text(chunk))

    if not q_terms or not c_terms:
        return 0.0

    tf = Counter(c_terms)
    dl = len(c_terms)
    avgdl = 450.0
    k1 = 1.5
    b = 0.75

    score = 0.0
    for term in set(q_terms):
        n = max(1, doc_freq.get(term, 1))
        idf = math.log(1 + (total_docs - n + 0.5) / (n + 0.5))
        freq = tf.get(term, 0)
        if freq <= 0:
            continue

        score += idf * ((freq * (k1 + 1)) / (freq + k1 * (1 - b + b * dl / avgdl)))

    return score


def phrase_score(query: str, chunk: SourceChunk) -> float:
    lower = chunk_text(chunk).lower()
    q = clean_text(query, 3000).lower()

    score = 0.0
    labels = phrase_tokens(q)

    for phrase in labels:
        if len(phrase) < 4:
            continue

        if phrase in lower:
            score += 2.5
        else:
            terms = tokenize(phrase)
            if terms:
                overlap = len(set(terms) & set(tokenize(lower[:25000])))
                score += overlap / max(1, len(set(terms)))

    return score


def diagram_hint_score(query: str, chunk: SourceChunk) -> Tuple[float, List[str]]:
    """
    Strict diagram detection.

    Critical fix:
    - Old version used: query + chunk_text(chunk)
    - User query often says: flowchart, ER, sequence, architecture, etc.
    - That polluted every chunk and produced random diagram hints.

    New version uses ONLY source chunk text.
    Diagram hints must come from PDF evidence, not from the user's wish-list.
    """
    text = chunk_text(chunk).lower()
    found: List[str] = []
    score = 0.0

    def has_any(words: List[str]) -> bool:
        return any(word in text for word in words)

    if has_any(["step", "steps", "workflow", "process", "run", "apply", "verify", "deploy", "migration"]):
        found.append("flowchart")
        score += 0.8

    if has_any(["version", "v1", "v2", "before", "after", "evolution", "timeline", "history", "over time"]):
        found.append("timeline")
        score += 0.7

    if has_any(["compare", "comparison", "versus", " vs ", "difference", "practice", "purpose", "pros", "cons"]):
        found.append("table")
        score += 0.6

    if has_any(["sql", "alter table", "create table", "drop column", "add column", "migration script"]):
        found.append("code")
        score += 0.8

    if has_any(["destructive", "break", "risk", "drop", "remove", "delete", "not null", "rollback"]):
        found.append("warning")
        score += 0.6

    # ER needs actual relationship/key evidence, not only "database" or "schema".
    if has_any(["foreign key", "primary key", "cardinality", "one-to-many", "many-to-many", "entity relationship"]):
        found.append("er-diagram")
        score += 0.9

    # Sequence needs actors/components interacting over time.
    if has_any(["developer", "dba", "ci", "pipeline", "request", "response"]) and has_any(
        ["then", "after", "before", "send", "compare", "update", "deploy"]
    ):
        found.append("sequence-diagram")
        score += 0.7

    # Architecture needs real components/services.
    if has_any(["client", "server", "service", "component", "api", "frontend", "backend"]) and has_any(
        ["database", "system", "architecture"]
    ):
        found.append("architecture")
        score += 0.7

    if has_any(["requirement", "must", "should", "constraint", "rule"]):
        found.append("requirement-diagram")
        score += 0.5

    if has_any(["commit", "branch", "merge", "repository", "git"]):
        found.append("git-graph")
        score += 0.5

    return score, found[:5]


def lexical_rank(query: str, chunks: List[SourceChunk], payload: JsonDict) -> List[Tuple[float, SourceChunk, JsonDict]]:
    chunk_ids, source_refs, pages = selected_source_ref_ids(payload)

    total_docs = max(1, len(chunks))
    df: Dict[str, int] = defaultdict(int)

    for chunk in chunks:
        for term in set(tokenize(chunk_text(chunk))):
            df[term] += 1

    ranked: List[Tuple[float, SourceChunk, JsonDict]] = []

    for chunk in chunks:
        text = chunk_text(chunk)
        metadata = safe_dict(chunk.metadata)
        flags = detect_content_flags(text, metadata)

        score = bm25_like_score(query, chunk, df, total_docs)
        score += phrase_score(query, chunk)

        selected_bonus = 0.0
        if chunk.chunkId in chunk_ids:
            selected_bonus += 8.0
        if chunk.sourceRef in source_refs:
            selected_bonus += 8.0
        if chunk.page in pages:
            selected_bonus += 4.0

        heading = f"{chunk.title} {chunk.heading}".lower()
        q_terms = set(tokenize(query))
        heading_overlap = len(q_terms & set(tokenize(heading)))
        heading_bonus = min(2.0, heading_overlap * 0.45)

        diagram_score, diagram_types = diagram_hint_score(query, chunk)

        score += selected_bonus + heading_bonus + diagram_score

        ranked.append(
            (
                score,
                chunk,
                {
                    "score": round(score, 4),
                    "selectedBonus": selected_bonus,
                    "headingBonus": round(heading_bonus, 4),
                    "diagramScore": round(diagram_score, 4),
                    "diagramHints": diagram_types,
                    "contentFlags": flags,
                    "fallbackUsed": False,
                },
            )
        )

    ranked.sort(key=lambda item: item[0], reverse=True)
    return ranked


def chunk_to_payload(chunk: SourceChunk, query: str, score: float, meta: JsonDict) -> JsonDict:
    text = clean_text(chunk.text, 16000)
    preview = clean_text(chunk.textPreview or chunk.text, 1000)

    return {
        "resourceId": chunk.resourceId,
        "chunkId": chunk.chunkId,
        "sourceRef": chunk.sourceRef,
        "pageRef": chunk.pageRef,
        "page": int(chunk.page or 1),
        "chunkIndex": int(chunk.chunkIndex or 0),
        "heading": clean_text(chunk.heading, 220),
        "title": clean_text(chunk.title, 220),
        "text": text,
        "textPreview": preview,
        "score": round(float(score or 0.0), 4),
        "sourceRefs": [make_source_ref(chunk, query, min(0.98, max(0.15, score / 10.0)))],
        "metadata": {
            **safe_dict(chunk.metadata),
            **safe_dict(meta),
            "agent": "RagRetrievalAgent",
            "fallbackUsed": False,
        },
    }


def fail_atlas_not_configured() -> None:
    needed = {
        "MONGODB_URI/MONGO_URI": os.getenv("MONGODB_URI") or os.getenv("MONGO_URI"),
        "MONGODB_DATABASE": os.getenv("MONGODB_DATABASE"),
        "ATLAS_VECTOR_SEARCH_INDEX/LIVE_TUTOR_VECTOR_INDEX": os.getenv("ATLAS_VECTOR_SEARCH_INDEX")
        or os.getenv("LIVE_TUTOR_VECTOR_INDEX"),
    }

    missing = [name for name, value in needed.items() if not clean_text(value)]
    if missing:
        raise RuntimeError(
            "retrieve_atlas requested but Atlas Vector Search is not configured. Missing: "
            + ", ".join(missing)
        )

    raise RuntimeError(
        "retrieve_atlas requested and env exists, but this local Python agent does not execute "
        "Atlas search directly yet. Use the server/MongoDB vector search service or mode=retrieve_local."
    )


class RagRetrievalAgent(BaseLiveTutorAgent):
    agent_name = "RagRetrievalAgent"
    agent_group = "source"
    default_mode = "retrieve_local"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Retrieve real source chunks for the selected tutor node.
Do not invent.
Return ranked chunks with exact chunkId/sourceRef/page/quote.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        mode = clean_text(payload.get("mode") or self.default_mode, 80)
        errors: List[str] = []
        warnings: List[str] = []

        if mode not in {"retrieve", "retrieve_local", "retrieve_selected_node", "retrieve_atlas"}:
            errors.append(f"Unsupported RagRetrievalAgent mode: {mode}")

        if mode == "retrieve_atlas":
            if not (os.getenv("MONGODB_URI") or os.getenv("MONGO_URI")):
                errors.append("retrieve_atlas requires MONGODB_URI or MONGO_URI.")
            if not os.getenv("MONGODB_DATABASE"):
                errors.append("retrieve_atlas requires MONGODB_DATABASE.")
        else:
            if not safe_list(payload.get("chunks")):
                errors.append("RagRetrievalAgent local mode requires chunks.")

        query = normalize_query(payload, AgentContext.from_payload(payload))
        if len(tokenize(query)) < 1:
            warnings.append("RAG query has very few searchable terms.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="RagRetrievalAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        mode = clean_text(payload.get("mode") or self.default_mode, 80)
        if mode == "retrieve":
            mode = "retrieve_local"

        if mode == "retrieve_atlas":
            fail_atlas_not_configured()

        query = normalize_query(payload, context)
        chunks = normalize_chunks(safe_list(payload.get("chunks")))

        if not chunks:
            raise RuntimeError("RagRetrievalAgent received no chunks after normalization.")

        ranked = lexical_rank(query, chunks, payload)

        max_chunks = int(payload.get("maxChunks") or payload.get("limit") or 12)
        max_chunks = max(1, min(max_chunks, 80))

        min_score = float(payload.get("minScore") or 0.0)

        selected: List[Tuple[float, SourceChunk, JsonDict]] = [
            item for item in ranked if item[0] >= min_score
        ][:max_chunks]

        if not selected:
            selected = ranked[: min(max_chunks, len(ranked))]

        if not selected:
            raise RuntimeError("RagRetrievalAgent could not retrieve any relevant chunks.")

        out_chunks: List[JsonDict] = []
        source_refs: List[JsonDict] = []
        diagram_hints: List[str] = []
        content_flags: Dict[str, bool] = {
            "hasSql": False,
            "hasCode": False,
            "hasTable": False,
            "hasFigureOrDiagram": False,
            "hasDestructiveChange": False,
        }

        for score, chunk, meta in selected:
            item = chunk_to_payload(chunk, query, score, meta)
            out_chunks.append(item)
            source_refs.extend(safe_list(item.get("sourceRefs")))

            for hint in safe_list(meta.get("diagramHints")):
                if hint not in diagram_hints:
                    diagram_hints.append(hint)

            flags = safe_dict(meta.get("contentFlags"))
            content_flags["hasSql"] = content_flags["hasSql"] or bool(flags.get("looksLikeSql"))
            content_flags["hasCode"] = content_flags["hasCode"] or bool(flags.get("looksLikeCode"))
            content_flags["hasTable"] = content_flags["hasTable"] or bool(flags.get("tableLike"))
            content_flags["hasFigureOrDiagram"] = content_flags["hasFigureOrDiagram"] or bool(flags.get("figureLike"))
            content_flags["hasDestructiveChange"] = content_flags["hasDestructiveChange"] or bool(flags.get("destructiveChange"))

        return {
            "query": query,
            "chunks": out_chunks,
            "sourceRefs": dedupe_source_refs(source_refs),
            "diagramHints": diagram_hints,
            "contentFlags": content_flags,
            "rankingPreview": [
                {
                    "chunkId": chunk.chunkId,
                    "page": chunk.page,
                    "score": round(score, 4),
                    "heading": clean_text(chunk.heading or chunk.title, 120),
                    "diagramHints": safe_list(meta.get("diagramHints")),
                }
                for score, chunk, meta in selected[:10]
            ],
            "metadata": {
                "agent": self.agent_name,
                "retrievalMode": mode,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "chunkCountInput": len(chunks),
                "chunkCountReturned": len(out_chunks),
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return {
            "query": clean_text(raw.get("query") or normalize_query(payload, context), 4000),
            "chunks": safe_list(raw.get("chunks")),
            "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(raw.get("sourceRefs"))]),
            "diagramHints": [clean_text(x, 80) for x in safe_list(raw.get("diagramHints"))],
            "contentFlags": safe_dict(raw.get("contentFlags")),
            "rankingPreview": safe_list(raw.get("rankingPreview")),
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

        chunks = safe_list(output.get("chunks"))
        refs = safe_list(output.get("sourceRefs"))

        if not chunks:
            errors.append("RagRetrievalAgent output must include chunks.")

        if not refs:
            errors.append("RagRetrievalAgent output must include sourceRefs.")

        for index, chunk in enumerate(chunks):
            item = safe_dict(chunk)
            if not clean_text(item.get("chunkId")):
                errors.append(f"chunks[{index}].chunkId is required.")
            if not clean_text(item.get("text")) and not clean_text(item.get("textPreview")):
                errors.append(f"chunks[{index}] must include text or textPreview.")

            try:
                page = int(item.get("page") or 0)
            except Exception:
                page = 0

            if page <= 0:
                errors.append(f"chunks[{index}].page must be positive.")

        for index, ref in enumerate(refs):
            item = safe_dict(ref)
            if not clean_text(item.get("chunkId")):
                errors.append(f"sourceRefs[{index}].chunkId is required.")

            try:
                page = int(item.get("page") or 0)
            except Exception:
                page = 0

            if page <= 0:
                errors.append(f"sourceRefs[{index}].page must be positive.")
            if not clean_text(item.get("quote")):
                warnings.append(f"sourceRefs[{index}].quote is empty.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="RagRetrievalAgent.validate_output",
            fallbackUsed=False,
        )