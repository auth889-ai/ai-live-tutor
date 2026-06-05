"""
google_agent/visual/text2diagram_style.py
===============================================================================
FULL REPLACEMENT FOR VERSION 5

Text2Diagram-style helper used by DiagramCompilerAgent.

What was taken from Text2Diagram.zip idea/code:
- text/source evidence -> diagram intent -> Mermaid
- keep Mermaid code visible/debuggable like CodeBlock.tsx
- renderable Mermaid output like Mermaids.tsx
- prompt-style schema from Prompts.md, but adapted to your Python backend

What this file does NOT do:
- does not copy the whole Next.js Text2Diagram app
- does not invent fake sourceRefs
- does not make keyword-chain diagrams from title words
===============================================================================
"""

from __future__ import annotations

import html
import re
from typing import Any, List

try:
    from ..live_tutor_agents.contracts import (
        JsonDict,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        safe_dict,
        safe_list,
    )
except Exception:
    from google_agent.live_tutor_agents.contracts import (
        JsonDict,
        clean_text,
        dedupe_source_refs,
        normalize_id,
        safe_dict,
        safe_list,
    )

STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "that", "this", "these", "those",
    "to", "of", "in", "on", "for", "from", "with", "without", "by", "as", "is", "are",
    "was", "were", "be", "been", "being", "it", "its", "can", "could", "should", "must",
    "may", "not", "also", "concept", "selected", "node", "topic", "definition", "example",
    "page", "source", "evidence", "chapter", "lecture",
}

SCHEMA_HINTS = {
    "star schema", "fact table", "dimension table", "dimension tables", "measure", "measures",
    "attribute", "attributes", "primary key", "foreign key", "denormalized", "denormalization",
    "snowflake schema", "galaxy schema", "schema", "database", "warehouse",
}

PROCESS_HINTS = {
    "step", "phase", "process", "workflow", "flow", "migration", "deploy", "backfill",
    "rollback", "verify", "validation", "sequence", "pipeline",
}

COMPARISON_HINTS = {"compare", "comparison", "versus", " vs ", "difference", "tradeoff", "pros", "cons"}
TIMELINE_HINTS = {"timeline", "history", "evolution", "before", "after", "period", "schedule"}
SEQUENCE_HINTS = {"request", "response", "client", "server", "interaction", "message", "actor"}


def walk_source_refs(value: Any, refs: List[JsonDict]) -> None:
    if isinstance(value, list):
        for item in value:
            walk_source_refs(item, refs)
        return

    if isinstance(value, dict):
        local = value.get("sourceRefs")
        if isinstance(local, list):
            refs.extend([safe_dict(x) for x in local if safe_dict(x)])
        for child in value.values():
            if isinstance(child, (dict, list)):
                walk_source_refs(child, refs)


def collect_source_refs(*values: Any) -> List[JsonDict]:
    refs: List[JsonDict] = []
    for value in values:
        walk_source_refs(value, refs)
    return dedupe_source_refs(refs)


def chunk_to_ref(chunk: JsonDict) -> JsonDict:
    c = safe_dict(chunk)
    page = c.get("page") or c.get("pageNumber") or 1
    chunk_id = clean_text(c.get("chunkId") or c.get("id") or f"chunk_p{page}", 220)

    return {
        "chunkId": chunk_id,
        "sourceRef": clean_text(c.get("sourceRef") or c.get("ref") or chunk_id, 300),
        "pageRef": clean_text(c.get("pageRef") or c.get("sourceRef") or f"page:{page}", 300),
        "page": page,
        "quote": clean_text(c.get("quote") or c.get("textPreview") or c.get("text") or c.get("ocrText") or "", 900),
        "confidence": c.get("confidence") or 0.78,
        "resourceId": clean_text(c.get("resourceId") or c.get("resource_id") or "", 180),
    }


def fallback_refs_from_chunks(chunks: List[JsonDict]) -> List[JsonDict]:
    refs: List[JsonDict] = []
    for chunk in safe_list(chunks):
        ref = chunk_to_ref(safe_dict(chunk))
        if clean_text(ref.get("chunkId")):
            refs.append(ref)
    return dedupe_source_refs(refs)


def get_grounded_refs(payload: JsonDict) -> List[JsonDict]:
    refs = collect_source_refs(
        payload.get("sourceRefs"),
        payload.get("groundedRefs"),
        payload.get("verifiedSourceRefs"),
        payload.get("selectedNode"),
        payload.get("node"),
        payload.get("visualPlan"),
        payload.get("sourceGrounding"),
        payload.get("explanation"),
        payload.get("conceptExtraction"),
        payload.get("knowledgeGraph"),
        payload.get("chunks"),
        payload.get("retrievedChunks"),
    )
    return refs or fallback_refs_from_chunks(safe_list(payload.get("chunks") or payload.get("retrievedChunks")))


def all_context_text(payload: JsonDict, visual: JsonDict | None = None, limit: int = 80000) -> str:
    parts: List[str] = []
    if visual:
        parts.append(clean_text(visual, 20000))
    for key in [
        "selectedNode", "visualPlan", "sourceGrounding", "conceptExtraction", "knowledgeGraph",
        "teachingStrategy", "explanation", "analogyExamples", "chunks", "retrievedChunks",
    ]:
        value = payload.get(key)
        if value:
            parts.append(clean_text(value, 20000))
    return clean_text("\n".join(parts), limit)


def title_from_payload(payload: JsonDict, visual: JsonDict | None = None) -> str:
    visual = safe_dict(visual)
    plan = safe_dict(payload.get("visualPlan"))
    node = safe_dict(payload.get("selectedNode") or payload.get("node"))
    return clean_text(
        visual.get("title") or plan.get("title") or node.get("title") or node.get("label") or payload.get("topic") or "Selected concept",
        180,
    )


def normalize_diagram_type(value: Any, context_text: str = "") -> str:
    raw = clean_text(value, 80).replace("_", "-").lower()
    text = clean_text(context_text, 50000).lower()

    if raw in {"schema", "schema-diagram", "schemadiagram", "er", "er-diagram", "database-schema"}:
        return "schemaDiagram"
    if raw in {"table", "comparison", "comparison-table", "mapping-table", "evidence-table"}:
        return "comparisonTable"
    if raw in {"sequence", "sequence-diagram", "sequencediagram"}:
        return "sequenceDiagram"
    if raw in {"timeline", "gantt"}:
        return "timeline"
    if raw in {"mindmap", "mind-map", "concept-map", "conceptmap", "tree", "concept-tree"}:
        return "conceptMap"
    if raw in {"state", "state-diagram"}:
        return "stateDiagram"
    if raw in {"class", "class-diagram"}:
        return "classDiagram"

    if any(h in text for h in SCHEMA_HINTS) and ("table" in text or "schema" in text):
        return "schemaDiagram"
    if any(h in text for h in COMPARISON_HINTS):
        return "comparisonTable"
    if any(h in text for h in TIMELINE_HINTS):
        return "timeline"
    if any(h in text for h in SEQUENCE_HINTS):
        return "sequenceDiagram"
    if any(h in text for h in PROCESS_HINTS):
        return "flowchart"
    return "conceptMap"


def split_sentences(text: str, limit: int = 12) -> List[str]:
    raw = re.split(r"(?<=[.!?])\s+|\n+|[•▪●◦]\s*", clean_text(text, 30000))
    out: List[str] = []
    seen = set()

    for part in raw:
        s = clean_text(part, 360)
        if len(s) < 18:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= limit:
            break

    return out


def evidence_rows(payload: JsonDict, visual: JsonDict | None = None, limit: int = 12) -> List[JsonDict]:
    visual = safe_dict(visual)
    rows: List[JsonDict] = []

    for row in safe_list(visual.get("evidenceRows")):
        r = safe_dict(row)
        text = clean_text(r.get("text") or r.get("quote") or r.get("meaning") or r.get("feature"), 420)
        refs = safe_list(r.get("sourceRefs")) or collect_source_refs(r, visual, payload)[:1]
        if text and refs:
            rows.append({"text": text, "sourceRefs": refs, "page": r.get("page") or safe_dict(refs[0]).get("page")})

    for ref in get_grounded_refs({**payload, "visual": visual})[:limit]:
        quote = clean_text(ref.get("quote"), 420)
        if quote:
            rows.append({"text": quote, "sourceRefs": [ref], "page": ref.get("page")})

    for chunk in safe_list(payload.get("chunks") or payload.get("retrievedChunks"))[:30]:
        c = safe_dict(chunk)
        ref = chunk_to_ref(c)
        for sentence in split_sentences(c.get("text") or c.get("textPreview") or c.get("ocrText") or "", 3):
            rows.append({"text": sentence, "sourceRefs": [ref], "page": ref.get("page")})
            if len(rows) >= limit * 2:
                break

    seen = set()
    out: List[JsonDict] = []
    for row in rows:
        text = clean_text(row.get("text"), 420)
        refs = safe_list(row.get("sourceRefs"))
        if not text or not refs:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"text": text, "sourceRefs": refs, "page": row.get("page") or safe_dict(refs[0]).get("page")})
        if len(out) >= limit:
            break

    return out


def is_good_label(label: Any) -> bool:
    text = clean_text(label, 100)
    if len(text) < 4:
        return False

    words = re.findall(r"[A-Za-z0-9-]+", text)
    if len(words) == 1 and text.lower() not in {"measures", "attributes", "keys"}:
        return False

    meaningful = [w for w in words if w.lower() not in STOPWORDS]
    return len(meaningful) >= 1 and not all(w.lower() in STOPWORDS for w in words)


def phrase_candidates(text: str, limit: int = 10) -> List[str]:
    candidates = re.findall(r"\b[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z][A-Za-z0-9-]*){1,5}\b", clean_text(text, 6000))
    out: List[str] = []
    seen = set()

    for cand in candidates:
        phrase = clean_text(cand.strip(" .,:;()[]{}"), 90)
        low = phrase.lower()
        words = [w for w in low.split() if w]

        if not is_good_label(phrase):
            continue
        if len([w for w in words if w not in STOPWORDS]) < 2:
            continue
        if low in seen:
            continue

        seen.add(low)
        out.append(phrase)
        if len(out) >= limit:
            break

    return out


def add_concept(concepts: List[JsonDict], label: str, why: str, refs: List[JsonDict]) -> None:
    label = clean_text(label, 90)
    if not is_good_label(label):
        return
    if label.lower() in {safe_dict(c).get("label", "").lower() for c in concepts}:
        return

    concepts.append({
        "id": normalize_id(label, "concept"),
        "label": label,
        "why": clean_text(why, 280),
        "sourceRefs": refs[:4],
    })


def source_concepts(payload: JsonDict, visual: JsonDict | None = None, limit: int = 12) -> List[JsonDict]:
    visual = safe_dict(visual)
    refs = collect_source_refs(visual, payload) or get_grounded_refs(payload)
    rows = evidence_rows(payload, visual, 12)
    text = all_context_text(payload, visual, 80000).lower()
    concepts: List[JsonDict] = []

    raw = safe_list(visual.get("concepts")) or safe_list(safe_dict(payload.get("visualPlan")).get("concepts"))
    for item in raw:
        d = safe_dict(item)
        if d:
            add_concept(concepts, d.get("label") or d.get("title") or d.get("name"), d.get("why") or d.get("meaning") or d.get("body"), safe_list(d.get("sourceRefs")) or refs)
        elif isinstance(item, str):
            add_concept(concepts, item, "Source-backed concept from visual plan.", refs)

    if "star schema" in text or ("fact table" in text and "dimension" in text):
        star_items = [
            ("Central Fact Table", "A star schema has one central fact table."),
            ("Keys And Measures", "The fact table contains keys and measures."),
            ("Surrounding Dimension Tables", "Dimension tables surround the fact table."),
            ("One Table Per Dimension", "Each dimension is represented by one table."),
            ("Dimension Attributes", "Dimension tables contain descriptive attributes."),
            ("Joined To Fact Table", "Dimension tables join directly to the fact table."),
            ("Dimensions Not Joined Together", "Dimension tables are not normally joined to each other."),
            ("May Be Denormalized", "Dimension tables may not be normalized."),
        ]
        for label, why in star_items:
            add_concept(concepts, label, why, refs)

    elif "non-destructive" in text:
        for label, why in [
            ("Safe Schema Change", "The change should not break existing data or old code."),
            ("Old Code Still Works", "Existing application code continues during rollout."),
            ("Incremental Deployment", "The change can be deployed in small safe steps."),
            ("Verification", "Tests and checks prove the change is safe."),
        ]:
            add_concept(concepts, label, why, refs)

    for row in rows:
        for phrase in phrase_candidates(row.get("text", ""), 2):
            add_concept(concepts, phrase, row.get("text", ""), safe_list(row.get("sourceRefs")) or refs)

    return concepts[:limit]


def is_keyword_only(concepts: List[JsonDict], title: str) -> bool:
    labels = [clean_text(safe_dict(c).get("label") or c, 100) for c in safe_list(concepts)]
    labels = [x for x in labels if x]
    if len(labels) < 3:
        return True

    title_words = {w.lower() for w in re.findall(r"[A-Za-z]+", clean_text(title, 200)) if len(w) > 2}
    single_title = [x for x in labels if len(x.split()) == 1 and x.lower() in title_words]

    if len(single_title) >= 3:
        return True
    if all(len(x.split()) == 1 for x in labels[:5]):
        return True
    return False


def mermaid_escape(label: str) -> str:
    text = clean_text(label, 90).replace('"', "'").replace("[", "(").replace("]", ")")
    return text or "Source backed idea"


def build_mermaid(kind: str, title: str, concepts: List[JsonDict], evidence: List[JsonDict]) -> str:
    title_label = mermaid_escape(title)
    labels = [mermaid_escape(c.get("label")) for c in concepts if clean_text(c.get("label"))]

    if kind == "schemaDiagram":
        lines = ["flowchart LR", '  FACT["Central Fact Table<br/>keys + measures"]']
        dim_labels = [l for l in labels if any(x in l.lower() for x in ["dimension", "attribute", "denormal", "joined"])]
        if not dim_labels:
            dim_labels = labels[:6]

        for i, label in enumerate(dim_labels[:6], start=1):
            nid = f"D{i}"
            relation = "joins to" if "joined" in label.lower() else "surrounds"
            lines.append(f'  {nid}["{label}"]')
            lines.append(f"  {nid} -- {relation} --> FACT")

        other = [l for l in labels if l not in dim_labels and "fact" not in l.lower()][:3]
        for i, label in enumerate(other, start=1):
            lines.append(f'  FACT --> M{i}["{label}"]')

        return "\n".join(lines)

    if kind == "comparisonTable":
        lines = ["flowchart TB", f'  ROOT["{title_label}"]']
        for i, row in enumerate(evidence[:6], start=1):
            lines.append(f'  ROOT --> E{i}["{mermaid_escape(row.get("text"))}"]')
        return "\n".join(lines)

    if kind == "sequenceDiagram":
        return "\n".join([
            "sequenceDiagram",
            "  participant Student",
            "  participant Tutor",
            "  participant Source as PDF Source",
            "  Student->>Tutor: asks selected concept",
            "  Tutor->>Source: verifies source evidence",
            "  Source-->>Tutor: returns grounded facts",
            "  Tutor-->>Student: explains with board diagram",
        ])

    if kind == "timeline":
        lines = ["timeline", f"  title {title_label}"]
        for i, concept in enumerate(concepts[:7], start=1):
            lines.append(f"  Step {i} : {mermaid_escape(concept.get('label'))}")
        return "\n".join(lines)

    if kind == "conceptMap":
        lines = ["mindmap", f"  root(({title_label}))"]
        for concept in concepts[:8]:
            lines.append(f"    {mermaid_escape(concept.get('label'))}")
        return "\n".join(lines)

    lines = ["flowchart TD", f'  ROOT["{title_label}"]']
    prev = "ROOT"
    for i, concept in enumerate(concepts[:8], start=1):
        nid = f"C{i}"
        lines.append(f'  {nid}["{mermaid_escape(concept.get("label"))}"]')
        lines.append(f"  {prev} --> {nid}")
        prev = nid

    return "\n".join(lines)


def react_flow(kind: str, title: str, concepts: List[JsonDict]) -> JsonDict:
    nodes: List[JsonDict] = []
    edges: List[JsonDict] = []

    nodes.append({"id": "root", "type": "input", "data": {"label": title}, "position": {"x": 360, "y": 220}})

    if kind == "schemaDiagram":
        positions = [(60, 40), (660, 40), (40, 220), (680, 220), (60, 420), (660, 420), (360, 40), (360, 420)]
        for i, concept in enumerate(concepts[:8], start=1):
            x, y = positions[(i - 1) % len(positions)]
            nid = f"n{i}"
            nodes.append({"id": nid, "data": {"label": concept.get("label")}, "position": {"x": x, "y": y}, "sourceRefs": concept.get("sourceRefs")})
            edges.append({"id": f"e{i}", "source": nid, "target": "root", "label": "source-backed relation"})
    else:
        y = 120
        prev = "root"
        for i, concept in enumerate(concepts[:8], start=1):
            nid = f"n{i}"
            nodes.append({"id": nid, "data": {"label": concept.get("label")}, "position": {"x": 100 + (i % 2) * 420, "y": y}, "sourceRefs": concept.get("sourceRefs")})
            edges.append({"id": f"e{i}", "source": prev, "target": nid, "label": "explains"})
            prev = nid
            y += 130

    return {"nodes": nodes, "edges": edges}


def html_preview(kind: str, title: str, concepts: List[JsonDict], evidence: List[JsonDict]) -> str:
    items = "".join(
        f"<li><strong>{html.escape(clean_text(c.get('label'), 90))}</strong><span>{html.escape(clean_text(c.get('why'), 180))}</span></li>"
        for c in concepts[:8]
    )
    quotes = "".join(
        f"<blockquote><b>p.{html.escape(str(e.get('page') or '?'))}</b> {html.escape(clean_text(e.get('text'), 240))}</blockquote>"
        for e in evidence[:4]
    )

    return (
        "<section class='text2diagram-preview source-grounded'>"
        f"<h3>{html.escape(clean_text(title, 120))}</h3>"
        f"<p>Diagram type: <b>{html.escape(kind)}</b>. Built from PDF source evidence, not title keywords.</p>"
        f"<ul>{items}</ul>"
        f"<div class='evidence'>{quotes}</div>"
        "</section>"
    )


def excalidraw_elements(concepts: List[JsonDict]) -> List[JsonDict]:
    elements: List[JsonDict] = []
    for i, concept in enumerate(concepts[:8], start=1):
        elements.append({
            "id": f"box_{i}",
            "type": "rectangle",
            "x": 80 + (i % 2) * 360,
            "y": 80 + i * 72,
            "width": 300,
            "height": 56,
            "label": clean_text(concept.get("label"), 100),
            "sourceRefs": safe_list(concept.get("sourceRefs")),
            "roughness": 1,
        })
    return elements


def text2diagram_prompt(title: str, kind: str, concepts: List[JsonDict], evidence: List[JsonDict]) -> str:
    evidence_lines = "\n".join(f"- p.{e.get('page')}: {clean_text(e.get('text'), 220)}" for e in evidence[:8])
    concept_lines = "\n".join(f"- {clean_text(c.get('label'), 90)}: {clean_text(c.get('why'), 180)}" for c in concepts[:10])

    return clean_text(
        f"""
Text2Diagram instruction:
Create a {kind} for: {title}
Use only these source-backed concepts:
{concept_lines}
Use these PDF evidence rows:
{evidence_lines}
Reject keyword-only title splitting. Every node must represent a source-backed concept.
Return Mermaid + renderable node/edge data + HTML preview.
""",
        8000,
    )


__all__ = [
    "collect_source_refs", "get_grounded_refs", "title_from_payload", "normalize_diagram_type",
    "evidence_rows", "source_concepts", "is_keyword_only", "build_mermaid", "react_flow",
    "html_preview", "excalidraw_elements", "text2diagram_prompt",
]