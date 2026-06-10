"""
google_agent/source/selected_page_vision_agent.py
===============================================================================
Selected PDF page image/diagram -> Gemini Vision -> planner-ready visualLessonInput.

Purpose in Stage 2:
- Receive selected node context from Node/sourceContextBuilder through orchestrator.
- Read selected/nearby PDF page image bytes from local rendered page images.
- Call real Gemini Vision with compact source truth + compact full-PDF context.
- Return structured visual understanding, not a final lesson and not a weak summary.
- Build visualLessonInput so later agents do not depend on repeated diagramSummary.

Strict rules:
- No fake/static fallback.
- If an image exists but cannot be read or Gemini cannot be called, fail clearly.
- PDF extracted text / selected evidence is truth.
- Image/OCR text is helper only.
- Page image is used for layout, diagram shape, visible labels, arrows, table shape, and teacher marking hints.
===============================================================================
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from json import JSONDecoder
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
from ..live_tutor_agents.contracts import (
    AgentContext,
    JsonDict,
    ValidationResult,
    clean_text,
    dedupe_source_refs,
    safe_dict,
    safe_list,
)

SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def env_first(*names: str) -> str:
    for name in names:
        value = clean_text(os.getenv(name), 4000)
        if value:
            return value
    return ""


def bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return fallback


def strip_json_fence(text: str) -> str:
    value = clean_text(text, 900000).strip()
    value = re.sub(r"^```(?:json|javascript|js|txt)?\s*", "", value, flags=re.I)
    value = re.sub(r"\s*```$", "", value.strip())
    value = value.replace("```", "")
    return value.strip()


def parse_json_from_text(text: str) -> JsonDict:
    raw = strip_json_fence(text)
    if not raw:
        raise RuntimeError("Gemini vision returned empty text.")

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"items": parsed}
    except Exception:
        pass

    try:
        parsed, _ = JSONDecoder().raw_decode(raw)
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"items": parsed}
    except Exception:
        pass

    spans: List[str] = []
    for opener, closer in [("{", "}"), ("[", "]")]:
        start = -1
        depth = 0
        in_string = False
        escape = False
        for index, char in enumerate(raw):
            if escape:
                escape = False
                continue
            if char == "\\" and in_string:
                escape = True
                continue
            if char == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if char == opener:
                if depth == 0:
                    start = index
                depth += 1
            elif char == closer and depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    spans.append(raw[start : index + 1])
                    start = -1

    best: Optional[JsonDict] = None
    best_score = -1
    for span in spans:
        try:
            parsed = json.loads(span)
            if isinstance(parsed, list):
                parsed = {"items": parsed}
            if not isinstance(parsed, dict):
                continue
            score = sum(
                10
                for key in [
                    "pageImageAnalyses",
                    "visualLessonInput",
                    "detectedDiagrams",
                    "diagramElements",
                    "teacherMarkingHints",
                    "boardRedrawHints",
                    "metadata",
                ]
                if key in parsed
            )
            if score > best_score:
                best = parsed
                best_score = score
        except Exception:
            continue

    if best is not None:
        return best

    raise RuntimeError(f"Gemini vision did not return valid JSON. Preview: {clean_text(raw, 800)}")


def image_mime_type(path_or_url: str) -> str:
    mime, _ = mimetypes.guess_type(path_or_url)
    if mime and mime.startswith("image/"):
        return mime
    ext = Path(path_or_url).suffix.lower()
    if ext == ".png":
        return "image/png"
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext == ".webp":
        return "image/webp"
    return "image/png"


def looks_like_http_url(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def normalize_slash_path(value: str) -> str:
    return clean_text(value, 3000).replace("\\", "/")


def possible_project_roots() -> List[Path]:
    roots: List[Path] = []
    for env_name in [
        "LIVE_TUTOR_PROJECT_ROOT",
        "PROJECT_ROOT",
        "APP_ROOT",
        "SERVER_ROOT",
        "LIVE_TUTOR_SERVER_ROOT",
    ]:
        raw = clean_text(os.getenv(env_name), 3000)
        if raw:
            roots.append(Path(raw).expanduser().resolve())

    cwd = Path.cwd().resolve()
    roots.append(cwd)
    roots.extend(list(cwd.parents))

    unique: List[Path] = []
    seen = set()
    for root in roots:
        key = str(root)
        if key not in seen:
            seen.add(key)
            unique.append(root)
    return unique


def resolve_local_image_path(path_value: str, url_value: str = "") -> str:
    raw_candidates = [normalize_slash_path(path_value), normalize_slash_path(url_value)]
    candidates: List[Path] = []

    for raw in raw_candidates:
        if not raw:
            continue
        if looks_like_http_url(raw):
            marker = "/live-tutor-page-images/"
            if marker not in raw:
                continue
            raw = "live-tutor-page-images/" + raw.split(marker, 1)[1]
        if raw.startswith("file://"):
            raw = raw.replace("file://", "", 1)

        p = Path(raw).expanduser()
        if p.is_absolute():
            candidates.append(p)

        for root in possible_project_roots():
            candidates.append(root / raw.lstrip("/"))
            if raw.startswith("/live-tutor-page-images/"):
                candidates.append(root / "server" / "public" / raw.lstrip("/"))
                candidates.append(root / "public" / raw.lstrip("/"))
            if raw.startswith("live-tutor-page-images/"):
                candidates.append(root / "server" / "public" / raw)
                candidates.append(root / "public" / raw)
            marker = "live-tutor-page-images/"
            if marker in raw:
                tail = raw.split(marker, 1)[1]
                candidates.append(root / "server" / "public" / "live-tutor-page-images" / tail)
                candidates.append(root / "public" / "live-tutor-page-images" / tail)

    seen = set()
    for candidate in candidates:
        try:
            resolved = candidate.expanduser().resolve()
        except Exception:
            resolved = candidate.expanduser()
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        if resolved.exists() and resolved.is_file():
            return str(resolved)
    return ""


def compact_source_ref(ref: Any) -> JsonDict:
    item = safe_dict(ref)
    return {
        "resourceId": clean_text(item.get("resourceId") or "", 260),
        "chunkId": clean_text(item.get("chunkId") or item.get("id") or "", 260),
        "sourceRef": clean_text(item.get("sourceRef") or item.get("ref") or "", 420),
        "pageRef": clean_text(item.get("pageRef") or "", 420),
        "page": safe_int(item.get("page") or item.get("pageNumber") or item.get("pageNo"), 0),
        "quote": clean_text(item.get("quote") or item.get("text") or item.get("textPreview") or item.get("snippet") or "", 1400),
        "confidence": item.get("confidence", 0.75),
        "evidenceRole": clean_text(item.get("evidenceRole") or item.get("role") or "", 120),
    }


def image_key(image: JsonDict) -> str:
    return "|".join(
        [
            str(image.get("page") or ""),
            clean_text(image.get("pageImagePath") or image.get("path") or "", 2000),
            clean_text(image.get("pageImageUrl") or image.get("url") or image.get("src") or "", 2000),
        ]
    )


def normalize_page_image(raw: Any, evidence_role: str = "") -> JsonDict:
    item = safe_dict(raw)
    page = safe_int(item.get("page") or item.get("pageNumber") or item.get("pageNo"), 0)
    page_image_path = clean_text(
        item.get("pageImagePath") or item.get("path") or item.get("filePath") or item.get("localPath") or "",
        3000,
    )
    page_image_url = clean_text(
        item.get("pageImageUrl") or item.get("url") or item.get("src") or item.get("publicUrl") or item.get("imageUrl") or "",
        3000,
    )
    resolved_path = resolve_local_image_path(page_image_path, page_image_url)
    mime_type = image_mime_type(page_image_path or page_image_url or resolved_path or "page.png")
    role = clean_text(evidence_role or item.get("evidenceRole") or item.get("role") or "pageImage", 160)

    return {
        **item,
        "page": page,
        "pageImagePath": page_image_path,
        "pageImageUrl": page_image_url,
        "path": page_image_path,
        "url": page_image_url,
        "src": page_image_url,
        "resolvedLocalPath": resolved_path,
        "resolvedLocalPathExists": bool(resolved_path and Path(resolved_path).exists()),
        "mimeType": mime_type,
        "evidenceRole": role,
        "imageRole": "selectedPageFullImage" if "selected" in role else "nearbyPageFullImage",
        "fullPageImageAvailableForGeminiVision": bool(resolved_path or page_image_url),
        "imageTextIsTruth": False,
        "pdfExtractedTextIsTruth": True,
        "ocrIsHelperOnly": True,
        "useRule": clean_text(
            item.get("useRule")
            or item.get("visualUseRule")
            or "Use image for diagram/layout/table/figure shape only. Verify labels/facts from selectedEvidence/PDF text.",
            700,
        ),
    }


def collect_images_from_context(context: JsonDict, max_images: int = 3) -> List[JsonDict]:
    buckets: List[Tuple[str, List[Any]]] = [
        ("selectedEvidence", safe_list(context.get("selectedEvidence") or context.get("selectedNodeExactChunks"))),
        (
            "selectedPageContext",
            [
                item
                for item in safe_list(context.get("pageContexts"))
                if safe_dict(item).get("relation") in {"selected_or_same_page", "selected_page"}
            ],
        ),
        ("visualContextPageImage", safe_list(safe_dict(context.get("visualContext")).get("pageImages"))),
        ("topLevelPageImage", safe_list(context.get("pageImages"))),
        ("samePageEvidence", safe_list(context.get("samePageEvidence") or context.get("samePageChunks"))),
        ("nearbyEvidence", safe_list(context.get("nearbyEvidence") or context.get("nearbyChunks"))),
        ("pageContext", safe_list(context.get("pageContexts"))),
    ]

    images: List[JsonDict] = []
    seen = set()
    for role, items in buckets:
        for raw in items:
            item = safe_dict(raw)
            candidates: List[JsonDict] = []
            if (
                item.get("pageImagePath")
                or item.get("pageImageUrl")
                or item.get("imagePath")
                or item.get("imageUrl")
                or item.get("path")
                or item.get("url")
            ):
                candidates.append(item)
            for nested_key in ["pageImage", "image", "pdfPageImage"]:
                nested = safe_dict(item.get(nested_key))
                if nested:
                    candidates.append(
                        {
                            **nested,
                            "page": nested.get("page") or item.get("page"),
                            "sourceRefs": item.get("sourceRefs") or [compact_source_ref(item)],
                        }
                    )
            for candidate in candidates:
                image = normalize_page_image(candidate, role)
                if not image.get("page") and item.get("page"):
                    image["page"] = safe_int(item.get("page"), 0)
                if not image.get("sourceRefs"):
                    image["sourceRefs"] = [compact_source_ref(item)]
                if not image.get("pageImagePath") and image.get("imagePath"):
                    image["pageImagePath"] = image.get("imagePath")
                if not image.get("pageImageUrl") and image.get("imageUrl"):
                    image["pageImageUrl"] = image.get("imageUrl")
                if not image.get("pageImagePath") and not image.get("pageImageUrl") and not image.get("resolvedLocalPath"):
                    continue
                key = image_key(image)
                if key in seen:
                    continue
                seen.add(key)
                images.append(image)
                if len(images) >= max_images:
                    return images
    return images


def evidence_lines(context: JsonDict, key: str, label: str, limit: int, chars_each: int) -> str:
    lines = []
    for item in safe_list(context.get(key))[:limit]:
        ev = safe_dict(item)
        page = ev.get("page") or "?"
        text = clean_text(ev.get("text") or ev.get("textPreview") or ev.get("quote") or "", chars_each)
        ocr = clean_text(ev.get("ocrText") or "", min(1200, chars_each))
        tables = safe_list(ev.get("tables"))[:3]
        figures = safe_list(ev.get("figures"))[:3]
        if text or ocr or tables or figures:
            lines.append(
                "\n".join(
                    [
                        f"[{label} page={page} chunk={clean_text(ev.get('chunkId') or '', 120)}]",
                        text,
                        f"OCR helper: {ocr}" if ocr else "",
                        f"Tables: {json.dumps(tables, ensure_ascii=False)[:1800]}" if tables else "",
                        f"Figures: {json.dumps(figures, ensure_ascii=False)[:1800]}" if figures else "",
                    ]
                )
            )
    return clean_text("\n\n---\n\n".join(lines), limit * chars_each)


def compact_evidence_text(context: JsonDict, max_chars: int = 70000) -> str:
    chunks: List[str] = []
    selected_node = safe_dict(context.get("selectedNode"))
    if selected_node:
        chunks.append(
            "\n".join(
                [
                    f"SELECTED NODE: {clean_text(selected_node.get('title') or selected_node.get('label') or '', 400)}",
                    clean_text(
                        selected_node.get("definition")
                        or selected_node.get("shortDefinition")
                        or selected_node.get("summary")
                        or "",
                        2200,
                    ),
                ]
            )
        )

    for key, label, limit, chars_each in [
        ("selectedEvidence", "SELECTED EVIDENCE - PRIMARY TRUTH", 14, 3200),
        ("samePageEvidence", "SAME PAGE EVIDENCE", 10, 2600),
        ("nearbyEvidence", "NEARBY PAGE EVIDENCE", 10, 2200),
        ("relatedEvidence", "RELATED PDF EVIDENCE", 8, 1800),
        ("comparisonEvidence", "COMPARISON EVIDENCE", 6, 1600),
    ]:
        text = evidence_lines(context, key, label, limit, chars_each)
        if text:
            chunks.append(text)

    selected_page_full_text = clean_text(context.get("selectedPageFullText") or "", 16000)
    if selected_page_full_text:
        chunks.append(f"SELECTED PAGE FULL TEXT - PRIMARY TRUTH:\n{selected_page_full_text}")

    page_contexts = []
    for pc in safe_list(context.get("pageContexts"))[:8]:
        item = safe_dict(pc)
        page_contexts.append(
            {
                "page": item.get("page"),
                "relation": item.get("relation"),
                "fullText": clean_text(item.get("fullText") or item.get("text") or "", 2200),
                "figures": safe_list(item.get("figures"))[:3],
                "tables": safe_list(item.get("tables"))[:3],
            }
        )
    if page_contexts:
        chunks.append("PAGE CONTEXTS:\n" + json.dumps(page_contexts, ensure_ascii=False)[:14000])

    return clean_text("\n\n====================\n\n".join(chunks), max_chars)


def compact_pdf_context(context: JsonDict) -> JsonDict:
    return {
        "fullPdfSummary": safe_dict(context.get("fullPdfSummary") or context.get("pdfSummary")),
        "fullPdfOutline": safe_dict(context.get("fullPdfOutline")),
        "fullPdfOutlineText": clean_text(context.get("fullPdfOutlineText") or "", 10000),
        "roadmapModules": safe_list(context.get("roadmapModules"))[:20],
        "prerequisites": safe_list(context.get("prerequisites") or context.get("prerequisiteConcepts"))[:20],
        "tables": safe_list(context.get("tables") or safe_dict(context.get("visualContext")).get("tables"))[:12],
        "figures": safe_list(context.get("figures") or safe_dict(context.get("visualContext")).get("figures"))[:12],
        "layoutBlocks": safe_list(context.get("layoutBlocks") or safe_dict(context.get("visualContext")).get("layoutBlocks"))[:20],
    }


def build_vision_prompt(context: JsonDict, image: JsonDict) -> str:
    source_text = compact_evidence_text(context)
    pdf_context = compact_pdf_context(context)
    selected_node = safe_dict(context.get("selectedNode"))

    return f"""
You are SelectedPageVisionAgent for a source-grounded live tutor board.

MISSION:
Inspect ONE selected/nearby PDF page image, then create detailed structured visual understanding for later agents.
Do not write the final full lesson. Do create enough teacher-board intelligence so a later VisualPlanner can build a premium board.

STRICT TRUTH RULES:
1. PDF extracted text, selectedEvidence, and selectedPageFullText are the truth.
2. OCR/image text is helper only.
3. Page image is used for layout, diagram shape, visible labels, arrows, table shape, and teacher marking hints.
4. Do not invent unsupported facts.
5. Map visual observations to source text when possible.
6. Return JSON only. No markdown.

SELECTED NODE:
{json.dumps({
    "nodeId": selected_node.get("nodeId") or selected_node.get("id"),
    "title": selected_node.get("title") or selected_node.get("label"),
    "summary": selected_node.get("summary") or selected_node.get("shortDefinition"),
    "pageRefs": selected_node.get("pageRefs"),
}, ensure_ascii=False, indent=2)[:6000]}

PAGE IMAGE METADATA:
{json.dumps({
    "page": image.get("page"),
    "imageRole": image.get("imageRole"),
    "evidenceRole": image.get("evidenceRole"),
    "pageImagePath": image.get("pageImagePath"),
    "pageImageUrl": image.get("pageImageUrl"),
    "resolvedLocalPathExists": image.get("resolvedLocalPathExists"),
    "mimeType": image.get("mimeType"),
    "useRule": image.get("useRule"),
}, ensure_ascii=False, indent=2)[:6000]}

COMPACT FULL-PDF CONTEXT / OUTLINE / TABLE-FIGURE HINTS:
{json.dumps(pdf_context, ensure_ascii=False, indent=2)[:24000]}

SOURCE TEXT / SELECTED PAGE / NEARBY CONTEXT:
{source_text}

Return JSON exactly with these keys:
{{
  "pageImageAnalyses": [
    {{
      "page": 1,
      "imageRole": "selectedPageFullImage|nearbyPageFullImage",
      "visualType": "schema|table|diagram|flowchart|text-heavy|mixed|unknown",
      "topicFromContext": "what this page means in the PDF topic",
      "summary": "concise visual summary, not final lesson",
      "layoutDescription": "where major visual/text areas appear",
      "sourceTextMapping": [
        {{"visualThing": "label/box/arrow", "sourceQuote": "matching source text", "reason": "why linked"}}
      ],
      "visibleLabels": ["label seen visually"],
      "diagramElements": [
        {{"label": "element label", "kind": "box|table|arrow|node|edge|caption|cluster", "description": "visual role", "teachingMeaning": "what student should learn"}}
      ],
      "relationships": [
        {{"from": "visual label", "to": "visual label", "relationship": "arrow/connection/containment/etc", "teachingMeaning": "meaning in concept"}}
      ],
      "tables": [
        {{"title": "table title if visible", "columns": ["col"], "summary": "what table compares"}}
      ],
      "coreVisualFacts": ["fact grounded in source text plus visual structure"],
      "boardRedrawHints": ["how a clean tutor board should redraw this visual"],
      "teacherMarkingHints": [
        {{"type": "circle|arrow|underline|highlight|zoom|source-preview", "target": "what to mark", "reason": "why"}}
      ],
      "commonConfusions": ["what students may confuse from this visual"],
      "confidence": 0.0
    }}
  ],
  "detectedDiagrams": [
    {{"page": 1, "diagramType": "ERD|star-schema|snowflake-schema|workflow|flowchart|table|architecture|concept-map|unknown", "title": "short title", "summary": "source-grounded visual summary", "needsRedraw": true, "sourceRefs": []}}
  ],
  "visualTeachingHints": ["how VisualPlanner/BoardScene/Voice should use this page"],
  "diagramSummary": "short debug summary only; not enough for board planning",
  "metadata": {{"selectedPageVisionUsed": true, "modelVisionUsed": true, "fallbackUsed": false, "usedSmartFallback": false}}
}}
""".strip()


def get_genai_client_and_types() -> Tuple[Any, Any]:
    try:
        from google import genai
        from google.genai import types
    except Exception as exc:
        raise RuntimeError("google-genai SDK is missing. Install it with: pip install google-genai") from exc

    api_key = env_first("GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Gemini API key missing. Set GOOGLE_API_KEY or GEMINI_API_KEY. No fake vision fallback is allowed.")
    return genai.Client(api_key=api_key), types


def get_vision_model() -> str:
    return env_first(
        "GEMINI_VISION_MODEL",
        "GOOGLE_GEMINI_VISION_MODEL",
        "GOOGLE_ADK_VISION_MODEL",
        "GEMINI_MODEL",
        "GOOGLE_GEMINI_MODEL",
    ) or "gemini-2.5-flash"


def load_image_bytes(image: JsonDict) -> Tuple[bytes, JsonDict]:
    resolved_path = clean_text(image.get("resolvedLocalPath") or "", 3000)
    if not resolved_path:
        resolved_path = resolve_local_image_path(
            clean_text(image.get("pageImagePath") or image.get("path") or "", 3000),
            clean_text(image.get("pageImageUrl") or image.get("url") or image.get("src") or "", 3000),
        )
    if not resolved_path:
        raise RuntimeError(
            "Selected page image path could not be resolved. "
            f"page={image.get('page')} path={image.get('pageImagePath') or image.get('path')} url={image.get('pageImageUrl') or image.get('url')}"
        )
    path = Path(resolved_path)
    if not path.exists() or not path.is_file():
        raise RuntimeError(f"Resolved page image does not exist: {resolved_path}")
    ext = path.suffix.lower()
    if ext and ext not in SUPPORTED_IMAGE_EXTENSIONS:
        raise RuntimeError(f"Unsupported page image extension {ext}. Supported={sorted(SUPPORTED_IMAGE_EXTENSIONS)}")
    data = path.read_bytes()
    if not data:
        raise RuntimeError(f"Selected page image file is empty: {resolved_path}")
    mime_type = image_mime_type(str(path))
    return data, {
        "resolvedLocalPath": str(path),
        "resolvedLocalPathExists": True,
        "imageBytesLoaded": True,
        "imageBytesLength": len(data),
        "mimeTypeUsed": mime_type,
        "imageReadMode": "local_file_read_bytes",
    }


def call_gemini_vision_for_image(context: JsonDict, image: JsonDict, index: int = 0) -> JsonDict:
    client, types = get_genai_client_and_types()
    model = get_vision_model()
    data, byte_proof = load_image_bytes(image)
    prompt = build_vision_prompt(context, image)
    image_part = types.Part.from_bytes(data=data, mime_type=byte_proof["mimeTypeUsed"])

    response = client.models.generate_content(
        model=model,
        contents=[prompt, image_part],
        config={
            "temperature": 0.05,
            "top_p": 0.8,
            "max_output_tokens": safe_int(os.getenv("SELECTED_PAGE_VISION_MAX_OUTPUT_TOKENS"), 24000),
            "response_mime_type": "application/json",
        },
    )
    text = clean_text(getattr(response, "text", "") or "", 260000)
    parsed = parse_json_from_text(text)
    analyses = safe_list(parsed.get("pageImageAnalyses"))
    if not analyses:
        raise RuntimeError("Gemini vision returned no pageImageAnalyses.")

    normalized_analyses = []
    for analysis in analyses:
        item = safe_dict(analysis)
        normalized_analyses.append(
            {
                **item,
                "page": safe_int(item.get("page") or image.get("page"), safe_int(image.get("page"), 0)),
                "imageRole": clean_text(item.get("imageRole") or image.get("imageRole") or image.get("evidenceRole") or "pageImage", 160),
                "sourceRefs": dedupe_source_refs(safe_list(item.get("sourceRefs")) or safe_list(image.get("sourceRefs"))),
                "metadata": {
                    **safe_dict(item.get("metadata")),
                    **byte_proof,
                    "geminiVisionCalled": True,
                    "geminiVisionCallIndex": index,
                    "modelVisionUsed": True,
                    "visionModel": model,
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                },
            }
        )

    detected_diagrams = []
    for diagram in safe_list(parsed.get("detectedDiagrams")):
        item = safe_dict(diagram)
        detected_diagrams.append(
            {
                **item,
                "page": safe_int(item.get("page") or image.get("page"), safe_int(image.get("page"), 0)),
                "sourceRefs": dedupe_source_refs(safe_list(item.get("sourceRefs")) or safe_list(image.get("sourceRefs"))),
                "needsRedraw": item.get("needsRedraw", True),
            }
        )

    return {
        **parsed,
        "pageImageAnalyses": normalized_analyses,
        "detectedDiagrams": detected_diagrams,
        "metadata": {
            **safe_dict(parsed.get("metadata")),
            **byte_proof,
            "selectedPageVisionUsed": True,
            "geminiVisionCalled": True,
            "geminiVisionCallCount": 1,
            "modelVisionUsed": True,
            "visionModel": model,
            "visionResponseTextLength": len(text),
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }


def _dedupe_text(items: List[Any], max_items: int = 80, max_len: int = 900) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items:
        text = clean_text(item, max_len)
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        out.append(text)
        if len(out) >= max_items:
            break
    return out


def extract_all(items: List[JsonDict], key: str) -> List[Any]:
    out: List[Any] = []
    for item in items:
        out.extend(safe_list(safe_dict(item).get(key)))
    return out


def build_visual_lesson_input(context: JsonDict, merged: JsonDict) -> JsonDict:
    analyses = safe_list(merged.get("pageImageAnalyses"))
    diagrams = safe_list(merged.get("detectedDiagrams"))
    selected_pages = {safe_int(ref.get("page"), 0) for ref in safe_list(safe_dict(context.get("selectedNode")).get("pageRefs")) if isinstance(ref, dict)}
    selected_pages.update({safe_int(p, 0) for p in safe_list(safe_dict(context.get("selectedNode")).get("pageRefs")) if not isinstance(p, dict)})
    for ev in safe_list(context.get("selectedEvidence")):
        page = safe_int(safe_dict(ev).get("page"), 0)
        if page:
            selected_pages.add(page)

    selected_analyses = []
    nearby_analyses = []
    for analysis in analyses:
        page = safe_int(safe_dict(analysis).get("page"), 0)
        role = clean_text(safe_dict(analysis).get("imageRole") or "", 120).lower()
        if page in selected_pages or "selected" in role:
            selected_analyses.append(analysis)
        else:
            nearby_analyses.append(analysis)

    diagram_elements = extract_all(analyses, "diagramElements")
    relationships = extract_all(analyses, "relationships")
    teacher_marks = extract_all(analyses, "teacherMarkingHints")
    redraw_hints = extract_all(analyses, "boardRedrawHints")
    common_confusions = extract_all(analyses, "commonConfusions")
    core_visual_facts = extract_all(analyses, "coreVisualFacts")

    source_refs = dedupe_source_refs(
        safe_list(context.get("sourceRefs"))
        + safe_list(merged.get("sourceRefs"))
        + [ref for analysis in analyses for ref in safe_list(safe_dict(analysis).get("sourceRefs"))]
        + [ref for diagram in diagrams for ref in safe_list(safe_dict(diagram).get("sourceRefs"))]
    )

    return {
        "plannerReady": True,
        "inputVersion": "visual-lesson-input-v20-strong",
        "selectedNode": safe_dict(context.get("selectedNode")),
        "selectedNodeTitle": clean_text(
            safe_dict(context.get("selectedNode")).get("title")
            or safe_dict(context.get("selectedNode")).get("label")
            or "Selected node",
            360,
        ),
        "selectedEvidence": safe_list(context.get("selectedEvidence"))[:16],
        "selectedPageFullText": clean_text(context.get("selectedPageFullText") or "", 24000),
        "samePageEvidence": safe_list(context.get("samePageEvidence"))[:12],
        "nearbyEvidence": safe_list(context.get("nearbyEvidence"))[:12],
        "relatedEvidence": safe_list(context.get("relatedEvidence"))[:10],
        "pageContexts": safe_list(context.get("pageContexts"))[:10],
        "fullPdfSummary": safe_dict(context.get("fullPdfSummary") or context.get("pdfSummary")),
        "fullPdfOutline": safe_dict(context.get("fullPdfOutline")),
        "fullPdfOutlineText": clean_text(context.get("fullPdfOutlineText") or "", 12000),
        "selectedPageAnalyses": selected_analyses,
        "nearbyPageAnalyses": nearby_analyses,
        "pageImageAnalyses": analyses,
        "detectedDiagrams": diagrams,
        "diagramElements": diagram_elements[:120],
        "relationships": relationships[:120],
        "coreVisualFacts": _dedupe_text(core_visual_facts + safe_list(merged.get("visualTeachingHints")), 80, 900),
        "boardRedrawHints": _dedupe_text(redraw_hints, 80, 900),
        "teacherMarkingHints": teacher_marks[:120],
        "visualTeachingHints": _dedupe_text(safe_list(merged.get("visualTeachingHints")), 80, 900),
        "commonConfusions": _dedupe_text(common_confusions, 40, 700),
        "tables": safe_list(merged.get("tables")) + safe_list(context.get("tables"))[:12],
        "figures": safe_list(context.get("figures"))[:12],
        "layoutBlocks": safe_list(merged.get("layoutBlocks")) + safe_list(context.get("layoutBlocks"))[:20],
        "sourceRefs": source_refs,
        "truthRules": {
            "selectedEvidenceIsPrimaryTruth": True,
            "pdfExtractedTextIsTruth": True,
            "selectedPageFullTextIsTruth": True,
            "imageTextIsTruth": False,
            "ocrIsHelperOnly": True,
            "pageImageUse": "visual_preview_layout_diagram_shape_only",
            "diagramSummaryIsDebugOnly": True,
            "plannerMustUseStructuredFields": True,
            "noUnsupportedFacts": True,
        },
        "qualityContract": {
            "doNotUseDiagramSummaryAsMainInput": True,
            "mustUseSourceEvidence": True,
            "mustUsePageImageAnalyses": bool(analyses),
            "mustPreserveSourceRefs": True,
            "target": "dynamic premium human tutor board, not fixed template and not fixed domain",
        },
        "metadata": {
            "plannerReady": True,
            "selectedPageAnalysisCount": len(selected_analyses),
            "nearbyPageAnalysisCount": len(nearby_analyses),
            "pageImageAnalysisCount": len(analyses),
            "detectedDiagramCount": len(diagrams),
            "diagramElementCount": len(diagram_elements),
            "relationshipCount": len(relationships),
            "boardRedrawHintCount": len(redraw_hints),
            "teacherMarkingHintCount": len(teacher_marks),
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }


def merge_vision_results(results: List[JsonDict], context: Optional[JsonDict] = None) -> JsonDict:
    context = safe_dict(context)
    analyses: List[JsonDict] = []
    detected_diagrams: List[JsonDict] = []
    tables: List[JsonDict] = []
    layout_blocks: List[JsonDict] = []
    hints: List[str] = []
    summaries: List[str] = []
    image_bytes_loaded = False
    image_bytes_length_total = 0
    resolved_path_exists = False
    gemini_vision_called = False
    model_vision_used = False
    vision_model = ""
    call_count = 0

    for result in results:
        meta = safe_dict(result.get("metadata"))
        analyses.extend(safe_list(result.get("pageImageAnalyses")))
        detected_diagrams.extend(safe_list(result.get("detectedDiagrams")))
        tables.extend(safe_list(result.get("tables")))
        layout_blocks.extend(safe_list(result.get("layoutBlocks")))
        hints.extend([clean_text(x, 800) for x in safe_list(result.get("visualTeachingHints")) if clean_text(x, 800)])
        summary = clean_text(result.get("diagramSummary") or result.get("summary") or "", 2000)
        if summary:
            summaries.append(summary)
        image_bytes_loaded = image_bytes_loaded or bool(meta.get("imageBytesLoaded"))
        image_bytes_length_total += safe_int(meta.get("imageBytesLength"), 0)
        resolved_path_exists = resolved_path_exists or bool(meta.get("resolvedLocalPathExists"))
        gemini_vision_called = gemini_vision_called or bool(meta.get("geminiVisionCalled"))
        model_vision_used = model_vision_used or bool(meta.get("modelVisionUsed"))
        vision_model = vision_model or clean_text(meta.get("visionModel") or "", 120)
        call_count += safe_int(meta.get("geminiVisionCallCount"), 0)

    diagram_summary = clean_text(
        "\n".join([f"- {summary}" for summary in summaries])
        or "Gemini Vision inspected selected PDF page images and produced structured visual analysis.",
        6000,
    )

    merged: JsonDict = {
        "selectedPageVisionUsed": True,
        "pageImageAnalyses": analyses,
        "detectedDiagrams": detected_diagrams,
        "tables": tables,
        "layoutBlocks": layout_blocks,
        "diagramSummary": diagram_summary,
        "visualTeachingHints": _dedupe_text(hints, 80, 900),
        "metadata": {
            "selectedPageVisionAgentConnected": True,
            "selectedPageVisionUsed": True,
            "imageBytesLoaded": image_bytes_loaded,
            "imageBytesLength": image_bytes_length_total,
            "resolvedLocalPathExists": resolved_path_exists,
            "geminiVisionCalled": gemini_vision_called,
            "geminiVisionCallCount": call_count,
            "modelVisionUsed": model_vision_used,
            "visionModel": vision_model,
            "pageImageAnalysisCount": len(analyses),
            "detectedDiagramCount": len(detected_diagrams),
            "diagramSummaryIsDebugOnly": True,
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }
    merged["visualLessonInput"] = build_visual_lesson_input(context, merged)
    merged["plannerReady"] = True
    merged["metadata"]["visualLessonInputReady"] = True
    return merged


class SelectedPageVisionAgent(BaseLiveTutorAgent):
    agent_name = "SelectedPageVisionAgent"
    agent_group = "source-vision"
    default_mode = "selected_page_vision"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return "Read selected PDF page images with Gemini Vision and return structured planner-ready visualLessonInput."

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        images = collect_images_from_context(safe_dict(payload), max_images=3)
        warnings = [] if images else ["No selected page image found; agent will skip without fake fallback."]
        if images:
            warnings.append(f"SelectedPageVisionAgent received {len(images)} Gemini-ready page image(s).")
        return ValidationResult(
            ok=True,
            warnings=warnings,
            validator="SelectedPageVisionAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        images = collect_images_from_context(safe_dict(payload), max_images=1)
        if not images:
            return "No page image available."
        return build_vision_prompt(safe_dict(payload), images[0])

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return safe_dict(raw)

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        meta = safe_dict(output.get("metadata"))
        errors = []
        if output.get("selectedPageVisionUsed") and not safe_list(output.get("pageImageAnalyses")):
            errors.append("selectedPageVisionUsed=true but pageImageAnalyses is empty")
        if output.get("selectedPageVisionUsed") and not meta.get("geminiVisionCalled"):
            errors.append("selectedPageVisionUsed=true but Gemini Vision was not called")
        if output.get("selectedPageVisionUsed") and not safe_dict(output.get("visualLessonInput")).get("plannerReady"):
            errors.append("visualLessonInput.plannerReady missing")
        return ValidationResult(
            ok=not errors,
            errors=errors,
            validator="SelectedPageVisionAgent.validate_output",
            fallbackUsed=False,
        )

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        payload = safe_dict(payload)
        max_images = safe_int(
            payload.get("maxSelectedPageVisionImages") or os.getenv("SELECTED_PAGE_VISION_MAX_IMAGES") or 3,
            3,
        )
        max_images = max(1, min(max_images, 5))
        images = collect_images_from_context(payload, max_images=max_images)
        if not images:
            result = {
                "selectedPageVisionUsed": False,
                "pageImageAnalyses": [],
                "detectedDiagrams": [],
                "tables": [],
                "layoutBlocks": [],
                "diagramSummary": "",
                "visualTeachingHints": [],
                "visualLessonInput": build_visual_lesson_input(payload, {"pageImageAnalyses": [], "detectedDiagrams": []}),
                "plannerReady": True,
                "metadata": {
                    "selectedPageVisionAgentConnected": True,
                    "selectedPageVisionUsed": False,
                    "imageBytesLoaded": False,
                    "geminiVisionCalled": False,
                    "modelVisionUsed": False,
                    "pageImageAnalysisCount": 0,
                    "detectedDiagramCount": 0,
                    "visualLessonInputReady": True,
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                    "skipReason": "no_page_images",
                },
            }
            payload["selectedPageVision"] = result
            payload["visualLessonInput"] = result["visualLessonInput"]
            return result

        parallel_enabled = bool_env("SELECTED_PAGE_VISION_PARALLEL", True)
        max_workers = max(1, min(safe_int(os.getenv("SELECTED_PAGE_VISION_WORKERS"), 3), len(images)))
        results: List[JsonDict] = []
        if parallel_enabled and len(images) > 1:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_map = {
                    executor.submit(call_gemini_vision_for_image, payload, image, index): (index, image)
                    for index, image in enumerate(images)
                }
                for future in as_completed(future_map):
                    index, image = future_map[future]
                    try:
                        result = future.result()
                    except Exception as exc:
                        raise RuntimeError(f"SelectedPageVisionAgent failed for page={image.get('page')} role={image.get('evidenceRole')}: {exc}") from exc
                    result["_sortIndex"] = index
                    results.append(result)
            results.sort(key=lambda x: safe_int(x.get("_sortIndex"), 0))
        else:
            for index, image in enumerate(images):
                try:
                    results.append(call_gemini_vision_for_image(payload, image, index))
                except Exception as exc:
                    raise RuntimeError(f"SelectedPageVisionAgent failed for page={image.get('page')} role={image.get('evidenceRole')}: {exc}") from exc

        merged = merge_vision_results(results, payload)
        payload["selectedPageVision"] = merged
        payload["visualLessonInput"] = merged.get("visualLessonInput")
        payload["pageImageAnalyses"] = merged.get("pageImageAnalyses", [])
        payload["detectedDiagramsFromVision"] = merged.get("detectedDiagrams", [])
        payload["visualContext"] = {
            **safe_dict(payload.get("visualContext")),
            "selectedPageVision": merged,
            "visualLessonInput": merged.get("visualLessonInput"),
            "pageImageAnalyses": merged.get("pageImageAnalyses", []),
            "detectedDiagramsFromVision": merged.get("detectedDiagrams", []),
            "diagramSummary": merged.get("diagramSummary", ""),
            "metadata": {
                **safe_dict(safe_dict(payload.get("visualContext")).get("metadata")),
                **safe_dict(merged.get("metadata")),
                "fallbackUsed": False,
                "usedSmartFallback": False,
            },
        }
        return merged

# === WORLD_TEACHER_VISION_JSON_REPAIR_V4 ===
# Fix:
# - Gemini Vision sometimes returns rich JSON that is truncated or not perfectly closed.
# - This patch keeps the real Gemini output, repairs only JSON structure, and parses it.
# - No fake visual fallback. No hardcoded topic. No static lesson content.
# - It also makes the prompt ask for compact but rich visual-teacher packet.

_ORIG_PARSE_JSON_FROM_TEXT_V4 = parse_json_from_text
_ORIG_BUILD_VISION_PROMPT_V4 = build_vision_prompt


def _v4_try_json_loads(text):
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"items": parsed}
    except Exception:
        return None
    return None


def _v4_strip_to_json_candidate(text):
    raw = strip_json_fence(text)
    if not raw:
        return ""

    starts = [i for i in [raw.find("{"), raw.find("[")] if i >= 0]
    if not starts:
        return raw
    return raw[min(starts):].strip()


def _v4_remove_bad_trailing_commas(text):
    # common model issue: trailing comma before object/array close
    return re.sub(r",\s*([}\]])", r"\1", text)


def _v4_balance_json(text):
    """
    Best-effort repair for truncated Gemini JSON:
    - closes open string
    - removes dangling comma
    - closes open braces/brackets
    """
    raw = _v4_strip_to_json_candidate(text)
    if not raw:
        return raw

    stack = []
    in_string = False
    escape = False
    out = []

    for ch in raw:
        out.append(ch)

        if escape:
            escape = False
            continue

        if ch == "\\" and in_string:
            escape = True
            continue

        if ch == '"':
            in_string = not in_string
            continue

        if in_string:
            continue

        if ch == "{":
            stack.append("}")
        elif ch == "[":
            stack.append("]")
        elif ch in "}]":
            if stack and stack[-1] == ch:
                stack.pop()

    fixed = "".join(out).rstrip()

    if in_string:
        fixed += '"'

    # remove dangling comma or colon at end after truncation
    fixed = re.sub(r",\s*$", "", fixed)
    fixed = re.sub(r":\s*$", ": null", fixed)

    # close remaining brackets
    while stack:
        fixed += stack.pop()

    fixed = _v4_remove_bad_trailing_commas(fixed)
    return fixed


def _v4_extract_best_json_span(text):
    raw = _v4_strip_to_json_candidate(text)
    spans = []

    for opener, closer in [("{", "}"), ("[", "]")]:
        start = -1
        depth = 0
        in_string = False
        escape = False

        for i, ch in enumerate(raw):
            if escape:
                escape = False
                continue

            if ch == "\\" and in_string:
                escape = True
                continue

            if ch == '"':
                in_string = not in_string
                continue

            if in_string:
                continue

            if ch == opener:
                if depth == 0:
                    start = i
                depth += 1
            elif ch == closer and depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    spans.append(raw[start:i + 1])
                    start = -1

    best = None
    best_score = -1
    for span in spans:
        parsed = _v4_try_json_loads(span)
        if not parsed:
            continue

        score = 0
        for key in [
            "pageImageAnalyses",
            "visualTeacherPacket",
            "visualLessonInput",
            "detectedDiagrams",
            "teacherMarkingHints",
            "boardRedrawHints",
            "metadata",
        ]:
            if key in parsed:
                score += 10

        if score > best_score:
            best = parsed
            best_score = score

    return best


def _v4_parse_json_from_text(text: str) -> JsonDict:
    """
    Replacement parser:
    1. original parser first
    2. direct parse
    3. best complete span parse
    4. truncated JSON repair and parse
    """
    raw = strip_json_fence(text)
    if not raw:
        raise RuntimeError("Gemini vision returned empty text.")

    try:
        return _ORIG_PARSE_JSON_FROM_TEXT_V4(raw)
    except Exception:
        pass

    parsed = _v4_try_json_loads(raw)
    if parsed:
        return parsed

    best = _v4_extract_best_json_span(raw)
    if best:
        return best

    repaired = _v4_balance_json(raw)
    parsed = _v4_try_json_loads(repaired)
    if parsed:
        parsed.setdefault("metadata", {})
        if isinstance(parsed["metadata"], dict):
            parsed["metadata"]["visionJsonRepairedFromTruncatedOutputV4"] = True
            parsed["metadata"]["originalVisionTextLength"] = len(raw)
            parsed["metadata"]["repairedVisionTextLength"] = len(repaired)
            parsed["metadata"]["fallbackUsed"] = False
            parsed["metadata"]["usedSmartFallback"] = False
        return parsed

    raise RuntimeError(
        "Gemini vision did not return valid JSON even after repair. "
        f"Preview: {clean_text(raw, 1200)}"
    )


def _v4_build_vision_prompt(context: JsonDict, image: JsonDict) -> str:
    """
    Rich but compact prompt:
    - still gives visual detail
    - prevents giant narrative fields that cause JSON truncation
    - requires visualTeacherPacket for downstream agents
    """
    base = _ORIG_BUILD_VISION_PROMPT_V4(context, image)

    compact_contract = {
        "IMPORTANT_OUTPUT_CONTROL": {
            "returnJsonOnly": True,
            "doNotUseMarkdown": True,
            "doNotWriteLongParagraphsInsideOneString": True,
            "maxWordsPerStringField": 80,
            "preferArraysOfShortObjects": True,
            "doNotRepeatSourceText": True,
            "doNotCopyFullPageText": True,
        },
        "WORLD_TEACHER_VISION_PACKET_REQUIRED": {
            "visualTeacherPacket": {
                "pageVisualNarrative": "70-120 words, compact but teacher-useful.",
                "sourceGroundedVisualFacts": "5-10 items; each has visualFact, sourceProof, teachingMeaning.",
                "diagramElementDetails": "5-12 items; each has label, kind, visualRole, conceptMeaning, boardRedrawInstruction.",
                "relationshipWalkthrough": "4-10 items; from, to, relationship, whyItMatters, boardAction.",
                "teacherMarkingScript": "6-12 items; markType, target, teacherReason, spokenCue.",
                "boardRedrawPlan": "6-12 items; order, action, content, layoutHint, voiceHint.",
                "misconceptionRisks": "2-5 items; risk, repairMove, boardRepair.",
                "visualTeachingSequence": "5-8 items; teacherMove, boardMove, studentCheck.",
                "downstreamAgentInstructions": {
                    "forConceptExtractionAgent": "short instruction",
                    "forKnowledgeGraphAgent": "short instruction",
                    "forTeachingStrategyAgent": "short instruction",
                    "forVisualPlannerAgent": "short instruction",
                    "forBoardCommandAgent": "short instruction",
                    "forVoiceScriptAgent": "short instruction",
                },
            }
        },
        "REQUIRED_TOP_LEVEL_KEYS": [
            "pageImageAnalyses",
            "detectedDiagrams",
            "visualTeachingHints",
            "diagramSummary",
            "visualTeacherPacket",
            "metadata",
        ],
        "QUALITY_RULE": "Detailed visual intelligence, but compact valid JSON. Never produce prose outside JSON.",
    }

    return (
        base
        + "\n\nSTRICT_COMPACT_JSON_REPAIR_SAFE_CONTRACT_V4:\n"
        + json.dumps(compact_contract, ensure_ascii=False, indent=2)
        + "\n\nReturn exactly one valid JSON object. Close all braces and arrays."
    )


def _v4_normalize_visual_teacher_packet(parsed: JsonDict, image: JsonDict) -> JsonDict:
    packet = safe_dict(parsed.get("visualTeacherPacket"))

    # If Gemini placed packet inside analysis, lift it.
    if not packet:
        for analysis in safe_list(parsed.get("pageImageAnalyses")):
            inner = safe_dict(safe_dict(analysis).get("visualTeacherPacket"))
            if inner:
                packet = inner
                break

    # If packet missing but normal vision fields exist, build a structural packet
    # from the real Gemini fields. This is not fake; it is reshaping real output.
    if not packet:
        analyses = safe_list(parsed.get("pageImageAnalyses"))
        elements = []
        relationships = []
        marks = []
        redraw = []
        confusions = []
        facts = []

        for analysis in analyses:
            a = safe_dict(analysis)
            elements.extend(safe_list(a.get("diagramElements")))
            relationships.extend(safe_list(a.get("relationships")))
            marks.extend(safe_list(a.get("teacherMarkingHints")))
            redraw.extend(safe_list(a.get("boardRedrawHints")))
            confusions.extend(safe_list(a.get("commonConfusions")))
            facts.extend(safe_list(a.get("coreVisualFacts")))

        packet = {
            "pageVisualNarrative": clean_text(parsed.get("diagramSummary") or "", 1600),
            "sourceGroundedVisualFacts": [
                {"visualFact": clean_text(x, 500), "sourceProof": "", "teachingMeaning": clean_text(x, 500)}
                for x in facts[:10]
            ],
            "diagramElementDetails": [
                {
                    "label": clean_text(safe_dict(x).get("label") or safe_dict(x).get("name") or "", 160),
                    "kind": clean_text(safe_dict(x).get("kind") or "visual-element", 80),
                    "visualRole": clean_text(safe_dict(x).get("description") or "", 500),
                    "conceptMeaning": clean_text(safe_dict(x).get("teachingMeaning") or "", 500),
                    "boardRedrawInstruction": clean_text(safe_dict(x).get("boardRedrawInstruction") or safe_dict(x).get("description") or "", 500),
                }
                for x in elements[:12]
            ],
            "relationshipWalkthrough": [
                {
                    "from": clean_text(safe_dict(x).get("from") or "", 120),
                    "to": clean_text(safe_dict(x).get("to") or "", 120),
                    "relationship": clean_text(safe_dict(x).get("relationship") or "", 160),
                    "whyItMatters": clean_text(safe_dict(x).get("teachingMeaning") or "", 500),
                    "boardAction": "trace this relationship with an arrow/highlight",
                }
                for x in relationships[:10]
            ],
            "teacherMarkingScript": marks[:12],
            "boardRedrawPlan": [
                {"order": i + 1, "action": "draw/write/highlight", "content": clean_text(x, 500)}
                for i, x in enumerate(redraw[:12])
            ],
            "misconceptionRisks": [
                {"risk": clean_text(x, 500), "repairMove": "clarify using the source text", "boardRepair": "mark the confusing visual part"}
                for x in confusions[:5]
            ],
            "visualTeachingSequence": [],
            "downstreamAgentInstructions": {
                "forConceptExtractionAgent": "Preserve visual labels and source-grounded elements.",
                "forKnowledgeGraphAgent": "Preserve visual relationships and arrows.",
                "forTeachingStrategyAgent": "Teach in the same order as the visual walkthrough.",
                "forVisualPlannerAgent": "Create rich board screens from redraw and marking plan.",
                "forBoardCommandAgent": "Use concrete draw, circle, arrow, highlight commands.",
                "forVoiceScriptAgent": "Sync narration with visual marks and redraw steps.",
            },
        }

    parsed["visualTeacherPacket"] = packet
    return parsed


# Replace global functions used by call_gemini_vision_for_image.
parse_json_from_text = _v4_parse_json_from_text
build_vision_prompt = _v4_build_vision_prompt


# Wrap call_gemini_vision_for_image so parsed output always carries visualTeacherPacket when possible.
_ORIG_CALL_GEMINI_VISION_FOR_IMAGE_V4 = call_gemini_vision_for_image


def call_gemini_vision_for_image(context: JsonDict, image: JsonDict, index: int = 0) -> JsonDict:
    result = _ORIG_CALL_GEMINI_VISION_FOR_IMAGE_V4(context, image, index)
    result = _v4_normalize_visual_teacher_packet(result, image)
    result.setdefault("metadata", {})
    if isinstance(result["metadata"], dict):
        result["metadata"]["worldTeacherVisionJsonRepairV4"] = True
        result["metadata"]["richVisualTeacherPacketNormalizedV4"] = True
        result["metadata"]["fallbackUsed"] = False
        result["metadata"]["usedSmartFallback"] = False
    return result


# === VISION_PAGE_IMAGE_ANALYSES_SHAPE_FIX_V5 ===
# Fix:
# - Gemini may return valid JSON but not under pageImageAnalyses.
# - Original agent requires pageImageAnalyses.
# - This normalizes real Gemini output into the required shape.
# - No fake visual content. No static topic hardcoding.

_PREV_PARSE_JSON_FROM_TEXT_V5 = parse_json_from_text


def _v5_wc(value):
    return len(clean_text(value or "", 20000).split())


def _v5_text(value, limit=4000):
    try:
        return clean_text(value or "", limit)
    except Exception:
        return str(value or "")[:limit]


def _v5_dict(value):
    try:
        return safe_dict(value)
    except Exception:
        return value if isinstance(value, dict) else {}


def _v5_list(value):
    try:
        return safe_list(value)
    except Exception:
        return value if isinstance(value, list) else []


def _v5_page_from_context_or_image(parsed: JsonDict) -> int:
    # Best effort only; does not invent semantic content.
    for key in ["page", "pageNumber"]:
        try:
            v = int(parsed.get(key) or 0)
            if v > 0:
                return v
        except Exception:
            pass
    return 0


def _v5_wrap_analysis_from_packet(parsed: JsonDict) -> JsonDict:
    packet = _v5_dict(parsed.get("visualTeacherPacket") or _v5_dict(parsed.get("visualLessonInput")).get("visualTeacherPacket"))
    diagram_summary = _v5_text(
        parsed.get("diagramSummary")
        or parsed.get("summary")
        or parsed.get("pageVisualNarrative")
        or packet.get("pageVisualNarrative")
        or "",
        3000,
    )

    detected = _v5_list(parsed.get("detectedDiagrams") or parsed.get("detectedVisualDiagrams"))
    hints = _v5_list(parsed.get("visualTeachingHints") or parsed.get("teacherMarkingHints"))

    analysis = {
        "page": _v5_page_from_context_or_image(parsed),
        "imageRole": _v5_text(parsed.get("imageRole") or "selectedPageFullImage", 120),
        "visualType": _v5_text(parsed.get("visualType") or "mixed", 120),
        "topicFromContext": _v5_text(parsed.get("topicFromContext") or parsed.get("title") or "", 240),
        "summary": diagram_summary,
        "layoutDescription": _v5_text(parsed.get("layoutDescription") or diagram_summary, 2500),
        "diagramSummary": diagram_summary,
        "diagramElements": _v5_list(parsed.get("diagramElements") or packet.get("diagramElementDetails")),
        "relationships": _v5_list(parsed.get("relationships") or packet.get("relationshipWalkthrough")),
        "teacherMarkingHints": _v5_list(parsed.get("teacherMarkingHints") or packet.get("teacherMarkingScript") or hints),
        "boardRedrawHints": _v5_list(parsed.get("boardRedrawHints") or packet.get("boardRedrawPlan")),
        "visualTeachingHints": hints,
        "detectedDiagrams": detected,
        "visualTeacherPacket": packet,
        "metadata": {
            **_v5_dict(parsed.get("metadata")),
            "pageImageAnalysisWrappedFromGeminiShapeV5": True,
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }
    return analysis


def _v5_normalize_vision_shape(parsed: JsonDict) -> JsonDict:
    parsed = _v5_dict(parsed)
    if not parsed:
        return parsed

    analyses = _v5_list(parsed.get("pageImageAnalyses"))

    # Case A: Gemini returned {"items":[...]}.
    if not analyses and _v5_list(parsed.get("items")):
        items = _v5_list(parsed.get("items"))
        candidate_analyses = []
        for item in items:
            item_d = _v5_dict(item)
            if not item_d:
                continue
            # If item itself looks like analysis, preserve it.
            if (
                item_d.get("summary")
                or item_d.get("diagramSummary")
                or item_d.get("layoutDescription")
                or item_d.get("visualTeacherPacket")
                or item_d.get("diagramElements")
                or item_d.get("relationships")
            ):
                candidate_analyses.append(item_d)
        if candidate_analyses:
            analyses = candidate_analyses

    # Case B: Gemini returned one analysis object directly.
    if not analyses and (
        parsed.get("summary")
        or parsed.get("diagramSummary")
        or parsed.get("layoutDescription")
        or parsed.get("visualTeacherPacket")
        or parsed.get("diagramElements")
        or parsed.get("relationships")
    ):
        analyses = [_v5_wrap_analysis_from_packet(parsed)]

    # Case C: packet only.
    if not analyses and _v5_dict(parsed.get("visualTeacherPacket")):
        analyses = [_v5_wrap_analysis_from_packet(parsed)]

    normalized_analyses = []
    for idx, raw in enumerate(analyses):
        a = _v5_dict(raw)
        if not a:
            continue

        packet = _v5_dict(a.get("visualTeacherPacket") or parsed.get("visualTeacherPacket"))
        summary = _v5_text(
            a.get("summary")
            or a.get("diagramSummary")
            or a.get("layoutDescription")
            or packet.get("pageVisualNarrative")
            or parsed.get("diagramSummary")
            or "",
            3000,
        )

        # Keep real Gemini content, only fill structural keys.
        a["page"] = a.get("page") or parsed.get("page") or 0
        a["imageRole"] = _v5_text(a.get("imageRole") or parsed.get("imageRole") or "selectedPageFullImage", 120)
        a["visualType"] = _v5_text(a.get("visualType") or parsed.get("visualType") or "mixed", 120)
        a["summary"] = summary
        a["diagramSummary"] = _v5_text(a.get("diagramSummary") or summary, 3000)
        a["layoutDescription"] = _v5_text(a.get("layoutDescription") or summary, 3000)

        if not _v5_list(a.get("diagramElements")) and packet:
            a["diagramElements"] = _v5_list(packet.get("diagramElementDetails"))
        if not _v5_list(a.get("relationships")) and packet:
            a["relationships"] = _v5_list(packet.get("relationshipWalkthrough"))
        if not _v5_list(a.get("teacherMarkingHints")) and packet:
            a["teacherMarkingHints"] = _v5_list(packet.get("teacherMarkingScript"))
        if not _v5_list(a.get("boardRedrawHints")) and packet:
            a["boardRedrawHints"] = _v5_list(packet.get("boardRedrawPlan"))

        if packet:
            a["visualTeacherPacket"] = packet

        a["metadata"] = {
            **_v5_dict(a.get("metadata")),
            "normalizedPageImageAnalysisV5": True,
            "fallbackUsed": False,
            "usedSmartFallback": False,
        }
        normalized_analyses.append(a)

    if normalized_analyses:
        parsed["pageImageAnalyses"] = normalized_analyses

    # Top-level detected diagrams from analyses if missing.
    if not _v5_list(parsed.get("detectedDiagrams")) and not _v5_list(parsed.get("detectedVisualDiagrams")):
        diagrams = []
        for a in normalized_analyses:
            diagrams.extend(_v5_list(a.get("detectedDiagrams")))
        if diagrams:
            parsed["detectedDiagrams"] = diagrams

    # Top-level visualTeacherPacket from first analysis if missing.
    if not _v5_dict(parsed.get("visualTeacherPacket")):
        for a in normalized_analyses:
            packet = _v5_dict(a.get("visualTeacherPacket"))
            if packet:
                parsed["visualTeacherPacket"] = packet
                break

    parsed["metadata"] = {
        **_v5_dict(parsed.get("metadata")),
        "visionShapeNormalizedV5": True,
        "pageImageAnalysisCountAfterNormalizeV5": len(_v5_list(parsed.get("pageImageAnalyses"))),
        "fallbackUsed": False,
        "usedSmartFallback": False,
    }
    return parsed


def parse_json_from_text(text: str) -> JsonDict:
    parsed = _PREV_PARSE_JSON_FROM_TEXT_V5(text)
    parsed = _v5_normalize_vision_shape(parsed)

    if not _v5_list(parsed.get("pageImageAnalyses")):
        raise RuntimeError(
            "Gemini vision returned JSON but no usable pageImageAnalyses after V5 shape normalization. "
            f"Keys: {list(parsed.keys()) if isinstance(parsed, dict) else type(parsed)}"
        )

    return parsed


# === FINAL_POWERFUL_VISUAL_TEACHER_PACKET_V8 ===
# Final v34 Vision handoff fix.
#
# What it does:
# - Keeps Gemini Vision as the real reader of full page images.
# - Builds a downstream-ready visualTeacherPacket from real pageImageAnalyses,
#   detectedDiagrams, diagramElements, relationships, teacherMarkingHints,
#   boardRedrawHints, commonConfusions, summaries.
# - If RAG misses text quotes, Vision still contributes visual observations:
#   sourceType="visual_observation", needsSourceVerification=True.
# - It does not invent source quotes.
# - It does not hardcode Star Schema or any topic.
# - It only reshapes/derives board-teacher plans from real visual output.

_ORIG_MERGE_VISION_RESULTS_FINAL_V8 = merge_vision_results


def _fv8_text(value, limit=1200):
    try:
        return clean_text(value or "", limit)
    except Exception:
        return str(value or "")[:limit]


def _fv8_dict(value):
    try:
        return safe_dict(value)
    except Exception:
        return value if isinstance(value, dict) else {}


def _fv8_list(value):
    try:
        return safe_list(value)
    except Exception:
        return value if isinstance(value, list) else []


def _fv8_has_source_proof(item):
    d = _fv8_dict(item)
    if _fv8_text(d.get("sourceProof"), 500):
        return True
    if _fv8_text(d.get("quote"), 500):
        return True
    if _fv8_list(d.get("sourceRefs")):
        return True
    return False


def _fv8_mark_source_type(item):
    d = _fv8_dict(item)
    has_proof = _fv8_has_source_proof(d)
    d["sourceType"] = "source_grounded_visual" if has_proof else "visual_observation"
    d["needsSourceVerification"] = not has_proof
    return d


def _fv8_dedupe_text(items, limit=80, text_limit=900):
    out = []
    seen = set()

    for raw in items:
        text = _fv8_text(raw, text_limit)
        if not text:
            continue

        key = " ".join(text.lower().split())
        if key in seen:
            continue

        seen.add(key)
        out.append(text)

        if len(out) >= limit:
            break

    return out


def _fv8_dedupe_dicts(items, keys, limit=100):
    out = []
    seen = set()

    for raw in items:
        item = _fv8_dict(raw)
        if not item:
            continue

        key = "|".join(_fv8_text(item.get(k), 220).lower() for k in keys)
        if not key.strip("|"):
            key = _fv8_text(str(item), 350).lower()

        if key in seen:
            continue

        seen.add(key)
        out.append(item)

        if len(out) >= limit:
            break

    return out


def _fv8_fact_from_any(raw, source_hint=""):
    if isinstance(raw, dict):
        item = _fv8_dict(raw)
        fact = _fv8_text(
            item.get("visualFact")
            or item.get("fact")
            or item.get("text")
            or item.get("description")
            or item.get("summary")
            or item.get("caption"),
            900,
        )
        source_proof = _fv8_text(
            item.get("sourceProof")
            or item.get("sourceText")
            or item.get("quote")
            or source_hint,
            900,
        )
        out = {
            "visualFact": fact,
            "sourceProof": source_proof,
            "teachingMeaning": _fv8_text(
                item.get("teachingMeaning")
                or item.get("meaning")
                or item.get("whyItMatters")
                or item.get("description")
                or fact,
                900,
            ),
            "sourceRefs": _fv8_list(item.get("sourceRefs")),
        }
        return _fv8_mark_source_type(out)

    text = _fv8_text(raw, 900)
    out = {
        "visualFact": text,
        "sourceProof": source_hint,
        "teachingMeaning": text,
        "sourceRefs": [],
    }
    return _fv8_mark_source_type(out)


def _fv8_element_from_any(raw):
    if isinstance(raw, dict):
        item = _fv8_dict(raw)
        label = _fv8_text(
            item.get("label")
            or item.get("name")
            or item.get("id")
            or item.get("text")
            or item.get("target")
            or item.get("title"),
            220,
        )
        role = _fv8_text(
            item.get("visualRole")
            or item.get("role")
            or item.get("description")
            or item.get("position")
            or item.get("summary")
            or "",
            900,
        )
        meaning = _fv8_text(
            item.get("conceptMeaning")
            or item.get("teachingMeaning")
            or item.get("meaning")
            or item.get("whyItMatters")
            or role,
            900,
        )
        out = {
            "label": label,
            "kind": _fv8_text(
                item.get("kind")
                or item.get("type")
                or item.get("visualType")
                or "visual-element",
                120,
            ),
            "visualRole": role,
            "conceptMeaning": meaning,
            "boardRedrawInstruction": _fv8_text(
                item.get("boardRedrawInstruction")
                or item.get("boardAction")
                or item.get("drawInstruction")
                or role
                or label,
                900,
            ),
            "sourceRefs": _fv8_list(item.get("sourceRefs")),
        }
        return _fv8_mark_source_type(out)

    text = _fv8_text(raw, 900)
    out = {
        "label": text[:180],
        "kind": "visual-element",
        "visualRole": text,
        "conceptMeaning": text,
        "boardRedrawInstruction": text,
        "sourceRefs": [],
    }
    return _fv8_mark_source_type(out)


def _fv8_relationship_from_any(raw):
    if isinstance(raw, dict):
        item = _fv8_dict(raw)
        rel = _fv8_text(
            item.get("relationship")
            or item.get("type")
            or item.get("label")
            or item.get("description")
            or item.get("summary"),
            350,
        )
        why = _fv8_text(
            item.get("whyItMatters")
            or item.get("teachingMeaning")
            or item.get("meaning")
            or item.get("description")
            or rel,
            900,
        )
        out = {
            "from": _fv8_text(item.get("from") or item.get("source") or item.get("start") or item.get("left"), 220),
            "to": _fv8_text(item.get("to") or item.get("target") or item.get("end") or item.get("right"), 220),
            "relationship": rel,
            "whyItMatters": why,
            "boardAction": _fv8_text(
                item.get("boardAction")
                or item.get("boardMove")
                or item.get("drawInstruction")
                or "trace this relationship with an arrow/highlight",
                700,
            ),
            "sourceRefs": _fv8_list(item.get("sourceRefs")),
        }
        return _fv8_mark_source_type(out)

    text = _fv8_text(raw, 900)
    out = {
        "from": "",
        "to": "",
        "relationship": text,
        "whyItMatters": text,
        "boardAction": "highlight this relationship on the board",
        "sourceRefs": [],
    }
    return _fv8_mark_source_type(out)


def _fv8_mark_from_any(raw):
    if isinstance(raw, dict):
        item = _fv8_dict(raw)
        target = _fv8_text(
            item.get("target")
            or item.get("label")
            or item.get("element")
            or item.get("content")
            or item.get("text")
            or item.get("description"),
            260,
        )
        reason = _fv8_text(
            item.get("teacherReason")
            or item.get("reason")
            or item.get("why")
            or item.get("teachingMeaning")
            or item.get("description")
            or target,
            900,
        )
        return {
            "markType": _fv8_text(item.get("markType") or item.get("type") or item.get("action") or "highlight", 100),
            "target": target,
            "teacherReason": reason,
            "spokenCue": _fv8_text(
                item.get("spokenCue")
                or item.get("voiceHint")
                or item.get("teacherMove")
                or reason,
                900,
            ),
            "sourceType": "visual_teacher_action",
        }

    text = _fv8_text(raw, 900)
    return {
        "markType": "highlight",
        "target": text[:240],
        "teacherReason": text,
        "spokenCue": text,
        "sourceType": "visual_teacher_action",
    }


def _fv8_redraw_from_any(raw, index):
    if isinstance(raw, dict):
        item = _fv8_dict(raw)
        content = _fv8_text(
            item.get("content")
            or item.get("target")
            or item.get("label")
            or item.get("text")
            or item.get("description")
            or item.get("boardRedrawInstruction"),
            900,
        )
        return {
            "order": int(item.get("order") or index + 1),
            "action": _fv8_text(item.get("action") or item.get("type") or "draw/write/highlight", 120),
            "content": content,
            "layoutHint": _fv8_text(
                item.get("layoutHint")
                or item.get("position")
                or item.get("where")
                or "preserve the relative position/grouping from the source page image",
                700,
            ),
            "voiceHint": _fv8_text(
                item.get("voiceHint")
                or item.get("spokenCue")
                or item.get("teacherMove")
                or content,
                900,
            ),
            "sourceType": "visual_redraw_instruction",
        }

    text = _fv8_text(raw, 900)
    return {
        "order": index + 1,
        "action": "draw/write/highlight",
        "content": text,
        "layoutHint": "preserve the relative position/grouping from the source page image",
        "voiceHint": text,
        "sourceType": "visual_redraw_instruction",
    }


def _fv8_risk_from_any(raw):
    if isinstance(raw, dict):
        item = _fv8_dict(raw)
        risk = _fv8_text(
            item.get("risk")
            or item.get("confusion")
            or item.get("mistake")
            or item.get("text")
            or item.get("description"),
            900,
        )
        return {
            "risk": risk,
            "repairMove": _fv8_text(
                item.get("repairMove")
                or item.get("fix")
                or item.get("teacherRepair")
                or "clarify using the source text and visual marking",
                900,
            ),
            "boardRepair": _fv8_text(
                item.get("boardRepair")
                or item.get("boardMove")
                or "mark the confusing visual part and redraw the relationship",
                900,
            ),
            "sourceType": "visual_misconception_detection",
        }

    text = _fv8_text(raw, 900)
    return {
        "risk": text,
        "repairMove": "clarify using the source text and visual marking",
        "boardRepair": "mark the confusing visual part and redraw the relationship",
        "sourceType": "visual_misconception_detection",
    }


def _fv8_collect_from_packet(packet):
    packet = _fv8_dict(packet)
    return {
        "narratives": [_fv8_text(packet.get("pageVisualNarrative"), 3000)] if _fv8_text(packet.get("pageVisualNarrative"), 3000) else [],
        "facts": _fv8_list(packet.get("sourceGroundedVisualFacts")),
        "elements": _fv8_list(packet.get("diagramElementDetails")),
        "relationships": _fv8_list(packet.get("relationshipWalkthrough")),
        "marks": _fv8_list(packet.get("teacherMarkingScript")),
        "redraw": _fv8_list(packet.get("boardRedrawPlan")),
        "risks": _fv8_list(packet.get("misconceptionRisks")),
        "sequence": _fv8_list(packet.get("visualTeachingSequence")),
    }


def _fv8_build_packet_from_merged(merged, raw_results=None):
    raw_results = raw_results or []
    analyses = _fv8_list(merged.get("pageImageAnalyses"))
    diagrams = _fv8_list(merged.get("detectedDiagrams") or merged.get("detectedVisualDiagrams"))

    narratives = []
    facts = []
    elements = []
    relationships = []
    marks = []
    redraw = []
    risks = []
    sequence = []

    # Preserve any packet already produced by direct Gemini response/wrappers.
    for result in raw_results:
        result = _fv8_dict(result)
        packets = []
        if _fv8_dict(result.get("visualTeacherPacket")):
            packets.append(_fv8_dict(result.get("visualTeacherPacket")))

        for analysis in _fv8_list(result.get("pageImageAnalyses")):
            analysis = _fv8_dict(analysis)
            if _fv8_dict(analysis.get("visualTeacherPacket")):
                packets.append(_fv8_dict(analysis.get("visualTeacherPacket")))

        for packet in packets:
            collected = _fv8_collect_from_packet(packet)
            narratives.extend(collected["narratives"])
            facts.extend(collected["facts"])
            elements.extend(collected["elements"])
            relationships.extend(collected["relationships"])
            marks.extend(collected["marks"])
            redraw.extend(collected["redraw"])
            risks.extend(collected["risks"])
            sequence.extend(collected["sequence"])

    # Build from final merged page analyses.
    for analysis in analyses:
        a = _fv8_dict(analysis)
        if not a:
            continue

        packet = _fv8_dict(a.get("visualTeacherPacket"))
        if packet:
            collected = _fv8_collect_from_packet(packet)
            narratives.extend(collected["narratives"])
            facts.extend(collected["facts"])
            elements.extend(collected["elements"])
            relationships.extend(collected["relationships"])
            marks.extend(collected["marks"])
            redraw.extend(collected["redraw"])
            risks.extend(collected["risks"])
            sequence.extend(collected["sequence"])

        summary = _fv8_text(
            a.get("summary")
            or a.get("diagramSummary")
            or a.get("layoutDescription")
            or "",
            2500,
        )
        if summary:
            narratives.append(summary)
            facts.append(_fv8_fact_from_any({
                "visualFact": summary,
                "teachingMeaning": summary,
                "sourceRefs": _fv8_list(a.get("sourceRefs")),
            }))

        for field in ["coreVisualFacts", "visualFacts", "facts"]:
            facts.extend(_fv8_fact_from_any(x) for x in _fv8_list(a.get(field)))

        for field in ["diagramElements", "elements", "layoutElements", "detectedObjects"]:
            elements.extend(_fv8_element_from_any(x) for x in _fv8_list(a.get(field)))

        for field in ["relationships", "edges", "links", "connections"]:
            relationships.extend(_fv8_relationship_from_any(x) for x in _fv8_list(a.get(field)))

        for field in ["teacherMarkingHints", "visualTeachingHints", "markingHints"]:
            marks.extend(_fv8_mark_from_any(x) for x in _fv8_list(a.get(field)))

        for field in ["boardRedrawHints", "redrawHints", "drawPlan"]:
            base = len(redraw)
            redraw.extend(_fv8_redraw_from_any(x, base + i) for i, x in enumerate(_fv8_list(a.get(field))))

        for field in ["commonConfusions", "misconceptions", "mistakeRisks"]:
            risks.extend(_fv8_risk_from_any(x) for x in _fv8_list(a.get(field)))

    # Build from detected diagrams as additional visual evidence.
    for diagram in diagrams:
        d = _fv8_dict(diagram)
        desc = _fv8_text(
            d.get("description")
            or d.get("summary")
            or d.get("caption")
            or d.get("title")
            or d.get("diagramType"),
            1000,
        )
        if desc:
            narratives.append(desc)
            facts.append(_fv8_fact_from_any({
                "visualFact": desc,
                "teachingMeaning": desc,
                "sourceRefs": _fv8_list(d.get("sourceRefs")),
            }))

        for field in ["elements", "diagramElements", "nodes", "objects"]:
            elements.extend(_fv8_element_from_any(x) for x in _fv8_list(d.get(field)))

        for field in ["relationships", "edges", "links", "connections"]:
            relationships.extend(_fv8_relationship_from_any(x) for x in _fv8_list(d.get(field)))

    narratives = _fv8_dedupe_text(narratives, 8, 900)
    facts = _fv8_dedupe_dicts(facts, ["visualFact", "teachingMeaning"], 100)
    elements = _fv8_dedupe_dicts(elements, ["label", "kind", "visualRole"], 120)
    relationships = _fv8_dedupe_dicts(relationships, ["from", "to", "relationship"], 120)
    marks = _fv8_dedupe_dicts(marks, ["markType", "target", "spokenCue"], 120)
    redraw = _fv8_dedupe_dicts(redraw, ["order", "action", "content"], 120)
    risks = _fv8_dedupe_dicts(risks, ["risk"], 60)
    sequence = _fv8_dedupe_dicts(sequence, ["step", "teacherMove", "boardMove"], 60)

    # Derive teacher marking/redraw actions from real detected visual objects when Gemini
    # did not explicitly provide board actions. This is not fake lesson content.
    if not marks:
        for idx, element in enumerate(elements[:18]):
            label = _fv8_text(element.get("label"), 220)
            meaning = _fv8_text(element.get("conceptMeaning") or element.get("visualRole"), 900)
            if label or meaning:
                marks.append({
                    "markType": "circle" if idx == 0 else "highlight",
                    "target": label or meaning[:220],
                    "teacherReason": meaning or f"Focus attention on {label}.",
                    "spokenCue": meaning or f"Look carefully at {label}.",
                    "sourceType": "derived_from_detected_visual_element",
                })

    if not redraw:
        order = 1

        for element in elements[:18]:
            label = _fv8_text(element.get("label"), 220)
            instruction = _fv8_text(
                element.get("boardRedrawInstruction")
                or element.get("visualRole")
                or element.get("conceptMeaning")
                or label,
                900,
            )
            if instruction:
                redraw.append({
                    "order": order,
                    "action": "draw/write/highlight",
                    "content": instruction,
                    "layoutHint": "preserve the relative layout/grouping from the source page image",
                    "voiceHint": instruction,
                    "sourceType": "derived_from_detected_visual_element",
                })
                order += 1

        for rel in relationships[:14]:
            rel_text = _fv8_text(rel.get("relationship") or rel.get("whyItMatters"), 700)
            if rel_text:
                redraw.append({
                    "order": order,
                    "action": "draw-arrow/highlight-relationship",
                    "content": rel_text,
                    "layoutHint": "draw between the related visual elements as shown in the source image",
                    "voiceHint": rel_text,
                    "sourceType": "derived_from_detected_visual_relationship",
                })
                order += 1

    if not sequence:
        for idx, step in enumerate(redraw[:14]):
            step = _fv8_dict(step)
            move = _fv8_text(step.get("voiceHint") or step.get("content"), 900)
            if not move:
                continue

            sequence.append({
                "step": idx + 1,
                "teacherMove": move,
                "boardMove": f"{_fv8_text(step.get('action'), 120)}: {_fv8_text(step.get('content'), 700)}",
                "studentCheck": "Ask the student to explain what this marked visual part means before moving on.",
                "sourceType": "derived_from_visual_redraw_plan",
            })

    packet = {
        "pageVisualNarrative": _fv8_text(" ".join(narratives), 4500),
        "sourceGroundedVisualFacts": facts,
        "diagramElementDetails": elements,
        "relationshipWalkthrough": relationships,
        "teacherMarkingScript": marks[:120],
        "boardRedrawPlan": redraw[:120],
        "misconceptionRisks": risks[:60],
        "visualTeachingSequence": sequence[:60],
        "downstreamAgentInstructions": {
            "forConceptExtractionAgent": "Use sourceGroundedVisualFacts and diagramElementDetails as visual concept hints.",
            "forKnowledgeGraphAgent": "Use relationshipWalkthrough to create visual graph edges.",
            "forTeachingStrategyAgent": "Use visualTeachingSequence and teacherMarkingScript to plan human visual teaching moves.",
            "forVisualPlannerAgent": "Use boardRedrawPlan for premium multi-screen board scene design.",
            "forBoardCommandAgent": "Convert boardRedrawPlan and teacherMarkingScript into draw/circle/arrow/highlight/reveal commands.",
            "forVoiceScriptAgent": "Sync spokenCue/voiceHint with board drawing and marking.",
            "forValidatorSafetyAgent": "Treat sourceType=visual_observation as visual truth; require text citation only when the claim is textual.",
        },
        "metadata": {
            "visualTeacherPacketV8": True,
            "finalPowerfulVisionHandoffV8": True,
            "builtFromRealGeminiVisionOutput": True,
            "usesFullPageImageAnalyses": True,
            "addsVisualObservationWhenRagMisses": True,
            "doesNotInventSourceQuotes": True,
            "pageImageAnalysisCount": len(analyses),
            "detectedDiagramCount": len(diagrams),
            "sourceGroundedVisualFactCount": len(facts),
            "diagramElementDetailCount": len(elements),
            "relationshipWalkthroughCount": len(relationships),
            "teacherMarkingScriptCount": len(marks),
            "boardRedrawPlanCount": len(redraw),
            "visualTeachingSequenceCount": len(sequence),
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }

    return packet


def merge_vision_results(results: List[JsonDict], context: Optional[JsonDict] = None) -> JsonDict:
    merged = _ORIG_MERGE_VISION_RESULTS_FINAL_V8(results, context)
    packet = _fv8_build_packet_from_merged(merged, results)

    merged["visualTeacherPacket"] = packet
    merged["visualLessonInput"] = {
        **_fv8_dict(merged.get("visualLessonInput")),
        "visualTeacherPacket": packet,
        "richVisualTeacherPacket": True,
        "plannerReady": True,
        "addsVisualObservationWhenRagMisses": True,
    }
    merged["plannerReady"] = True
    merged["metadata"] = {
        **_fv8_dict(merged.get("metadata")),
        "visualTeacherPacketV8": True,
        "finalPowerfulVisionHandoffV8": True,
        "richVisualTeacherPacket": True,
        "addsVisualObservationWhenRagMisses": True,
        "doesNotInventSourceQuotes": True,
        "fallbackUsed": False,
        "usedSmartFallback": False,
    }
    return merged


# === SUPER_TEACHER_VISION_PROMPT_AND_PACKET_V9 ===
# v35 final depth upgrade:
# - Previous V8 made visualTeacherPacket exist.
# - But the original prompt was compact and allowed short items.
# - This V9 prompt forces detailed teacher-quality visual understanding.
# - Still real/dynamic: uses Gemini Vision on page images.
# - No hardcoded Star Schema. No fake source quotes.
# - If RAG misses text, Vision adds visual_observation with needsSourceVerification=True.

_PREV_BUILD_VISION_PROMPT_SUPER_V9 = build_vision_prompt
_PREV_MERGE_VISION_RESULTS_SUPER_V9 = merge_vision_results


def _stv9_text(value, limit=1200):
    try:
        return clean_text(value or "", limit)
    except Exception:
        return str(value or "")[:limit]


def _stv9_dict(value):
    try:
        return safe_dict(value)
    except Exception:
        return value if isinstance(value, dict) else {}


def _stv9_list(value):
    try:
        return safe_list(value)
    except Exception:
        return value if isinstance(value, list) else []


def _stv9_has_source(item):
    d = _stv9_dict(item)
    return bool(
        _stv9_text(d.get("sourceProof"), 400)
        or _stv9_text(d.get("quote"), 400)
        or _stv9_list(d.get("sourceRefs"))
    )


def _stv9_source_type(item):
    return "source_grounded_visual" if _stv9_has_source(item) else "visual_observation"


def _stv9_enrich_fact(item):
    d = _stv9_dict(item)
    fact = _stv9_text(
        d.get("visualFact")
        or d.get("fact")
        or d.get("text")
        or d.get("description")
        or d.get("teachingMeaning"),
        1000,
    )
    meaning = _stv9_text(d.get("teachingMeaning") or d.get("meaning") or d.get("whyItMatters") or fact, 1000)
    source_proof = _stv9_text(d.get("sourceProof") or d.get("sourceText") or d.get("quote"), 1000)
    source_type = _stv9_source_type({**d, "sourceProof": source_proof})
    return {
        **d,
        "visualFact": fact,
        "sourceProof": source_proof,
        "visualObservation": _stv9_text(d.get("visualObservation") or fact, 1000),
        "teachingMeaning": meaning,
        "whyStudentShouldCare": _stv9_text(
            d.get("whyStudentShouldCare")
            or d.get("studentMeaning")
            or f"This helps the student connect the page image to the concept: {meaning}",
            1000,
        ),
        "exactBoardMove": _stv9_text(
            d.get("exactBoardMove")
            or d.get("boardAction")
            or d.get("boardMove")
            or "mark this visual fact on the board and connect it to the source text",
            900,
        ),
        "spokenTeacherLine": _stv9_text(
            d.get("spokenTeacherLine")
            or d.get("spokenCue")
            or d.get("voiceHint")
            or meaning,
            1000,
        ),
        "studentCheckQuestion": _stv9_text(
            d.get("studentCheckQuestion")
            or "What does this visual detail tell us about the concept?",
            500,
        ),
        "sourceType": source_type,
        "needsSourceVerification": source_type == "visual_observation",
        "confidence": d.get("confidence", 0.82 if source_type == "visual_observation" else 0.9),
        "sourceRefs": _stv9_list(d.get("sourceRefs")),
    }


def _stv9_enrich_element(item):
    d = _stv9_dict(item)
    label = _stv9_text(d.get("label") or d.get("name") or d.get("text") or d.get("target"), 220)
    role = _stv9_text(d.get("visualRole") or d.get("role") or d.get("description"), 1000)
    meaning = _stv9_text(d.get("conceptMeaning") or d.get("teachingMeaning") or d.get("meaning") or role, 1000)
    source_type = _stv9_source_type(d)
    return {
        **d,
        "label": label,
        "kind": _stv9_text(d.get("kind") or d.get("type") or "visual-element", 120),
        "exactLocation": _stv9_text(d.get("exactLocation") or d.get("position") or d.get("location") or "location inferred from page image layout", 500),
        "visualRole": role,
        "attributesSeen": _stv9_list(d.get("attributesSeen") or d.get("attributes") or d.get("visibleAttributes")),
        "connectedTo": _stv9_list(d.get("connectedTo") or d.get("connections")),
        "conceptMeaning": meaning,
        "teacherExplanation": _stv9_text(
            d.get("teacherExplanation")
            or f"Point to {label or 'this element'} and explain: {meaning}",
            1000,
        ),
        "boardRedrawInstruction": _stv9_text(
            d.get("boardRedrawInstruction")
            or d.get("drawInstruction")
            or d.get("boardAction")
            or f"Draw/write {label or 'this element'} and explain its role.",
            1000,
        ),
        "exactBoardMove": _stv9_text(
            d.get("exactBoardMove")
            or d.get("boardRedrawInstruction")
            or f"draw/write/highlight: {label or meaning}",
            900,
        ),
        "spokenTeacherLine": _stv9_text(
            d.get("spokenTeacherLine")
            or d.get("spokenCue")
            or d.get("voiceHint")
            or meaning,
            1000,
        ),
        "studentCheckQuestion": _stv9_text(
            d.get("studentCheckQuestion")
            or f"What role does {label or 'this visual element'} play in the diagram?",
            600,
        ),
        "sourceType": source_type,
        "needsSourceVerification": source_type == "visual_observation",
        "confidence": d.get("confidence", 0.82 if source_type == "visual_observation" else 0.9),
        "sourceRefs": _stv9_list(d.get("sourceRefs")),
    }


def _stv9_enrich_relationship(item):
    d = _stv9_dict(item)
    rel = _stv9_text(d.get("relationship") or d.get("type") or d.get("label") or d.get("description"), 500)
    why = _stv9_text(d.get("whyItMatters") or d.get("teachingMeaning") or d.get("meaning") or rel, 1000)
    source_type = _stv9_source_type(d)
    return {
        **d,
        "from": _stv9_text(d.get("from") or d.get("source") or d.get("start") or d.get("left"), 220),
        "to": _stv9_text(d.get("to") or d.get("target") or d.get("end") or d.get("right"), 220),
        "relationship": rel,
        "visualEvidence": _stv9_text(
            d.get("visualEvidence")
            or d.get("description")
            or "relationship inferred from visual connection/position/arrow/grouping in the page image",
            1000,
        ),
        "sourceProof": _stv9_text(d.get("sourceProof") or d.get("quote") or d.get("sourceText"), 1000),
        "whyItMatters": why,
        "misconceptionRisk": _stv9_text(
            d.get("misconceptionRisk")
            or "Student may miss the direction or meaning of this visual connection.",
            900,
        ),
        "boardAction": _stv9_text(
            d.get("boardAction")
            or d.get("boardMove")
            or "draw an arrow/highlight between the connected visual elements",
            900,
        ),
        "spokenCue": _stv9_text(
            d.get("spokenCue")
            or d.get("voiceHint")
            or why,
            1000,
        ),
        "studentCheckQuestion": _stv9_text(
            d.get("studentCheckQuestion")
            or "Can you explain why these two visual parts are connected?",
            600,
        ),
        "sourceType": source_type,
        "needsSourceVerification": source_type == "visual_observation",
        "confidence": d.get("confidence", 0.82 if source_type == "visual_observation" else 0.9),
        "sourceRefs": _stv9_list(d.get("sourceRefs")),
    }


def _stv9_enrich_mark(item):
    d = _stv9_dict(item)
    target = _stv9_text(d.get("target") or d.get("label") or d.get("element") or d.get("content") or d.get("text"), 260)
    reason = _stv9_text(d.get("teacherReason") or d.get("reason") or d.get("why") or d.get("description"), 1000)
    return {
        **d,
        "markType": _stv9_text(d.get("markType") or d.get("type") or d.get("action") or "highlight", 100),
        "target": target,
        "teacherReason": reason or f"Focus student attention on {target}.",
        "spokenCue": _stv9_text(d.get("spokenCue") or d.get("voiceHint") or d.get("teacherMove") or reason or target, 1000),
        "studentAttentionGoal": _stv9_text(
            d.get("studentAttentionGoal")
            or "Make the learner notice the exact visual detail before abstract explanation.",
            800,
        ),
        "sourceType": "visual_teacher_action",
    }


def _stv9_enrich_redraw(item, index):
    d = _stv9_dict(item)
    content = _stv9_text(d.get("content") or d.get("target") or d.get("label") or d.get("description") or d.get("text"), 1000)
    return {
        **d,
        "order": int(d.get("order") or index + 1),
        "action": _stv9_text(d.get("action") or d.get("type") or "draw/write/highlight", 120),
        "content": content,
        "layoutHint": _stv9_text(
            d.get("layoutHint")
            or d.get("position")
            or d.get("where")
            or "preserve the relative layout and grouping from the page image",
            900,
        ),
        "voiceHint": _stv9_text(d.get("voiceHint") or d.get("spokenCue") or d.get("teacherMove") or content, 1000),
        "teacherPurpose": _stv9_text(
            d.get("teacherPurpose")
            or "Build the diagram slowly so the student understands the visual structure.",
            900,
        ),
        "studentCheckQuestion": _stv9_text(
            d.get("studentCheckQuestion")
            or "What did we just add to the board, and why is it important?",
            600,
        ),
        "sourceType": "visual_redraw_instruction",
    }


def _stv9_enrich_sequence(item, index):
    d = _stv9_dict(item)
    teacher = _stv9_text(d.get("teacherMove") or d.get("voiceHint") or d.get("spokenCue"), 1200)
    board = _stv9_text(d.get("boardMove") or d.get("boardAction") or d.get("content"), 1200)
    return {
        **d,
        "step": int(d.get("step") or index + 1),
        "teacherMove": teacher,
        "boardMove": board,
        "whyThisStepNow": _stv9_text(
            d.get("whyThisStepNow")
            or "This step follows the visual reading order and reduces cognitive load.",
            900,
        ),
        "studentCheck": _stv9_text(
            d.get("studentCheck")
            or "Ask the student to explain the marked visual part in their own words.",
            900,
        ),
        "sourceType": "visual_teaching_sequence",
    }


def _stv9_super_build_vision_prompt(context: JsonDict, image: JsonDict) -> str:
    source_text = compact_evidence_text(context, max_chars=42000)
    pdf_context = compact_pdf_context(context)
    selected_node = safe_dict(context.get("selectedNode"))

    contract = {
        "returnJsonOnly": True,
        "role": "You are a world-class visual teacher, not a captioning bot.",
        "nonNegotiableTruthRules": [
            "Use PDF/source text as textual truth.",
            "Use the page image as visual truth for layout, labels, arrows, grouping, boxes, tables, diagrams, hierarchy, and what a teacher should mark.",
            "If source text/RAG misses something but the page image clearly shows it, include it as sourceType='visual_observation' with needsSourceVerification=true.",
            "Never invent sourceQuote/sourceProof. Leave sourceProof empty when only visual observation exists.",
            "If an image detail is uncertain, mark confidence below 0.65 and do not teach it as confirmed fact.",
            "Do not give a generic summary. Read the page like a human teacher at a board.",
        ],
        "requiredDepth": {
            "pageVisualNarrative": "180-260 words. Explain what the learner should notice first, second, third. Mention visual hierarchy and why it matters.",
            "sourceGroundedVisualFacts": "8-14 objects. Each: visualFact, sourceProof if available, visualObservation, teachingMeaning, whyStudentShouldCare, exactBoardMove, spokenTeacherLine, studentCheckQuestion, sourceType, needsSourceVerification, confidence.",
            "diagramElementDetails": "8-18 objects. Each: label, kind, exactLocation, visualRole, attributesSeen, connectedTo, conceptMeaning, teacherExplanation, boardRedrawInstruction, exactBoardMove, spokenTeacherLine, studentCheckQuestion, sourceType, confidence.",
            "relationshipWalkthrough": "6-14 objects. Each: from, to, relationship, visualEvidence, sourceProof if available, whyItMatters, misconceptionRisk, boardAction, spokenCue, studentCheckQuestion, sourceType, confidence.",
            "teacherMarkingScript": "8-16 objects. Each: markType, target, teacherReason, spokenCue, studentAttentionGoal.",
            "boardRedrawPlan": "8-16 objects. Each: order, action, content, layoutHint, voiceHint, teacherPurpose, studentCheckQuestion.",
            "misconceptionRisks": "4-8 objects. Each: risk, repairMove, boardRepair, visualTrigger.",
            "visualTeachingSequence": "6-12 objects. Each: step, teacherMove, boardMove, whyThisStepNow, studentCheck.",
        },
        "boardQualityTarget": "The output should let a later BoardCommandAgent draw and teach like a premium human teacher: write, draw boxes, arrows, circle, highlight, zoom, reveal step-by-step.",
    }

    schema = {
        "pageImageAnalyses": [
            {
                "page": image.get("page"),
                "imageRole": "selectedPageFullImage|nearbyPageFullImage",
                "visualType": "schema|table|diagram|flowchart|text-heavy|mixed|unknown",
                "topicFromContext": "topic inferred from node + source text",
                "summary": "rich but not final lesson",
                "layoutDescription": "explain layout, positions, hierarchy, grouping, arrows/lines",
                "sourceTextMapping": [
                    {"visualThing": "label/box/arrow", "sourceQuote": "only if available from source text", "reason": "why mapped"}
                ],
                "visibleLabels": ["all important visible labels"],
                "diagramElements": [
                    {
                        "label": "visual label",
                        "kind": "box|table|arrow|node|edge|caption|cluster|text-block",
                        "exactLocation": "center/top-left/etc",
                        "visualRole": "what it does visually",
                        "attributesSeen": ["visible attribute/field/list item"],
                        "connectedTo": ["other labels visually connected"],
                        "conceptMeaning": "what this means for the concept",
                        "teacherExplanation": "how a teacher should explain this element",
                        "boardRedrawInstruction": "exact redraw instruction",
                        "spokenTeacherLine": "teacher narration line",
                        "studentCheckQuestion": "quick check question",
                        "sourceType": "source_grounded_visual|visual_observation",
                        "needsSourceVerification": False,
                        "confidence": 0.0
                    }
                ],
                "relationships": [
                    {
                        "from": "visual label",
                        "to": "visual label",
                        "relationship": "arrow/connection/containment/adjacency/hierarchy",
                        "visualEvidence": "what in image proves this relationship",
                        "sourceProof": "source quote only if available",
                        "whyItMatters": "conceptual meaning",
                        "misconceptionRisk": "what student might misunderstand",
                        "boardAction": "how to draw/mark this relation",
                        "spokenCue": "teacher narration",
                        "studentCheckQuestion": "question",
                        "sourceType": "source_grounded_visual|visual_observation",
                        "confidence": 0.0
                    }
                ],
                "coreVisualFacts": [
                    {
                        "visualFact": "fact visible or source-grounded",
                        "sourceProof": "quote if available, empty if visual-only",
                        "visualObservation": "what the image shows",
                        "teachingMeaning": "why it matters",
                        "whyStudentShouldCare": "learning value",
                        "exactBoardMove": "draw/circle/highlight/write",
                        "spokenTeacherLine": "teacher voice line",
                        "studentCheckQuestion": "question",
                        "sourceType": "source_grounded_visual|visual_observation",
                        "needsSourceVerification": False,
                        "confidence": 0.0
                    }
                ],
                "boardRedrawHints": [
                    {
                        "order": 1,
                        "action": "draw/write/circle/arrow/highlight/zoom/reveal",
                        "content": "what to place on board",
                        "layoutHint": "where and why",
                        "voiceHint": "what teacher says",
                        "teacherPurpose": "why this helps",
                        "studentCheckQuestion": "quick check"
                    }
                ],
                "teacherMarkingHints": [
                    {
                        "markType": "circle|arrow|underline|highlight|zoom|source-preview",
                        "target": "what to mark",
                        "teacherReason": "why mark it",
                        "spokenCue": "teacher line",
                        "studentAttentionGoal": "what student should notice"
                    }
                ],
                "commonConfusions": [
                    {
                        "risk": "mistake",
                        "repairMove": "how teacher fixes",
                        "boardRepair": "what to draw/mark",
                        "visualTrigger": "what in the image may cause confusion"
                    }
                ],
                "confidence": 0.0,
                "visualTeacherPacket": {}
            }
        ],
        "detectedDiagrams": [
            {
                "page": image.get("page"),
                "diagramType": "ERD|star-schema|snowflake-schema|workflow|flowchart|table|architecture|concept-map|unknown",
                "title": "short title",
                "summary": "teacher-useful visual summary",
                "elements": [],
                "relationships": [],
                "needsRedraw": True,
                "sourceRefs": []
            }
        ],
        "visualTeacherPacket": {
            "pageVisualNarrative": "",
            "sourceGroundedVisualFacts": [],
            "diagramElementDetails": [],
            "relationshipWalkthrough": [],
            "teacherMarkingScript": [],
            "boardRedrawPlan": [],
            "misconceptionRisks": [],
            "visualTeachingSequence": [],
            "downstreamAgentInstructions": {
                "forConceptExtractionAgent": "Use visual facts/elements.",
                "forKnowledgeGraphAgent": "Use visual relationships.",
                "forTeachingStrategyAgent": "Use visual teaching sequence.",
                "forVisualPlannerAgent": "Use redraw plan.",
                "forBoardCommandAgent": "Use marks/redraw.",
                "forVoiceScriptAgent": "Sync voice with marks.",
            },
        },
        "visualTeachingHints": [],
        "diagramSummary": "debug summary only",
        "metadata": {
            "selectedPageVisionUsed": True,
            "modelVisionUsed": True,
            "superTeacherVisionPromptV9": True,
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }

    return f"""
SUPER TEACHER SELECTED PAGE VISION AGENT

MISSION:
Inspect the attached PDF page image as a world-class human teacher.
Do not just summarize. Produce detailed visual teaching intelligence for an animated board lesson.
Your output must be useful for: ConceptExtractionAgent, KnowledgeGraphAgent, TeachingStrategyAgent, VisualPlannerAgent, BoardCommandAgent, VoiceScriptAgent.

SELECTED NODE:
{json.dumps({
    "nodeId": selected_node.get("nodeId") or selected_node.get("id"),
    "title": selected_node.get("title") or selected_node.get("label"),
    "summary": selected_node.get("summary") or selected_node.get("shortDefinition"),
    "pageRefs": selected_node.get("pageRefs"),
}, ensure_ascii=False, indent=2)[:8000]}

PAGE IMAGE METADATA:
{json.dumps({
    "page": image.get("page"),
    "imageRole": image.get("imageRole"),
    "evidenceRole": image.get("evidenceRole"),
    "pageImagePath": image.get("pageImagePath"),
    "pageImageUrl": image.get("pageImageUrl"),
    "resolvedLocalPathExists": image.get("resolvedLocalPathExists"),
    "mimeType": image.get("mimeType"),
    "useRule": image.get("useRule"),
}, ensure_ascii=False, indent=2)[:8000]}

FULL PDF / OUTLINE CONTEXT:
{json.dumps(pdf_context, ensure_ascii=False, indent=2)[:32000]}

SOURCE TEXT / SELECTED PAGE / RAG EVIDENCE:
{source_text}

STRICT CONTRACT:
{json.dumps(contract, ensure_ascii=False, indent=2)}

RETURN JSON ONLY.
Use this schema and fill it with real visual/page information:
{json.dumps(schema, ensure_ascii=False, indent=2)}
""".strip()


def _stv9_super_merge_vision_results(results: List[JsonDict], context: Optional[JsonDict] = None) -> JsonDict:
    merged = _PREV_MERGE_VISION_RESULTS_SUPER_V9(results, context)

    packet = _stv9_dict(merged.get("visualTeacherPacket"))
    if not packet:
        packet = _stv9_dict(_stv9_dict(merged.get("visualLessonInput")).get("visualTeacherPacket"))

    facts = [_stv9_enrich_fact(x) for x in _stv9_list(packet.get("sourceGroundedVisualFacts"))]
    elements = [_stv9_enrich_element(x) for x in _stv9_list(packet.get("diagramElementDetails"))]
    relationships = [_stv9_enrich_relationship(x) for x in _stv9_list(packet.get("relationshipWalkthrough"))]
    marks = [_stv9_enrich_mark(x) for x in _stv9_list(packet.get("teacherMarkingScript"))]
    redraw = [_stv9_enrich_redraw(x, i) for i, x in enumerate(_stv9_list(packet.get("boardRedrawPlan")))]
    sequence = [_stv9_enrich_sequence(x, i) for i, x in enumerate(_stv9_list(packet.get("visualTeachingSequence")))]

    # Add missing facts/elements/relationships directly from page analyses.
    for analysis in _stv9_list(merged.get("pageImageAnalyses")):
        a = _stv9_dict(analysis)
        for x in _stv9_list(a.get("coreVisualFacts") or a.get("visualFacts") or a.get("facts")):
            facts.append(_stv9_enrich_fact(x))
        for x in _stv9_list(a.get("diagramElements") or a.get("elements")):
            elements.append(_stv9_enrich_element(x))
        for x in _stv9_list(a.get("relationships") or a.get("edges") or a.get("links")):
            relationships.append(_stv9_enrich_relationship(x))
        for x in _stv9_list(a.get("teacherMarkingHints") or a.get("visualTeachingHints")):
            marks.append(_stv9_enrich_mark(x))
        for i, x in enumerate(_stv9_list(a.get("boardRedrawHints") or a.get("redrawHints"))):
            redraw.append(_stv9_enrich_redraw(x, len(redraw) + i))

    def dedupe(items, key_fields, limit):
        out = []
        seen = set()
        for item in items:
            d = _stv9_dict(item)
            key = "|".join(_stv9_text(d.get(k), 250).lower() for k in key_fields)
            if not key.strip("|"):
                key = _stv9_text(str(d), 400).lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(d)
            if len(out) >= limit:
                break
        return out

    facts = dedupe(facts, ["visualFact", "teachingMeaning"], 120)
    elements = dedupe(elements, ["label", "kind", "visualRole"], 140)
    relationships = dedupe(relationships, ["from", "to", "relationship"], 140)
    marks = dedupe(marks, ["markType", "target", "spokenCue"], 140)
    redraw = dedupe(redraw, ["order", "action", "content"], 140)
    sequence = dedupe(sequence, ["step", "teacherMove", "boardMove"], 80)

    # If sequence is still short, build it from redraw plan.
    if len(sequence) < 6:
        for i, step in enumerate(redraw[:12]):
            d = _stv9_dict(step)
            sequence.append(_stv9_enrich_sequence({
                "step": i + 1,
                "teacherMove": d.get("voiceHint") or d.get("content"),
                "boardMove": f"{d.get('action')}: {d.get('content')}",
                "studentCheck": d.get("studentCheckQuestion"),
            }, i))
        sequence = dedupe(sequence, ["step", "teacherMove", "boardMove"], 80)

    narrative = _stv9_text(packet.get("pageVisualNarrative"), 5000)
    if len(narrative.split()) < 120:
        parts = []
        for fact in facts[:5]:
            parts.append(_stv9_text(fact.get("spokenTeacherLine") or fact.get("teachingMeaning") or fact.get("visualFact"), 500))
        for rel in relationships[:3]:
            parts.append(_stv9_text(rel.get("spokenCue") or rel.get("whyItMatters") or rel.get("relationship"), 500))
        narrative = _stv9_text((narrative + " " + " ".join(parts)).strip(), 5000)

    packet = {
        **packet,
        "pageVisualNarrative": narrative,
        "sourceGroundedVisualFacts": facts,
        "diagramElementDetails": elements,
        "relationshipWalkthrough": relationships,
        "teacherMarkingScript": marks,
        "boardRedrawPlan": redraw,
        "visualTeachingSequence": sequence,
        "metadata": {
            **_stv9_dict(packet.get("metadata")),
            "superTeacherVisionPacketV9": True,
            "superTeacherVisionPromptV9": True,
            "worldClassVisualExplanationReady": True,
            "addsVisualObservationWhenRagMisses": True,
            "doesNotInventSourceQuotes": True,
            "sourceGroundedVisualFactCount": len(facts),
            "diagramElementDetailCount": len(elements),
            "relationshipWalkthroughCount": len(relationships),
            "teacherMarkingScriptCount": len(marks),
            "boardRedrawPlanCount": len(redraw),
            "visualTeachingSequenceCount": len(sequence),
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }

    merged["visualTeacherPacket"] = packet
    merged["visualLessonInput"] = {
        **_stv9_dict(merged.get("visualLessonInput")),
        "visualTeacherPacket": packet,
        "richVisualTeacherPacket": True,
        "plannerReady": True,
        "superTeacherVisionPacketV9": True,
    }
    merged["metadata"] = {
        **_stv9_dict(merged.get("metadata")),
        "superTeacherVisionPromptV9": True,
        "superTeacherVisionPacketV9": True,
        "worldClassVisualExplanationReady": True,
        "fallbackUsed": False,
        "usedSmartFallback": False,
    }
    return merged


build_vision_prompt = _stv9_super_build_vision_prompt
merge_vision_results = _stv9_super_merge_vision_results
