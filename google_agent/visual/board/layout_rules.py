"""
layout_rules.py — position and constraint rules per screen type.
Defines where each element goes on the board (normalized 0-1 coordinates).
"""
from __future__ import annotations
from typing import Dict, Tuple

# Layout zones: (x, y, w, h) normalized 0.0–1.0
ZONES: Dict[str, Dict[str, Tuple[float, float, float, float]]] = {
    "definition": {
        "title":       (0.05, 0.05, 0.90, 0.10),
        "term":        (0.05, 0.18, 0.50, 0.12),
        "definition":  (0.05, 0.33, 0.88, 0.15),
        "plain_eng":   (0.05, 0.52, 0.88, 0.12),
        "analogy":     (0.05, 0.67, 0.88, 0.12),
        "source_badge":(0.70, 0.88, 0.28, 0.08),
    },
    "workflow": {
        "title":       (0.05, 0.04, 0.90, 0.08),
        "step_row":    (0.05, 0.18, 0.90, 0.10),  # each step offset by y_step
        "arrow":       (0.0,  0.0,  0.0,  0.0),
        "source_badge":(0.70, 0.90, 0.28, 0.08),
    },
    "pdf_diagram": {
        "image":       (0.02, 0.10, 0.96, 0.75),
        "label":       (0.02, 0.87, 0.70, 0.10),
        "source_badge":(0.72, 0.88, 0.26, 0.08),
    },
    "comparison": {
        "title":       (0.05, 0.04, 0.90, 0.08),
        "table":       (0.05, 0.15, 0.90, 0.70),
        "source_badge":(0.70, 0.88, 0.28, 0.08),
    },
    "warning": {
        "title":       (0.05, 0.04, 0.90, 0.10),
        "wrong_box":   (0.05, 0.18, 0.42, 0.35),
        "correct_box": (0.53, 0.18, 0.42, 0.35),
        "reason":      (0.05, 0.60, 0.88, 0.18),
        "source_badge":(0.70, 0.88, 0.28, 0.08),
    },
    "quiz": {
        "question":    (0.05, 0.15, 0.90, 0.15),
        "option_a":    (0.08, 0.35, 0.84, 0.08),
        "option_b":    (0.08, 0.46, 0.84, 0.08),
        "option_c":    (0.08, 0.57, 0.84, 0.08),
        "option_d":    (0.08, 0.68, 0.84, 0.08),
        "source_badge":(0.70, 0.88, 0.28, 0.08),
    },
    "code_dryrun": {
        "title":       (0.05, 0.04, 0.60, 0.08),
        "code":        (0.02, 0.14, 0.58, 0.55),
        "output":      (0.02, 0.72, 0.58, 0.20),
        "db_visual":   (0.62, 0.14, 0.36, 0.78),
    },
}

CONSTRAINTS = {
    "max_write_commands":    8,
    "max_bullets_per_screen": 6,
    "min_duration_ms":       8000,
    "max_duration_ms":       90000,
    "pdf_image_min_ms":      12000,
    "source_badge_always":   True,
    "y_step_workflow":       0.10,
}


def get_zone(screen_type: str, element: str) -> Tuple[float, float, float, float]:
    zones = ZONES.get(screen_type) or ZONES.get("definition")
    return zones.get(element) or (0.05, 0.05, 0.90, 0.10)


def get_constraint(key: str):
    return CONSTRAINTS.get(key)
