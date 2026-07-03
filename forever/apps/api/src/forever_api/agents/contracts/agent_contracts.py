from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AgentContract:
    name: str
    purpose: str
    tools: tuple[str, ...]
    input_contract: str
    output_contract: str
    quality_gates: tuple[str, ...]
    repair_targets: tuple[str, ...] = ()


AGENT_CONTRACTS: tuple[AgentContract, ...] = (
    AgentContract(
        name="SourcePackAgent",
        purpose="Convert raw input into trusted source material.",
        tools=("PyMuPDF", "Playwright", "chunker", "embedding model", "pgvector"),
        input_contract="RawInput",
        output_contract="SourcePack",
        quality_gates=("every chunk has sourceRef", "no unsupported generated claims"),
    ),
    AgentContract(
        name="LearningUnitAgent",
        purpose="Extract the smallest teachable ideas.",
        tools=("Qwen Cloud", "semantic search"),
        input_contract="SourcePack",
        output_contract="LearningUnit[]",
        quality_gates=("one primary teaching goal per unit", "each unit has sourceChunkIds"),
    ),
    AgentContract(
        name="CourseSeriesPlannerAgent",
        purpose="Plan Udemy/Coursera-style course and episode flow.",
        tools=("Qwen Cloud",),
        input_contract="LearningUnitGraph",
        output_contract="CourseSeriesPlan",
        quality_gates=("episode order follows prerequisites", "duration estimates are realistic"),
    ),
    AgentContract(
        name="PedagogyPlannerAgent",
        purpose="Choose human teaching sequence for each scene.",
        tools=("Qwen Cloud", "teaching pattern library"),
        input_contract="TutorScenePlan",
        output_contract="PedagogyPlan",
        quality_gates=("procedural topics include dry run", "scene teaches one idea"),
    ),
    AgentContract(
        name="ScriptBeatWriterAgent",
        purpose="Write natural spoken tutor narration.",
        tools=("Qwen Cloud",),
        input_contract="PedagogyPlan + SourceEvidence",
        output_contract="ScriptBeat[]",
        quality_gates=("one idea per beat", "spoken not textbook", "source refs on factual claims"),
        repair_targets=("script", "source"),
    ),
    AgentContract(
        name="VoiceDirectorAgent",
        purpose="Prepare speakable voice lines and alignment hints.",
        tools=("TTS provider", "forced alignment"),
        input_contract="ScriptBeat[]",
        output_contract="VoiceLine[] + SubtitleWord[]",
        quality_gates=("short natural voice lines", "pauses and emphasis are explicit"),
        repair_targets=("voice",),
    ),
    AgentContract(
        name="VisualDirectorAgent",
        purpose="Design notebook/code/diagram actions for each spoken beat.",
        tools=("Qwen Cloud", "renderer capability registry"),
        input_contract="ScriptBeat[] + VoiceTiming + RendererCapabilities",
        output_contract="TimelineAction[] + VisualObject[]",
        quality_gates=("visuals anchored to voice", "board writes less than voice says", "no clutter"),
        repair_targets=("timeline", "layout"),
    ),
    AgentContract(
        name="TimelineCompilerAgent",
        purpose="Compile replayable audio-clock timeline manifest.",
        tools=("schema validator",),
        input_contract="VoiceLine[] + VisualObject[] + TimelineAction[]",
        output_contract="TimelineManifest",
        quality_gates=("valid object refs", "valid timing", "source proof attached"),
        repair_targets=("timeline",),
    ),
    AgentContract(
        name="NotebookCompilerAgent",
        purpose="Create saved notebook pages from the lecture timeline.",
        tools=("canvas snapshotter", "PDF exporter"),
        input_contract="TimelineManifest",
        output_contract="NotebookPage",
        quality_gates=("notebook useful without replay", "includes key takeaways and source refs"),
    ),
    AgentContract(
        name="ReviewerSociety",
        purpose="Reject weak scenes before users see them.",
        tools=("Qwen Cloud", "schema validator", "semantic search"),
        input_contract="TimelineManifest + SourcePack",
        output_contract="ReviewReport",
        quality_gates=("accuracy", "grounding", "pedagogy", "sync", "visual polish"),
        repair_targets=("source", "script", "voice", "timeline", "layout", "notebook"),
    ),
)


def describe_contracts() -> list[dict]:
    return [
        {
            "name": contract.name,
            "purpose": contract.purpose,
            "tools": list(contract.tools),
            "inputContract": contract.input_contract,
            "outputContract": contract.output_contract,
            "qualityGates": list(contract.quality_gates),
            "repairTargets": list(contract.repair_targets),
        }
        for contract in AGENT_CONTRACTS
    ]

