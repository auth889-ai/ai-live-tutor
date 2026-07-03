"""
google_agent/planning/teachers/finance_econ_teacher.py
FinanceEconTeacher — specialist for finance, economics, accounting, investment.
"""

from __future__ import annotations

try:
    from .base_domain_teacher import BaseDomainTeacher, teach_node
except ImportError:
    from google_agent.planning.teachers.base_domain_teacher import BaseDomainTeacher, teach_node  # type: ignore


class FinanceEconTeacher(BaseDomainTeacher):
    agent_name = "FinanceEconTeacher"
    domain = "finance_econ"

    screen_families = ["finance_econ", "source_grounded", "explanation",
                       "visual_model", "worked_example", "interaction",
                       "mistake_repair", "summary_book"]

    teaching_sequence = [
        "real_money_scenario_hook",
        "concept_definition",
        "formula_variables",
        "worked_numerical_example",
        "chart_or_table_reading",
        "scenario_simulation",
        "risk_and_tradeoff",
        "common_decision_mistakes",
        "student_calculation_challenge",
        "real_case_study",
        "recap_decision_framework",
    ]

    hook_opening = (
        "Open with a real money decision the student might face: "
        "'Should you invest $1000 today or spend it?' "
        "Show real charts/tables from the PDF — numbers must match the source."
    )

    domain_addon_prompt = """
DOMAIN: FINANCE / ECONOMICS / BUSINESS — teach like the world's best finance instructor who makes a
beginner AND a strong student fully understand. Anchor every idea to a real money decision.

EXPLAIN EVERYTHING (depth mandate above): for every idea on the pages build detailed element cards
covering — simple definition; why it matters; a real money scenario; the formula and EACH variable;
a fully worked numerical example (every calculation step); how to read each chart/table; risk vs
reward; the decision/recommendation; common mistakes; and practice. Walk every number, every axis,
every row.

FINANCE ELEMENT VOCABULARY (use what the page calls for; LONG specific contentBrief each):
  business_scenario, framework_board (SWOT/4P/funnel), decision_tree, tradeoff_card, metric_card
  (revenue/cost/ROI), financial_table, formula_card, chart_explain, break_even_visual, risk_matrix,
  stakeholder_map, process_funnel, case_question, recommendation_card.
Plus universal elements (definition_card, comparison_table, common_mistake_box,
progressive_practice_set, quiz_check, recap_map, …).

MODES:
  • PREBUILT (voice+point): graph/chart explanation, framework board, comparison, case overview,
    source focus — point at each part while explaining.
  • WRITING (voice+point+writing): solve a numerical example line by line, draw demand/supply or
    cashflow, write a formula step by step, build a decision tree, run a scenario.
  • BOTH: show the chart AND compute/annotate on it.
Board actions: drawGraph, writeFormula, writeText, highlight, drawArrow, circle, drawTable.

ALWAYS: define EACH formula variable before calculating; use REAL numbers (from the PDF or realistic);
read charts by highlighting each axis/point/trend in order; pair reward with risk; cover nominal vs
real, time value, wrong discount rate. Give a scenario/real-life calculation challenge with a worked
solution. Numbers must match the source — never invent.
"""
