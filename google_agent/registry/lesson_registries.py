"""
google_agent/registry/lesson_registries.py
===============================================================================
UNIVERSAL REGISTRIES — POWERFUL_WORKFLOW Golden Rule #10:
  Hardcode SCREEN TYPES (capabilities). NEVER hardcode lesson content.
  Domain + source + student decides what fills each screen.

154 screen types (categories A-J) + 12 board command types.
Planners SELECT from these registries; Gemini FILLS the selection with
real content from the SourceTruthPacket. Content is always dynamic.
===============================================================================
"""

from __future__ import annotations

from typing import Dict, List

# ═══════════════════════════════════════════════════════════════════
# SCREEN TYPE REGISTRY (154 types, categories A-J)
# ═══════════════════════════════════════════════════════════════════

SCREEN_REGISTRY: Dict[str, List[str]] = {
    # A — LESSON START / PLANNING (8)
    "lesson_start": [
        "learning_objective", "success_criteria", "why_this_matters",
        "lesson_roadmap", "prior_knowledge_review", "starter_hook",
        "materials_source_list", "standards_alignment",
    ],
    # B — SOURCE-GROUNDED (10) — real PDF imagery ONLY, never generated
    "source_grounded": [
        "full_pdf_page", "pdf_crop_zoom", "exact_sentence_highlight",
        "table_row_col_highlight", "figure_region_zoom", "source_evidence_card",
        "source_quote_explanation", "source_to_board_redraw",
        "source_comparison", "source_misconception",
    ],
    # C — EXPLANATION (12)
    "explanation": [
        "simple_explanation", "deep_explanation", "vocabulary_decode",
        "key_term_card", "definition_breakdown", "concept_meaning",
        "first_principles", "cause_effect", "step_by_step_reasoning",
        "analogy", "real_life_example", "teacher_note",
    ],
    # D — VISUAL MODEL (12)
    "visual_model": [
        "concept_map", "flow_diagram", "process_diagram", "timeline",
        "tree_branch_diagram", "cycle_diagram", "relationship_graph",
        "before_after", "input_process_output", "system_architecture",
        "layered_explanation", "mental_model",
    ],
    # E — WORKED EXAMPLE (10) — Model → Together → Alone → Check → Repair
    "worked_example": [
        "worked_example_setup", "worked_example_step", "worked_example_final",
        "teacher_model", "guided_practice", "independent_practice",
        "similar_example", "challenge_example", "edge_case_example",
        "practice_check",
    ],
    # F — SUBJECT-SPECIFIC (60)
    "sql_database": [
        "schema_diagram", "table_relationship", "pk_fk",
        "join_bridge_animation", "sql_query_block", "query_dry_run",
        "result_table_build", "normalization_vs_denorm", "erd",
        "star_schema_fact_dimension",
    ],
    "programming": [
        "code_block", "line_by_line_dry_run", "variable_table", "stack_heap",
        "array_pointer", "recursion_tree", "loop_trace", "function_call_flow",
        "bug_explanation", "complexity",
    ],
    "math": [
        "formula_card", "symbol_meaning", "equation_derivation", "graph",
        "number_line", "geometry_diagram", "proof_step", "worked_calculation",
        "common_algebra_mistake", "final_formula_summary",
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
        "profit_loss_breakdown", "interest_return_calc", "decision_tradeoff",
        "forecast_assumption",
    ],
    "history_law": [
        "source_quote_zoom", "event_timeline", "cause_effect_map",
        "actor_relationship_map", "claim_evidence_reasoning", "case_fact",
        "rule_application", "compare_viewpoints", "argument_structure",
        "summary_judgment",
    ],
    # G — INTERACTION / ENGAGEMENT (13)
    "interaction": [
        "quick_question", "multiple_choice_quiz", "fill_in_blank",
        "spot_the_mistake", "match_the_pairs", "drag_order_steps",
        "mini_whiteboard", "confidence_check", "pause_and_think",
        "student_answer_reveal", "hint", "scaffolded_support", "challenge_mode",
    ],
    # H — MISTAKE / REPAIR (10)
    "mistake_repair": [
        "common_mistake", "wrong_vs_correct", "misconception_repair",
        "why_wrong_is_tempting", "error_trace", "fix_it_step",
        "alternative_explanation", "simpler_analogy_repair",
        "prerequisite_repair", "retry_checkpoint",
    ],
    # I — SUMMARY / LESSON BOOK (12)
    "summary_book": [
        "key_takeaway", "one_minute_summary", "formula_definition_recap",
        "concept_map_recap", "what_became_clearer", "what_still_confusing",
        "follow_up_activity", "homework_practice", "lesson_book_page",
        "audio_book_chapter", "replay_bookmark", "source_reference_list",
    ],
    # J — MINI-SCENE / DECORATION (7) — beauty only, NEVER content
    "decoration": [
        "tiny_mascot", "corner_decoration", "subject_icon",
        "soft_background_theme", "topic_mini_scene",
        "celebration_checkpoint", "progress_badge",
    ],
}

# Domain → which F-category (plus always-available universal categories)
DOMAIN_SCREEN_FAMILIES: Dict[str, str] = {
    "sql": "sql_database",
    "database": "sql_database",
    "sql_database": "sql_database",
    "programming": "programming",
    "code": "programming",
    "math": "math",
    "physics": "math",
    "biology": "biology_science",
    "science": "biology_science",
    "biology_science": "biology_science",
    "finance": "finance_econ",
    "economics": "finance_econ",
    "finance_econ": "finance_econ",
    "history": "history_law",
    "law": "history_law",
    "history_law": "history_law",
    "general": "explanation",  # no subject family → lean on universal
}

UNIVERSAL_CATEGORIES = [
    "lesson_start", "source_grounded", "explanation", "visual_model",
    "worked_example", "interaction", "mistake_repair", "summary_book",
    "decoration",
]

# Decoration themes per domain (Golden Rule: topic-matched, never fake imagery)
DOMAIN_DECO_THEMES: Dict[str, str] = {
    "sql_database": "database_table_icons",
    "programming": "terminal_code_icons",
    "math": "compass_graph_icons",
    "biology_science": "leaf_cell_icons",
    "finance_econ": "coin_chart_icons",
    "history_law": "scroll_timeline_icons",
    "general": "soft_neutral_theme",
}


# ═══════════════════════════════════════════════════════════════════
# BOARD COMMAND TYPE REGISTRY (12)
# ═══════════════════════════════════════════════════════════════════

COMMAND_REGISTRY: Dict[str, str] = {
    "movePointer": "animate pointer to bbox",
    "circle": "draw circle around bbox region",
    "underline": "underline text at bbox",
    "highlight": "translucent highlight over bbox",
    "writeText": "write text character-by-character at position",
    "drawArrow": "animated arrow from A to B",
    "drawDiagram": "progressively draw a diagram",
    "showPdfCrop": "display real cropped PDF region (Sharp crop)",
    "zoomRegion": "zoom into a bbox region of real page image",
    "askStudent": "pause, pose question, wait/timer",
    "revealAnswer": "reveal the answer with explanation",
    "saveBookPage": "snapshot screen+audio into lesson book",
}

COMMAND_TYPES: List[str] = list(COMMAND_REGISTRY.keys())

# Typical commands per screen category (guides BoardCommandAgent prompts;
# actual selection is always dynamic per content)
CATEGORY_COMMAND_HINTS: Dict[str, List[str]] = {
    "source_grounded": ["showPdfCrop", "zoomRegion", "movePointer", "circle", "highlight"],
    "explanation": ["writeText", "underline", "movePointer", "highlight"],
    "visual_model": ["drawDiagram", "drawArrow", "movePointer", "circle"],
    "worked_example": ["writeText", "drawArrow", "movePointer", "askStudent"],
    "interaction": ["askStudent", "revealAnswer", "highlight"],
    "mistake_repair": ["highlight", "writeText", "drawArrow", "revealAnswer"],
    "summary_book": ["writeText", "saveBookPage", "movePointer"],
    "lesson_start": ["writeText", "movePointer", "highlight"],
    "decoration": [],
}


# ═══════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════

def all_screen_types() -> List[str]:
    """Flat list of every screen type across all categories."""
    seen: List[str] = []
    for types in SCREEN_REGISTRY.values():
        for t in types:
            if t not in seen:
                seen.append(t)
    return seen


def screen_types_for_domain(domain: str) -> List[str]:
    """Universal categories + the domain's subject family."""
    types: List[str] = []
    for cat in UNIVERSAL_CATEGORIES:
        types.extend(SCREEN_REGISTRY[cat])
    family = DOMAIN_SCREEN_FAMILIES.get((domain or "general").lower().strip(), "explanation")
    if family in SCREEN_REGISTRY:
        for t in SCREEN_REGISTRY[family]:
            if t not in types:
                types.append(t)
    return types


def is_valid_screen_type(screen_type: str) -> bool:
    return screen_type in all_screen_types()


def is_valid_command_type(command_type: str) -> bool:
    return command_type in COMMAND_REGISTRY


def category_of(screen_type: str) -> str:
    for cat, types in SCREEN_REGISTRY.items():
        if screen_type in types:
            return cat
    return ""
