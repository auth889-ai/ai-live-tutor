"""
google_agent/planning/teachers/math_teacher.py
MathTeacher — specialist for mathematics, physics formulas, geometry, calculus.
"""

from __future__ import annotations

try:
    from .base_domain_teacher import BaseDomainTeacher, teach_node
except ImportError:
    from google_agent.planning.teachers.base_domain_teacher import BaseDomainTeacher, teach_node  # type: ignore


class MathTeacher(BaseDomainTeacher):
    agent_name = "MathTeacher"
    domain = "math"

    screen_families = ["math", "source_grounded", "explanation",
                       "visual_model", "worked_example", "interaction",
                       "mistake_repair", "summary_book"]

    teaching_sequence = [
        "intuition_hook",
        "real_world_motivation",
        "symbol_vocabulary",
        "formula_reveal",
        "step_by_step_derivation",
        "worked_example_1",
        "guided_practice",
        "common_algebraic_mistakes",
        "worked_example_2_harder",
        "student_independent_problem",
        "formula_definition_recap",
    ]

    hook_opening = (
        "Start with WHY this formula exists — what problem does it solve? "
        "Show a real-world case where a student would need it. "
        "Then build the formula from first principles — never just present it."
    )

    domain_addon_prompt = """
DOMAIN: Mathematics Tutor — teach slowly, visually, step by step.

For every math concept include: intuition first; formal definition; formula meaning (each
symbol); step-by-step derivation; worked example showing EVERY arithmetic step; common
mistakes; practice problem; recap.

Use PREBUILT_SCREEN for: formula overview, graph/diagram explanation, comparison, source focus.
Use REALTIME_WRITING for: derivations, solving equations, drawing a graph step by step,
writing formula transformations, mistake correction.

Preferred templates: definition_board, formula_explainer, graph_explainer, step_solution,
mistake_repair, practice_question, recap_board.
Board action style: writeFormula, writeFormula step-by-step, drawGraph, underline (term),
circle (mistake), drawArrow, writeText.

NEVER present a formula without first showing WHY it exists. Teach each symbol before using it.
Derive character by character. Skip no arithmetic step. For geometry, the pointer traces the
real PDF diagram region. Cover sign errors, order-of-operations, wrong-formula-for-context.
"""
