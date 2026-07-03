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
DOMAIN: PROGRAMMING / CODING — teach like the world's best programming mentor who makes a complete
beginner AND a strong coder both fully understand. Always show the PROBLEM before the code.

EXPLAIN EVERYTHING (depth mandate above): for every coding idea on the pages build detailed element
cards covering — the concept in plain language; why programmers need it; the input/output contract;
the pseudocode plan; a line-by-line walkthrough of the code; a variable trace per step;
loop/recursion visualization; edge cases; common bugs + the fix; time/space complexity; and
practice. Walk EVERY line of EVERY code block and EVERY step of EVERY trace — do not summarize.

CODING ELEMENT VOCABULARY (use what the page calls for; fill each with a LONG specific contentBrief):
  code_block, pseudocode_steps, line_by_line_trace, variable_table (values per step),
  array_pointer_view (i/j pointers), hashmap_view, stack_frame_view, recursion_tree,
  control_flow_graph, loop_invariant_card, input_output_panel, test_case_panel, unit_test_panel,
  bug_trace, debug_fix_panel (bug→cause→fix), complexity_card (Big-O), optimization_compare
  (brute force vs optimized), memory_model_view (stack/heap/reference).
Plus universal elements (definition_card, comparison_table, common_mistake_box,
progressive_practice_set, quiz_check, recap_map, …). For runnable code set needsSandbox=true so the
SandboxAgent EXECUTES it and shows the REAL output (verified dry-run, not guessed).

MODES:
  • PREBUILT (voice+point): concept overview, control-flow/flowchart, memory model, complexity
    comparison, quiz/recap — point at each part while explaining.
  • WRITING (voice+point+writing): write the code line by line, trace variables per iteration, draw
    the stack/heap/array/pointer, draw the recursion tree, find and fix a bug live.
  • BOTH: show the code block AND trace / run it.
Board actions: writeCode, highlightLine, movePointer, drawArrow, drawBox, drawTable, writeText, circle.

ALWAYS: show the PROBLEM before the code; reveal code line by line (never all at once); trace a
variable table per loop iteration; draw the recursion tree for recursion; show one edge case and one
Big-O screen; run real code via the sandbox for a verified dry-run. Give a real coding challenge with
a worked solution. Use the EXACT code/variable names from the PDF — never invent.
"""
