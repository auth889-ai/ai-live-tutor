from __future__ import annotations

from forever_api.semantic_search.interfaces import SearchHit


class PgVectorSourceStore:
    """
    Phase 3 implementation target.

    This class owns source chunk semantic retrieval. The first slice keeps the
    contract without requiring a local Postgres instance.
    """

    async def upsert_chunks(self, course_id: str, chunks: list[dict]) -> None:
        raise NotImplementedError("Phase 3: store chunks in PostgreSQL + pgvector")

    async def search(self, course_id: str, query: str, limit: int = 8) -> list[SearchHit]:
        raise NotImplementedError("Phase 3: semantic search with pgvector")

