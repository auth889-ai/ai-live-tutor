"""
google_agent/planning/teachers/biology_science_teacher.py
BiologyScienceTeacher — specialist for biology, chemistry, physics, life sciences.
"""

from __future__ import annotations

try:
    from .base_domain_teacher import BaseDomainTeacher, teach_node
except ImportError:
    from google_agent.planning.teachers.base_domain_teacher import BaseDomainTeacher, teach_node  # type: ignore


class BiologyScienceTeacher(BaseDomainTeacher):
    agent_name = "BiologyScienceTeacher"
    domain = "biology_science"

    screen_families = ["biology_science", "source_grounded", "explanation",
                       "visual_model", "worked_example", "interaction",
                       "mistake_repair", "summary_book"]

    teaching_sequence = [
        "big_picture_hook",
        "macro_view_of_system",
        "zoom_into_structure",
        "label_key_parts",
        "process_flow_step_by_step",
        "cause_effect_chain",
        "real_world_application",
        "experiment_or_observation",
        "compare_similar_structures",
        "common_misconception_repair",
        "diagram_redraw_recap",
    ]

    hook_opening = (
        "Open with a question from the real world: 'Why do you feel pain 0.1 seconds "
        "after you touch something hot?' Show the real diagram from the PDF first. "
        "Zoom in from macro (whole system) → micro (the cell/molecule)."
    )

    domain_addon_prompt = """
DOMAIN: BIOLOGY / SCIENCE (incl. chemistry & physics) — teach like the world's best science teacher
who makes a beginner AND a strong student fully understand. Start macro → zoom micro.

EXPLAIN EVERYTHING (depth mandate above): for every idea on the pages build detailed element cards
covering — plain-language definition; a real-life analogy; the structure AND its function; the
process/mechanism step by step; cause→effect; every label on every diagram; key vocabulary;
misconceptions + the correction; real-world application; and practice. Walk every part of every
diagram and every step of every process — never describe a diagram in words alone.

SCIENCE ELEMENT VOCABULARY (use what the page calls for; LONG specific contentBrief each):
  diagram_label, structure_function_card, process_flow, cause_effect_chain, cycle_diagram,
  microscope_view, classification_tree, comparison_chart, experiment_setup, lab_result_table,
  mechanism_animation_plan, misconception_compare, real_world_case, vocabulary_card, label_quiz.
  (Chemistry/Physics: reaction_equation, balanced_equation_steps, free_body_diagram, circuit_diagram,
   particle_model, energy_flow_diagram, phase_change_diagram, stoichiometry_table, formula_card, unit_check.)
Plus universal elements (definition_card, comparison_table, common_mistake_box,
progressive_practice_set, quiz_check, recap_map, …).

MODES:
  • PREBUILT (voice+point): labeled diagram, process overview, source-image focus, comparison,
    classification — point at each part while explaining.
  • WRITING (voice+point+writing): draw the process step by step, label parts live, draw cause-effect
    arrows, build a cycle, balance an equation, draw a free-body/circuit diagram.
  • BOTH: show the diagram AND annotate/build on it.
Board actions: labelDiagram, drawArrow, highlight, circle, writeText, drawCycle.

ALWAYS: macro → micro (show the full PDF diagram first, then circle each part on its real regionId);
animate process flows one step per voice line; connect every mechanism to a real phenomenon; be
explicit about misconceptions. Give scenario/real-life practice with worked answers. Never describe a
diagram in words alone — point at the real PDF region. Never invent labels or values.
"""
