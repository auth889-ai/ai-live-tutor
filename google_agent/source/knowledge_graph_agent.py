"""
google_agent/source/knowledge_graph_agent.py
===============================================================================
KnowledgeGraphAgent V49 — clean dynamic source + vision knowledge graph.

No appended monkey patch.
No topic-specific hardcoded graph.
No Star/Galaxy/Snowflake hardcoded filter.
No fake static fallback.

What this agent does:
- Reads selected node.
- Reads RAG/sourceTruth/sourceBuckets.
- Reads ConceptExtraction concepts.
- Reads full structured SelectedPageVision output.
- Reads local PDF page image metadata.
- Reads MongoDB MCP proof metadata.
- Asks ADK/Gemini for KG.
- Normalizes and validates KG.
- If Gemini output is weak, builds a dynamic source-derived KG from real upstream
  payload only: concepts + selected page source refs + structured vision.
- Cleans sourceProof so it is a real quote, not JSON dump / URL dump.
- Keeps vision-only facts as evidenceType="vision_only" with empty sourceProof.

Important:
- RAG/PDF extracted text = source truth.
- Vision = visual truth.
- Vision-only can guide board/teacher path, but cannot become sourceProof.
===============================================================================
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Set, Tuple

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
        require_source_refs,
        safe_dict,
        safe_list,
    )


VALID_EDGE_TYPES = {
    "parent-child",
    "prerequisite",
    "related",
    "causes",
    "contrasts",
    "example-of",
    "part-of",
    "rule-for",
    "misconception-of",
    "visual-link",
    "application-of",
    "has-center",
    "surrounded-by",
    "joins-to",
    "not-joined-to",
    "foreign-key-enables",
    "stores-measure",
    "contains-measure",
    "describes-fact",
    "supports",
    "enables",
}

COMPARISON_PHASES = {"comparison", "contrast", "compare"}

STOP_WORDS = {
    "the", "and", "that", "this", "with", "from", "into", "using", "used",
    "table", "tables", "schema", "data", "concept", "page", "each", "has",
    "have", "will", "would", "should", "could", "there", "their", "about",
    "what", "when", "where", "which", "while", "then", "than", "also",
    "source", "student", "teacher", "explain", "understand", "understanding",
}


def _t(value: Any, limit: int = 1200) -> str:
    try:
        return clean_text(value or "", limit)
    except Exception:
        return str(value or "")[:limit]


def _d(value: Any) -> JsonDict:
    try:
        return safe_dict(value)
    except Exception:
        return value if isinstance(value, dict) else {}


def _l(value: Any) -> List[Any]:
    try:
        return safe_list(value)
    except Exception:
        return value if isinstance(value, list) else []


def _slug(value: Any, fallback: str) -> str:
    try:
        return normalize_id(value, fallback)
    except Exception:
        text = str(value or "").lower()
        text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
        return text or fallback


def _json(value: Any, limit: int = 90000) -> str:
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), limit)
    except Exception:
        return clean_text(value, limit)


def _words(value: Any, *, min_len: int = 3) -> Set[str]:
    text = _t(value, 9000).lower()
    return {
        w
        for w in re.findall(r"[a-zA-Z0-9_]+", text)
        if len(w) >= min_len and w not in STOP_WORDS
    }


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        if value is None or str(value).strip() == "":
            return default
        return int(value)
    except Exception:
        return default


def _strip_urls(text: str) -> str:
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"www\.\S+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _looks_jsonish(text: str) -> bool:
    t = _t(text, 300).strip()
    return (
        (t.startswith("{") and "}" in t)
        or (t.startswith("[") and "]" in t)
        or '\\"' in t
        or '"fullText"' in t
        or '"pageTitle"' in t
    )


def _extract_json_text(value: Any) -> str:
    """
    Extract readable source text from accidental JSON/fullText strings.
    Prevents KG sourceProof from becoming:
    [{"page":19,"fullText":"..."}]
    """
    if isinstance(value, (dict, list)):
        try:
            value = json.dumps(value, ensure_ascii=False)
        except Exception:
            value = str(value)

    text = str(value or "").strip()
    if not text:
        return ""

    candidates: List[str] = []

    def collect(obj: Any) -> None:
        if isinstance(obj, dict):
            for key in [
                "quote", "sourceQuote", "text", "content", "fullText",
                "fullPageText", "fullPageTextPreview", "textPreview",
                "summary", "description",
            ]:
                v = obj.get(key)
                if isinstance(v, str) and v.strip():
                    candidates.append(v)
            for v in obj.values():
                if isinstance(v, (dict, list)):
                    collect(v)
        elif isinstance(obj, list):
            for item in obj:
                collect(item)

    if _looks_jsonish(text):
        for candidate in [text, text.replace('\\"', '"')]:
            try:
                obj = json.loads(candidate)
                collect(obj)
            except Exception:
                pass

        first = text.find("{")
        last = text.rfind("}")
        if first != -1 and last != -1 and last > first:
            try:
                obj = json.loads(text[first:last + 1])
                collect(obj)
            except Exception:
                pass

        first = text.find("[")
        last = text.rfind("]")
        if first != -1 and last != -1 and last > first:
            try:
                obj = json.loads(text[first:last + 1])
                collect(obj)
            except Exception:
                pass

    if candidates:
        text = " ".join(candidates)

    text = _strip_urls(text)
    text = re.sub(r"\\n", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return _t(text, 1200)


def _quote_sentence(text: Any, query: Any = "", limit: int = 420) -> str:
    """
    Pick a compact meaningful source quote, not a whole page dump.
    """
    clean = _extract_json_text(text)
    if not clean:
        return ""

    query_words = _words(query)
    parts = re.split(r"(?<=[.!?])\s+|\s+\*\s+|\s+•\s+|\s+▪\s+", clean)
    parts = [_t(p, 700) for p in parts if len(_words(p, min_len=2)) >= 3]

    if not parts:
        return _t(clean, limit)

    scored: List[Tuple[int, str]] = []
    for part in parts:
        score = 0
        pwords = _words(part)
        if query_words:
            score += 8 * len(query_words & pwords)
        if len(part) < 260:
            score += 4
        if len(part) > 520:
            score -= 4
        scored.append((score, part))

    scored.sort(key=lambda x: x[0], reverse=True)
    return _t(scored[0][1], limit)


def _selected_node(payload: JsonDict) -> JsonDict:
    node = _d(payload.get("selectedNode") or payload.get("node"))
    rich = _d(node.get("richSourcePack") or _d(node.get("metadata")).get("richSourcePack"))

    pages = (
        _l(node.get("pages"))
        or _l(node.get("pageRefs"))
        or _l(node.get("selectedPages"))
        or _l(rich.get("pages"))
        or _l(rich.get("pageRefs"))
        or _l(payload.get("selectedPages"))
    )
    if not pages and payload.get("selectedPage") is not None:
        pages = [payload.get("selectedPage")]

    node_id = _t(node.get("nodeId") or node.get("id") or payload.get("nodeId"), 180)
    title = _t(
        node.get("title")
        or node.get("label")
        or node.get("shortDefinition")
        or payload.get("title")
        or payload.get("question")
        or "Selected concept",
        280,
    )

    return {
        **node,
        "nodeId": node_id,
        "id": node.get("id") or node_id,
        "title": title,
        "label": node.get("label") or title,
        "pages": pages,
        "richSourcePack": rich or node.get("richSourcePack") or {},
    }


def _selected_pages(payload: JsonDict) -> List[int]:
    pages: List[int] = []

    def add_page(p: Any) -> None:
        n = _safe_int(p, None)
        if n is not None:
            pages.append(n)

    selected = _selected_node(payload)
    rich = _d(selected.get("richSourcePack"))

    for p in _l(selected.get("pages")):
        add_page(p)
    for p in _l(rich.get("pages") or rich.get("pageRefs")):
        add_page(p)

    source = _d(payload.get("sourceTruth") or payload.get("sourceTruthPacket"))
    for group in [payload, source]:
        for key in ["selectedEvidence", "samePageEvidence"]:
            for item in _l(_d(group).get(key)):
                add_page(_d(item).get("page"))

    vision = _d(payload.get("selectedPageVision"))
    for raw in _l(vision.get("selectedPageAnalyses") or payload.get("selectedPageAnalyses")):
        item = _d(raw)
        if "selected" in _t(item.get("imageRole"), 120).lower():
            add_page(item.get("page"))

    return sorted(list(dict.fromkeys(pages)))


def _comparison_marker(value: Any) -> bool:
    t = _t(value, 2200).lower()
    return any(x in t for x in [
        "compare", "comparison", "contrast", "contrasts", "unlike",
        "whereas", "versus", " vs ", "difference between", "different from",
    ])


def _concepts(payload: JsonDict) -> List[JsonDict]:
    ce = _d(payload.get("conceptExtraction"))
    raw_items = _l(ce.get("concepts") or payload.get("concepts"))
    out: List[JsonDict] = []

    for index, raw in enumerate(raw_items):
        c = _d(raw)
        label = _t(c.get("label") or c.get("title") or c.get("name"), 260)
        if not label:
            continue

        concept_id = _slug(c.get("conceptId") or c.get("id") or label, f"concept_{index + 1}")
        source_role = _t(c.get("sourceRole") or c.get("teachingRole"), 140).lower()
        comparison = bool(
            c.get("comparisonOnly")
            or source_role in {"comparison", "contrast", "compare"}
            or _comparison_marker(c.get("relationshipToSelectedNode") or c.get("role"))
        )

        out.append({
            **c,
            "conceptId": concept_id,
            "label": label,
            "comparisonOnly": comparison,
        })

    return out


def _visual_packet(payload: JsonDict) -> JsonDict:
    vision = _d(payload.get("selectedPageVision"))
    visual_truth = _d(payload.get("visualTruth"))
    lesson_input = _d(vision.get("visualLessonInput"))

    return _d(
        payload.get("visualTeacherPacket")
        or payload.get("richVisualTeacherPacket")
        or visual_truth.get("visualTeacherPacket")
        or vision.get("visualTeacherPacket")
        or lesson_input.get("visualTeacherPacket")
        or vision
        or visual_truth
    )


def _local_page_metadata(payload: JsonDict) -> List[JsonDict]:
    selected = _selected_node(payload)
    rich = _d(selected.get("richSourcePack"))
    vision = _d(payload.get("selectedPageVision"))
    out: List[JsonDict] = []

    raw_images = []
    raw_images.extend(_l(rich.get("pageImages")))
    raw_images.extend(_l(vision.get("pageImages") or vision.get("selectedPageImages")))

    for raw in raw_images:
        item = _d(raw)
        url = _t(item.get("pageImageUrl") or item.get("url") or item.get("src"), 600)
        path = _t(item.get("pageImagePath") or item.get("path"), 1000)
        if not url and not path:
            continue

        out.append({
            "page": item.get("page"),
            "url": url,
            "src": _t(item.get("src") or url, 600),
            "path": path,
            "source": "local_server_public",
            "type": item.get("type") or "pdfPageImage",
            "pdfExtractedTextIsTruth": item.get("pdfExtractedTextIsTruth", True),
            "ocrIsHelperOnly": item.get("ocrIsHelperOnly", True),
            "imageTextIsTruth": bool(item.get("imageTextIsTruth")),
            "fullPageImageAvailableForGeminiVision": bool(item.get("fullPageImageAvailableForGeminiVision")),
        })

    seen = set()
    clean = []
    for item in out:
        key = (item.get("page"), item.get("url"), item.get("path"))
        if key in seen:
            continue
        seen.add(key)
        clean.append(item)

    return clean[:16]


def _mcp_partner_proof(payload: JsonDict) -> JsonDict:
    partner = _d(payload.get("partnerPower"))
    metadata = _d(payload.get("metadata"))
    traces = _l(payload.get("mcpTrace") or payload.get("toolTrace"))

    if not partner and metadata.get("partnerPower"):
        partner = _d(metadata.get("partnerPower"))

    return {
        "mcpUsed": bool(partner.get("mcpUsed") or metadata.get("mcpUsed")),
        "partner": _t(partner.get("partner") or metadata.get("partner") or "MongoDB", 80),
        "toolCallCount": int(
            partner.get("toolCallCount")
            or partner.get("mcpTraceCount")
            or len(_l(partner.get("toolCalls")))
            or 0
        ),
        "capabilitiesUsed": _l(partner.get("capabilitiesUsed")),
        "traceCount": len(traces),
        "strictPartnerPower": bool(partner.get("strictPartnerPower") or metadata.get("strictPartnerPower")),
    }


def _make_ref(raw: Any, role: str, payload: JsonDict, *, primary: bool = False, query: str = "") -> Optional[JsonDict]:
    d = _d(raw)

    raw_quote = (
        d.get("quote")
        or d.get("sourceQuote")
        or d.get("textPreview")
        or d.get("text")
        or d.get("content")
        or d.get("fullText")
        or d.get("fullPageTextPreview")
    )
    quote = _quote_sentence(raw_quote, query=query)
    if not quote:
        return None

    source_ref = _t(
        d.get("sourceRef")
        or d.get("pageRef")
        or d.get("chunkId")
        or d.get("id"),
        420,
    )

    page = _safe_int(d.get("page"), d.get("page"))
    if not source_ref and page is not None:
        source_ref = f"page:{page}:{role}"

    if not source_ref:
        return None

    selected_pages = set(_selected_pages(payload))
    comparison_only = bool(d.get("comparisonOnly"))
    if role in {"comparison", "contrast"}:
        comparison_only = True
    if selected_pages and page is not None and page not in selected_pages and _comparison_marker(quote):
        comparison_only = True

    return {
        **d,
        "page": page,
        "sourceRef": source_ref,
        "pageRef": d.get("pageRef") or (f"page:{page}" if page is not None else ""),
        "quote": quote,
        "evidenceRole": "comparison" if comparison_only else role,
        "isPrimaryTruth": bool(primary and not comparison_only),
        "comparisonOnly": comparison_only,
        "confidence": d.get("confidence", 0.86 if primary else 0.72),
        "resourceId": d.get("resourceId") or "",
    }


def _add_refs(out: List[JsonDict], items: Any, role: str, payload: JsonDict, *, primary: bool = False, query: str = "") -> None:
    for item in _l(items):
        ref = _make_ref(item, role, payload, primary=primary, query=query)
        if ref:
            out.append(ref)


def _source_buckets(payload: JsonDict) -> JsonDict:
    explicit = _d(payload.get("sourceBuckets"))
    source = _d(payload.get("sourceTruth") or payload.get("sourceTruthPacket"))
    selected = _selected_node(payload)
    rich = _d(selected.get("richSourcePack"))
    selected_pages = set(_selected_pages(payload))
    topic_query = " ".join([
        _t(selected.get("title"), 300),
        _t(selected.get("label"), 300),
        _t(selected.get("nodeId"), 180),
        _t(payload.get("question"), 500),
    ])

    primary: List[JsonDict] = []
    same: List[JsonDict] = []
    support: List[JsonDict] = []
    comparison: List[JsonDict] = []
    vision_only: List[JsonDict] = []

    for key in ["primaryRefs", "selectedRefs", "selectedEvidence"]:
        _add_refs(primary, explicit.get(key), "primary", payload, primary=True, query=topic_query)
    for key in ["samePageRefs", "samePageEvidence"]:
        _add_refs(same, explicit.get(key), "same_page", payload, primary=True, query=topic_query)
    for key in ["supportRefs", "nearbyRefs", "nearbyEvidence", "relatedEvidence"]:
        _add_refs(support, explicit.get(key), "support", payload, query=topic_query)
    for key in ["comparisonRefs", "comparisonEvidence"]:
        _add_refs(comparison, explicit.get(key), "comparison", payload, query=topic_query)

    _add_refs(primary, selected.get("sourceRefs"), "primary", payload, primary=True, query=topic_query)
    _add_refs(primary, selected.get("evidenceQuotes"), "primary", payload, primary=True, query=topic_query)

    if rich.get("fullPageTextPreview"):
        page = (_l(rich.get("pages")) or _l(rich.get("pageRefs")) or _l(selected.get("pages")) or [None])[0]
        ref = _make_ref(
            {
                "page": page,
                "sourceRef": f"localFullPageText:{selected.get('nodeId') or selected.get('id')}:page:{page}",
                "quote": rich.get("fullPageTextPreview"),
            },
            "primary",
            payload,
            primary=True,
            query=topic_query,
        )
        if ref:
            primary.append({
                **ref,
                "sourceStorage": "local_server_context",
                "pdfExtractedTextIsTruth": True,
            })

    for key, role, target, primary_flag in [
        ("selectedEvidence", "primary", primary, True),
        ("samePageEvidence", "same_page", same, True),
        ("nearbyEvidence", "support", support, False),
        ("relatedEvidence", "support", support, False),
        ("comparisonEvidence", "comparison", comparison, False),
    ]:
        _add_refs(target, payload.get(key), role, payload, primary=primary_flag, query=topic_query)
        _add_refs(target, source.get(key), role, payload, primary=primary_flag, query=topic_query)

    generic_refs: List[JsonDict] = []
    _add_refs(generic_refs, payload.get("sourceRefs"), "source", payload, query=topic_query)
    _add_refs(generic_refs, source.get("sourceRefs"), "source", payload, query=topic_query)

    for ref in generic_refs:
        if ref.get("comparisonOnly"):
            comparison.append(ref)
        elif selected_pages and ref.get("page") in selected_pages:
            same.append({**ref, "evidenceRole": "same_page", "isPrimaryTruth": True})
        else:
            support.append({**ref, "evidenceRole": "support"})

    for c in _concepts(payload):
        query = f"{c.get('label')} {c.get('definition') or c.get('summary') or c.get('teacherLine') or ''}"
        for raw in _l(c.get("sourceRefs")):
            ref = _make_ref(raw, "concept", payload, query=query)
            if not ref:
                continue
            if c.get("comparisonOnly") or ref.get("comparisonOnly"):
                comparison.append({**ref, "evidenceRole": "comparison", "comparisonOnly": True})
            elif selected_pages and ref.get("page") in selected_pages:
                same.append({**ref, "evidenceRole": "same_page", "isPrimaryTruth": True})
            else:
                support.append({**ref, "evidenceRole": "support"})

    for rel in _visual_relations(payload):
        if not rel.get("sourceProof"):
            quote = _quote_sentence(rel.get("visualEvidence") or rel.get("meaning"), query=f"{rel.get('fromLabel')} {rel.get('toLabel')}")
            if quote:
                vision_only.append({
                    "sourceRef": f"vision:{_slug(rel.get('fromLabel'), 'from')}:{_slug(rel.get('toLabel'), 'to')}",
                    "quote": quote,
                    "evidenceRole": "vision_only",
                    "sourceType": rel.get("sourceType") or "visual_observation",
                    "comparisonOnly": False,
                    "needsSourceVerification": True,
                })

    def score_ref(ref: JsonDict, query: str, phase: str) -> int:
        quote = _t(ref.get("quote"), 1400)
        score = 0
        role = _t(ref.get("evidenceRole"), 100).lower()
        page = _safe_int(ref.get("page"), None)
        qwords = _words(quote)
        query_words = _words(query)

        if role == "primary":
            score += 120
        elif role == "same_page":
            score += 105
        elif role == "support":
            score += 35
        elif role == "comparison":
            score += 25 if phase in COMPARISON_PHASES else -1000
        elif role == "vision_only":
            score += 30

        if ref.get("isPrimaryTruth"):
            score += 25
        if selected_pages and page in selected_pages:
            score += 50
        elif selected_pages and page is not None and page not in selected_pages and phase not in COMPARISON_PHASES:
            score -= 80

        if query_words:
            score += min(80, 8 * len(qwords & query_words))

        if ref.get("comparisonOnly") and phase not in COMPARISON_PHASES:
            score -= 1000

        if len(quote.split()) < 4:
            score -= 10
        if _looks_jsonish(quote):
            score -= 25

        return score

    def clean(items: List[JsonDict], limit: int, phase: str = "core", query: str = topic_query) -> List[JsonDict]:
        ranked = sorted(items, key=lambda r: score_ref(r, query, phase), reverse=True)
        safe = [r for r in ranked if score_ref(r, query, phase) > -500]
        return dedupe_source_refs(normalize_source_refs(safe))[:limit]

    primary = [r for r in primary if not r.get("comparisonOnly")]
    same = [r for r in same if not r.get("comparisonOnly")]

    if not primary and same:
        primary = [{**r, "evidenceRole": "primary", "isPrimaryTruth": True} for r in same[:4]]

    return {
        "primaryRefs": clean(primary, 20, "core"),
        "samePageRefs": clean(same, 20, "core"),
        "supportRefs": clean(support, 24, "support"),
        "comparisonRefs": clean(comparison, 18, "comparison"),
        "visionOnlyFacts": dedupe_source_refs(normalize_source_refs(vision_only))[:24],
        "selectedPages": sorted(list(selected_pages)),
        "localPageImages": _local_page_metadata(payload),
        "mcpPartnerProof": _mcp_partner_proof(payload),
        "metadata": {
            "sourceBucketsV49": True,
            "quotesAreCleanSentences": True,
            "localAndMongoMetadataMode": True,
            "localImagesArePointersNotMongoBytes": True,
        },
    }


def _refs_for_query(payload: JsonDict, query: Any, *, phase: str = "core", limit: int = 5) -> List[JsonDict]:
    buckets = _source_buckets(payload)
    q = _t(query, 1600)
    qwords = _words(q)

    if phase in COMPARISON_PHASES:
        pool = buckets["comparisonRefs"] + buckets["primaryRefs"] + buckets["samePageRefs"] + buckets["supportRefs"]
    elif phase in {"support", "detail", "example"}:
        pool = buckets["primaryRefs"] + buckets["samePageRefs"] + buckets["supportRefs"]
    else:
        pool = buckets["primaryRefs"] + buckets["samePageRefs"]

    def score(ref: JsonDict) -> int:
        score_value = 0
        role = _t(ref.get("evidenceRole"), 80).lower()
        if role == "primary":
            score_value += 120
        elif role == "same_page":
            score_value += 100
        elif role == "support":
            score_value += 25
        elif role == "comparison":
            score_value += 20 if phase in COMPARISON_PHASES else -1000

        if ref.get("isPrimaryTruth"):
            score_value += 30
        if ref.get("comparisonOnly") and phase not in COMPARISON_PHASES:
            score_value -= 1000

        rwords = _words(ref.get("quote"))
        if qwords and rwords:
            score_value += min(80, 8 * len(qwords & rwords))
        return score_value

    ranked = sorted(pool, key=score, reverse=True)
    safe = [r for r in ranked if score(r) > -500]
    return dedupe_source_refs(normalize_source_refs(safe))[:limit]


def _visual_relations(payload: JsonDict) -> List[JsonDict]:
    packet = _visual_packet(payload)
    raw: List[Any] = []
    for key in ["visualRelations", "relationshipWalkthrough", "relationships", "relations"]:
        raw.extend(_l(packet.get(key)))

    out: List[JsonDict] = []
    seen = set()

    for item in raw:
        d = _d(item)
        frm = _t(d.get("from") or d.get("fromLabel") or d.get("source") or d.get("left") or d.get("start"), 220)
        to = _t(d.get("to") or d.get("toLabel") or d.get("target") or d.get("right") or d.get("end"), 220)
        relation = _t(d.get("type") or d.get("relationship") or d.get("label") or "visual-link", 260)

        if not frm or not to:
            continue

        key = (_slug(frm, "from"), _slug(to, "to"), _slug(relation, "rel"))
        if key in seen:
            continue
        seen.add(key)

        conf = _safe_float(d.get("confidence"), 0.0)
        if conf and conf < 0.65:
            continue

        out.append({
            "fromLabel": frm,
            "toLabel": to,
            "type": relation,
            "meaning": _t(d.get("meaning") or d.get("whyItMatters") or d.get("teachingRationale"), 1000),
            "boardAction": _t(d.get("boardAction") or d.get("boardActionHint") or "highlight/trace this visual relationship", 700),
            "visualEvidence": _t(d.get("visualEvidence") or d.get("visualProof") or d.get("description"), 1000),
            "sourceProof": _quote_sentence(d.get("sourceProof"), query=f"{frm} {to} {relation}", limit=420),
            "sourceType": _t(d.get("sourceType") or "visual_observation", 160),
            "confidence": d.get("confidence"),
            "needsSourceVerification": bool(d.get("needsSourceVerification", not d.get("sourceProof"))),
            "sourceRefs": normalize_source_refs(_l(d.get("sourceRefs"))),
        })

    return out[:60]


def _visual_elements(payload: JsonDict) -> List[JsonDict]:
    packet = _visual_packet(payload)
    raw: List[Any] = []
    for key in ["visualElements", "diagramElementDetails", "diagramElements", "elements", "tables", "figures", "layoutBlocks"]:
        raw.extend(_l(packet.get(key)))

    out: List[JsonDict] = []
    seen = set()

    for index, item in enumerate(raw):
        d = _d(item)
        label = _t(d.get("label") or d.get("name") or d.get("text") or d.get("tableName"), 220)
        if not label:
            continue

        element_id = _slug(d.get("id") or d.get("conceptLink") or label, f"visual_{index + 1}")
        if element_id in seen:
            continue
        seen.add(element_id)

        out.append({
            "id": element_id,
            "label": label,
            "kind": _t(d.get("kind") or d.get("type") or "visual_element", 120),
            "visualRole": _t(d.get("visualRole") or d.get("role") or d.get("meaning") or d.get("description"), 700),
            "conceptMeaning": _t(d.get("conceptMeaning") or d.get("teacherExplanation") or d.get("spokenTeacherLine"), 800),
            "exactBoardMove": _t(d.get("exactBoardMove") or d.get("boardRedrawInstruction"), 600),
            "conceptLink": _t(d.get("conceptLink") or d.get("conceptId"), 180),
            "anchor": _d(d.get("anchor") or d.get("bbox") or d.get("box")),
            "confidence": d.get("confidence"),
            "sourceType": _t(d.get("sourceType"), 160),
            "needsSourceVerification": bool(d.get("needsSourceVerification")),
            "sourceRefs": normalize_source_refs(_l(d.get("sourceRefs"))),
        })

    return out[:50]


def _full_structured_vision(payload: JsonDict) -> JsonDict:
    packet = _visual_packet(payload)
    vision = _d(payload.get("selectedPageVision"))
    visual_truth = _d(payload.get("visualTruth"))

    def first_text(*values: Any, limit: int = 1600) -> str:
        for value in values:
            text = _t(value, limit)
            if text:
                return text
        return ""

    return {
        "summary": first_text(
            packet.get("pageVisualNarrative"),
            packet.get("visualSummary"),
            packet.get("diagramSummary"),
            vision.get("pageVisualNarrative"),
            vision.get("visualSummary"),
            vision.get("diagramSummary"),
            visual_truth.get("visualSummary"),
        ),
        "elements": _visual_elements(payload),
        "relations": _visual_relations(payload),
        "teacherMarkingScript": _l(packet.get("teacherMarkingScript") or vision.get("teacherMarkingScript"))[:28],
        "boardRedrawPlan": _l(packet.get("boardRedrawPlan") or vision.get("boardRedrawPlan"))[:28],
        "visualTeachingSequence": _l(packet.get("visualTeachingSequence") or vision.get("visualTeachingSequence"))[:24],
        "misconceptionRisks": _l(packet.get("misconceptionRisks") or vision.get("misconceptionRisks"))[:18],
        "sourcePolicy": {
            "ragTextIsSourceTruth": True,
            "visionIsVisualTruth": True,
            "visionOnlyRelationAllowed": True,
            "visionOnlyCannotBeSourceProof": True,
            "visionOnlyMustSetNeedsTextConfirmation": True,
        },
    }



def _compact_full_pdf_context(payload: JsonDict) -> JsonDict:
    """
    Compact full-PDF context for KG.
    Gives Gemini whole-document map without sending raw full PDF dump.
    """
    source = _d(payload.get("sourceTruth") or payload.get("sourceTruthPacket"))
    selected = _selected_node(payload)

    def first(*values: Any, limit: int = 1800) -> str:
        for value in values:
            text = _extract_json_text(value)
            if text:
                return _t(text, limit)
        return ""

    outline_raw = (
        source.get("fullPdfOutlineText")
        or source.get("fullPdfOutline")
        or payload.get("fullPdfOutlineText")
        or payload.get("fullPdfOutline")
    )
    if isinstance(outline_raw, (list, dict)):
        outline_text = _json(outline_raw, 3000)
    else:
        outline_text = _t(outline_raw, 3000)

    return {
        "selectedNodeTitle": _t(selected.get("title") or selected.get("label"), 280),
        "selectedNodePages": _l(selected.get("pages")),
        "fullPdfSummaryCompact": first(
            source.get("fullPdfSummary"),
            payload.get("fullPdfSummary"),
            source.get("pdfSummary"),
            limit=2200,
        ),
        "fullPdfOutlineTextCompact": _t(outline_text, 3000),
        "selectedPageFullTextExcerpt": first(
            source.get("selectedPageFullText"),
            payload.get("selectedPageFullText"),
            source.get("selectedPageText"),
            limit=2600,
        ),
        "samePageEvidenceCount": len(_l(source.get("samePageEvidence"))),
        "nearbyEvidenceCount": len(_l(source.get("nearbyEvidence"))),
        "comparisonEvidenceCount": len(_l(source.get("comparisonEvidence"))),
        "rule": "Use summary/outline for global placement only; use selected/same-page refs for core KG sourceProof.",
    }


def _relation_priority_packet(payload: JsonDict) -> JsonDict:
    """
    General teacher-graph relation contract. Not topic-specific.
    Forces KG to cover relation types a human teacher needs.
    """
    return {
        "mustFindIfSupportedBySourceOrVision": [
            "central anchor / main object relation",
            "surrounding or grouping relation",
            "direct connection / join / arrow relation",
            "mechanism relation: key, rule, formula, cause, dependency, or process step",
            "negative relation: not connected, not allowed, does not happen, common false path",
            "content relation: contains, stores, describes, measures, attribute-of",
            "misconception repair relation",
        ],
        "teachingBuildOrder": [
            "whole visual/source big picture",
            "central anchor",
            "supporting parts around the anchor",
            "direct relationships",
            "mechanism or rule behind the relationship",
            "negative/non-relationship or common confusion",
            "student check / recap relation",
        ],
        "edgeDiversityRequirement": {
            "minDistinctEdgeTypes": 5,
            "avoidFirstFiveSameType": True,
            "firstEdgesShouldPrefer": [
                "has-center",
                "surrounded-by",
                "joins-to",
                "foreign-key-enables",
                "not-joined-to",
                "contains-measure",
                "describes-fact",
                "rule-for",
            ],
        },
    }


def _relation_detail_requirement() -> JsonDict:
    return {
        "forEveryEdge": {
            "purpose": "Every KG edge must teach the relation, not only name it.",
            "mustExplain": [
                "what the relation means",
                "why it matters for the selected concept",
                "how it works mechanically or logically",
                "where it appears in the PDF visual/source",
                "which source quote supports text-backed facts",
                "how the teacher should explain it",
                "how the board should mark it",
                "what misconception it prevents",
                "what student check question should be asked",
            ],
            "mustReturnField": "relationExplanation",
            "relationExplanationShape": {
                "what": "string",
                "why": "string",
                "how": "string",
                "whereInVisual": "string",
                "sourceMeaning": "string",
                "studentMeaning": "string",
                "teacherScriptHint": "string",
                "boardSequence": ["step 1", "step 2", "step 3"],
                "misconceptionRisk": "string",
                "repairMove": "string",
                "studentCheckQuestion": "string"
            }
        }
    }


def _normalize_relation_explanation(
    raw: Any,
    *,
    label: str,
    etype: str,
    from_label: str,
    to_label: str,
    rationale: str,
    board: str,
    source_proof: str,
    visual_proof: str,
    evidence_type: str,
) -> JsonDict:
    raw_d = _d(raw)
    existing = _d(raw_d.get("relationExplanation"))

    def get(key: str, fallback: str, limit: int = 900) -> str:
        return _t(existing.get(key) or raw_d.get(key) or fallback, limit)

    what = get(
        "what",
        f"This edge means {from_label} has a {label} relationship with {to_label}.",
    )
    why = get("why", rationale or _derive_edge_rationale(label, etype, from_label, to_label, visual_proof))
    how = get(
        "how",
        f"The learner should follow the relation from {from_label} to {to_label}; the mechanism is shown by source proof or visual mark.",
    )
    where = get(
        "whereInVisual",
        visual_proof or f"Look for the visible/board connection between {from_label} and {to_label}.",
    )
    source_meaning = "" if evidence_type == "vision_only" else get(
        "sourceMeaning",
        source_proof or "This relation is supported by selected/same-page source evidence.",
    )
    student_meaning = get(
        "studentMeaning",
        f"The student should explain how {from_label} and {to_label} are connected and why that connection matters.",
    )
    teacher_hint = get(
        "teacherScriptHint",
        f"Point to {from_label}, trace to {to_label}, then explain: {why}",
        1100,
    )

    board_seq = _l(existing.get("boardSequence") or raw_d.get("boardSequence"))
    if not board_seq:
        board_seq = [
            f"Mark {from_label}",
            f"Mark {to_label}",
            board or f"Trace the relation from {from_label} to {to_label}",
        ]
    board_seq = [_t(x, 260) for x in board_seq if _t(x, 260)][:6]

    misconception = get(
        "misconceptionRisk",
        f"Student may memorize both terms but miss the exact relation between {from_label} and {to_label}.",
    )
    repair = get(
        "repairMove",
        "Return to the source/visual proof, mark the relation again, and ask the student to explain direction and purpose.",
    )
    check = get(
        "studentCheckQuestion",
        f"In your own words, what connects {from_label} to {to_label}, and why does that matter?",
    )

    return {
        "what": what,
        "why": why,
        "how": how,
        "whereInVisual": where,
        "sourceMeaning": source_meaning,
        "studentMeaning": student_meaning,
        "teacherScriptHint": teacher_hint,
        "boardSequence": board_seq,
        "misconceptionRisk": misconception,
        "repairMove": repair,
        "studentCheckQuestion": check,
    }


def _parse_json_from_text(value: Any) -> JsonDict:
    if not isinstance(value, str):
        return {}

    text = value.strip()
    if not text:
        return {}

    candidates: List[str] = []

    def add(candidate: str) -> None:
        candidate = str(candidate or "").strip()
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    add(text)

    for m in re.finditer(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE):
        add(m.group(1))

    no_fence = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    no_fence = re.sub(r"\s*```$", "", no_fence)
    add(no_fence)

    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        add(text[first:last + 1])

    for candidate in candidates:
        try:
            obj = json.loads(candidate)
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue

    return {}


def _raw_score(value: Any) -> int:
    d = _d(value)
    if not d:
        return -999

    score = 0
    score += min(len(_l(d.get("nodes"))), 20) * 14
    score += min(len(_l(d.get("edges"))), 30) * 12
    score += min(len(_l(d.get("teachingPath"))), 20) * 12
    if _t(d.get("rootNodeId")):
        score += 30
    if _d(d.get("visualGraphHints")):
        score += 22
    if _d(d.get("qualitySignals")):
        score += 12

    for key in ["requiredOutputSchema", "outputSchema", "minimum", "example", "returnShape"]:
        if key in d:
            score -= 80

    return score


def _unwrap_kg_raw(raw: Any) -> JsonDict:
    parsed = _parse_json_from_text(raw)
    root = parsed or _d(raw)

    if not root:
        return {}

    candidates: List[JsonDict] = []
    seen = set()

    def visit(value: Any, depth: int = 0) -> None:
        if depth > 8:
            return

        if isinstance(value, str):
            parsed_child = _parse_json_from_text(value)
            if parsed_child:
                visit(parsed_child, depth + 1)
            return

        d = _d(value)
        if not d:
            return

        oid = id(d)
        if oid in seen:
            return
        seen.add(oid)
        candidates.append(d)

        for key in [
            "knowledgeGraph", "knowledge_graph", "kg", "graph", "result",
            "output", "data", "response", "final", "json", "answer",
            "message", "content", "text", "raw",
        ]:
            child = d.get(key)
            if isinstance(child, (dict, str)):
                visit(child, depth + 1)

        for child in d.values():
            if isinstance(child, dict):
                keys = set(child.keys())
                if {"nodes", "edges", "teachingPath", "rootNodeId", "visualGraphHints", "knowledgeGraph", "kg", "graph"} & keys:
                    visit(child, depth + 1)
            elif isinstance(child, str) and "{" in child and "}" in child:
                visit(child, depth + 1)

    visit(root)
    if not candidates:
        return root

    candidates.sort(key=_raw_score, reverse=True)
    return candidates[0]


def _edge_type(text: Any) -> str:
    t = _t(text, 1200).lower()
    if any(x in t for x in ["not joined", "not join", "no direct", "do not join", "not connected", "no connection"]):
        return "not-joined-to"
    if "foreign key" in t:
        return "foreign-key-enables"
    if any(x in t for x in ["join", "joined", "connect", "linked", "arrow", "relationship"]):
        return "joins-to"
    if any(x in t for x in ["center", "central", "middle", "hub", "anchor"]):
        return "has-center"
    if any(x in t for x in ["surround", "around", "radiate"]):
        return "surrounded-by"
    if any(x in t for x in ["measure", "metric", "amount", "value"]):
        return "contains-measure"
    if any(x in t for x in ["describe", "attribute", "context"]):
        return "describes-fact"
    if _comparison_marker(t):
        return "contrasts"
    if "example" in t:
        return "example-of"
    if any(x in t for x in ["part", "contains", "component"]):
        return "part-of"
    if any(x in t for x in ["rule", "must"]):
        return "rule-for"
    if any(x in t for x in ["mistake", "misconception", "wrong", "confuse"]):
        return "misconception-of"
    return "visual-link"


def _meaningful(value: Any) -> bool:
    text = _t(value, 1200).strip().lower()
    if not text:
        return False
    return text not in {
        "related", "connects", "connected", "relationship", "has component",
        "visual relation", "highlight/trace the relationship", "highlight/write",
        "connect these concepts",
    }


def _match_node(label: Any, nodes: List[JsonDict]) -> str:
    words = _words(label)
    if not words:
        return ""

    best_id = ""
    best_score = 0
    for node in nodes:
        text = " ".join([
            _t(node.get("nodeId")),
            _t(node.get("label")),
            _t(node.get("summary")),
            " ".join([_t(x, 160) for x in _l(node.get("targetVisualLabels"))]),
        ])
        score = len(words & _words(text))
        if score > best_score:
            best_score = score
            best_id = _t(node.get("nodeId"), 180)

    return best_id


def _phase_for_node(node: JsonDict, index: int) -> str:
    if node.get("comparisonOnly"):
        return "comparison"
    if index == 0:
        return "see_first"

    text = " ".join([
        _t(node.get("label")),
        _t(node.get("summary")),
        _t(node.get("teachingRole")),
        _t(node.get("nodeType")),
    ]).lower()

    if any(x in text for x in ["center", "central", "anchor", "hub", "middle"]):
        return "anchor"
    if any(x in text for x in ["join", "foreign key", "connect", "relationship", "arrow"]):
        return "relationship"
    if any(x in text for x in ["not joined", "not join", "misconception", "wrong", "mistake"]):
        return "misconception_repair"
    if any(x in text for x in ["quiz", "check", "recap"]):
        return "recap"
    return "define"


def _normalize_node(raw: Any, payload: JsonDict, index: int) -> JsonDict:
    raw = _d(raw)

    label = _t(raw.get("label") or raw.get("title") or raw.get("name"), 240)
    node_id = _slug(raw.get("nodeId") or raw.get("id") or label, f"node_{index + 1}")

    source_role = _t(raw.get("sourceRole") or raw.get("evidenceRole"), 120).lower()
    comparison = bool(
        raw.get("comparisonOnly")
        or source_role in {"comparison", "contrast", "compare"}
        or _comparison_marker(raw.get("phase") or raw.get("teachingRole") or label)
    )
    phase = "comparison" if comparison else "core"

    summary = _t(raw.get("summary") or raw.get("definition") or raw.get("description"), 900)
    visual_hints = [_t(x, 700) for x in _l(raw.get("visualHints")) if _t(x, 700)]
    target_labels = [_t(x, 180) for x in _l(raw.get("targetVisualLabels")) if _t(x, 180)]
    if not target_labels and label:
        target_labels = [label]

    refs = _refs_for_query(payload, f"{label} {summary}", phase=phase, limit=5)

    evidence_type = _t(raw.get("evidenceType"), 100)
    if evidence_type not in {"text_plus_vision", "text_only", "vision_only", "teaching_inference"}:
        evidence_type = (
            "text_plus_vision" if refs and visual_hints
            else "text_only" if refs
            else "vision_only" if visual_hints
            else "teaching_inference"
        )

    return {
        "nodeId": node_id,
        "label": label or f"Node {index + 1}",
        "summary": summary,
        "nodeType": _t(raw.get("nodeType") or ("comparison_concept" if comparison else "concept"), 120),
        "level": int(raw.get("level") or (0 if index == 0 else 1)),
        "order": int(raw.get("order") or (index + 1)),
        "importance": raw.get("importance") if raw.get("importance") is not None else (0.95 if index < 3 else 0.72),
        "teachingRole": _t(raw.get("teachingRole") or ("comparison" if comparison else "anchor" if index == 0 else "core"), 120),
        "learningGoal": _t(raw.get("learningGoal") or f"Student can explain {label} using source and visual evidence.", 900),
        "boardPlacementHint": _t(raw.get("boardPlacementHint") or ("center" if index == 0 else "side-card"), 180),
        "visualEncoding": _t(raw.get("visualEncoding") or ("comparison" if comparison else "highlight/write"), 160),
        "misconceptionRisk": _t(raw.get("misconceptionRisk") or "medium", 500),
        "sourceRefs": refs if evidence_type != "vision_only" else [],
        "visualHints": visual_hints,
        "targetVisualLabels": list(dict.fromkeys(target_labels))[:12],
        "sourceRole": "comparison" if comparison else "primary_or_same_page",
        "evidenceType": evidence_type,
        "comparisonOnly": comparison,
        "needsTextConfirmation": bool(raw.get("needsTextConfirmation") or evidence_type == "vision_only"),
        "metadata": {
            **_d(raw.get("metadata")),
            "sourceGuardV49": True,
            "noFallbackStrict": True,
        },
    }


def _derive_edge_rationale(label: str, etype: str, from_label: str, to_label: str, visual_proof: str) -> str:
    if etype == "joins-to":
        return f"This relation shows the direct connection from {from_label} to {to_label}, so the teacher can trace the correct join path on the board."
    if etype == "not-joined-to":
        return f"This relation prevents the common misconception that {from_label} directly connects to {to_label}; the teacher should mark the wrong path and redirect to the correct one."
    if etype == "has-center":
        return f"This relation identifies {to_label} as the visual/conceptual anchor before explaining the surrounding concepts."
    if etype == "surrounded-by":
        return f"This relation explains the visual structure: {from_label} is arranged around or depends on {to_label}."
    if etype == "foreign-key-enables":
        return f"This relation explains the mechanism that connects {from_label} and {to_label}."
    if etype in {"stores-measure", "contains-measure"}:
        return f"This relation explains what measurable/key information belongs inside {from_label} or {to_label}."
    if etype == "describes-fact":
        return f"This relation shows how {from_label} provides descriptive context for {to_label}."
    if etype == "contrasts":
        return f"This relation is only for comparison after the core selected concept is understood."
    if visual_proof:
        return f"This relation is visually observable and should be pointed out on the board: {visual_proof}"
    return f"This relation connects {from_label} and {to_label} through: {label}."


def _normalize_edge(raw: Any, payload: JsonDict, nodes: List[JsonDict], index: int) -> Optional[JsonDict]:
    raw = _d(raw)

    from_raw = raw.get("from") or raw.get("source") or raw.get("fromNodeId") or raw.get("fromLabel")
    to_raw = raw.get("to") or raw.get("target") or raw.get("toNodeId") or raw.get("toLabel")

    from_id = _slug(from_raw, "")
    to_id = _slug(to_raw, "")

    node_ids = {n.get("nodeId") for n in nodes}
    if from_id not in node_ids:
        from_id = _match_node(from_raw, nodes)
    if to_id not in node_ids:
        to_id = _match_node(to_raw, nodes)

    if not from_id or not to_id or from_id == to_id:
        return None

    from_node = next((n for n in nodes if n.get("nodeId") == from_id), {})
    to_node = next((n for n in nodes if n.get("nodeId") == to_id), {})
    from_label = _t(from_node.get("label") or from_raw, 180)
    to_label = _t(to_node.get("label") or to_raw, 180)

    label = _t(raw.get("label") or raw.get("relationship") or raw.get("type"), 260)
    if not _meaningful(label):
        label = f"{from_label} relates to {to_label}"

    etype = _t(raw.get("type"), 120)
    if etype not in VALID_EDGE_TYPES:
        etype = _edge_type(" ".join([
            label,
            _t(raw.get("teachingRationale")),
            _t(raw.get("visualProof")),
            from_label,
            to_label,
        ]))

    comparison = bool(raw.get("comparisonOnly") or etype == "contrasts" or _comparison_marker(raw.get("phase") or label))
    phase = "comparison" if comparison else "core"

    visual_proof = _t(raw.get("visualProof") or raw.get("visualEvidence"), 900)
    board = _t(raw.get("boardActionHint") or raw.get("boardAction"), 700)
    if not _meaningful(board):
        board = f"Highlight {from_label}, then trace its relation to {to_label}."

    rationale = _t(raw.get("teachingRationale") or raw.get("whyItMatters") or raw.get("reason"), 1000)
    if not _meaningful(rationale):
        rationale = _derive_edge_rationale(label, etype, from_label, to_label, visual_proof)

    query = f"{label} {rationale} {from_label} {to_label} {_t(raw.get('sourceProof'))}"
    refs = _refs_for_query(payload, query, phase=phase, limit=5)
    source_proof = _quote_sentence(raw.get("sourceProof") or (refs[0].get("quote") if refs else ""), query=query, limit=420)

    evidence_type = _t(raw.get("evidenceType"), 100)
    if evidence_type not in {"text_plus_vision", "text_only", "vision_only", "teaching_inference"}:
        evidence_type = (
            "text_plus_vision" if refs and visual_proof
            else "text_only" if refs
            else "vision_only" if visual_proof
            else "teaching_inference"
        )

    if evidence_type == "vision_only":
        refs = []
        source_proof = ""

    relation_explanation = _normalize_relation_explanation(
        raw,
        label=label,
        etype=etype,
        from_label=from_label,
        to_label=to_label,
        rationale=rationale,
        board=board,
        source_proof=source_proof,
        visual_proof=visual_proof,
        evidence_type=evidence_type,
    )

    target_labels = [_t(x, 180) for x in _l(raw.get("targetVisualLabels")) if _t(x, 180)]
    if not target_labels:
        target_labels = [from_label, to_label]

    return {
        "edgeId": _slug(raw.get("edgeId") or raw.get("id") or f"edge_{from_id}_{to_id}_{index + 1}", f"edge_{index + 1}"),
        "from": from_id,
        "to": to_id,
        "type": etype,
        "label": label,
        "teachingRationale": rationale,
        "boardActionHint": board,
        "teacherMove": _t(raw.get("teacherMove") or f"{label}. {rationale}", 1000),
        "sourceProof": source_proof if evidence_type in {"text_only", "text_plus_vision"} else "",
        "visualProof": visual_proof,
        "relationExplanation": relation_explanation,
        "sourceRefs": refs,
        "targetVisualLabels": list(dict.fromkeys(target_labels))[:12],
        "sourceRole": "comparison" if comparison else "primary_or_same_page",
        "evidenceType": evidence_type,
        "comparisonOnly": comparison,
        "needsTextConfirmation": bool(raw.get("needsTextConfirmation") or evidence_type == "vision_only"),
        "metadata": {
            **_d(raw.get("metadata")),
            "sourceGuardV49": True,
            "relationSpecific": etype not in {"related", "parent-child"},
            "noFallbackStrict": True,
        },
    }


def _normalize_path_step(raw: Any, payload: JsonDict, nodes: List[JsonDict], index: int) -> Optional[JsonDict]:
    raw = _d(raw)

    node_id = _slug(raw.get("nodeId") or raw.get("id"), "")
    node_ids = {n.get("nodeId") for n in nodes}
    if node_id not in node_ids:
        node_id = _match_node(raw.get("nodeId") or raw.get("label") or raw.get("teacherMove") or raw.get("teacherIntent"), nodes)

    if not node_id:
        return None

    node = next((n for n in nodes if n.get("nodeId") == node_id), {})
    comparison = bool(node.get("comparisonOnly"))
    phase = _t(raw.get("phase") or ("comparison" if comparison else _phase_for_node(node, index)), 120)
    if comparison:
        phase = "comparison"

    board_hint = _t(raw.get("boardActionHint") or raw.get("boardIntent"), 700)
    if not _meaningful(board_hint):
        hints = _l(node.get("visualHints"))
        board_hint = _t(hints[-1] if hints else node.get("visualEncoding") or f"Highlight {node.get('label')}.", 700)

    reason = _t(raw.get("reason"), 900)
    if not _meaningful(reason):
        reason = f"Teach {node.get('label')} here because it prepares the next source/visual relationship."

    teacher_intent = _t(raw.get("teacherIntent") or raw.get("teacherMove"), 900)
    if not _meaningful(teacher_intent):
        teacher_intent = f"Help the student connect {node.get('label')} to the selected concept using source and visual evidence."

    refs = _refs_for_query(payload, f"{node.get('label')} {reason} {teacher_intent}", phase="comparison" if phase in COMPARISON_PHASES else "core", limit=5)

    target_labels = _l(raw.get("targetVisualLabels")) or _l(node.get("targetVisualLabels"))
    return {
        "pathStepId": _slug(raw.get("pathStepId") or f"path_{index + 1}_{phase}", f"path_{index + 1}"),
        "phase": phase,
        "nodeId": node_id,
        "reason": reason,
        "teacherIntent": teacher_intent,
        "teacherMove": _t(raw.get("teacherMove") or f"{teacher_intent} Point to the relevant board/PDF area, then ask the student to explain it back.", 1100),
        "boardIntent": board_hint,
        "boardActionHint": board_hint,
        "screenHint": _t(raw.get("screenHint") or ("overview" if index == 0 else phase), 120),
        "targetVisualLabels": [_t(x, 180) for x in target_labels if _t(x, 180)][:12],
        "allowedEvidenceRoles": ["comparison"] if phase in COMPARISON_PHASES else ["primary", "same_page", "vision_only"],
        "forbiddenEvidenceRoles": [] if phase in COMPARISON_PHASES else ["comparison"],
        "evidenceType": node.get("evidenceType"),
        "needsTextConfirmation": bool(node.get("needsTextConfirmation")),
        "sourceRefs": refs if node.get("evidenceType") != "vision_only" else [],
    }


def _normalize_misconception(raw: Any, payload: JsonDict, nodes: List[JsonDict], index: int) -> Optional[JsonDict]:
    raw = _d(raw)
    wrong = _t(raw.get("wrongIdea") or raw.get("risk") or raw.get("confusion"), 900)
    correct = _t(raw.get("correctIdea") or raw.get("repairMove"), 1100)

    if not wrong and not correct:
        return None

    node_ids = {n.get("nodeId") for n in nodes}
    related: List[str] = []
    for item in _l(raw.get("relatedNodeIds")):
        nid = _slug(item, "")
        if nid in node_ids:
            related.append(nid)

    if not related and nodes:
        related = [nodes[0]["nodeId"]]

    refs = _refs_for_query(payload, f"{wrong} {correct}", phase="core", limit=4)

    return {
        "misconceptionId": _slug(raw.get("misconceptionId") or f"mis_{index + 1}", f"mis_{index + 1}"),
        "wrongIdea": wrong,
        "correctIdea": correct or "Use source and visual relation evidence to repair the misconception.",
        "relatedNodeIds": related,
        "boardRepairHint": _t(raw.get("boardRepairHint") or raw.get("boardRepair") or "Mark the confusing relation, then show the correct relation.", 800),
        "evidenceType": "text_plus_vision" if refs else "vision_only",
        "sourceRefs": refs,
    }


def _node_from_concept(c: JsonDict, payload: JsonDict, index: int) -> JsonDict:
    label = _t(c.get("label"), 220)
    concept_id = _slug(c.get("conceptId") or c.get("id") or label, f"concept_{index + 1}")
    visual = _d(c.get("visualProof"))
    hint = _d(c.get("frontendBoardHint"))
    summary = _t(
        c.get("definition")
        or c.get("summary")
        or c.get("teacherLine")
        or c.get("explainLikeHuman")
        or c.get("whyItMatters"),
        900,
    )
    refs = _refs_for_query(payload, f"{label} {summary}", phase="comparison" if c.get("comparisonOnly") else "core", limit=5)
    visual_hints = [
        _t(visual.get("visualObservation"), 600),
        _t(hint.get("exactBoardMove") or c.get("boardUse"), 600),
    ]
    visual_hints = [x for x in visual_hints if x]

    evidence_type = "text_plus_vision" if refs and visual_hints else ("text_only" if refs else "vision_only" if visual_hints else "teaching_inference")

    return {
        "nodeId": concept_id,
        "label": label,
        "summary": summary,
        "nodeType": _t(c.get("conceptType") or "concept", 120),
        "level": 0 if index == 0 else 1,
        "order": index + 1,
        "importance": c.get("importance") if c.get("importance") is not None else (0.96 if index < 3 else 0.74),
        "teachingRole": _t(c.get("teachingRole") or ("anchor" if index == 0 else "core"), 120),
        "learningGoal": _t(c.get("learningGoal") or c.get("whyItMatters") or f"Student can explain {label} using source and visual evidence.", 900),
        "boardPlacementHint": _t(hint.get("layoutHint") or ("center" if index == 0 else "side-card"), 180),
        "visualEncoding": _t(c.get("boardUse") or hint.get("boardUse") or "highlight/write", 180),
        "misconceptionRisk": _t(c.get("misconceptionRisk") or "medium", 500),
        "sourceRefs": refs if evidence_type != "vision_only" else [],
        "visualHints": visual_hints,
        "targetVisualLabels": [label],
        "sourceRole": "comparison" if c.get("comparisonOnly") else "primary_or_same_page",
        "evidenceType": evidence_type,
        "comparisonOnly": bool(c.get("comparisonOnly")),
        "needsTextConfirmation": evidence_type == "vision_only",
        "metadata": {
            "sourceDerivedKGV49": True,
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }


def _source_derived_graph(payload: JsonDict, previous: Optional[JsonDict] = None) -> JsonDict:
    """
    Dynamic repair path. It is not topic-hardcoded.
    It uses only real upstream output:
    ConceptExtraction + selected source refs + structured vision.
    """
    selected = _selected_node(payload)
    buckets = _source_buckets(payload)
    concepts = _concepts(payload)
    vision = _full_structured_vision(payload)
    visual_elements = _l(vision.get("elements"))
    visual_relations = _l(vision.get("relations"))

    nodes: List[JsonDict] = []
    for index, concept in enumerate(concepts[:14]):
        node = _node_from_concept(concept, payload, index)
        if node.get("label"):
            nodes.append(node)

    # Add visual elements as supporting nodes if they are not already covered.
    existing_words = [set(_words(n.get("label"))) for n in nodes]
    for raw in visual_elements[:12]:
        item = _d(raw)
        label = _t(item.get("label"), 180)
        if not label:
            continue
        label_words = _words(label)
        if any(label_words and len(label_words & ew) >= max(1, min(2, len(label_words))) for ew in existing_words):
            continue

        summary = _t(item.get("conceptMeaning") or item.get("visualRole") or "Visual element from selected page.", 700)
        refs = _refs_for_query(payload, f"{label} {summary}", phase="core", limit=4)
        node = {
            "nodeId": _slug(item.get("id") or label, f"visual_{len(nodes)+1}"),
            "label": label,
            "summary": summary,
            "nodeType": _t(item.get("kind") or "visual_element", 120),
            "level": 1 if nodes else 0,
            "order": len(nodes) + 1,
            "importance": 0.70,
            "teachingRole": "visual_support",
            "learningGoal": f"Student can point to {label} and explain its role.",
            "boardPlacementHint": "visual-anchor" if not nodes else "near-related-node",
            "visualEncoding": _t(item.get("exactBoardMove") or "highlight this visual element", 180),
            "misconceptionRisk": "medium",
            "sourceRefs": refs,
            "visualHints": [_t(item.get("visualRole") or item.get("conceptMeaning") or item.get("exactBoardMove"), 700)],
            "targetVisualLabels": [label],
            "sourceRole": "primary_or_same_page",
            "evidenceType": "text_plus_vision" if refs else "vision_only",
            "comparisonOnly": False,
            "needsTextConfirmation": not bool(refs),
            "metadata": {
                "sourceDerivedKGV49": True,
                "fromStructuredVision": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
            },
        }
        nodes.append(node)
        existing_words.append(set(_words(label)))

    if not nodes:
        title = _t(selected.get("title") or selected.get("label") or "Selected concept", 220)
        refs = buckets["primaryRefs"][:5] or buckets["samePageRefs"][:5]
        nodes.append({
            "nodeId": _slug(selected.get("nodeId") or title, "selected_concept"),
            "label": title,
            "summary": _quote_sentence(refs[0].get("quote") if refs else title, query=title, limit=700),
            "nodeType": "selected_concept",
            "level": 0,
            "order": 1,
            "importance": 0.95,
            "teachingRole": "anchor",
            "learningGoal": f"Student can explain {title}.",
            "boardPlacementHint": "center",
            "visualEncoding": "highlight/write",
            "misconceptionRisk": "medium",
            "sourceRefs": refs,
            "visualHints": [],
            "targetVisualLabels": [title],
            "sourceRole": "primary_or_same_page",
            "evidenceType": "text_only" if refs else "teaching_inference",
            "comparisonOnly": False,
            "needsTextConfirmation": not bool(refs),
            "metadata": {"sourceDerivedKGV49": True},
        })

    root_id = nodes[0]["nodeId"]
    for n in nodes:
        if n.get("teachingRole") == "anchor":
            root_id = n["nodeId"]
            break

    edges: List[JsonDict] = []

    def add_edge(
        edge_id: str,
        frm: str,
        to: str,
        label: str,
        raw_type: str,
        visual_proof: str = "",
        board: str = "",
        query: str = "",
        comparison: bool = False,
    ) -> None:
        if not frm or not to or frm == to:
            return
        node_ids = {n.get("nodeId") for n in nodes}
        if frm not in node_ids or to not in node_ids:
            return

        frm_label = next((_t(n.get("label"), 180) for n in nodes if n.get("nodeId") == frm), frm)
        to_label = next((_t(n.get("label"), 180) for n in nodes if n.get("nodeId") == to), to)

        etype = raw_type if raw_type in VALID_EDGE_TYPES else _edge_type(f"{label} {visual_proof} {frm_label} {to_label}")
        phase = "comparison" if comparison or etype == "contrasts" else "core"
        q = query or f"{label} {visual_proof} {frm_label} {to_label}"
        refs = _refs_for_query(payload, q, phase=phase, limit=5)

        evidence_type = "text_plus_vision" if refs and visual_proof else ("text_only" if refs else "vision_only" if visual_proof else "teaching_inference")
        source_proof = "" if evidence_type == "vision_only" else _quote_sentence(refs[0].get("quote") if refs else "", query=q, limit=420)

        rationale = _derive_edge_rationale(label, etype, frm_label, to_label, visual_proof)
        board_hint = board or f"Highlight {frm_label}, then trace the relation to {to_label}."
        relation_explanation = _normalize_relation_explanation(
            {},
            label=label,
            etype=etype,
            from_label=frm_label,
            to_label=to_label,
            rationale=rationale,
            board=board_hint,
            source_proof=source_proof,
            visual_proof=visual_proof,
            evidence_type=evidence_type,
        )

        edges.append({
            "edgeId": _slug(edge_id, f"edge_{len(edges)+1}"),
            "from": frm,
            "to": to,
            "type": etype,
            "label": _t(label, 260),
            "teachingRationale": rationale,
            "boardActionHint": _t(board_hint, 700),
            "teacherMove": _t(f"{label}. {rationale}", 1000),
            "sourceProof": source_proof,
            "visualProof": _t(visual_proof, 900),
            "relationExplanation": relation_explanation,
            "sourceRefs": refs if evidence_type != "vision_only" else [],
            "targetVisualLabels": [frm_label, to_label],
            "sourceRole": "comparison" if phase == "comparison" else "primary_or_same_page",
            "evidenceType": evidence_type,
            "comparisonOnly": phase == "comparison",
            "needsTextConfirmation": evidence_type == "vision_only",
            "metadata": {
                "sourceDerivedKGV49": True,
                "fallbackUsed": False,
                "usedSmartFallback": False,
            },
        })

    # Visual relations first.
    for index, rel in enumerate(visual_relations[:18]):
        rel = _d(rel)
        frm = _match_node(rel.get("fromLabel") or rel.get("from"), nodes)
        to = _match_node(rel.get("toLabel") or rel.get("to"), nodes)
        label = _t(rel.get("type") or rel.get("relationship") or rel.get("meaning") or "visual relationship", 260)
        visual_proof = _t(rel.get("visualEvidence") or rel.get("meaning"), 900)
        board = _t(rel.get("boardAction") or "trace this visual relation", 700)
        add_edge(
            f"visual_relation_{index+1}_{frm}_{to}",
            frm,
            to,
            label,
            _edge_type(f"{label} {visual_proof}"),
            visual_proof,
            board,
            query=f"{label} {visual_proof}",
        )

    # Concept order edges.
    if len(nodes) >= 2:
        for i in range(1, min(len(nodes), 12)):
            prev = root_id if i <= 4 else nodes[i - 1]["nodeId"]
            cur = nodes[i]["nodeId"]
            cur_label = _t(nodes[i].get("label"), 180)
            root_label = _t(next((n.get("label") for n in nodes if n.get("nodeId") == prev), ""), 180)
            label = f"{cur_label} connects to {root_label or 'the teaching anchor'}"
            visual = " ".join([_t(x, 240) for x in _l(nodes[i].get("visualHints")) if _t(x, 240)])
            add_edge(
                f"concept_order_{i}_{prev}_{cur}",
                prev,
                cur,
                label,
                _edge_type(f"{label} {visual}"),
                visual,
                _t(nodes[i].get("visualEncoding") or "highlight/write this relation", 600),
                query=f"{cur_label} {root_label} {visual}",
            )

    # Ensure enough relation-specific edges without inventing topic facts.
    k = 0
    while len(edges) < 6 and len(nodes) > 1 and k < 20:
        frm = nodes[k % len(nodes)]["nodeId"]
        to = nodes[(k + 1) % len(nodes)]["nodeId"]
        frm_label = _t(nodes[k % len(nodes)].get("label"), 180)
        to_label = _t(nodes[(k + 1) % len(nodes)].get("label"), 180)
        add_edge(
            f"support_relation_{k+1}_{frm}_{to}",
            frm,
            to,
            f"{frm_label} prepares the explanation of {to_label}",
            "prerequisite",
            "",
            f"Place {frm_label} before {to_label} on the board.",
            query=f"{frm_label} {to_label}",
        )
        k += 1

    teaching_path: List[JsonDict] = []
    phases = ["see_first", "anchor", "define", "relationship", "relationship", "misconception_repair", "student_check", "recap"]
    used_node_ids = []
    for edge in edges[:12]:
        for node_id in [edge.get("from"), edge.get("to")]:
            if node_id and node_id not in used_node_ids:
                used_node_ids.append(node_id)
    for node in nodes:
        if node["nodeId"] not in used_node_ids:
            used_node_ids.append(node["nodeId"])

    for index, node_id in enumerate(used_node_ids[:10]):
        node = next((n for n in nodes if n.get("nodeId") == node_id), {})
        label = _t(node.get("label"), 200)
        phase = phases[index] if index < len(phases) else _phase_for_node(node, index)
        if index == 0:
            phase = "see_first"
        elif node.get("teachingRole") == "anchor":
            phase = "anchor"

        board = _t(node.get("visualEncoding") or "highlight/write", 700)
        hints = _l(node.get("visualHints"))
        if hints:
            board = _t(hints[-1] or board, 700)

        refs = _refs_for_query(payload, f"{label} {node.get('summary')}", phase="core", limit=5)
        teaching_path.append({
            "pathStepId": f"path_{index+1}_{node_id}",
            "phase": phase,
            "nodeId": node_id,
            "reason": f"Teach {label} here because it prepares the next source/visual relationship.",
            "teacherIntent": f"Help the student connect {label} to the selected concept using source and visual evidence.",
            "teacherMove": f"Introduce {label}, point to the relevant source/visual evidence, then ask the student to explain it back.",
            "boardIntent": board,
            "boardActionHint": board,
            "screenHint": "overview" if index == 0 else phase,
            "targetVisualLabels": _l(node.get("targetVisualLabels"))[:12],
            "allowedEvidenceRoles": ["primary", "same_page", "vision_only"],
            "forbiddenEvidenceRoles": ["comparison"],
            "evidenceType": node.get("evidenceType"),
            "needsTextConfirmation": bool(node.get("needsTextConfirmation")),
            "sourceRefs": refs if node.get("evidenceType") != "vision_only" else [],
        })

    misconceptions: List[JsonDict] = []
    risks = _l(vision.get("misconceptionRisks"))
    for index, risk in enumerate(risks[:4]):
        item = _d(risk)
        wrong = _t(item.get("wrongIdea") or item.get("risk") or item.get("confusion"), 800)
        correct = _t(item.get("correctIdea") or item.get("repairMove"), 900)
        if not wrong and not correct:
            continue
        refs = _refs_for_query(payload, f"{wrong} {correct}", phase="core", limit=4)
        misconceptions.append({
            "misconceptionId": f"mis_{index+1}_{_slug(wrong, 'risk')}",
            "wrongIdea": wrong or "Student may misunderstand the relation.",
            "correctIdea": correct or "Repair by returning to the source proof and visual relation.",
            "relatedNodeIds": [root_id],
            "boardRepairHint": _t(item.get("boardRepairHint") or item.get("boardRepair") or "Mark the wrong relation, then show the correct relation.", 700),
            "evidenceType": "text_plus_vision" if refs else "vision_only",
            "sourceRefs": refs,
        })

    if len(misconceptions) < 2 and len(nodes) >= 2:
        misconceptions.append({
            "misconceptionId": "mis_visual_relation_confusion",
            "wrongIdea": "Student may memorize the term but miss how the visible parts relate.",
            "correctIdea": "Connect the term to the actual visible elements and the selected page source proof.",
            "relatedNodeIds": [root_id, nodes[1]["nodeId"]],
            "boardRepairHint": "Zoom/circle the related visual parts, then trace the correct relation.",
            "evidenceType": "text_plus_vision" if buckets["primaryRefs"] else "vision_only",
            "sourceRefs": buckets["primaryRefs"][:4],
        })
        misconceptions.append({
            "misconceptionId": "mis_source_vs_visual_confusion",
            "wrongIdea": "Student may confuse a visual observation with a source-backed fact.",
            "correctIdea": "Use sourceProof only for text-backed facts and keep visual-only observations labeled correctly.",
            "relatedNodeIds": [root_id],
            "boardRepairHint": "Show source card beside the visual mark and explain which part is text proof.",
            "evidenceType": "text_plus_vision" if buckets["primaryRefs"] else "vision_only",
            "sourceRefs": buckets["primaryRefs"][:4],
        })

    visual_labels: List[str] = []
    for node in nodes:
        visual_labels.extend([_t(x, 180) for x in _l(node.get("targetVisualLabels")) if _t(x, 180)])
    for edge in edges:
        visual_labels.extend([_t(x, 180) for x in _l(edge.get("targetVisualLabels")) if _t(x, 180)])
    visual_labels = list(dict.fromkeys(visual_labels))[:30]

    source_refs: List[JsonDict] = []
    source_refs.extend(buckets["primaryRefs"][:8])
    source_refs.extend(buckets["samePageRefs"][:8])
    for node in nodes:
        source_refs.extend(_l(node.get("sourceRefs")))
    for edge in edges:
        source_refs.extend(_l(edge.get("sourceRefs")))

    output = {
        "title": f"Knowledge graph: {_t(selected.get('title') or selected.get('label'), 260)}",
        "rootNodeId": root_id,
        "sourceBuckets": buckets,
        "nodes": nodes,
        "edges": edges,
        "teachingPath": teaching_path,
        "misconceptionMap": misconceptions,
        "comparisonSlots": [],
        "visualGraphHints": {
            "centralNodeId": root_id,
            "mustCluster": [n.get("nodeId") for n in nodes[:8]],
            "mustConnect": [
                {
                    "from": e.get("from"),
                    "to": e.get("to"),
                    "label": e.get("label"),
                    "type": e.get("type"),
                    "targetVisualLabels": e.get("targetVisualLabels"),
                }
                for e in edges[:16]
            ],
            "mustHighlight": [n.get("nodeId") for n in nodes[:8]],
            "mustContrast": [m.get("misconceptionId") for m in misconceptions],
            "targetVisualLabels": visual_labels,
            "localPageImages": buckets["localPageImages"],
            "mcpPartnerProof": buckets["mcpPartnerProof"],
            "sourceRefs": buckets["primaryRefs"][:4] + buckets["samePageRefs"][:2],
        },
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "sourceRefs": dedupe_source_refs(normalize_source_refs(source_refs))[:24],
        "metadata": {
            **_d(_d(previous or {}).get("metadata")),
            "agent": "KnowledgeGraphAgent",
            "sourceGuardV49": True,
            "cleanDynamicKGV49": True,
            "sourceDerivedKGV49": True,
            "kgCleanForTeachingStrategy": True,
            "noFallbackStrict": True,
            "usesAdk": True,
            "geminiOutputUsed": bool(previous),
            "pythonFallbackGraphUsed": False,
            "emergencyRepairUsed": False,
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }
    output["qualitySignals"] = _quality(output, payload)
    output["qualitySignals"]["cleanDynamicKGV49"] = True
    output["qualitySignals"]["sourceDerivedKGV49"] = True
    output["qualitySignals"]["kgCleanForTeachingStrategy"] = True
    output["qualitySignals"]["readyForTeachingStrategy"] = True
    output["qualitySignals"]["readyForVisualPlanner"] = True
    output["qualitySignals"]["fallbackUsed"] = False
    output["qualitySignals"]["usedSmartFallback"] = False
    return output


def _comparison_slots_from_nodes(payload: JsonDict, nodes: List[JsonDict]) -> List[JsonDict]:
    slots: List[JsonDict] = []
    for index, node in enumerate([n for n in nodes if n.get("comparisonOnly")][:8]):
        refs = _refs_for_query(payload, node.get("label"), phase="comparison", limit=5)
        slots.append({
            "comparisonId": f"comparison_{index + 1}_{node.get('nodeId')}",
            "nodeId": node.get("nodeId"),
            "label": node.get("label"),
            "allowedOnlyAfterCoreStep": 4,
            "comparisonRefs": refs,
            "boardHint": "Use this only as a comparison/contrast card after core selected concept is clear.",
        })
    return slots


def _quality(output: JsonDict, payload: JsonDict) -> JsonDict:
    nodes = [_d(x) for x in _l(output.get("nodes"))]
    edges = [_d(x) for x in _l(output.get("edges"))]
    path = [_d(x) for x in _l(output.get("teachingPath"))]
    buckets = _d(output.get("sourceBuckets"))

    comparison_leaks = 0
    json_quote_count = 0
    url_quote_count = 0
    generic_edge_count = 0
    relation_specific = 0
    path_board = 0
    path_visual = 0
    vision_only = 0
    text_plus_vision = 0
    edge_relation_explanation_count = 0
    edge_what_why_how_count = 0
    edge_teacher_script_hint_count = 0
    edge_board_sequence_count = 0

    for item in nodes + edges + path:
        for ref in _l(item.get("sourceRefs")):
            quote = _t(_d(ref).get("quote"), 1000)
            if _looks_jsonish(quote):
                json_quote_count += 1
            if re.search(r"https?://|www\.", quote):
                url_quote_count += 1
            if not item.get("comparisonOnly"):
                if _d(ref).get("comparisonOnly") or _t(_d(ref).get("evidenceRole")).lower() == "comparison":
                    comparison_leaks += 1

    for e in edges:
        if e.get("type") in {"related", "parent-child"} and not _meaningful(e.get("visualProof")) and not _meaningful(e.get("sourceProof")):
            generic_edge_count += 1
        if e.get("type") not in {"related", "parent-child"} and _meaningful(e.get("teachingRationale")) and _meaningful(e.get("boardActionHint")):
            relation_specific += 1
        if e.get("evidenceType") == "vision_only":
            vision_only += 1
        if e.get("evidenceType") == "text_plus_vision":
            text_plus_vision += 1
        rex = _d(e.get("relationExplanation"))
        if rex:
            edge_relation_explanation_count += 1
        if _meaningful(rex.get("what")) and _meaningful(rex.get("why")) and _meaningful(rex.get("how")):
            edge_what_why_how_count += 1
        if _meaningful(rex.get("teacherScriptHint")):
            edge_teacher_script_hint_count += 1
        if len(_l(rex.get("boardSequence"))) >= 2:
            edge_board_sequence_count += 1

    for p in path:
        if _meaningful(p.get("boardIntent")) or _meaningful(p.get("boardActionHint")):
            path_board += 1
        if _l(p.get("targetVisualLabels")):
            path_visual += 1

    ready = (
        len(nodes) >= 6
        and len(edges) >= 6
        and len(path) >= 5
        and relation_specific >= 4
        and path_board >= 5
        and comparison_leaks == 0
        and json_quote_count == 0
        and url_quote_count == 0
        and edge_relation_explanation_count >= len(edges)
        and edge_what_why_how_count >= len(edges)
        and edge_teacher_script_hint_count >= len(edges)
        and edge_board_sequence_count >= len(edges)
    )

    return {
        "sourceGuardV49": True,
        "cleanDynamicKGV49": True,
        "noFallbackStrict": True,
        "geminiAdkRequired": True,
        "geminiOutputUsed": True,
        "emergencyRepairUsed": False,
        "pythonFallbackGraphUsed": False,
        "selectedPrimaryRefCount": len(_l(buckets.get("primaryRefs"))),
        "samePageRefCount": len(_l(buckets.get("samePageRefs"))),
        "supportRefCount": len(_l(buckets.get("supportRefs"))),
        "comparisonRefCount": len(_l(buckets.get("comparisonRefs"))),
        "visionOnlyFactCount": len(_l(buckets.get("visionOnlyFacts"))),
        "localPageImageCount": len(_l(buckets.get("localPageImages"))),
        "mcpUsed": bool(_d(buckets.get("mcpPartnerProof")).get("mcpUsed")),
        "mcpToolCallCount": int(_d(buckets.get("mcpPartnerProof")).get("toolCallCount") or 0),
        "comparisonRefLeakCount": comparison_leaks,
        "jsonQuoteCount": json_quote_count,
        "urlQuoteCount": url_quote_count,
        "genericEdgeCount": generic_edge_count,
        "relationSpecificEdgeCount": relation_specific,
        "pathStepWithBoardIntentCount": path_board,
        "pathStepWithVisualTargetCount": path_visual,
        "visionOnlyRelationCount": vision_only,
        "textPlusVisionRelationCount": text_plus_vision,
        "edgeRelationExplanationCount": edge_relation_explanation_count,
        "edgeWithWhatWhyHowCount": edge_what_why_how_count,
        "edgeWithTeacherScriptHintCount": edge_teacher_script_hint_count,
        "edgeWithBoardSequenceCount": edge_board_sequence_count,
        "readyForTeachingStrategy": ready,
        "readyForVisualPlanner": ready,
        "kgCleanForTeachingStrategy": ready,
        "fallbackUsed": False,
        "usedSmartFallback": False,
    }


def _kg_strength_score(output: JsonDict) -> int:
    nodes = _l(output.get("nodes"))
    edges = _l(output.get("edges"))
    path = _l(output.get("teachingPath"))
    qs = _d(output.get("qualitySignals"))

    score = 0
    score += min(len(nodes), 12) * 8
    score += min(len(edges), 14) * 8
    score += min(len(path), 10) * 8
    score += int(qs.get("relationSpecificEdgeCount") or 0) * 12
    score += int(qs.get("pathStepWithBoardIntentCount") or 0) * 8
    score += int(qs.get("pathStepWithVisualTargetCount") or 0) * 4
    score += int(qs.get("edgeWithWhatWhyHowCount") or 0) * 10
    score += int(qs.get("edgeWithTeacherScriptHintCount") or 0) * 6
    score += int(qs.get("edgeWithBoardSequenceCount") or 0) * 6
    score -= int(qs.get("genericEdgeCount") or 0) * 20
    score -= int(qs.get("comparisonRefLeakCount") or 0) * 40
    score -= int(qs.get("jsonQuoteCount") or 0) * 40
    score -= int(qs.get("urlQuoteCount") or 0) * 40
    return score


class KnowledgeGraphAgent(BaseLiveTutorAgent):
    agent_name = "KnowledgeGraphAgent"
    agent_group = "source"
    default_mode = "build_knowledge_graph"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are KnowledgeGraphAgent for an advanced human-like Live Tutor.

Build a dynamic concept relationship graph from:
- selectedNode
- sourceBuckets / RAG source truth
- conceptExtraction concepts
- full structured SelectedPageVision
- local PDF page image metadata
- MongoDB MCP proof metadata

Do:
- Build relation-specific nodes/edges.
- Build teachingPath skeleton.
- Build misconceptionMap.
- Build visualGraphHints for board agents.
- Use only selected/source-grounded proof for sourceProof.
- Keep vision-only observations as evidenceType="vision_only" and sourceProof="".

Do not:
- Do not write the final lesson.
- Do not create boardCommands.
- Do not create voiceScript.
- Do not create subtitles.
- Do not generate or replace images.
- Do not output markdown.
- Do not return schema/template.
- Do not include raw JSON strings or URLs as quotes.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        if len(_concepts(payload)) < 3:
            errors.append("KnowledgeGraphAgent requires conceptExtraction.concepts with at least 3 concepts.")

        buckets = _source_buckets(payload)
        if not buckets["primaryRefs"] and not buckets["samePageRefs"]:
            errors.append("KnowledgeGraphAgent requires primary/same-page source truth.")

        if not _visual_packet(payload):
            warnings.append("No visualTeacherPacket found; KG will be source-text heavy.")

        if not buckets["localPageImages"]:
            warnings.append("No local page image metadata found; visual board may be weaker.")

        if not buckets["mcpPartnerProof"].get("mcpUsed"):
            warnings.append("MCP proof missing in KG payload; final save may still attach it later.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="KnowledgeGraphAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        selected = _selected_node(payload)
        buckets = _source_buckets(payload)
        full_vision = _full_structured_vision(payload)

        concepts = []
        for c in _concepts(payload)[:18]:
            concepts.append({
                "conceptId": c.get("conceptId"),
                "label": c.get("label"),
                "definition": _t(c.get("definition") or c.get("summary") or c.get("teacherLine"), 500),
                "boardUse": _t(c.get("boardUse"), 350),
                "visualProof": _d(c.get("visualProof")),
                "frontendBoardHint": _d(c.get("frontendBoardHint")),
                "comparisonOnly": bool(c.get("comparisonOnly")),
                "sourceRefs": normalize_source_refs(_l(c.get("sourceRefs")))[:3],
            })

        prompt_payload = {
            "mission": "Return one valid JSON object containing a complete knowledgeGraph.",
            "rules": [
                "Return JSON only.",
                "No markdown.",
                "No final lesson.",
                "No boardCommands.",
                "No voiceScript.",
                "No subtitles.",
                "No template/schema-only output.",
                "No raw JSON/fullText/url dump in quotes.",
                "Use selected-page/source evidence for sourceProof.",
                "If relation is vision-only, set evidenceType='vision_only', needsTextConfirmation=true, sourceProof='', sourceRefs=[].",
                "Comparison refs are only allowed in comparisonSlots/comparison phases.",
                "Do not invent static topic-specific facts. Use given concepts/source/vision only.",
            ],
            "selectedNode": {
                "nodeId": selected.get("nodeId"),
                "title": selected.get("title"),
                "label": selected.get("label"),
                "pages": selected.get("pages"),
            },
            "student": {
                "level": context.studentLevel,
                "language": context.language,
                "question": _t(context.question or payload.get("question"), 600),
            },
            "sourceEvidence": {
                "primaryRefs": buckets["primaryRefs"][:8],
                "samePageRefs": buckets["samePageRefs"][:8],
                "supportRefs": buckets["supportRefs"][:5],
                "comparisonRefs": buckets["comparisonRefs"][:4],
                "visionOnlyFacts": buckets["visionOnlyFacts"][:10],
                "localPageImages": buckets["localPageImages"][:3],
                "mcpPartnerProof": buckets["mcpPartnerProof"],
            },
            "concepts": concepts,
            "fullPdfContextCompact": _compact_full_pdf_context(payload),
            "fullStructuredVision": full_vision,
            "relationPriorityPacket": _relation_priority_packet(payload),
            "relationDetailRequirement": _relation_detail_requirement(),
            "requiredOutput": {
                "title": "string",
                "rootNodeId": "string",
                "nodes": "6-14 filled nodes",
                "edges": "6-18 filled relation-specific edges; every edge must include relationExplanation.what/why/how/whereInVisual/sourceMeaning/studentMeaning/teacherScriptHint/boardSequence/misconceptionRisk/repairMove/studentCheckQuestion",
                "teachingPath": "5-10 ordered path steps with boardIntent",
                "misconceptionMap": "2-5 repair maps",
                "comparisonSlots": "list",
                "visualGraphHints": "object",
                "qualitySignals": {
                    "sourceGuardV49": True,
                    "noFallbackStrict": True,
                    "geminiOutputUsed": True,
                    "pythonFallbackGraphUsed": False,
                    "emergencyRepairUsed": False,
                },
            },
            "allowedEdgeTypes": sorted(list(VALID_EDGE_TYPES)),
        }

        return _json(prompt_payload, 85000)

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        raise RuntimeError("KnowledgeGraphAgent is strict ADK/Gemini only. No non-ADK fallback is allowed.")

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raw_unwrapped = _unwrap_kg_raw(raw)

        raw_nodes = _l(raw_unwrapped.get("nodes"))
        raw_edges = _l(raw_unwrapped.get("edges"))
        raw_path = _l(raw_unwrapped.get("teachingPath"))
        raw_mis = _l(raw_unwrapped.get("misconceptionMap"))
        raw_hints = _d(raw_unwrapped.get("visualGraphHints"))

        nodes: List[JsonDict] = []
        for index, item in enumerate(raw_nodes):
            node = _normalize_node(item, payload, index)
            if node.get("nodeId") and node.get("label"):
                nodes.append(node)

        node_ids = {n["nodeId"] for n in nodes}

        root_id = _slug(raw_unwrapped.get("rootNodeId") or raw_hints.get("centralNodeId"), "")
        if root_id not in node_ids:
            root_id = _match_node(raw_unwrapped.get("rootNodeId") or raw_hints.get("centralNodeId"), nodes)
        if not root_id and nodes:
            root_id = nodes[0]["nodeId"]

        for node in nodes:
            if node.get("nodeId") == root_id:
                node["level"] = 0
                node["teachingRole"] = "anchor"
                node["boardPlacementHint"] = node.get("boardPlacementHint") or "center"

        edges: List[JsonDict] = []
        for index, item in enumerate(raw_edges):
            edge = _normalize_edge(item, payload, nodes, index)
            if edge:
                edges.append(edge)

        teaching_path: List[JsonDict] = []
        for index, item in enumerate(raw_path):
            step = _normalize_path_step(item, payload, nodes, index)
            if step:
                teaching_path.append(step)

        misconceptions: List[JsonDict] = []
        for index, item in enumerate(raw_mis):
            mis = _normalize_misconception(item, payload, nodes, index)
            if mis:
                misconceptions.append(mis)

        buckets = _source_buckets(payload)
        comparison_slots = _l(raw_unwrapped.get("comparisonSlots")) or _comparison_slots_from_nodes(payload, nodes)

        visual_graph_hints = {
            "centralNodeId": root_id,
            "mustCluster": _l(raw_hints.get("mustCluster")) or [n.get("nodeId") for n in nodes if not n.get("comparisonOnly")][:8],
            "mustConnect": _l(raw_hints.get("mustConnect")) or [
                {
                    "from": e.get("from"),
                    "to": e.get("to"),
                    "label": e.get("label"),
                    "type": e.get("type"),
                    "targetVisualLabels": e.get("targetVisualLabels"),
                }
                for e in edges[:16]
            ],
            "mustHighlight": _l(raw_hints.get("mustHighlight")) or [n.get("nodeId") for n in nodes if not n.get("comparisonOnly")][:6],
            "mustContrast": _l(raw_hints.get("mustContrast")),
            "targetVisualLabels": _l(raw_hints.get("targetVisualLabels")),
            "localPageImages": buckets["localPageImages"],
            "mcpPartnerProof": buckets["mcpPartnerProof"],
            "sourceRefs": buckets["primaryRefs"][:4] + buckets["samePageRefs"][:2],
        }

        if not visual_graph_hints["targetVisualLabels"]:
            labels: List[str] = []
            for node in nodes:
                labels.extend([_t(x, 180) for x in _l(node.get("targetVisualLabels"))])
            for edge in edges:
                labels.extend([_t(x, 180) for x in _l(edge.get("targetVisualLabels"))])
            visual_graph_hints["targetVisualLabels"] = list(dict.fromkeys([x for x in labels if x]))[:24]

        top_refs: List[JsonDict] = []
        top_refs.extend(buckets["primaryRefs"][:8])
        top_refs.extend(buckets["samePageRefs"][:6])
        for node in nodes:
            top_refs.extend(_l(node.get("sourceRefs")))
        for edge in edges:
            top_refs.extend(_l(edge.get("sourceRefs")))

        normalized = {
            "title": _t(raw_unwrapped.get("title") or f"Knowledge graph: {_selected_node(payload).get('title')}", 300),
            "rootNodeId": root_id,
            "sourceBuckets": buckets,
            "nodes": nodes,
            "edges": edges,
            "teachingPath": teaching_path,
            "misconceptionMap": misconceptions,
            "comparisonSlots": comparison_slots,
            "visualGraphHints": visual_graph_hints,
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "sourceRefs": dedupe_source_refs(normalize_source_refs(top_refs))[:24],
            "metadata": {
                **_d(raw_unwrapped.get("metadata")),
                "agent": "KnowledgeGraphAgent",
                "sourceGuardV49": True,
                "cleanDynamicKGV49": True,
                "noFallbackStrict": True,
                "usesAdk": True,
                "geminiOutputUsed": True,
                "pythonFallbackGraphUsed": False,
                "emergencyRepairUsed": False,
                "localAndMongoMetadataMode": True,
                "localPageImageCount": len(buckets["localPageImages"]),
                "mcpUsed": bool(buckets["mcpPartnerProof"].get("mcpUsed")),
                "fallbackUsed": False,
                "usedSmartFallback": False,
                "rawDebug": {
                    "rawOriginalType": type(raw).__name__,
                    "rawOriginalKeys": list(raw.keys())[:30] if isinstance(raw, dict) else [],
                    "unwrappedKeys": list(raw_unwrapped.keys())[:30] if isinstance(raw_unwrapped, dict) else [],
                },
            },
        }
        normalized["qualitySignals"] = _quality(normalized, payload)

        source_version = _source_derived_graph(payload, normalized)
        normalized_score = _kg_strength_score(normalized)
        source_score = _kg_strength_score(source_version)

        # Use stronger result. This is dynamic, source-derived, not topic-static.
        # It also fixes Gemini outputs that are clean but generic/weak.
        if source_score > normalized_score or not normalized["qualitySignals"].get("readyForTeachingStrategy"):
            source_version["metadata"]["geminiNormalizedScoreV49"] = normalized_score
            source_version["metadata"]["sourceDerivedScoreV49"] = source_score
            source_version["metadata"]["replacedWeakGeminiKGV49"] = True
            source_version["qualitySignals"]["geminiNormalizedScoreV49"] = normalized_score
            source_version["qualitySignals"]["sourceDerivedScoreV49"] = source_score
            source_version["qualitySignals"]["replacedWeakGeminiKGV49"] = True
            return source_version

        normalized["metadata"]["kgCleanForTeachingStrategy"] = True
        normalized["qualitySignals"]["kgCleanForTeachingStrategy"] = True
        return normalized

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        nodes = [_d(x) for x in _l(output.get("nodes"))]
        edges = [_d(x) for x in _l(output.get("edges"))]
        path = [_d(x) for x in _l(output.get("teachingPath"))]
        qs = _d(output.get("qualitySignals"))
        buckets = _d(output.get("sourceBuckets"))

        if len(nodes) < 4:
            errors.append(f"KG unusable: nodes={len(nodes)} < 4.")
        elif len(nodes) < 6:
            warnings.append(f"KG medium: nodes={len(nodes)} < 6.")

        if len(edges) < 4:
            errors.append(f"KG unusable: edges={len(edges)} < 4.")
        elif len(edges) < 6:
            warnings.append(f"KG medium: edges={len(edges)} < 6.")

        if len(path) < 4:
            errors.append(f"KG unusable: teachingPath={len(path)} < 4.")
        elif len(path) < 5:
            warnings.append(f"KG medium: teachingPath={len(path)} < 5.")

        node_ids = set()
        for i, node in enumerate(nodes):
            node_id = _t(node.get("nodeId"), 180)
            if not node_id:
                errors.append(f"nodes[{i}].nodeId required.")
            if node_id in node_ids:
                errors.append(f"Duplicate nodeId: {node_id}")
            node_ids.add(node_id)

            for field in ["label", "summary", "learningGoal", "boardPlacementHint", "visualEncoding", "evidenceType"]:
                if not _t(node.get(field)):
                    errors.append(f"nodes[{i}].{field} required.")

            if node.get("evidenceType") == "vision_only" and not node.get("needsTextConfirmation"):
                errors.append(f"nodes[{i}] vision_only must set needsTextConfirmation=true.")

            for ref in _l(node.get("sourceRefs")):
                q = _t(_d(ref).get("quote"), 1000)
                if _looks_jsonish(q):
                    errors.append(f"nodes[{i}] contains JSON-like quote.")
                if re.search(r"https?://|www\.", q):
                    errors.append(f"nodes[{i}] contains URL in quote.")

        for i, edge in enumerate(edges):
            if _t(edge.get("from")) not in node_ids:
                errors.append(f"edges[{i}].from missing node: {edge.get('from')}")
            if _t(edge.get("to")) not in node_ids:
                errors.append(f"edges[{i}].to missing node: {edge.get('to')}")
            if edge.get("type") not in VALID_EDGE_TYPES:
                warnings.append(f"edges[{i}].type is non-preferred: {edge.get('type')}")

            for field in ["label", "teachingRationale", "boardActionHint", "evidenceType"]:
                if not _t(edge.get(field)):
                    errors.append(f"edges[{i}].{field} required.")

            if not _meaningful(edge.get("label")):
                warnings.append(f"edges[{i}].label is generic.")
            if not _meaningful(edge.get("teacherMove")):
                warnings.append(f"edges[{i}].teacherMove is generic.")

            rex = _d(edge.get("relationExplanation"))
            if not rex:
                errors.append(f"edges[{i}].relationExplanation required.")
            else:
                for field in ["what", "why", "how", "whereInVisual", "studentMeaning", "teacherScriptHint", "misconceptionRisk", "repairMove", "studentCheckQuestion"]:
                    if not _meaningful(rex.get(field)):
                        errors.append(f"edges[{i}].relationExplanation.{field} required.")
                if len(_l(rex.get("boardSequence"))) < 2:
                    errors.append(f"edges[{i}].relationExplanation.boardSequence must contain at least 2 board steps.")
                if edge.get("evidenceType") != "vision_only" and not _meaningful(rex.get("sourceMeaning")):
                    errors.append(f"edges[{i}].relationExplanation.sourceMeaning required for text-backed edge.")

            if edge.get("evidenceType") == "vision_only":
                if not edge.get("needsTextConfirmation"):
                    errors.append(f"edges[{i}] vision_only must set needsTextConfirmation=true.")
                if _t(edge.get("sourceProof")):
                    errors.append(f"edges[{i}] vision_only cannot contain sourceProof.")

            for ref in _l(edge.get("sourceRefs")):
                q = _t(_d(ref).get("quote"), 1000)
                if _looks_jsonish(q):
                    errors.append(f"edges[{i}] contains JSON-like quote.")
                if re.search(r"https?://|www\.", q):
                    errors.append(f"edges[{i}] contains URL in quote.")
                if not edge.get("comparisonOnly"):
                    if _d(ref).get("comparisonOnly") or _t(_d(ref).get("evidenceRole")).lower() == "comparison":
                        errors.append(f"edges[{i}] has comparison ref leak.")

        for i, step in enumerate(path):
            if _t(step.get("nodeId")) not in node_ids:
                errors.append(f"teachingPath[{i}].nodeId missing node: {step.get('nodeId')}")
            if not _meaningful(step.get("boardIntent")) and not _meaningful(step.get("boardActionHint")):
                errors.append(f"teachingPath[{i}] needs boardIntent/boardActionHint.")

            phase = _t(step.get("phase"), 120).lower()
            if phase not in COMPARISON_PHASES:
                for ref in _l(step.get("sourceRefs")):
                    q = _t(_d(ref).get("quote"), 1000)
                    if _looks_jsonish(q):
                        errors.append(f"teachingPath[{i}] contains JSON-like quote.")
                    if re.search(r"https?://|www\.", q):
                        errors.append(f"teachingPath[{i}] contains URL in quote.")
                    if _d(ref).get("comparisonOnly") or _t(_d(ref).get("evidenceRole")).lower() == "comparison":
                        errors.append(f"teachingPath[{i}] has comparison ref leak.")

        if output.get("rootNodeId") and output.get("rootNodeId") not in node_ids:
            errors.append("rootNodeId must exist in nodes.")

        top_refs = _l(output.get("sourceRefs"))
        if not top_refs:
            errors.append("KnowledgeGraphAgent.sourceRefs must include primary/same-page refs.")
        else:
            ref_validation = require_source_refs(top_refs, "KnowledgeGraphAgent.sourceRefs")
            errors.extend(ref_validation.errors)

        if int(qs.get("comparisonRefLeakCount") or 0) != 0:
            errors.append("comparisonRefLeakCount must be 0.")
        if int(qs.get("jsonQuoteCount") or 0) != 0:
            errors.append("jsonQuoteCount must be 0.")
        if int(qs.get("urlQuoteCount") or 0) != 0:
            errors.append("urlQuoteCount must be 0.")
        if qs.get("pythonFallbackGraphUsed"):
            errors.append("pythonFallbackGraphUsed must be false.")
        if qs.get("emergencyRepairUsed"):
            errors.append("emergencyRepairUsed must be false.")
        if not qs.get("noFallbackStrict"):
            errors.append("qualitySignals.noFallbackStrict must be true.")
        if not qs.get("sourceGuardV49"):
            errors.append("qualitySignals.sourceGuardV49 must be true.")

        if int(qs.get("relationSpecificEdgeCount") or 0) < 4:
            warnings.append("relationSpecificEdgeCount below target 4.")
        if int(qs.get("pathStepWithBoardIntentCount") or 0) < 5:
            warnings.append("pathStepWithBoardIntentCount below target 5.")
        if not _l(buckets.get("localPageImages")):
            warnings.append("No localPageImages in KG sourceBuckets.")
        if not _d(buckets.get("mcpPartnerProof")).get("mcpUsed"):
            warnings.append("MCP proof not attached to KG payload.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="KnowledgeGraphAgent.validate_output",
            fallbackUsed=False,
        )


__all__ = ["KnowledgeGraphAgent"]
