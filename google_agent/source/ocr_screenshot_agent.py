"""
google_agent/live_tutor_agents/source/ocr_screenshot_agent.py
===============================================================================
OCR / Screenshot Understanding Agent.

Separate strong agent responsibility:
- Understand screenshot/image payload metadata.
- Extract provided OCR text if available.
- Optionally use pytesseract/PIL if installed and imagePath is provided.
- Detect likely code/table/diagram/text regions.
- Produce source chunks with screenshot region metadata.
- No fake OCR.

Important:
Built-in OCR is optional because local machines may not have Tesseract installed.
If OCR text is not provided and OCR dependencies are missing, this agent fails clearly.
===============================================================================
"""

from __future__ import annotations

import os
import re
from typing import Any, List

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
    AgentContext,
    JsonDict,
    SourceChunk,
    ValidationResult,
    clean_text,
    make_id,
    safe_dict,
    safe_list,
)


def classify_region_text(text: str) -> str:
    sample = clean_text(text, 3000)
    lower = sample.lower()

    code_signals = [
        "function ",
        "const ",
        "let ",
        "var ",
        "def ",
        "class ",
        "public ",
        "private ",
        "return ",
        "console.log",
        "import ",
        "#include",
        "SELECT ".lower(),
        "CREATE TABLE".lower(),
    ]

    if any(signal in lower for signal in code_signals):
        return "code"

    if "|" in sample or len(re.findall(r"\S\s{3,}\S", sample)) >= 3:
        return "table"

    diagram_terms = ["arrow", "flow", "diagram", "node", "edge", "tree", "graph", "chart"]
    if any(term in lower for term in diagram_terms):
        return "diagram"

    return "text"


def run_optional_ocr(image_path: str) -> str:
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"imagePath does not exist: {image_path}")

    try:
        from PIL import Image  # type: ignore
        import pytesseract  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "OCR dependencies are missing. Install pillow and pytesseract plus local Tesseract binary, "
            f"or send ocrText from another OCR service. Real error: {exc}"
        )

    image = Image.open(image_path)
    text = pytesseract.image_to_string(image)
    text = clean_text(text, 120000)

    if not text:
        raise RuntimeError("OCR produced empty text. No fake OCR text generated.")

    return text


def chunk_ocr_text(resource_id: str, text: str, regions: List[JsonDict]) -> List[SourceChunk]:
    text = clean_text(text, 120000)
    chunks: List[SourceChunk] = []

    if regions:
        for index, region_raw in enumerate(regions):
            region = safe_dict(region_raw)
            region_text = clean_text(region.get("text") or region.get("ocrText") or "", 20000)
            if not region_text:
                continue

            region_id = clean_text(region.get("regionId") or f"region_{index + 1}", 100)
            chunks.append(
                SourceChunk(
                    resourceId=resource_id,
                    chunkId=f"{resource_id}_{region_id}",
                    text=region_text,
                    sourceRef=f"{resource_id}:screenshot:{region_id}",
                    pageRef=f"{resource_id}:screenshot",
                    page=1,
                    chunkIndex=index,
                    heading=clean_text(region.get("label") or classify_region_text(region_text), 160),
                    title="Screenshot OCR",
                    textPreview=clean_text(region_text, 700),
                    metadata={
                        "agent": "OcrScreenshotUnderstandingAgent",
                        "regionId": region_id,
                        "regionType": classify_region_text(region_text),
                        "bbox": safe_dict(region.get("bbox")),
                        "fallbackUsed": False,
                    },
                )
            )

    if chunks:
        return chunks

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paragraphs:
        paragraphs = [text]

    current = []
    chunk_index = 0

    def flush() -> None:
        nonlocal current, chunk_index
        if not current:
            return
        body = "\n\n".join(current).strip()
        if not body:
            current = []
            return

        region_type = classify_region_text(body)
        chunks.append(
            SourceChunk(
                resourceId=resource_id,
                chunkId=f"{resource_id}_ocr_c{chunk_index}",
                text=body,
                sourceRef=f"{resource_id}:screenshot:ocr_chunk:{chunk_index}",
                pageRef=f"{resource_id}:screenshot",
                page=1,
                chunkIndex=chunk_index,
                heading=region_type,
                title="Screenshot OCR",
                textPreview=clean_text(body, 700),
                metadata={
                    "agent": "OcrScreenshotUnderstandingAgent",
                    "regionType": region_type,
                    "fallbackUsed": False,
                },
            )
        )
        current = []
        chunk_index += 1

    for para in paragraphs:
        if sum(len(x) for x in current) + len(para) > 1800:
            flush()
        current.append(para)

    flush()
    return chunks


class OcrScreenshotUnderstandingAgent(BaseLiveTutorAgent):
    agent_name = "OcrScreenshotUnderstandingAgent"
    agent_group = "source"
    default_mode = "understand_screenshot"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
OCR / Screenshot Understanding Agent:
Read screenshot text/regions, identify text/table/code/diagram areas, and produce source chunks.
Never fake OCR content.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []

        ocr_text = clean_text(payload.get("ocrText") or payload.get("text") or "", 1000)
        regions = safe_list(payload.get("regions"))
        image_path = clean_text(payload.get("imagePath") or payload.get("filePath") or "", 2000)

        has_region_text = any(clean_text(safe_dict(r).get("text") or safe_dict(r).get("ocrText")) for r in regions)

        if not ocr_text and not has_region_text and not image_path:
            errors.append("OCR agent requires ocrText, regions with text, or imagePath.")

        if image_path and not os.path.exists(image_path):
            errors.append(f"imagePath does not exist: {image_path}")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="OcrScreenshotUnderstandingAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        resource = safe_dict(payload.get("resource"))
        resource_id = clean_text(
            payload.get("resourceId")
            or resource.get("resourceId")
            or context.resourceId
            or make_id("screenshot"),
            220,
        )

        ocr_text = clean_text(payload.get("ocrText") or payload.get("text") or "", 120000)
        regions = [safe_dict(r) for r in safe_list(payload.get("regions"))]
        image_path = clean_text(payload.get("imagePath") or payload.get("filePath") or "", 2000)

        if not ocr_text and not any(clean_text(r.get("text") or r.get("ocrText")) for r in regions):
            if not image_path:
                raise RuntimeError("No OCR text/regions/imagePath provided. No fake OCR generated.")
            ocr_text = run_optional_ocr(image_path)

        chunks = chunk_ocr_text(resource_id, ocr_text, regions)

        if not chunks:
            raise RuntimeError("OCR agent produced zero chunks. No fake screenshot understanding generated.")

        detected_types = sorted(set(clean_text(chunk.metadata.get("regionType") or "text") for chunk in chunks))

        return {
            "resourceId": resource_id,
            "resourceType": "screenshot",
            "chunkCount": len(chunks),
            "detectedRegionTypes": detected_types,
            "chunks": [chunk.to_dict() for chunk in chunks],
            "sourceRefs": [chunk.to_source_ref().to_dict() for chunk in chunks],
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "ocrFromPayload": bool(ocr_text),
                "ocrFromImagePath": bool(image_path and not payload.get("ocrText")),
                "regionCount": len(regions),
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return raw

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        chunks = safe_list(output.get("chunks"))
        if not chunks:
            errors.append("OCR output must include chunks.")

        for index, raw in enumerate(chunks):
            chunk = safe_dict(raw)
            if not clean_text(chunk.get("chunkId")):
                errors.append(f"chunks[{index}].chunkId is required.")
            if not clean_text(chunk.get("text")):
                errors.append(f"chunks[{index}].text is required.")
            metadata = safe_dict(chunk.get("metadata"))
            if not clean_text(metadata.get("regionType")):
                warnings.append(f"chunks[{index}] missing metadata.regionType.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="OcrScreenshotUnderstandingAgent.validate_output",
            fallbackUsed=False,
        )