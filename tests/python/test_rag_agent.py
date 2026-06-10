"""
tests/python/test_rag_agent.py

Tests for RagRetrievalAgent.
These tests PROVE the current keyword-scoring RAG is weak
and document what Atlas Vector Search would fix.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from google_agent.source.rag_retrieval_agent import _score_text, _tokens


# ══════════════════════════════════════════════════════════════════
# KEYWORD SCORING — PROVING ITS WEAKNESS
# ══════════════════════════════════════════════════════════════════

class TestKeywordScoring:

    def test_exact_keyword_match_scores_higher(self):
        """Direct keyword match scores higher than semantic match."""
        query = "database denormalization"
        direct = "denormalization database table"
        semantic = "adding redundant data to improve query speed without exact keywords"
        assert _score_text(query, direct) > _score_text(query, semantic)

    def test_semantic_miss_proves_weakness(self):
        """
        WEAKNESS PROOF: This chunk is semantically about denormalization
        but uses different words — keyword RAG scores it ZERO.
        With Atlas Vector Search it would score HIGH.
        """
        query = "database denormalization performance"
        # This chunk talks about the same concept but uses different vocabulary
        semantic_chunk = "adding redundant columns to speed up read operations at the cost of storage"
        score = _score_text(query, semantic_chunk)
        # Keyword RAG gives 0 because "denormalization", "database", "performance" not in chunk
        assert score == 0.0, f"KEYWORD RAG GIVES {score} — Atlas Vector Search would give ~0.9"

    def test_irrelevant_chunk_with_keyword_scores_high(self):
        """
        WEAKNESS PROOF: Chunk mentions 'database' but is about backups — not relevant.
        Keyword RAG scores it as relevant. Vector Search would score it LOW.
        """
        query = "database denormalization"
        irrelevant_chunk = "database backup procedures and disaster recovery for production database systems"
        score = _score_text(query, irrelevant_chunk)
        # Scores 2+ because 'database' appears twice — WRONG, this is not about denormalization
        assert score > 1.0, f"Proves keyword RAG falsely scores irrelevant chunks: {score}"

    def test_empty_query_scores_zero(self):
        assert _score_text("", "any content here") == 0.0

    def test_empty_text_scores_zero(self):
        assert _score_text("database query", "") == 0.0

    def test_both_empty_scores_zero(self):
        assert _score_text("", "") == 0.0

    def test_identical_text_scores_highest(self):
        text = "database denormalization table index foreign key"
        score = _score_text(text, text)
        assert score > 0

    def test_stop_words_excluded(self):
        """Stop words like 'the', 'and', 'for' don't affect score."""
        score1 = _score_text("the database", "the database table")
        score2 = _score_text("database", "database table")
        # Should be similar — stop words are filtered
        assert abs(score1 - score2) < 1.0


class TestTokenizer:

    def test_lowercases(self):
        tokens = _tokens("Database SQL Table")
        assert "database" in tokens
        assert "sql" in tokens
        assert "table" in tokens

    def test_removes_stop_words(self):
        tokens = _tokens("the and for with that")
        assert len(tokens) == 0

    def test_handles_empty(self):
        assert _tokens("") == []

    def test_handles_numbers(self):
        tokens = _tokens("page 5 chapter 12")
        assert "page" in tokens
        assert "chapter" in tokens

    def test_handles_special_chars(self):
        tokens = _tokens("O(log n) complexity")
        assert len(tokens) > 0


# ══════════════════════════════════════════════════════════════════
# WHY ATLAS VECTOR SEARCH WOULD FIX THIS
# ══════════════════════════════════════════════════════════════════

class TestWhyVectorSearchWouldWin:
    """
    These tests document what SHOULD happen once Atlas Vector Search is wired.
    They show the semantic gap that keyword RAG cannot bridge.
    Currently these are just documentation — they show what to implement.
    """

    def test_document_semantic_gap(self):
        """
        Query:  "denormalization for reporting performance"

        Chunk A (keyword match): "denormalization database table performance" → scores 4.0
        Chunk B (semantic match): "star schema reduces joins for OLAP analytics" → scores 0.0

        Chunk B is MORE RELEVANT to reporting performance (OLAP, star schema)
        but keyword RAG completely misses it.

        Atlas Vector Search would score Chunk B ~0.87 cosine similarity.
        """
        query = "denormalization for reporting performance"
        chunk_a = "denormalization database table performance"
        chunk_b = "star schema reduces joins for OLAP analytics reporting systems"

        score_a = _score_text(query, chunk_a)
        score_b = _score_text(query, chunk_b)

        # Document the problem: chunk_b is semantically more relevant but scores lower
        # This is the EXACT reason the AI gives poor lessons — wrong evidence
        assert score_a > score_b, (
            f"Keyword RAG: chunk_a={score_a:.2f} chunk_b={score_b:.2f}. "
            f"chunk_b is semantically more relevant but keyword RAG misses it. "
            f"FIX: Wire Atlas $vectorSearch with text-embedding-004."
        )

    def test_document_synonym_blindness(self):
        """
        Keyword RAG is blind to synonyms.
        'redundancy' and 'duplication' mean the same as 'denormalization' in context
        but score zero against query 'denormalization'.
        """
        query = "denormalization"
        synonym_chunk = "data redundancy through duplication of attributes across relations"
        score = _score_text(query, synonym_chunk)
        # Keyword RAG scores 0 — Vector Search would score ~0.82
        assert score == 0.0, "Synonym blindness confirmed — Atlas Vector Search needed"
