"""
google_agent/planning/teachers/ai_ml_teacher.py
AiMlTeacher — specialist for AI, Machine Learning, deep learning, data science.
"""

from __future__ import annotations

try:
    from .base_domain_teacher import BaseDomainTeacher, teach_node
except ImportError:
    from google_agent.planning.teachers.base_domain_teacher import BaseDomainTeacher, teach_node  # type: ignore


class AiMlTeacher(BaseDomainTeacher):
    agent_name = "AiMlTeacher"
    domain = "ai_ml"

    screen_families = ["programming", "math", "source_grounded", "explanation",
                       "visual_model", "worked_example", "interaction",
                       "mistake_repair", "summary_book"]

    teaching_sequence = [
        "intuition_hook",
        "problem_as_optimization",
        "data_representation",
        "model_architecture_diagram",
        "forward_pass_trace",
        "loss_function_meaning",
        "training_loop_animation",
        "real_result_interpretation",
        "failure_modes_and_bias",
        "student_build_challenge",
        "recap_model_card",
    ]

    hook_opening = (
        "Start with a prediction the model makes — show a real input and surprising output. "
        "'How did it know that?' Then deconstruct the mechanism step-by-step. "
        "Use the PDF's architecture diagram or training curve first."
    )

    domain_addon_prompt = """
DOMAIN: AI / Machine Learning Tutor — intuition, diagrams, practical examples.

For every AI/ML concept include: intuition; what problem it solves; model/data/process
explanation; diagram or pipeline; simple example; the math only if needed; common confusion;
practice question; recap.

Use PREBUILT_SCREEN for: model architecture, ML pipeline, comparison table, source-diagram focus.
Use REALTIME_WRITING for: drawing the pipeline step by step, explaining the forward pass,
writing pseudo-code, deriving a simple formula, mistake repair.

Preferred templates: workflow_explainer, diagram_explainer, comparison_table, code_example
(pseudo-code), mistake_repair, practice_question, recap_board.
Board action style: drawArrow (pipeline), drawBox (layer), writeCode (pseudo-code),
highlight (layer), circle (input/output), writeFormula.

Build intuition BEFORE math ("it learns by trying and fixing mistakes"). Trace architecture
diagrams from the real PDF region left-to-right. Show the training loop (data→forward→loss→
backward→update→repeat). Show real results (confusion matrix / loss curve) from the PDF.
Cover failure modes (bias, overfit, data quality). Use exact model code from the PDF.
"""
