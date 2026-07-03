from __future__ import annotations

from forever_api.agents.base import AgentSpec
from forever_api.agents.contracts.agent_contracts import describe_contracts


AGENT_SOCIETY = [
    AgentSpec("SourceGroundingAgent", "Builds and retrieves source-backed evidence.", "SourcePack"),
    AgentSpec("LearningUnitAgent", "Converts source chunks into teachable units.", "LearningUnit[]"),
    AgentSpec("CoursePlannerAgent", "Plans adaptive episodes and learning order.", "CoursePlan"),
    AgentSpec("TeachingIntentAgent", "Selects teaching intent per learning unit.", "TeachingIntent[]"),
    AgentSpec("RepresentationAgent", "Chooses required renderer affordances.", "RepresentationPlan[]"),
    AgentSpec("ScriptBeatAgent", "Writes voice beats with source references.", "ScriptBeat[]"),
    AgentSpec("TimelineCompilerAgent", "Creates audio-synced timeline manifests.", "TimelineManifest"),
    AgentSpec("GroundingReviewerAgent", "Blocks unsupported claims.", "ReviewReport"),
    AgentSpec("PedagogyReviewerAgent", "Checks explanation sequence and cognitive load.", "ReviewReport"),
    AgentSpec("SyncReviewerAgent", "Checks voice-board timing feasibility.", "ReviewReport"),
    AgentSpec("RepairAgent", "Repairs failed script, source, or timeline parts.", "RepairPatch"),
]


def describe_agent_society() -> list[dict]:
    return [spec.__dict__ for spec in AGENT_SOCIETY]


def describe_full_agent_contracts() -> list[dict]:
    return describe_contracts()
