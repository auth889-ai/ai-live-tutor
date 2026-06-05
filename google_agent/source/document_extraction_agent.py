"""
google_agent/live_tutor_agents/source/document_extraction_agent.py
===============================================================================
Document Extraction Agent.

Separate strong agent responsibility:
- Detect document resource.
- Extract page-wise text when possible.
- Preserve page numbers.
- Detect headings.
- Detect possible tables/figures.
- Return chunks with sourceRefs.
- Never invent missing document text.

This agent can work in two modes:
1. If payload already contains extracted pages/text, it normalizes them.
2. If payload contains local filePath, it tries real extraction using installed libs.

No fake fallback:
- If no text/pages/file is provided, returns error.
- If PDF extraction library is unavailable, returns error, not fake text.
===============================================================================
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
    AgentContext,
    JsonDict,
    SourceChunk,
    ValidationResult,
    clean_text,
    make_id,
    normalize_id,
    safe_dict,
    safe_list,
)


def detect_heading(line: str) -> bool:
    line = clean_text(line, 180)
    if not line:
        return False
    if len(line.split()) > 14:
        return False
    if re.match(r"^(\d+(\.\d+)*|[A-Z])[\).\s-]+[A-Za-z]", line):
        return True
    if line.isupper() and len(line) >= 4:
        return True
    title_words = sum(1 for word in line.split() if word[:1].isupper())
    return title_words >= max(2, len(line.split()) // 2)


def detect_table_like(text: str) -> bool:
    lines = [line for line in clean_text(text, 4000).split("\n") if line.strip()]
    if not lines:
        return False

    pipe_lines = sum(1 for line in lines if "|" in line)
    multi_space_lines = sum(1 for line in lines if re.search(r"\S\s{3,}\S", line))
    numeric_grid_lines = sum(1 for line in lines if len(re.findall(r"\b\d+(\.\d+)?\b", line)) >= 3)

    return pipe_lines >= 2 or multi_space_lines >= 3 or numeric_grid_lines >= 3


def detect_figure_like(text: str) -> bool:
    text = clean_text(text, 4000).lower()
    figure_terms = [
        "figure",
        "fig.",
        "diagram",
        "chart",
        "graph",
        "flowchart",
        "table",
        "image",
        "screenshot",
    ]
    return any(term in text for term in figure_terms)


def split_page_into_chunks(resource_id: str, page: int, text: str, title: str = "") -> List[SourceChunk]:
    clean = clean_text(text, 30000)
    if not clean:
        return []

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", clean) if p.strip()]
    chunks: List[SourceChunk] = []

    current: List[str] = []
    current_heading = ""
    chunk_index = 0

    def flush() -> None:
        nonlocal current, current_heading, chunk_index
        if not current:
            return
        body = "\n\n".join(current).strip()
        if not body:
            current = []
            return

        chunk_id = f"{resource_id}_p{page}_c{chunk_index}"
        chunks.append(
            SourceChunk(
                resourceId=resource_id,
                chunkId=chunk_id,
                text=body,
                sourceRef=f"{resource_id}:page:{page}:chunk:{chunk_index}",
                pageRef=f"{resource_id}:page:{page}",
                page=page,
                chunkIndex=chunk_index,
                heading=current_heading,
                title=title,
                textPreview=clean_text(body, 700),
                metadata={
                    "agent": "DocumentExtractionAgent",
                    "tableLike": detect_table_like(body),
                    "figureLike": detect_figure_like(body),
                    "heading": current_heading,
                    "fallbackUsed": False,
                },
            )
        )
        current = []
        chunk_index += 1

    for para in paragraphs:
        first_line = para.split("\n", 1)[0].strip()

        if detect_heading(first_line):
            if current:
                flush()
            current_heading = clean_text(first_line, 180)

        if sum(len(x) for x in current) + len(para) > 2200:
            flush()

        current.append(para)

    flush()

    if not chunks and clean:
        chunks.append(
            SourceChunk(
                resourceId=resource_id,
                chunkId=f"{resource_id}_p{page}_c0",
                text=clean,
                sourceRef=f"{resource_id}:page:{page}:chunk:0",
                pageRef=f"{resource_id}:page:{page}",
                page=page,
                chunkIndex=0,
                heading="",
                title=title,
                textPreview=clean_text(clean, 700),
                metadata={
                    "agent": "DocumentExtractionAgent",
                    "tableLike": detect_table_like(clean),
                    "figureLike": detect_figure_like(clean),
                    "fallbackUsed": False,
                },
            )
        )

    return chunks


def try_extract_pdf_with_available_libs(file_path: str) -> List[JsonDict]:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Document file not found: {file_path}")

    lower = file_path.lower()

    if lower.endswith(".pdf"):
        try:
            from pypdf import PdfReader  # type: ignore
        except Exception as first_error:
            try:
                from PyPDF2 import PdfReader  # type: ignore
            except Exception as second_error:
                raise RuntimeError(
                    "PDF extraction requires pypdf or PyPDF2. Install one of them; no fake extraction generated. "
                    f"pypdf error={first_error}; PyPDF2 error={second_error}"
                )

        reader = PdfReader(file_path)
        pages: List[JsonDict] = []
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            pages.append(
                {
                    "page": index + 1,
                    "text": clean_text(text, 30000),
                    "metadata": {
                        "method": "pdf-text-extraction",
                        "library": "pypdf/PyPDF2",
                    },
                }
            )
        return pages

    if lower.endswith((".txt", ".md")):
        with open(file_path, "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        return [{"page": 1, "text": text, "metadata": {"method": "plain-text-read"}}]

    raise RuntimeError(f"Unsupported document file type for extraction: {file_path}")


class DocumentExtractionAgent(BaseLiveTutorAgent):
    agent_name = "DocumentExtractionAgent"
    agent_group = "source"
    default_mode = "extract_document"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Document Extraction Agent:
Extract page-wise text, headings, table-like blocks, figure-like hints, and sourceRefs.
Never invent document content.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        pages = safe_list(payload.get("pages"))
        raw_text = clean_text(payload.get("text") or payload.get("rawText") or "", 1000)
        file_path = clean_text(payload.get("filePath") or payload.get("path") or "", 2000)

        if not pages and not raw_text and not file_path:
            errors.append("DocumentExtractionAgent requires pages, text/rawText, or filePath.")

        if file_path and not os.path.exists(file_path):
            errors.append(f"filePath does not exist: {file_path}")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="DocumentExtractionAgent.validate_input",
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
            or make_id("resource"),
            220,
        )
        title = clean_text(payload.get("title") or resource.get("title") or "Uploaded Resource", 220)

        pages = safe_list(payload.get("pages"))
        if not pages:
            raw_text = clean_text(payload.get("text") or payload.get("rawText") or "", 200000)
            if raw_text:
                pages = [{"page": 1, "text": raw_text, "metadata": {"method": "payload-text"}}]

        if not pages:
            file_path = clean_text(payload.get("filePath") or payload.get("path") or "", 2000)
            pages = try_extract_pdf_with_available_libs(file_path)

        chunks: List[SourceChunk] = []
        page_summaries: List[JsonDict] = []

        for page_raw in pages:
            page_obj = safe_dict(page_raw)
            page_number = int(page_obj.get("page") or page_obj.get("pageNumber") or len(page_summaries) + 1)
            page_text = clean_text(page_obj.get("text") or page_obj.get("content") or "", 40000)

            if not page_text:
                continue

            page_chunks = split_page_into_chunks(
                resource_id=resource_id,
                page=page_number,
                text=page_text,
                title=title,
            )
            chunks.extend(page_chunks)

            headings = []
            for line in page_text.split("\n"):
                if detect_heading(line):
                    headings.append(clean_text(line, 180))
                if len(headings) >= 8:
                    break

            page_summaries.append(
                {
                    "page": page_number,
                    "charCount": len(page_text),
                    "headingCandidates": headings,
                    "tableLike": detect_table_like(page_text),
                    "figureLike": detect_figure_like(page_text),
                    "chunkCount": len(page_chunks),
                }
            )

        if not chunks:
            raise RuntimeError("DocumentExtractionAgent extracted zero chunks. No fake chunks generated.")

        return {
            "resourceId": resource_id,
            "title": title,
            "resourceType": clean_text(payload.get("resourceType") or resource.get("type") or "document", 80),
            "pageCount": len(page_summaries),
            "chunkCount": len(chunks),
            "pages": page_summaries,
            "chunks": [chunk.to_dict() for chunk in chunks],
            "sourceRefs": [chunk.to_source_ref().to_dict() for chunk in chunks[:20]],
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "supportsPdfText": True,
                "supportsTxtMd": True,
                "tableDetection": "heuristic",
                "figureDetection": "heuristic",
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return raw

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        chunks = safe_list(output.get("chunks"))
        if not chunks:
            errors.append("DocumentExtractionAgent output must include chunks.")

        for index, raw in enumerate(chunks):
            chunk = safe_dict(raw)
            if not clean_text(chunk.get("chunkId")):
                errors.append(f"chunks[{index}].chunkId is required.")
            if not clean_text(chunk.get("text")):
                errors.append(f"chunks[{index}].text is required.")
            if int(chunk.get("page") or 0) <= 0:
                errors.append(f"chunks[{index}].page must be positive.")
            if not clean_text(chunk.get("sourceRef")):
                warnings.append(f"chunks[{index}].sourceRef is missing.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="DocumentExtractionAgent.validate_output",
            fallbackUsed=False,
        )