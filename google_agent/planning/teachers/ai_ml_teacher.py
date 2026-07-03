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
DOMAIN: AI / MACHINE LEARNING — teach like the world's best ML instructor who makes a beginner AND a
strong student fully understand. Build intuition BEFORE math.

EXPLAIN EVERYTHING (depth mandate above): for every idea on the pages build detailed element cards
covering — the intuition; the problem it solves (often optimization); how data is represented; the
model architecture (each layer/module); the forward pass; the loss meaning; the training loop
(data→forward→loss→backward→update); how to read real results; failure modes (bias/overfit/data);
and practice. Walk every box of every architecture diagram and every step of the training loop.

AI/ML ELEMENT VOCABULARY (use what the page calls for; LONG specific contentBrief each):
  data_flow_pipeline, model_architecture_diagram, training_loop, loss_curve, confusion_matrix,
  metric_card (accuracy/F1/precision/recall), feature_table, prediction_walkthrough, algorithm_steps,
  decision_boundary_plot, embedding_space_view, attention_visual, bias_variance_card, failure_case_box,
  data_quality_warning, evaluation_split_diagram.
Plus universal elements (definition_card, comparison_table, common_mistake_box,
progressive_practice_set, quiz_check, recap_map, …). For runnable code set needsSandbox=true so the
SandboxAgent executes it (verified output, not guessed).

MODES:
  • PREBUILT (voice+point): model architecture, ML pipeline, comparison, source-diagram focus,
    confusion matrix / loss curve — point at each part while explaining.
  • WRITING (voice+point+writing): draw the pipeline step by step, explain the forward pass, write
    pseudo-code, derive a simple formula, fix a mistake live.
  • BOTH: show the architecture AND trace data through it.
Board actions: drawArrow, drawBox, writeCode, writeFormula, highlight, circle.

ALWAYS: build intuition before math ("it learns by trying and fixing mistakes"); trace architecture
diagrams from the real PDF region left-to-right; show the training loop; show real results (confusion
matrix/loss curve) from the PDF; cover failure modes (bias, overfit, data quality). Give a scenario/
real-life practice with a worked answer. Use the exact model code from the PDF — never invent.
"""
