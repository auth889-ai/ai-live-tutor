"""
tests/python/conftest.py
Shared fixtures for all Python tests.
"""
import sys
import os
import pytest

# Make google_agent importable from tests
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


# ── Sample payloads ───────────────────────────────────────────────────────────

@pytest.fixture
def database_node_payload():
    return {
        "nodeId": "database_denormalization_optimizing_performance_for_reporting",
        "nodeTitle": "Database Denormalization: Optimizing Performance for Reporting",
        "resourceId": "glt_resource_1781020240341_814ec180",
        "treeId": "tree_001",
        "selectedNode": {
            "nodeId": "database_denormalization_optimizing_performance_for_reporting",
            "title": "Database Denormalization",
            "label": "Database Denormalization",
        },
        "selectedEvidence": [
            {
                "chunkId": "chunk_001",
                "text": "Denormalization is the process of adding redundant data to a normalized database to improve read performance. It trades write efficiency for faster queries.",
                "page": 5,
                "pageRef": "5",
                "sourceRef": "[Page 5] Denormalization overview",
                "confidence": 0.92,
            },
            {
                "chunkId": "chunk_002",
                "text": "In reporting databases, star schema and snowflake schema use denormalization. Fact tables join dimension tables for fast OLAP queries.",
                "page": 6,
                "pageRef": "6",
                "sourceRef": "[Page 6] Star schema",
                "confidence": 0.88,
            },
            {
                "chunkId": "chunk_003",
                "text": "SQL query performance improves when JOIN operations are reduced. Materialized views pre-compute expensive aggregations.",
                "page": 7,
                "pageRef": "7",
                "sourceRef": "[Page 7] Query optimization",
                "confidence": 0.85,
            },
        ],
        "studentLevel": "beginner",
        "lessonMode": "masterclass",
    }


@pytest.fixture
def code_node_payload():
    return {
        "nodeId": "binary_search_algorithm",
        "nodeTitle": "Binary Search Algorithm",
        "selectedEvidence": [
            {
                "chunkId": "chunk_c1",
                "text": "Binary search finds a target value in a sorted array by repeatedly halving the search interval. Time complexity is O(log n).",
                "page": 12,
                "sourceRef": "[Page 12] Binary search",
                "confidence": 0.95,
            }
        ],
    }


@pytest.fixture
def math_node_payload():
    return {
        "nodeId": "calculus_derivatives",
        "nodeTitle": "Calculus: Derivatives and Differentiation",
        "selectedEvidence": [
            {
                "chunkId": "chunk_m1",
                "text": "The derivative of a function f(x) represents the instantaneous rate of change. dy/dx = lim(h→0) [f(x+h) - f(x)] / h",
                "page": 3,
                "sourceRef": "[Page 3] Derivative definition",
                "confidence": 0.93,
            }
        ],
    }


@pytest.fixture
def empty_payload():
    return {
        "nodeId": "unknown_node",
        "nodeTitle": "Unknown Topic",
        "selectedEvidence": [],
    }


@pytest.fixture
def mock_gemini_response_database():
    """A realistic but minimal Gemini response for database topic."""
    import json
    screens = [
        {
            "screenId": f"screen_{i:03d}",
            "screenType": "title_concept_card" if i == 1 else "definition_term_card",
            "title": f"Section {i}: Database Denormalization",
            "blocks": [
                {"blockId": f"b{i}_1", "type": "heading", "content": f"Key Point {i}"},
                {"blockId": f"b{i}_2", "type": "body", "content": "Denormalization adds redundant data to improve query speed."},
            ],
            "sourceRef": "[Page 5] Denormalization overview",
            "teacherNote": f"Let me explain point {i} about denormalization.",
        }
        for i in range(1, 26)
    ]
    commands = [
        {
            "commandId": f"cmd_{i:03d}",
            "screenId": f"screen_{((i-1)//5)+1:03d}",
            "voiceLineId": f"vl_{((i-1)//5)+1:03d}",
            "commandType": "writeText",
            "content": f"Board note {i}",
            "targetRegionId": None,
            "bbox": None,
            "startMs": (i - 1) * 2000,
            "endMs": i * 2000,
            "sourceRef": "[Page 5]",
        }
        for i in range(1, 126)
    ]
    voice = [
        {
            "lineId": f"vl_{i:03d}",
            "screenId": f"screen_{i:03d}",
            "text": f"Now let's understand section {i} about database denormalization and how it improves performance.",
            "startMs": 0,
            "endMs": 10000,
            "words": [],
        }
        for i in range(1, 26)
    ]
    return json.dumps({
        "lessonTitle": "Database Denormalization",
        "subject": "database",
        "nodeId": "database_denormalization_optimizing_performance_for_reporting",
        "boardScreens": screens,
        "boardCommands": commands,
        "voiceScript": voice,
        "subtitles": [{"lineId": v["lineId"], "text": v["text"], "startMs": 0, "endMs": 10000} for v in voice],
        "sourceRefs": [{"chunkId": "chunk_001", "page": 5, "quote": "Denormalization...", "confidence": 0.92}],
        "lessonMetadata": {"totalScreens": 25, "fallbackUsed": False},
        "metadata": {"fallbackUsed": False},
    })
