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
DOMAIN: SQL / DATABASE — teach like the world's best database-engineering instructor who makes
a complete beginner AND a strong student both fully understand.

EXPLAIN EVERYTHING (depth, per the DEPTH MANDATE above): for every database idea on the pages,
build detailed element cards covering — plain-English definition; the technical definition;
WHY it exists / what problem it solves; the schema & table relationships; a real SQL example
using the EXACT table/column names visible on the PDF page (never invent names); a row-by-row
dry-run of what the query/operation does; the design/migration implication; the ERD / data-flow
reading; common mistakes + how to fix them; safe production practice; and practice tasks. Walk
EVERY part of EVERY diagram and EVERY line of EVERY query — do not summarize a rich ERD into one
sentence.

SQL/DATABASE ELEMENT VOCABULARY (use the ones the page content calls for; fill each with a LONG,
specific contentBrief — real teaching, not a label):
  schema_diagram, erd_explain, table_structure_view, pk_fk_card, relationship_trace,
  cardinality_card (1:1 / 1:N / M:N), sql_query_block, sql_clause_breakdown
  (SELECT/FROM/WHERE/GROUP BY/HAVING/ORDER BY explained clause by clause), sql_dry_run
  (execution step-by-step with a status/execution-log feel), result_table_build (result rows
  appearing one by one), join_visualizer, normalization_table (1NF/2NF/3NF compare),
  schema_before_after, migration_plan (ordered safe steps), alter_table_demo,
  transaction_timeline (BEGIN → COMMIT/ROLLBACK), index_visualizer.
Plus the universal elements (definition_card, comparison_table, common_mistake_box,
progressive_practice_set, quiz_check, recap_map, source_quote_highlight, …).

MODES for SQL:
  • PREBUILT (voice+point): ERD/schema overview, table relationships, comparison tables (e.g.
    Star vs Snowflake), source-page focus, normalization compare, recap — teacher points at each
    region/part while explaining in detail.
  • WRITING (voice+point+writing): writing a query clause by clause, drawing table relationships
    and JOIN bridges, building a result table row by row, walking a migration sequence, showing a
    buggy query and fixing it live.
  • BOTH: show the prebuilt ERD AND write/trace a query against it at the same time.
Board actions: drawTable, drawArrow, writeSQL, highlight, circle, underline, movePointer, zoomRegion.

ALWAYS: show the real ERD/schema region FIRST; walk each table & column before JOINs; dry-run
queries row by row; teach normalization as removing redundancy (concrete, not abstract); cover
NULL handling, BETWEEN off-by-one, GROUP BY/HAVING errors, cartesian-join mistakes. Give a real
student challenge (write a query answering a real question) with a worked answer. Never invent
table or column names — use exactly what is on the page.
"""
