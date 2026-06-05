"""
google_agent/live_tutor_agents/live/interaction_agent.py
===============================================================================
Interaction Agent.

Separate strong agent responsibility:
- Track live tutor playback/session state.
- Decide whether user input is interrupt, answer, follow-up, pause, resume, quiz.
- Preserve board position and visible command IDs.
- Prepare interaction event for InterruptAgent / RepairConfusionAgent.
- No fake fallback.
===============================================================================
"""

from __future__ import annotations

from typing import List

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
    AgentContext,
    JsonDict,
    ValidationResult,
    clean_text,
    make_id,
    safe_dict,
    safe_list,
)


INTENTS = {
    "interrupt_question",
    "pause",
    "resume",
    "repeat",
    "explain_simpler",
    "show_example",
    "draw_more",
    "quiz_answer",
    "quiz_request",
    "continue",
    "unknown",
}


def classify_intent(text: str, explicit: str = "") -> str:
    explicit = clean_text(explicit, 80)
    if explicit in INTENTS:
        return explicit

    lower = clean_text(text, 1600).lower()
    if not lower:
        return "unknown"

    if any(x in lower for x in ["pause", "stop", "wait", "hold on", "থাম", "রোকো"]):
        return "pause"
    if any(x in lower for x in ["resume", "continue", "go on", "next", "চালাও"]):
        return "resume"
    if any(x in lower for x in ["repeat", "again", "say again", "আরেকবার"]):
        return "repeat"
    if any(x in lower for x in ["simpler", "simple", "easy", "সহজ", "বুঝিনি"]):
        return "explain_simpler"
    if any(x in lower for x in ["example", "উদাহরণ"]):
        return "show_example"
    if any(x in lower for x in ["draw", "diagram", "flowchart", "tree", "table", "চিত্র"]):
        return "draw_more"
    if any(x in lower for x in ["quiz me", "test me", "question me"]):
        return "quiz_request"
    if "?" in lower or any(x in lower for x in ["why", "how", "what", "explain", "মানে", "কেন", "কিভাবে"]):
        return "interrupt_question"

    return "unknown"


class InteractionAgent(BaseLiveTutorAgent):
    agent_name = "InteractionAgent"
    agent_group = "live"
    default_mode = "handle_interaction"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Interaction Agent:
Classify live user interactions and preserve session/board state.
No fake fallback.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        if not safe_dict(payload.get("sessionState")) and not safe_dict(payload.get("boardState")):
            errors.append("InteractionAgent requires sessionState or boardState.")
        if not clean_text(payload.get("userInput") or payload.get("question") or payload.get("intent")):
            errors.append("InteractionAgent requires userInput/question/intent.")
        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="InteractionAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        session_state = safe_dict(payload.get("sessionState"))
        board_state = safe_dict(payload.get("boardState") or payload.get("board"))
        user_input = clean_text(payload.get("userInput") or payload.get("question") or "", 1600)
        intent = classify_intent(user_input, clean_text(payload.get("intent") or "", 80))

        current_scene_id = clean_text(
            session_state.get("currentSceneId")
            or board_state.get("currentSceneId")
            or board_state.get("selectedSceneId")
            or "",
            120,
        )
        current_command_index = int(
            session_state.get("currentCommandIndex")
            if session_state.get("currentCommandIndex") is not None
            else board_state.get("currentCommandIndex") or 0
        )
        visible_command_ids = [
            clean_text(x, 120)
            for x in safe_list(session_state.get("visibleCommandIds") or board_state.get("visibleCommandIds"))
            if clean_text(x, 120)
        ]

        should_pause = intent in {
            "interrupt_question",
            "pause",
            "repeat",
            "explain_simpler",
            "show_example",
            "draw_more",
            "quiz_request",
        }
        needs_repair = intent in {
            "interrupt_question",
            "explain_simpler",
            "show_example",
            "draw_more",
            "repeat",
        }

        interaction_event = {
            "interactionId": make_id("interaction"),
            "intent": intent,
            "userInput": user_input,
            "shouldPause": should_pause,
            "needsRepair": needs_repair,
            "needsQuizEvaluation": intent == "quiz_answer",
            "needsResume": intent in {"resume", "continue"},
            "capturedState": {
                "currentSceneId": current_scene_id,
                "currentCommandIndex": current_command_index,
                "visibleCommandIds": visible_command_ids,
                "selectedNodeId": clean_text(board_state.get("selectedNodeId") or session_state.get("selectedNodeId") or "", 120),
                "boardId": clean_text(board_state.get("boardId") or session_state.get("boardId") or "", 160),
                "treeId": clean_text(board_state.get("treeId") or session_state.get("treeId") or "", 160),
            },
            "routing": {
                "sendToInterruptAgent": should_pause,
                "sendToRepairConfusionAgent": needs_repair,
                "sendToAssessmentQuizAgent": intent in {"quiz_answer", "quiz_request"},
                "resumeWithoutRepair": intent in {"resume", "continue"},
            },
        }

        return {
            "interactionEvent": interaction_event,
            "sessionPatch": {
                "paused": should_pause,
                "lastInteractionId": interaction_event["interactionId"],
                "currentSceneId": current_scene_id,
                "currentCommandIndex": current_command_index,
                "visibleCommandIds": visible_command_ids,
            },
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "interruptReady": should_pause,
                "repairReady": needs_repair,
                "resumeStatePreserved": True,
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return raw

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        event = safe_dict(output.get("interactionEvent"))
        captured = safe_dict(event.get("capturedState"))

        if not clean_text(event.get("interactionId")):
            errors.append("interactionEvent.interactionId is required.")
        if event.get("intent") not in INTENTS:
            errors.append(f"interactionEvent.intent invalid: {event.get('intent')}")
        if "currentCommandIndex" not in captured:
            errors.append("capturedState.currentCommandIndex is required.")
        if event.get("shouldPause") and not safe_dict(event.get("routing")).get("sendToInterruptAgent"):
            warnings.append("shouldPause=true but sendToInterruptAgent is false.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="InteractionAgent.validate_output",
            fallbackUsed=False,
        )