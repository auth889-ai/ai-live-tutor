"""
google_agent/live_tutor_agents/live/interrupt_agent.py
===============================================================================
Interrupt Agent.

Separate strong agent responsibility:
- Convert a live student interruption into a repair-ready interrupt packet.
- Preserve exact playback state:
  currentSceneId, currentCommandIndex, visibleCommandIds, boardId, treeId.
- Decide if the tutor should pause, repair, answer, quiz, repeat, or continue.
- Prepare payload for RepairConfusionAgent without losing board state.
- No fake fallback.

Input:
  userInput/question/intent
  sessionState
  boardState
  selectedNode/segment/explanation optional

Output:
  interruptPacket, repairRequest, sessionPatch, resumeAnchor
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


INTERRUPT_TYPES = {
    "confusion",
    "clarification",
    "example_request",
    "draw_request",
    "repeat_request",
    "pause_request",
    "quiz_request",
    "answer_attempt",
    "resume_request",
    "unknown",
}


def classify_interrupt(user_text: str, explicit_intent: str = "") -> str:
    explicit = clean_text(explicit_intent, 80)
    if explicit in INTERRUPT_TYPES:
        return explicit

    text = clean_text(user_text, 2000).lower()

    if not text:
        return "unknown"

    if any(x in text for x in ["pause", "stop", "wait", "hold on", "থাম", "রোকো", "একটু দাঁড়াও"]):
        return "pause_request"

    if any(x in text for x in ["continue", "resume", "go on", "next", "চালাও", "পরেরটা"]):
        return "resume_request"

    if any(x in text for x in ["repeat", "again", "say again", "আরেকবার", "পুনরায়"]):
        return "repeat_request"

    if any(x in text for x in ["example", "উদাহরণ", "sample"]):
        return "example_request"

    if any(x in text for x in ["draw", "diagram", "flowchart", "tree", "table", "চিত্র", "ডায়াগ্রাম"]):
        return "draw_request"

    if any(x in text for x in ["quiz", "test me", "question me", "প্রশ্ন কর"]):
        return "quiz_request"

    if any(x in text for x in ["i think", "answer is", "my answer", "উত্তর", "আমার মনে হয়"]):
        return "answer_attempt"

    if any(x in text for x in ["simpler", "simple", "easy", "সহজ", "বুঝিনি", "confused", "don't understand"]):
        return "confusion"

    if "?" in text or any(x in text for x in ["why", "how", "what", "explain", "মানে", "কেন", "কিভাবে"]):
        return "clarification"

    return "unknown"


def urgency_for_interrupt(interrupt_type: str) -> str:
    if interrupt_type in {"pause_request", "confusion", "clarification"}:
        return "high"
    if interrupt_type in {"example_request", "draw_request", "repeat_request", "quiz_request"}:
        return "medium"
    return "low"


class InterruptAgent(BaseLiveTutorAgent):
    agent_name = "InterruptAgent"
    agent_group = "live"
    default_mode = "handle_interrupt"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Interrupt Agent:
Capture student interruption, pause state, and create a repair-ready packet.
No fake fallback.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []

        if not clean_text(payload.get("userInput") or payload.get("question") or payload.get("intent")):
            errors.append("InterruptAgent requires userInput/question/intent.")

        if not safe_dict(payload.get("sessionState")) and not safe_dict(payload.get("boardState") or payload.get("board")):
            errors.append("InterruptAgent requires sessionState or boardState.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="InterruptAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        session_state = safe_dict(payload.get("sessionState"))
        board_state = safe_dict(payload.get("boardState") or payload.get("board"))
        user_input = clean_text(payload.get("userInput") or payload.get("question") or "", 2000)
        explicit_intent = clean_text(payload.get("intent") or "", 80)

        interrupt_type = classify_interrupt(user_input, explicit_intent)
        urgency = urgency_for_interrupt(interrupt_type)

        current_scene_id = clean_text(
            session_state.get("currentSceneId")
            or board_state.get("currentSceneId")
            or board_state.get("selectedSceneId")
            or "",
            160,
        )
        current_command_index = int(
            session_state.get("currentCommandIndex")
            if session_state.get("currentCommandIndex") is not None
            else board_state.get("currentCommandIndex") or 0
        )

        visible_command_ids = [
            clean_text(x, 160)
            for x in safe_list(session_state.get("visibleCommandIds") or board_state.get("visibleCommandIds"))
            if clean_text(x, 160)
        ]

        completed_command_ids = [
            clean_text(x, 160)
            for x in safe_list(session_state.get("completedCommandIds") or board_state.get("completedCommandIds"))
            if clean_text(x, 160)
        ]

        selected_node_id = clean_text(
            board_state.get("selectedNodeId")
            or session_state.get("selectedNodeId")
            or safe_dict(payload.get("selectedNode") or payload.get("node")).get("nodeId")
            or "",
            160,
        )

        should_pause = interrupt_type not in {"resume_request"}
        needs_repair = interrupt_type in {
            "confusion",
            "clarification",
            "example_request",
            "draw_request",
            "repeat_request",
        }

        interrupt_id = make_id("interrupt")

        resume_anchor = {
            "pausedAtSceneId": current_scene_id,
            "pausedAtCommandIndex": current_command_index,
            "visibleCommandIds": visible_command_ids,
            "completedCommandIds": completed_command_ids,
            "selectedNodeId": selected_node_id,
            "boardId": clean_text(board_state.get("boardId") or session_state.get("boardId") or "", 220),
            "treeId": clean_text(board_state.get("treeId") or session_state.get("treeId") or "", 220),
            "resourceId": clean_text(
                board_state.get("resourceId")
                or session_state.get("resourceId")
                or context.resourceId
                or "",
                220,
            ),
        }

        interrupt_packet = {
            "interruptId": interrupt_id,
            "interruptType": interrupt_type,
            "urgency": urgency,
            "userInput": user_input,
            "shouldPause": should_pause,
            "needsRepair": needs_repair,
            "needsQuizEvaluation": interrupt_type == "answer_attempt",
            "needsQuizGeneration": interrupt_type == "quiz_request",
            "resumeAnchor": resume_anchor,
            "routing": {
                "sendToRepairConfusionAgent": needs_repair,
                "sendToAssessmentQuizAgent": interrupt_type in {"answer_attempt", "quiz_request"},
                "resumeDirectly": interrupt_type == "resume_request",
                "pauseOnly": interrupt_type == "pause_request",
            },
        }

        repair_request = {
            "interruptId": interrupt_id,
            "question": user_input,
            "confusion": user_input,
            "sessionState": {
                "currentSceneId": current_scene_id,
                "currentCommandIndex": current_command_index,
                "visibleCommandIds": visible_command_ids,
                "completedCommandIds": completed_command_ids,
                "selectedNodeId": selected_node_id,
            },
            "boardState": board_state,
            "resumeState": resume_anchor,
            "selectedNode": safe_dict(payload.get("selectedNode") or payload.get("node")),
            "segment": safe_dict(payload.get("segment") or payload.get("segmentPlan")),
            "explanation": safe_dict(payload.get("explanation")),
            "sourceRefs": safe_list(payload.get("sourceRefs")),
            "chunks": safe_list(payload.get("chunks")),
        }

        return {
            "interruptPacket": interrupt_packet,
            "repairRequest": repair_request,
            "sessionPatch": {
                "paused": should_pause,
                "pauseReason": interrupt_type,
                "lastInterruptId": interrupt_id,
                "currentSceneId": current_scene_id,
                "currentCommandIndex": current_command_index,
                "visibleCommandIds": visible_command_ids,
                "selectedNodeId": selected_node_id,
            },
            "resumeAnchor": resume_anchor,
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "interruptSafe": True,
                "resumePreserved": True,
                "repairReady": needs_repair,
            },
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return raw

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        packet = safe_dict(output.get("interruptPacket"))
        anchor = safe_dict(output.get("resumeAnchor"))
        repair_request = safe_dict(output.get("repairRequest"))

        if not clean_text(packet.get("interruptId")):
            errors.append("interruptPacket.interruptId is required.")

        if packet.get("interruptType") not in INTERRUPT_TYPES:
            errors.append(f"interruptPacket.interruptType invalid: {packet.get('interruptType')}")

        if "pausedAtCommandIndex" not in anchor:
            errors.append("resumeAnchor.pausedAtCommandIndex is required.")

        if packet.get("needsRepair") and not repair_request:
            errors.append("repairRequest is required when needsRepair=true.")

        if packet.get("shouldPause") and not safe_dict(output.get("sessionPatch")).get("paused"):
            warnings.append("shouldPause=true but sessionPatch.paused is not true.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="InterruptAgent.validate_output",
            fallbackUsed=False,
        )