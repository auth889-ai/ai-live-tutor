"""
google_agent/live_tutor_agents/live/memory_personalization_agent.py
===============================================================================
Memory / Personalization Agent.

Separate strong agent responsibility:
- Read/update tutor memory profile.
- Track weak concepts, preferred language, explanation style, completed segments.
- Create personalization patch for future agents.
- Optionally persist to MongoDB when configured.
- No fake fallback:
  - If persistence mode is requested and MongoDB is missing, fail clearly.
  - If only payload memory is provided, use it honestly as in-memory context.

Modes:
  personalize
  save_memory
  load_memory
===============================================================================
"""

from __future__ import annotations

import os
from typing import List

from ..base_agent import BaseLiveTutorAgent
from ..contracts import (
    AgentContext,
    JsonDict,
    ValidationResult,
    clean_text,
    make_id,
    normalize_id,
    safe_dict,
    safe_list,
)


def mongo_config() -> JsonDict:
    return {
        "uri": os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or "",
        "db": os.getenv("MONGODB_DATABASE") or os.getenv("MONGO_DB") or "live-tutor",
        "collection": os.getenv("LIVE_TUTOR_MEMORY_COLLECTION") or "google_live_tutor_memory_profiles",
    }


def require_pymongo():
    try:
        from pymongo import MongoClient  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"pymongo is required for persisted memory. Install pymongo. Error: {exc}")
    return MongoClient


def memory_key(context: AgentContext, payload: JsonDict) -> JsonDict:
    return {
        "ownerKey": clean_text(payload.get("ownerKey") or context.ownerKey or context.offlineUserId, 220),
        "offlineUserId": clean_text(payload.get("offlineUserId") or context.offlineUserId or context.ownerKey, 220),
    }


def load_memory_from_mongo(context: AgentContext, payload: JsonDict) -> JsonDict:
    cfg = mongo_config()
    if not cfg["uri"]:
        raise RuntimeError("MongoDB URI missing. Cannot load persisted memory.")

    MongoClient = require_pymongo()
    client = MongoClient(cfg["uri"], serverSelectionTimeoutMS=12000)
    try:
        collection = client[cfg["db"]][cfg["collection"]]
        doc = collection.find_one(memory_key(context, payload), {"_id": 0})
        return safe_dict(doc)
    finally:
        client.close()


def save_memory_to_mongo(context: AgentContext, payload: JsonDict, memory_profile: JsonDict) -> JsonDict:
    cfg = mongo_config()
    if not cfg["uri"]:
        raise RuntimeError("MongoDB URI missing. Cannot save persisted memory.")

    MongoClient = require_pymongo()
    client = MongoClient(cfg["uri"], serverSelectionTimeoutMS=12000)
    try:
        collection = client[cfg["db"]][cfg["collection"]]
        key = memory_key(context, payload)
        doc = {
            **key,
            **memory_profile,
            "updatedAtMs": memory_profile.get("updatedAtMs"),
        }
        collection.update_one(key, {"$set": doc}, upsert=True)
        saved = collection.find_one(key, {"_id": 0})
        return safe_dict(saved)
    finally:
        client.close()


def merge_unique_strings(existing: List[object], new_items: List[object], max_items: int = 80) -> List[str]:
    out: List[str] = []
    seen = set()

    for item in [*existing, *new_items]:
        text = clean_text(item, 240)
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        out.append(text)
        if len(out) >= max_items:
            break

    return out


def build_memory_patch(payload: JsonDict, context: AgentContext, base: JsonDict) -> JsonDict:
    interaction = safe_dict(payload.get("interactionEvent"))
    interrupt = safe_dict(payload.get("interruptPacket"))
    repair = safe_dict(payload.get("repairResult") or payload.get("repair"))
    quiz = safe_dict(payload.get("quizResult"))
    selected_node = safe_dict(payload.get("selectedNode") or payload.get("node"))
    segment = safe_dict(payload.get("segment") or payload.get("segmentPlan"))

    weak_concepts_new: List[object] = []
    mastered_concepts_new: List[object] = []

    if safe_dict(interaction).get("needsRepair") or safe_dict(interrupt).get("needsRepair"):
        label = selected_node.get("label") or selected_node.get("nodeId") or segment.get("title")
        if label:
            weak_concepts_new.append(label)

    if quiz.get("correct") is True:
        label = selected_node.get("label") or selected_node.get("nodeId") or segment.get("title")
        if label:
            mastered_concepts_new.append(label)

    preferred_language = clean_text(
        payload.get("language")
        or base.get("preferredLanguage")
        or context.language
        or "english",
        80,
    )

    preferred_style = clean_text(
        payload.get("preferredExplanationStyle")
        or base.get("preferredExplanationStyle")
        or ("simpler" if weak_concepts_new else "normal"),
        120,
    )

    return {
        "preferredLanguage": preferred_language,
        "preferredExplanationStyle": preferred_style,
        "weakConcepts": merge_unique_strings(safe_list(base.get("weakConcepts")), weak_concepts_new),
        "masteredConcepts": merge_unique_strings(safe_list(base.get("masteredConcepts")), mastered_concepts_new),
        "recentQuestions": merge_unique_strings(
            safe_list(base.get("recentQuestions")),
            [payload.get("question"), payload.get("userInput"), interaction.get("userInput")],
            max_items=30,
        ),
        "completedSegments": merge_unique_strings(
            safe_list(base.get("completedSegments")),
            [segment.get("segmentId")] if payload.get("segmentCompleted") else [],
            max_items=200,
        ),
        "lastNodeId": clean_text(selected_node.get("nodeId") or base.get("lastNodeId") or "", 160),
        "lastSegmentId": clean_text(segment.get("segmentId") or base.get("lastSegmentId") or "", 160),
    }


class MemoryPersonalizationAgent(BaseLiveTutorAgent):
    agent_name = "MemoryPersonalizationAgent"
    agent_group = "live"
    default_mode = "personalize"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
Memory / Personalization Agent:
Track student preferences, weak concepts, mastered concepts, and resume hints.
No fake fallback.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        errors: List[str] = []
        mode = clean_text(payload.get("mode") or self.default_mode, 80)

        if mode in {"save_memory", "load_memory"} and not mongo_config()["uri"]:
            errors.append("Persisted memory mode requires MONGODB_URI/MONGO_URI.")

        if mode == "personalize" and not safe_dict(payload.get("memoryProfile")) and not payload.get("allowEmptyMemory", True):
            errors.append("personalize mode requires memoryProfile unless allowEmptyMemory=true.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator="MemoryPersonalizationAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        mode = clean_text(payload.get("mode") or self.default_mode, 80)

        if mode == "load_memory":
            loaded = load_memory_from_mongo(context, payload)
            if not loaded:
                loaded = {
                    **memory_key(context, payload),
                    "memoryProfileId": make_id("memory_profile"),
                    "preferredLanguage": context.language,
                    "preferredExplanationStyle": "normal",
                    "weakConcepts": [],
                    "masteredConcepts": [],
                    "recentQuestions": [],
                    "completedSegments": [],
                }
            return {
                "memoryProfile": loaded,
                "personalizationHints": self._hints_from_profile(loaded),
                "metadata": {
                    "agent": self.agent_name,
                    "realSeparateAgent": True,
                    "fallbackUsed": False,
                    "mongoUsed": True,
                },
            }

        base = safe_dict(payload.get("memoryProfile"))
        if payload.get("loadBeforeSave") or payload.get("loadBeforePersonalize"):
            persisted = load_memory_from_mongo(context, payload)
            base = {**persisted, **base}

        patch = build_memory_patch(payload, context, base)
        memory_profile = {
            **memory_key(context, payload),
            "memoryProfileId": clean_text(base.get("memoryProfileId") or make_id("memory_profile"), 220),
            **base,
            **patch,
            "updatedAtMs": __import__("time").time_ns() // 1_000_000,
            "metadata": {
                **safe_dict(base.get("metadata")),
                "agent": self.agent_name,
                "fallbackUsed": False,
            },
        }

        saved = None
        if mode == "save_memory" or payload.get("persist") is True:
            saved = save_memory_to_mongo(context, payload, memory_profile)
            memory_profile = saved

        return {
            "memoryProfile": memory_profile,
            "memoryPatch": patch,
            "personalizationHints": self._hints_from_profile(memory_profile),
            "metadata": {
                "agent": self.agent_name,
                "realSeparateAgent": True,
                "fallbackUsed": False,
                "mongoUsed": bool(saved),
                "mode": mode,
            },
        }

    @staticmethod
    def _hints_from_profile(profile: JsonDict) -> JsonDict:
        weak = safe_list(profile.get("weakConcepts"))
        style = clean_text(profile.get("preferredExplanationStyle") or "normal", 120)
        language = clean_text(profile.get("preferredLanguage") or "english", 80)

        return {
            "language": language,
            "explanationStyle": style,
            "shouldExplainSlower": bool(weak) or style in {"simpler", "slow", "beginner"},
            "prioritizeExamples": style in {"example-first", "simpler"} or bool(weak),
            "weakConceptsToReview": [clean_text(x, 200) for x in weak[:8]],
            "masteredConcepts": [clean_text(x, 200) for x in safe_list(profile.get("masteredConcepts"))[:8]],
            "voicePaceHint": "slow" if bool(weak) or style in {"simpler", "slow"} else "normal",
            "boardDensityHint": "low" if bool(weak) or style in {"simpler", "slow"} else "normal",
        }

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        return raw

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        profile = safe_dict(output.get("memoryProfile"))
        hints = safe_dict(output.get("personalizationHints"))

        if not profile:
            errors.append("memoryProfile is required.")
        if not clean_text(profile.get("memoryProfileId")):
            errors.append("memoryProfile.memoryProfileId is required.")
        if not hints:
            errors.append("personalizationHints are required.")
        if not clean_text(hints.get("language")):
            warnings.append("personalizationHints.language missing.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="MemoryPersonalizationAgent.validate_output",
            fallbackUsed=False,
        )