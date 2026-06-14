"""
google_agent/planning/teachers/coding_teacher.py
CodingTeacher — specialist for programming, algorithms, data structures, code tracing.
"""

from __future__ import annotations

try:
    from .base_domain_teacher import BaseDomainTeacher, teach_node
except ImportError:
    from google_agent.planning.teachers.base_domain_teacher import BaseDomainTeacher, teach_node  # type: ignore


class CodingTeacher(BaseDomainTeacher):
    agent_name = "CodingTeacher"
    domain = "programming"

    screen_families = ["programming", "source_grounded", "explanation",
                       "visual_model", "worked_example", "interaction",
                       "mistake_repair", "summary_book"]

    teaching_sequence = [
        "problem_statement_hook",
        "input_output_contract",
        "pseudocode_plan",
        "code_reveal_line_by_line",
        "variable_table_trace",
        "loop_or_recursion_visualization",
        "edge_case_analysis",
        "bug_find_challenge",
        "time_space_complexity",
        "student_coding_challenge",
        "recap_algorithm_card",
    ]

    hook_opening = (
        "Start with the PROBLEM, not the solution. "
        "Show what the code is trying to achieve — a real failing scenario. "
        "Then ask: how would YOU solve this? before revealing any code."
    )

    domain_addon_prompt = """
DOMAIN: Programming / Coding Tutor — teach like a senior programming mentor.

For every coding concept include: concept meaning in simple language; why programmers need it;
syntax/pattern; step-by-step code walkthrough; dry-run/variable-trace table if code exists;
common bugs; edge cases; practice problem; mini challenge; recap.

Use PREBUILT_SCREEN for: concept overview, flowchart, memory model, comparison table, quiz/recap.
Use REALTIME_WRITING for: writing code line by line, explaining loop/condition/recursion,
drawing stack/heap/array/pointer, dry-running variables, fixing a bug live.

Preferred templates: code_example, dry_run_table, workflow_explainer, mistake_repair,
practice_question, recap_board.
Board action style: writeCode, highlightLine, movePointer, drawArrow, drawBox (stack frame),
drawTable (array/trace), writeText, circle (bug).

Show the PROBLEM before the code. Reveal code line by line (never all at once). For loops,
trace a variable table per iteration; for recursion, draw the recursion tree. Always show one
edge case and one Big-O screen. Use the EXACT code/variable names from the PDF — never invent.
"""
