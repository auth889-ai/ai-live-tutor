from __future__ import annotations


def build_source_pack(text: str, input_type: str) -> dict:
    clean = " ".join(text.split())
    return {
        "sourcePackId": "sp_demo_patterns",
        "inputType": input_type,
        "title": "Nested Loop Pattern Lesson",
        "conceptCandidates": [
            "nested loops",
            "outer loop counts rows",
            "inner loop controls columns",
            "print inside inner loop",
            "observe symmetry",
        ],
        "chunks": [
            {
                "chunkId": "chunk_loop_rules",
                "sourceId": "src_transcript_001",
                "text": clean,
                "sourceRef": "Teacher transcript 1:39-3:56",
            }
        ],
    }

