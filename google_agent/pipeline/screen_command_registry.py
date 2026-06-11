"""
Universal screen and command registries for Lumina Stage 2.

These are capabilities only. Lesson content must still come from source
evidence, vision regions, and pedagogy planning.
"""

from __future__ import annotations

from typing import Dict, List


SCREEN_TYPE_REGISTRY: Dict[str, List[str]] = {
    "lesson_start": [
        "learning_objective", "success_criteria", "why_this_matters",
        "lesson_roadmap", "prior_knowledge_review", "starter_hook",
        "materials_source_list", "standards_alignment",
    ],
    "source_grounded": [
        "full_pdf_page", "pdf_crop_zoom", "exact_sentence_highlight",
        "table_row_col_highlight", "figure_region_zoom",
        "source_evidence_card", "source_quote_explanation",
        "source_to_board_redraw", "source_comparison",
        "source_misconception",
    ],
    "explanation": [
        "simple_explanation", "deep_explanation", "vocabulary_decode",
        "key_term_card", "definition_breakdown", "concept_meaning",
        "first_principles", "cause_effect", "step_by_step_reasoning",
        "analogy", "real_life_example", "teacher_note",
    ],
    "visual_model": [
        "concept_map", "flow_diagram", "process_diagram", "timeline",
        "tree_branch_diagram", "cycle_diagram", "relationship_graph",
        "before_after", "input_process_output", "system_architecture",
        "layered_explanation", "mental_model",
    ],
    "worked_example": [
        "worked_example_setup", "worked_example_step", "worked_example_final",
        "teacher_model", "guided_practice", "independent_practice",
        "similar_example", "challenge_example", "edge_case_example",
        "practice_check",
    ],
    "sql_db": [
        "schema_diagram", "table_relationship", "pk_fk",
        "join_bridge_animation", "sql_query_block", "query_dry_run",
        "result_table_build", "normalization_vs_denorm", "erd",
        "star_schema_fact_dimension",
    ],
    "programming": [
        "code_block", "line_by_line_dry_run", "variable_table",
        "stack_heap", "array_pointer", "recursion_tree", "loop_trace",
        "function_call_flow", "bug_explanation", "complexity",
    ],
    "math": [
        "formula_card", "symbol_meaning", "equation_derivation", "graph",
        "number_line", "geometry_diagram", "proof_step",
        "worked_calculation", "common_algebra_mistake",
        "final_formula_summary",
    ],
    "biology_science": [
        "real_figure_label", "process_flow", "structure_function",
        "cause_effect_bio", "experiment_setup", "observation_table",
        "hypothesis_result", "micro_to_macro", "compare_structures",
        "diagram_redraw",
    ],
    "finance_econ": [
        "formula_variable", "cashflow_timeline", "scenario_simulation",
        "risk_comparison", "chart_explanation", "table_analysis",
        "profit_loss_breakdown", "interest_return_calc",
        "decision_tradeoff", "forecast_assumption",
    ],
    "history_law": [
        "source_quote_zoom", "event_timeline", "cause_effect_map",
        "actor_relationship_map", "claim_evidence_reasoning",
        "case_fact", "rule_application", "compare_viewpoints",
        "argument_structure", "summary_judgment",
    ],
    "interaction": [
        "quick_question", "multiple_choice_quiz", "fill_in_blank",
        "spot_the_mistake", "match_the_pairs", "drag_order_steps",
        "mini_whiteboard", "confidence_check", "pause_and_think",
        "student_answer_reveal", "hint", "scaffolded_support",
        "challenge_mode",
    ],
    "mistake_repair": [
        "common_mistake", "wrong_vs_correct", "misconception_repair",
        "why_wrong_is_tempting", "error_trace", "fix_it_step",
        "alternative_explanation", "simpler_analogy_repair",
        "prerequisite_repair", "retry_checkpoint",
    ],
    "summary_book": [
        "key_takeaway", "one_minute_summary", "formula_definition_recap",
        "concept_map_recap", "what_became_clearer",
        "what_still_confusing", "follow_up_activity",
        "homework_practice", "lesson_book_page", "audio_book_chapter",
        "replay_bookmark", "source_reference_list",
    ],
    "mini_scene": [
        "tiny_mascot", "corner_decoration", "subject_icon",
        "soft_background_theme", "topic_mini_scene",
        "celebration_checkpoint", "progress_badge",
    ],
}


COMMAND_TYPE_REGISTRY: List[str] = [
    "movePointer", "circle", "underline", "highlight", "writeText",
    "drawArrow", "drawDiagram", "showPdfCrop", "zoomRegion",
    "askStudent", "revealAnswer", "saveBookPage",
]


DOMAIN_TO_SCREEN_FAMILIES: Dict[str, List[str]] = {
    "sql": ["source_grounded", "explanation", "visual_model", "worked_example", "sql_db", "interaction", "mistake_repair", "summary_book"],
    "database": ["source_grounded", "explanation", "visual_model", "worked_example", "sql_db", "interaction", "mistake_repair", "summary_book"],
    "programming": ["source_grounded", "explanation", "visual_model", "worked_example", "programming", "interaction", "mistake_repair", "summary_book"],
    "math": ["source_grounded", "explanation", "visual_model", "worked_example", "math", "interaction", "mistake_repair", "summary_book"],
    "biology": ["source_grounded", "explanation", "visual_model", "worked_example", "biology_science", "interaction", "mistake_repair", "summary_book"],
    "science": ["source_grounded", "explanation", "visual_model", "worked_example", "biology_science", "interaction", "mistake_repair", "summary_book"],
    "finance": ["source_grounded", "explanation", "visual_model", "worked_example", "finance_econ", "interaction", "mistake_repair", "summary_book"],
    "history": ["source_grounded", "explanation", "visual_model", "worked_example", "history_law", "interaction", "mistake_repair", "summary_book"],
    "law": ["source_grounded", "explanation", "visual_model", "worked_example", "history_law", "interaction", "mistake_repair", "summary_book"],
    "general": ["source_grounded", "explanation", "visual_model", "worked_example", "interaction", "mistake_repair", "summary_book"],
}


def all_screen_types() -> List[str]:
    values: List[str] = []
    for items in SCREEN_TYPE_REGISTRY.values():
        values.extend(items)
    return values


def screen_families_for_domain(domain: str) -> List[str]:
    key = (domain or "general").strip().lower()
    return DOMAIN_TO_SCREEN_FAMILIES.get(key, DOMAIN_TO_SCREEN_FAMILIES["general"])


def screen_types_for_domain(domain: str) -> List[str]:
    types: List[str] = []
    for family in screen_families_for_domain(domain):
        types.extend(SCREEN_TYPE_REGISTRY.get(family, []))
    return types

