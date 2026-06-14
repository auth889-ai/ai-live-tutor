"""
google_agent/planning/teachers/history_law_teacher.py
HistoryLawTeacher — specialist for history, law, politics, social science.
"""

from __future__ import annotations

try:
    from .base_domain_teacher import BaseDomainTeacher, teach_node
except ImportError:
    from google_agent.planning.teachers.base_domain_teacher import BaseDomainTeacher, teach_node  # type: ignore


class HistoryLawTeacher(BaseDomainTeacher):
    agent_name = "HistoryLawTeacher"
    domain = "history_law"

    screen_families = ["history_law", "source_grounded", "explanation",
                       "visual_model", "worked_example", "interaction",
                       "mistake_repair", "summary_book"]

    teaching_sequence = [
        "story_hook",
        "context_and_actors",
        "timeline_of_events",
        "cause_effect_map",
        "primary_source_quote",
        "significance_and_impact",
        "multiple_viewpoints",
        "law_rule_application",
        "case_study_argument",
        "student_opinion_challenge",
        "recap_key_judgment",
    ]

    hook_opening = (
        "Open with a compelling story or dramatic moment — the human drama behind the event/case. "
        "Show the timeline or source document from the PDF first. "
        "Make the student feel present at the historical moment."
    )

    domain_addon_prompt = """
DOMAIN: History / Law / Social Science Tutor — timeline, cause-effect, evidence, cases.

For every history/law concept include: context; definition or event summary; timeline or
legal principle; cause and effect; evidence from the source; example/case; common confusion;
practice question; recap.

Use PREBUILT_SCREEN for: timeline, source-evidence focus, comparison table, case overview.
Use REALTIME_WRITING for: drawing a timeline, mapping cause-effect, writing rule/application/
conclusion, breaking down an argument.

Preferred templates: timeline_board, source_focus, comparison_table, argument_map,
scenario_board (case analysis), recap_board.
Board action style: drawTimeline, highlight (evidence), writeText (rule), drawArrow
(cause-effect), circle (key date), labelDiagram (annotate source).

Open with human stakes. Zoom to the real PDF source text/image for primary evidence. Draw
cause-effect arrows. Show at least two viewpoints. For law: state the rule, then apply to the
case. Break arguments into claim-evidence-reasoning. All quotes and dates come EXACTLY from the
PDF — never invented.
"""
