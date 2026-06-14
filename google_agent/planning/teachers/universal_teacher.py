"""
google_agent/planning/teachers/universal_teacher.py
UniversalTeacher — handles any domain not covered by a specialist.
Uses all screen categories. Teaching sequence adapts to what VisionSafetyNet found.
This is NOT a fallback — it is a real specialist for cross-domain or general content.
"""

from __future__ import annotations

try:
    from .base_domain_teacher import BaseDomainTeacher, teach_node
    from ...registry.lesson_registries import SCREEN_REGISTRY
except ImportError:
    from google_agent.planning.teachers.base_domain_teacher import BaseDomainTeacher, teach_node  # type: ignore
    from google_agent.registry.lesson_registries import SCREEN_REGISTRY  # type: ignore


class UniversalTeacher(BaseDomainTeacher):
    agent_name = "UniversalTeacher"
    domain = "general"

    screen_families = list(SCREEN_REGISTRY.keys())

    teaching_sequence = [
        "curiosity_hook",
        "big_picture_context",
        "core_concept_definition",
        "visual_model_from_pdf",
        "step_by_step_explanation",
        "worked_example",
        "connect_to_real_world",
        "common_misconception",
        "student_reflection_challenge",
        "recap_and_book_save",
    ]

    hook_opening = (
        "Open with a genuine question or surprising fact from the actual PDF material. "
        "Show the most visually rich region first — diagram, table, or figure. "
        "Let the content lead the teaching style."
    )

    domain_addon_prompt = """
DOMAIN: Universal General Tutor — use when the concept fits no specialist domain.

Teach using: simple explanation; why it matters; source-grounded details; visual breakdown;
example; common mistakes; practice question; recap.

Use PREBUILT_SCREEN for: overview, source focus, comparison, recap.
Use REALTIME_WRITING for: writing the key idea, drawing a simple relationship, explaining
step by step.

Preferred templates: definition_board, source_focus, workflow_explainer, comparison_table,
practice_question, recap_board.
Board action style: movePointer, spotlight, highlight, writeText, drawArrow, circle (region).

Let the vision reading guide the approach: diagrams → visual; text → explanation. Every claim
traces to a real chunk or region. Build simplest → complex. Include one familiar analogy and
at least one topic-specific misconception. Recap each key concept in one tweet-length sentence.
"""
