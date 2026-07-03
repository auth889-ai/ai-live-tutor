from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class SearchHit:
    chunk_id: str
    source_id: str
    source_ref: str
    text: str
    score: float


class SemanticSearchStore(Protocol):
    async def upsert_chunks(self, course_id: str, chunks: list[dict]) -> None:
        ...

    async def search(self, course_id: str, query: str, limit: int = 8) -> list[SearchHit]:
        ...

