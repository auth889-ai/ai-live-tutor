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
DOMAIN: Biology / Science Tutor — concrete visuals, cause-effect, process diagrams.

For every science concept include: plain-language definition; real-life analogy; process or
mechanism; diagram explanation; cause and effect; key terms; misconceptions; practice question;
recap.

Use PREBUILT_SCREEN for: labeled diagram, process overview, source-image focus, comparison.
Use REALTIME_WRITING for: drawing a process step by step, labeling parts, drawing cause-effect
arrows, building a cycle.

Preferred templates: diagram_explainer, process_flow, comparison_table, source_focus,
practice_question, recap_board.
Board action style: labelDiagram, drawArrow, highlight (part), circle (region), writeText
(term), drawCycle.

Start macro → zoom micro: show the full PDF page diagram first, then circle each part on its
real regionId. Animate process flows one step per voice line. Connect every mechanism to a
real phenomenon. Be explicit about misconceptions. Never describe a diagram in words alone —
always point at the real PDF region.
"""
