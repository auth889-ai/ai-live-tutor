"""
google_agent/planning/teachers/sql_database_teacher.py
SQLDatabaseTeacher — specialist for database, SQL, schema, normalization topics.
"""

from __future__ import annotations

try:
    from .base_domain_teacher import BaseDomainTeacher, teach_node
except ImportError:
    from google_agent.planning.teachers.base_domain_teacher import BaseDomainTeacher, teach_node  # type: ignore


class SQLDatabaseTeacher(BaseDomainTeacher):
    agent_name = "SQLDatabaseTeacher"
    domain = "sql_database"

    screen_families = ["sql_database", "source_grounded", "explanation",
                       "worked_example", "interaction", "mistake_repair", "summary_book"]

    teaching_sequence = [
        "real_world_hook",
        "show_erd_diagram",
        "table_by_table_walkthrough",
        "pk_fk_relationships",
        "join_bridge_animation",
        "write_first_query",
        "query_dry_run_trace",
        "normalization_rule",
        "common_sql_mistakes",
        "student_query_challenge",
        "recap_and_book_save",
    ]

    hook_opening = (
        "Start with a real-world scenario: 'Imagine you run a hospital. "
        "How do you store 10,000 patients without duplication?' "
        "Then reveal the ERD from the PDF page."
    )

    domain_addon_prompt = """
DOMAIN: SQL / Database Tutor — teach like a practical database engineering instructor.

For every database concept include: simple definition; real-world use case; schema/table
relationships; SQL example using the EXACT table/column names visible on the PDF page;
migration/design implication; ERD / data-flow explanation; common mistakes; safe production
practice; a practice query/design task; recap.

Use PREBUILT_SCREEN for: ERD explanation, schema overview, table relationships, source-page
focus, comparison tables.
Use REALTIME_WRITING for: writing SQL step by step, drawing table relationships, explaining
migration steps, solving a query live, showing a mistake and correcting it.

Preferred templates: source_focus, diagram_explainer, comparison_table, sql_code_example,
mistake_repair, practice_question, recap_board.
Board action style: drawTable, drawArrow, writeSQL, highlight, circle, underline, movePointer.

Always show the ERD/schema diagram FIRST from the real page region; walk each table before
JOINs; dry-run a query row by row; teach normalization (1NF/2NF/3NF) as removing redundancy,
not abstract rules. Cover NULL handling, BETWEEN off-by-one, GROUP BY errors. Student
challenge: write a query answering a real question. Never invent table/column names.
"""
