from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field


SUPPORTED_INPUT_TYPES = {"text"}


class SourcePackError(ValueError):
    pass


@dataclass(frozen=True)
class SourceChunk:
    chunk_id: str
    source_id: str
    text: str
    source_ref: str


@dataclass(frozen=True)
class SourcePack:
    source_pack_id: str
    input_type: str
    title: str
    sources: list[dict]
    chunks: list[SourceChunk]
    concepts: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "sourcePackId": self.source_pack_id,
            "inputType": self.input_type,
            "title": self.title,
            "sources": self.sources,
            "chunks": [
                {
                    "chunkId": chunk.chunk_id,
                    "sourceId": chunk.source_id,
                    "text": chunk.text,
                    "sourceRef": chunk.source_ref,
                }
                for chunk in self.chunks
            ],
            "concepts": self.concepts,
        }


def build_source_pack(*, input_type: str, text: str | None = None) -> SourcePack:
    normalized_type = input_type.strip().lower()
    if normalized_type not in SUPPORTED_INPUT_TYPES:
        raise SourcePackError(f"Input type '{input_type}' is not implemented yet.")

    clean_text = _normalize_text(text or "")
    if len(clean_text) < 40:
        raise SourcePackError("Text input is too short to build a useful lesson source.")

    title = _title_from_text(clean_text)
    source_id = _stable_id("src", clean_text[:300])
    chunks = _chunk_text(clean_text, source_id)

    return SourcePack(
        source_pack_id=_stable_id("sp", clean_text[:600]),
        input_type=normalized_type,
        title=title,
        sources=[
            {
                "sourceId": source_id,
                "type": normalized_type,
                "sourceRef": "User text",
                "title": title,
            }
        ],
        chunks=chunks,
        concepts=_extract_concepts(clean_text),
    )


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _title_from_text(text: str) -> str:
    first_sentence = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    return first_sentence[:80].strip() or "Untitled Lesson"


def _chunk_text(text: str, source_id: str) -> list[SourceChunk]:
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    chunks: list[SourceChunk] = []
    current: list[str] = []
    current_len = 0

    for sentence in sentences:
        if current and current_len + len(sentence) > 700:
            chunks.append(_make_chunk(source_id, len(chunks), " ".join(current)))
            current = []
            current_len = 0
        current.append(sentence)
        current_len += len(sentence)

    if current:
        chunks.append(_make_chunk(source_id, len(chunks), " ".join(current)))

    return chunks


def _make_chunk(source_id: str, index: int, text: str) -> SourceChunk:
    return SourceChunk(
        chunk_id=f"{source_id}_chunk_{index + 1:03d}",
        source_id=source_id,
        text=text,
        source_ref="User text" if index == 0 else f"User text chunk {index + 1}",
    )


def _extract_concepts(text: str) -> list[str]:
    words = re.findall(r"\b[A-Za-z][A-Za-z0-9+#-]{3,}\b", text)
    ignored = {"this", "that", "with", "from", "have", "will", "when", "then", "because"}
    concepts: list[str] = []
    seen: set[str] = set()

    for word in words:
        key = word.lower()
        if key in ignored or key in seen:
            continue
        seen.add(key)
        concepts.append(word)
        if len(concepts) == 10:
            break

    return concepts


def _stable_id(prefix: str, value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"

