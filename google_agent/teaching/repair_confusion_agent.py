"""
google_agent/live_tutor_agents/teaching/repair_confusion_agent.py
===============================================================================
Repair / Confusion Agent.

Separate strong agent responsibility:
- Handle student confusion or interrupt during live tutor playback.
- Preserve pause/resume state: currentSceneId, currentCommandIndex, visibleCommandIds.
- Generate a source-grounded repair explanation.
- Return repair board notes that BoardCommandAgent can convert into commands.
- Return continueAfterRepair state so the tutor resumes from the exact point.
- No fake fallback.

Input:
  student question/confusion
  current board/session state
  explanation/segment/node
  chunks/sourceRefs

Output:
  repairPlan, repairedExplanation, boardRepairNotes, resumeState, sourceRefs
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
    dedupe_source_refs,
    normalize_id,
    require_source_refs,
    safe_dict,
    safe_list,
)


class RepairConfusionAgent(BaseLiveTutorAgent):
    agent_name = "RepairConfusionAgent"
    agent_group = "teaching"
    default_mode = "repair_confusion"
    uses_adk = True

    @property
    def instruction(self) -> str:
        return """
You are the Repair / Confusion Agent for a human-like AI Live Tutor.

Your job:
- When the student interrupts, pause the lesson mentally.
- Diagnose what the student is confused about.
- Give a simpler source-grounded explanation.
- Create repair board notes that can be written/drawn.
- Preserve exact resume state.
- Do not restart the whole lesson unless requested.
- Every repair must include sourceRefs.
- Output ONLY valid JSON.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        question = clean_text(payload.get("question") or payload.get("studentQuestion") or payload.get("confusion"), 1600)
        session_state = safe_dict(payload.get("sessionState") or payload.get("resumeState"))
        board_state = safe_dict(payload.get("boardState") or payload.get("board"))
        chunks = safe_list(payload.get("chunks"))

        if not question:
            errors.append("RepairConfusionAgent requires question/studentQuestion/confusion.")
        if not session_state and not board_state:
            errors.append("RepairConfusionAgent requires sessionState/resumeState or boardState.")
        if not chunks and not safe_list(payload.get("sourceRefs")):
            errors.append("RepairConfusionAgent requires chunks or sourceRefs.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="RepairConfusionAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        session_state = safe_dict(payload.get("sessionState") or payload.get("resumeState"))
        board_state = safe_dict(payload.get("boardState") or payload.get("board"))
        selected_node = safe_dict(payload.get("selectedNode") or payload.get("node"))
        segment = safe_dict(payload.get("segment") or payload.get("segmentPlan"))
        explanation = safe_dict(payload.get("explanation"))
        strategy = safe_dict(payload.get("teachingStrategy") or payload.get("strategy"))
        chunks_text = self.compact_chunks_for_prompt(safe_list(payload.get("chunks")), max_chars=75000)

        return f"""
Repair the student's confusion without losing the live tutor position.

Student level: {context.studentLevel}
Language: {context.language}
Student confusion/question: {context.question or payload.get("studentQuestion") or payload.get("confusion")}

Return JSON exactly:
{{
  "repairId": "repair_1",
  "confusionDiagnosis": {{
    "confusionType": "definition|example|visual|step|prerequisite|pace|other",
    "studentLikelyIssue": "what the student is missing",
    "evidenceFromQuestion": "why you think so"
  }},
  "repairStrategy": {{
    "strategy": "explain_simpler|show_example|draw_flowchart|compare|define_prerequisite|slow_down",
    "reason": "why this repair helps",
    "sourceRefs": []
  }},
  "repairedExplanation": {{
    "shortAnswer": "direct answer first",
    "simplerExplanation": "simple source-grounded explanation",
    "miniExample": "small example",
    "checkQuestion": "ask student one quick check",
    "sourceRefs": []
  }},
  "boardRepairNotes": [
    {{
      "noteId": "repair_note_1",
      "type": "definition|example|arrow|warning|recap|flowchart|table",
      "text": "short board text",
      "visualHint": "writeText|drawArrow|drawFlowchart|drawTable|highlightNode",
      "targetNodeId": "optional node id",
      "sourceRefs": []
    }}
  ],
  "resumeState": {{
    "pausedAtSceneId": "from input if available",
    "pausedAtCommandIndex": 0,
    "visibleCommandIds": [],
    "repairSceneId": "repair_scene_1",
    "continueAfterRepair": true,
    "continueAtSceneId": "original scene id",
    "continueAtCommandIndex": 0
  }},
  "repairOptions": ["continue", "explain_even_simpler", "draw_more", "quiz_me"],
  "sourceRefs": [],
  "metadata": {{
    "fallbackUsed": false,
    "agent": "RepairConfusionAgent"
  }}
}}

Session state:
{session_state}

Board state:
{board_state}

Selected node:
{selected_node}

Segment:
{segment}

Previous explanation:
{explanation}

Teaching strategy:
{strategy}

Source chunks:
{chunks_text}
"""

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        diagnosis = safe_dict(raw.get("confusionDiagnosis"))
        strategy = safe_dict(raw.get("repairStrategy"))
        repaired = safe_dict(raw.get("repairedExplanation"))
        input_state = safe_dict(payload.get("sessionState") or payload.get("resumeState"))
        raw_resume = safe_dict(raw.get("resumeState"))

        notes: List[JsonDict] = []
        for index, item in enumerate(safe_list(raw.get("boardRepairNotes"))):
            note = safe_dict(item)
            notes.append(
                {
                    "noteId": normalize_id(note.get("noteId") or f"repair_note_{index + 1}", f"repair_note_{index + 1}"),
                    "type": clean_text(note.get("type") or "recap", 80),
                    "text": clean_text(note.get("text") or "", 700),
                    "visualHint": clean_text(note.get("visualHint") or "writeText", 80),
                    "targetNodeId": clean_text(note.get("targetNodeId") or note.get("nodeId") or "", 120),
                    "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(note.get("sourceRefs"))]),
                    "metadata": safe_dict(note.get("metadata")),
                }
            )

        all_refs: List[JsonDict] = []
        all_refs.extend([safe_dict(x) for x in safe_list(raw.get("sourceRefs"))])
        all_refs.extend([safe_dict(x) for x in safe_list(strategy.get("sourceRefs"))])
        all_refs.extend([safe_dict(x) for x in safe_list(repaired.get("sourceRefs"))])
        for note in notes:
            all_refs.extend(safe_list(note.get("sourceRefs")))

        paused_scene = clean_text(
            raw_resume.get("pausedAtSceneId")
            or input_state.get("currentSceneId")
            or input_state.get("sceneId")
            or "",
            120,
        )
        paused_index = int(
            raw_resume.get("pausedAtCommandIndex")
            if raw_resume.get("pausedAtCommandIndex") is not None
            else input_state.get("currentCommandIndex") or 0
        )

        return {
            "repairId": normalize_id(raw.get("repairId") or "repair_1", "repair_1"),
            "confusionDiagnosis": {
                "confusionType": clean_text(diagnosis.get("confusionType") or "other", 80),
                "studentLikelyIssue": clean_text(diagnosis.get("studentLikelyIssue") or "", 1000),
                "evidenceFromQuestion": clean_text(diagnosis.get("evidenceFromQuestion") or "", 800),
            },
            "repairStrategy": {
                "strategy": clean_text(strategy.get("strategy") or "explain_simpler", 120),
                "reason": clean_text(strategy.get("reason") or "", 1000),
                "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(strategy.get("sourceRefs"))]),
            },
            "repairedExplanation": {
                "shortAnswer": clean_text(repaired.get("shortAnswer") or "", 1200),
                "simplerExplanation": clean_text(repaired.get("simplerExplanation") or "", 3000),
                "miniExample": clean_text(repaired.get("miniExample") or "", 1600),
                "checkQuestion": clean_text(repaired.get("checkQuestion") or "", 700),
                "sourceRefs": dedupe_source_refs([safe_dict(x) for x in safe_list(repaired.get("sourceRefs"))]),
            },
            "boardRepairNotes": notes,
            "resumeState": {
                "pausedAtSceneId": paused_scene,
                "pausedAtCommandIndex": paused_index,
                "visibleCommandIds": [clean_text(x, 120) for x in safe_list(raw_resume.get("visibleCommandIds") or input_state.get("visibleCommandIds"))],
                "repairSceneId": clean_text(raw_resume.get("repairSceneId") or "repair_scene_1", 120),
                "continueAfterRepair": raw_resume.get("continueAfterRepair", True) is not False,
                "continueAtSceneId": clean_text(raw_resume.get("continueAtSceneId") or paused_scene, 120),
                "continueAtCommandIndex": int(raw_resume.get("continueAtCommandIndex") if raw_resume.get("continueAtCommandIndex") is not None else paused_index),
            },
            "repairOptions": [clean_text(x, 120) for x in safe_list(raw.get("repairOptions"))],
            "sourceRefs": dedupe_source_refs(all_refs),
            "metadata": {
                **safe_dict(raw.get("metadata")),
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "interruptSafe": True,
                "resumePreserved": True,
            },
        }

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        repaired = safe_dict(output.get("repairedExplanation"))
        resume = safe_dict(output.get("resumeState"))

        if not clean_text(safe_dict(output.get("confusionDiagnosis")).get("studentLikelyIssue")):
            errors.append("confusionDiagnosis.studentLikelyIssue is required.")
        if not clean_text(repaired.get("shortAnswer")):
            errors.append("repairedExplanation.shortAnswer is required.")
        if not clean_text(repaired.get("simplerExplanation")):
            errors.append("repairedExplanation.simplerExplanation is required.")
        if not safe_list(output.get("boardRepairNotes")):
            errors.append("boardRepairNotes are required.")
        if resume.get("continueAfterRepair") is not True:
            warnings.append("continueAfterRepair should normally be true.")
        if "pausedAtCommandIndex" not in resume:
            errors.append("resumeState.pausedAtCommandIndex is required.")

        ref_validation = require_source_refs(
            safe_list(output.get("sourceRefs")),
            "RepairConfusionAgent.output.sourceRefs",
        )
        errors.extend(ref_validation.errors)

        for index, note in enumerate(safe_list(output.get("boardRepairNotes"))):
            item = safe_dict(note)
            if not clean_text(item.get("text")):
                errors.append(f"boardRepairNotes[{index}].text is required.")
            if not safe_list(item.get("sourceRefs")):
                errors.append(f"boardRepairNotes[{index}].sourceRefs are required.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="RepairConfusionAgent.validate_output",
            fallbackUsed=False,
        )