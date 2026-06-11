"""
google_agent/generation/screen_schema.py
===============================================================================
THE W3 BOARD SCREEN CONTRACT — OpenMAIC-style source focus patch.

Core fix:
  - Real PDF source is a full rendered page element: kind="pdf_page".
  - PDF regions are child focus areas: regionId + parentElementId + bbox.
  - Pointer/spotlight/zoom are actions against the full page DOM element.
  - pdf_crop remains optional/debug only; not the main teaching visual.
  - Voice may stay legacy `voiceover`, but schema now allows sentence-level
    `voiceLines` with action timing for correct-time pointer sync.
===============================================================================
"""

from __future__ import annotations

from typing import Any, Dict

ELEMENT_KINDS = [
    "box",
    "arrow",
    "code_line",
    "label",
    "highlight_zone",
    "table_drawing",
    "pdf_crop",          # legacy/debug thumbnail only
    "pdf_page",          # NEW: real full PDF page source element
    "teacher_redraw",    # NEW: clean tutor explanation diagram/card
]

ELEMENT_STYLES = [
    "normal",
    "measure",
    "foreign_key",
    "danger",
    "success",
    "annotation",
    "source",
    "teacher",
    "focus",
    "debug",
]

BLOCK_TYPES = [
    "heading",
    "body",
    "bullet_list",
    "code",
    "quote_from_source",
    "warning",
    "comparison_left",
    "comparison_right",
    "annotation",
    "key_term",
    "step",
]

EMPHASIS = ["normal", "highlight", "danger", "success"]

ACTIONS = [
    "writeText",
    "drawBox",
    "drawArrow",
    "highlight",
    "circle",
    "underline",
    "showPdfCrop",
    "zoomRegion",
    "movePointer",
    "askStudent",
    "revealAnswer",
    "saveBookPage",
    "drawDiagram",

    # OpenMAIC-style region actions
    "showFullPage",
    "showPdfPage",
    "circleRegion",
    "highlightRegion",
    "spotlightRegion",
    "zoomToRegion",
    "panToRegion",
    "pointToRegion",
]

LAYOUTS = [
    "full",
    "split_source_explanation",
    "diagram_center",
    "code_walkthrough",
    "comparison",
    "quiz",

    # New source-focus layouts
    "source_focus_teacher_board",
    "full_page_with_focus",
    "source_teacher_split",
]

_BBOX = {
    "type": "object",
    "properties": {
        "x": {"type": "number"},
        "y": {"type": "number"},
        "w": {"type": "number"},
        "h": {"type": "number"},
    },
    "required": ["x", "y", "w", "h"],
}

_ACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "atMs": {"type": "integer"},
        "action": {"type": "string", "enum": ACTIONS},

        # legacy element targeting
        "targetElementId": {"type": "string"},

        # OpenMAIC-style source-region targeting
        "regionId": {"type": "string"},
        "parentElementId": {"type": "string"},
        "voiceLineId": {"type": "string"},
        "narrationCue": {"type": "string"},
    },
    "required": ["atMs", "action", "narrationCue"],
}

BOARD_SCREEN_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "screenId": {"type": "string"},
        "screenType": {"type": "string"},
        "title": {"type": "string"},
        "subtitle": {"type": "string"},
        "layout": {"type": "string", "enum": LAYOUTS},
        "sourceMode": {
            "type": "string",
            "enum": ["full_page_with_focus", "teacher_redraw", "debug_crop", "none"],
            "description": "Use full_page_with_focus for real PDF evidence. Do not use hard crop as main view.",
        },

        # Optional explicit page/focus contract.
        "pageElement": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "type": {"type": "string"},
                "pageNumber": {"type": "integer"},
                "pageImageUrl": {"type": "string"},
            },
        },
        "focusRegions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "regionId": {"type": "string"},
                    "parentElementId": {"type": "string"},
                    "type": {"type": "string"},
                    "label": {"type": "string"},
                    "bbox": _BBOX,
                },
                "required": ["regionId", "parentElementId", "bbox"],
            },
        },

        "visualElements": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "elementId": {"type": "string"},
                    "kind": {"type": "string", "enum": ELEMENT_KINDS},
                    "content": {"type": "string"},
                    "position": _BBOX,
                    "connectsTo": {"type": "string"},
                    "style": {"type": "string", "enum": ELEMENT_STYLES},
                    "regionId": {
                        "type": "string",
                        "description": "For pdf_crop/debug or focus actions: real visionIndex regionId only.",
                    },

                    # New PDF page element fields
                    "pageNumber": {"type": "integer"},
                    "pageImageUrl": {"type": "string"},
                    "parentElementId": {"type": "string"},
                    "sourceMode": {
                        "type": "string",
                        "enum": ["full_page_with_focus", "teacher_redraw", "debug_crop", "none"],
                    },
                    "focusBbox": _BBOX,
                },
                "required": ["elementId", "kind", "content", "position", "style"],
            },
        },

        "blocks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": BLOCK_TYPES},
                    "content": {"type": "string"},
                    "emphasis": {"type": "string", "enum": EMPHASIS},
                },
                "required": ["type", "content", "emphasis"],
            },
        },

        "dryRun": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "step": {"type": "integer"},
                    "codeLine": {"type": "string"},
                    "whatHappens": {"type": "string"},
                    "stateAfter": {"type": "string"},
                    "beginnerTrap": {"type": "string"},
                },
                "required": ["step", "codeLine", "whatHappens", "stateAfter"],
            },
        },

        "boardActions": {"type": "array", "items": _ACTION_SCHEMA},

        # Legacy whole-screen speech
        "voiceover": {
            "type": "string",
            "description": "Full natural teacher speech, 4-8 sentences",
        },

        # New sentence-level sync.
        "voiceLines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "lineId": {"type": "string"},
                    "startMs": {"type": "integer"},
                    "endMs": {"type": "integer"},
                    "text": {"type": "string"},
                    "targetRegionId": {"type": "string"},
                    "targetElementId": {"type": "string"},
                    "actions": {"type": "array", "items": _ACTION_SCHEMA},
                },
                "required": ["lineId", "text"],
            },
        },

        "teacherNote": {"type": "string"},
        "boardWriting": {"type": "string"},
        "keyPoints": {"type": "array", "items": {"type": "string"}},
        "sourceRef": {
            "type": "object",
            "properties": {
                "page": {"type": "integer"},
                "quote": {
                    "type": "string",
                    "description": "VERBATIM source quote — verified downstream",
                },
                "regionId": {"type": "string"},
            },
            "required": ["page", "quote"],
        },
        "checkQuestion": {"type": "string"},
    },
    "required": [
        "screenId",
        "screenType",
        "title",
        "layout",
        "visualElements",
        "blocks",
        "boardActions",
        "voiceover",
        "teacherNote",
        "keyPoints",
        "sourceRef",
        "checkQuestion",
    ],
}

SEGMENT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "segmentSummary": {
            "type": "string",
            "description": "2-3 sentences: what this segment taught — feeds the NEXT segment for continuity",
        },
        "screens": {"type": "array", "items": BOARD_SCREEN_SCHEMA},
    },
    "required": ["segmentSummary", "screens"],
}

DRYRUN_REQUIRED_TYPES = {
    "line_by_line_dry_run",
    "query_dry_run",
    "worked_example_step",
    "worked_calculation",
    "equation_derivation",
    "loop_trace",
    "proof_step",
    "step_by_step_reasoning",
    "process_flow",
    "cashflow_timeline",
    "interest_return_calc",
}