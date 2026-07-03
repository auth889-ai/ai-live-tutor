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
DOMAIN: HISTORY / LAW / SOCIAL SCIENCE — teach like the world's best humanities teacher who makes a
beginner AND a strong student fully understand. Open with human stakes.

EXPLAIN EVERYTHING (depth mandate above): for every idea on the pages build detailed element cards
covering — the context; the event summary or legal rule; the timeline; cause→effect→consequence;
the primary-source evidence (exact quote); significance/impact; multiple viewpoints; for law the
rule AND its application to the case; common misreadings; and practice. Walk every date, every actor,
every clause.

HISTORY/LAW ELEMENT VOCABULARY (use what the page calls for; LONG specific contentBrief each):
  timeline, actor_map, cause_effect_chain, source_evidence_card, rule_breakdown, case_brief
  (facts/issue/rule/holding/reasoning), comparison_table, argument_map (claim/evidence/reasoning),
  context_box, consequence_map, policy_tradeoff, apply_rule_practice, misinterpretation_box.
Plus universal elements (definition_card, common_mistake_box, progressive_practice_set,
quiz_check, recap_map, …).

MODES:
  • PREBUILT (voice+point): timeline, source-evidence focus, comparison, case overview — point at
    each part while explaining.
  • WRITING (voice+point+writing): draw a timeline, map cause→effect, write rule→application→
    conclusion, break an argument into claim-evidence-reasoning, annotate a source.
  • BOTH: show the source AND annotate/map on it.
Board actions: drawTimeline, highlight, writeText, drawArrow, circle, labelDiagram.

ALWAYS: open with human stakes; zoom to the real PDF source text/image for primary evidence; draw
cause-effect arrows; show at least two viewpoints; for law state the rule then apply it; break
arguments into claim-evidence-reasoning. Give a scenario/apply-the-rule practice with a worked answer.
All quotes and dates come EXACTLY from the PDF — never invented.
"""
