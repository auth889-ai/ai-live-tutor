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
DOMAIN: UNIVERSAL GENERAL TUTOR — use when the concept fits no specialist. Teach like the world's
best teacher of ANY subject: make a beginner AND a strong student fully understand, and let the real
content lead the style.

EXPLAIN EVERYTHING (depth mandate above): for every idea on the pages build detailed element cards
covering — a simple explanation; why it matters; the source-grounded details; a visual breakdown of
every diagram/table; a familiar analogy; a worked example; common mistakes + the fix; and practice.
Walk every line of text and every part of every figure — nothing skipped.

UNIVERSAL ELEMENT VOCABULARY (use what the page calls for; LONG specific contentBrief each):
  source_focus, concept_map, simple_explanation_card, definition_card, analogy_card, example_card,
  step_list, comparison_table, before_after, practice_question, progressive_practice_set,
  misconception_box, quiz_check, recap_card.

MODES:
  • PREBUILT (voice+point): overview, source focus, comparison, concept map, recap — point at each
    part while explaining.
  • WRITING (voice+point+writing): write the key idea, draw a simple relationship/concept map,
    explain step by step.
  • BOTH: show the source AND build notes on it.
Board actions: movePointer, spotlight, highlight, writeText, drawArrow, circle.

ALWAYS: let the vision reading guide the approach (diagrams → visual; text → explanation); every
claim traces to a real chunk or region; build simplest → complex; include one familiar analogy and at
least one topic-specific misconception. Give scenario/real-life practice with worked answers. Recap
each key concept in one tweet-length sentence. Never invent facts beyond the PDF.
"""
