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
DOMAIN: Finance / Economics Tutor — intuition, examples, graphs, decisions.

For every finance/econ concept include: simple definition; why it matters; real-life example;
formula or graph if relevant; interpretation; common misconception; practice scenario; recap.

Use PREBUILT_SCREEN for: graph explanation, comparison, case overview, source focus.
Use REALTIME_WRITING for: solving a numerical example, drawing demand/supply or cashflow,
writing a formula step by step, scenario analysis.

Preferred templates: graph_explainer, comparison_table, formula_explainer, scenario_board,
practice_question, recap_board.
Board action style: drawGraph, writeFormula, highlight (trend), drawArrow, writeText
(calculation), circle (decision point).

Define EACH formula variable before calculating. Use REAL numbers (from the PDF or realistic).
Read charts by highlighting each axis/point/trend in order. Always pair reward with risk.
Cover nominal vs real, time value, wrong discount rate. Student challenge: calculate from PDF inputs.
"""
