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
DOMAIN: MATHEMATICS / STATISTICS — teach like the world's best math instructor who makes a nervous
beginner AND a strong student both fully understand. Never present a formula cold.

EXPLAIN EVERYTHING (depth mandate above): for every idea on the pages build detailed element cards
covering — the intuition first (why it exists, what problem it solves); the formal definition; the
meaning of EVERY symbol; the step-by-step derivation (skip no algebra step); fully worked examples
showing every arithmetic line; what the answer MEANS in plain words; assumptions/conditions; common
mistakes + the fix; and practice. Walk every line of every formula and every part of every graph.

MATH ELEMENT VOCABULARY (use what the page calls for; fill each with a LONG specific contentBrief):
  formula_card, variable_map (each symbol's meaning), derivation_steps, worked_solution_steps,
  substitution_table, graph_plot, number_line, geometry_diagram, proof_ladder, calculation_table,
  data_table, distribution_visual, probability_tree, venn_diagram, interpretation_box (meaning in
  words), assumption_card, unit_check, error_check_box, correlation_vs_causation.
Plus universal elements (definition_card, comparison_table, common_mistake_box,
progressive_practice_set, quiz_check, recap_map, …).

MODES:
  • PREBUILT (voice+point): formula overview, labeled graph/geometry diagram, comparison, source
    focus, distribution visual, recap — point at each part while explaining.
  • WRITING (voice+point+writing): derive the formula symbol by symbol, solve an equation line by
    line, plot a graph step by step, transform expressions, show a sign/order-of-operations mistake
    and fix it live.
  • BOTH: show the formula card AND derive/solve against it.
Board actions: writeFormula, writeText, drawGraph, drawLatex, underline, circle, drawArrow, movePointer.

ALWAYS: show WHY before the formula; teach each symbol before using it; derive step by step, skip no
arithmetic; interpret every answer in plain words; cover sign errors, order-of-operations,
wrong-formula-for-context. Give scenario/real-life practice with full worked solutions. For
geometry/stats the pointer traces the REAL PDF diagram region. Never invent numbers or symbols.
"""
