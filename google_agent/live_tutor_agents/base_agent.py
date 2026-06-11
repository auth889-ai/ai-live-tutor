"""
google_agent/live_tutor_agents/base_agent.py
===============================================================================
Base class for every separate Live Tutor agent.

Every agent must:
- be independently runnable
- have its own instruction
- validate input
- validate output
- return strict JSON
- never fake fallback
- optionally use Google ADK when LLM reasoning is needed

This fixed version improves ADK JSON parsing:
- accepts valid JSON object
- accepts valid JSON array and wraps it
- accepts fenced JSON
- accepts JSON followed by extra text
- accepts multiple JSON objects and chooses the best one
- handles Gemini/ADK "Extra data" output safely without fake fallback
===============================================================================
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import traceback
from abc import ABC, abstractmethod
from json import JSONDecoder
from typing import Any, Dict, List, Optional, Tuple

from .contracts import (
    AgentContext,
    AgentResult,
    JsonDict,
    ValidationResult,
    clean_text,
    safe_dict,
    safe_list,
)


try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass


try:
    from google.adk.agents import Agent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types
except Exception as import_error:
    Agent = None
    Runner = None
    InMemorySessionService = None
    types = None
    ADK_IMPORT_ERROR = import_error
else:
    ADK_IMPORT_ERROR = None


def model_name() -> str:
    return (
        os.getenv("GOOGLE_GEMINI_MODEL")
        or os.getenv("GEMINI_MODEL")
        or os.getenv("GOOGLE_ADK_MODEL")
        or "gemini-2.5-flash"
    )


def _strip_markdown_fences(text: str) -> str:
    value = clean_text(text, 900000).strip()
    value = re.sub(r"^```(?:json|javascript|js|python|txt)?\s*", "", value, flags=re.I)
    value = re.sub(r"\s*```$", "", value.strip())
    value = value.replace("```", "")
    return value.strip()


def _remove_trailing_commas(text: str) -> str:
    return re.sub(r",\s*([}\]])", r"\1", text)


def _wrap_top_level_array(value: List[Any]) -> JsonDict:
    return {
        "items": value,
        "rawList": value,
        "voiceScript": value,
        "lines": value,
        "compiledDiagrams": value,
        "boardCommands": value,
        "subtitles": value,
        "metadata": {
            "wrappedTopLevelArray": True,
            "fallbackUsed": False,
            "usedSmartFallback": False,
        },
    }


def _json_quality_score(value: Any) -> int:
    """
    Pick the most useful JSON object when ADK returns multiple JSON objects.
    VoiceScriptAgent error came from output like:
      { "voiceScript": [...] }
      extra text / another JSON object
    So we prefer objects that contain useful agent outputs.
    """
    if isinstance(value, list):
        return 30 + len(value)

    if not isinstance(value, dict):
        return 0

    score = 10

    high_value_keys = [
        "voiceScript",
        "boardCommands",
        "subtitles",
        "compiledDiagrams",
        "premiumBoardScreens",
        "boardSections",
        "sourceRefs",
        "result",
        "metadata",
        "teacherTranscript",
        "diagramArtifacts",
        "quiz",
    ]

    for key in high_value_keys:
        if key in value:
            score += 50

    for key in ["voiceScript", "boardCommands", "subtitles", "compiledDiagrams", "premiumBoardScreens"]:
        if isinstance(value.get(key), list):
            score += min(len(value[key]), 80)

    if isinstance(value.get("result"), dict):
        score += _json_quality_score(value["result"]) // 2

    if value.get("ok") is True:
        score += 10

    if value.get("fallbackUsed") is True or value.get("usedSmartFallback") is True:
        score -= 200

    return score


def _loads_candidate(candidate: str) -> Optional[Any]:
    cleaned = _remove_trailing_commas(_strip_markdown_fences(candidate))
    if not cleaned:
        return None

    try:
        return json.loads(cleaned)
    except Exception:
        pass

    # Important fix for "Extra data" JSON:
    # JSONDecoder.raw_decode can parse the first valid JSON object and ignore
    # extra text after it. We still return only the parsed JSON object.
    decoder = JSONDecoder()
    try:
        parsed, _end = decoder.raw_decode(cleaned)
        return parsed
    except Exception:
        return None


def _balanced_json_spans(text: str) -> List[str]:
    """
    Extract balanced JSON objects/arrays from noisy model text.
    Handles quoted braces and escaped quotes.
    """
    raw = clean_text(text, 900000)
    spans: List[str] = []

    for opener, closer in [("{", "}"), ("[", "]")]:
        start = -1
        depth = 0
        in_string = False
        escape = False

        for index, char in enumerate(raw):
            if escape:
                escape = False
                continue

            if char == "\\" and in_string:
                escape = True
                continue

            if char == '"':
                in_string = not in_string
                continue

            if in_string:
                continue

            if char == opener:
                if depth == 0:
                    start = index
                depth += 1
                continue

            if char == closer and depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    spans.append(raw[start : index + 1])
                    start = -1

    # longest and earliest candidates first, but keep all for scoring
    spans = list(dict.fromkeys(spans))
    spans.sort(key=lambda item: (-len(item), raw.find(item)))
    return spans


def extract_json_object(text: str) -> JsonDict:
    """
    Robust ADK JSON parser.

    Accepts:
    - plain JSON object: {...}
    - fenced JSON object: ```json {...} ```
    - plain JSON array: [...]
    - fenced JSON array: ```json [...] ```
    - JSON object followed by extra text
    - multiple JSON objects in the same ADK output

    If top-level JSON is an array, wrap it into an object so downstream agents
    like VoiceScriptAgent can normalize it without fake fallback.
    """
    text = clean_text(text, 900000)

    if not text:
        raise ValueError("ADK agent returned empty text.")

    candidates: List[str] = []

    def add_candidate(value: str) -> None:
        value = clean_text(value, 900000).strip()
        if value and value not in candidates:
            candidates.append(value)

    add_candidate(text)
    add_candidate(_strip_markdown_fences(text))

    for fenced in re.finditer(r"```(?:json|javascript|js|python|txt)?\s*([\s\S]*?)```", text, flags=re.I):
        add_candidate(fenced.group(1).strip())

    # Add balanced JSON blocks. This fixes Extra data after first JSON.
    for span in _balanced_json_spans(text):
        add_candidate(span)

    # Legacy broad object/array slice as a fallback candidate.
    first_obj = text.find("{")
    last_obj = text.rfind("}")
    if first_obj >= 0 and last_obj > first_obj:
        add_candidate(text[first_obj : last_obj + 1])

    first_arr = text.find("[")
    last_arr = text.rfind("]")
    if first_arr >= 0 and last_arr > first_arr:
        add_candidate(text[first_arr : last_arr + 1])

    parsed_values: List[Any] = []
    errors: List[str] = []

    for candidate in candidates:
        parsed = _loads_candidate(candidate)
        if parsed is None:
            try:
                json.loads(_remove_trailing_commas(_strip_markdown_fences(candidate)))
            except Exception as exc:
                errors.append(str(exc))
            continue
        parsed_values.append(parsed)

    if parsed_values:
        parsed_values.sort(key=_json_quality_score, reverse=True)
        best = parsed_values[0]

        if isinstance(best, dict):
            best.setdefault("metadata", {})
            if isinstance(best["metadata"], dict):
                best["metadata"].setdefault("fallbackUsed", False)
                best["metadata"].setdefault("usedSmartFallback", False)
                best["metadata"].setdefault("parsedBy", "base_agent.extract_json_object.v8")
            return best

        if isinstance(best, list):
            return _wrap_top_level_array(best)

    preview = text[:1800]
    last_error = errors[-1] if errors else "no JSON candidate parsed"
    raise ValueError(f"Could not parse JSON from ADK output. Last error: {last_error}. Preview: {preview}")


async def create_session_if_needed(
    session_service: Any,
    app_name: str,
    user_id: str,
    session_id: str,
) -> None:
    result = session_service.create_session(
        app_name=app_name,
        user_id=user_id,
        session_id=session_id,
    )

    if hasattr(result, "__await__"):
        await result


def _safe_json_for_repair(value: Any, limit: int = 45000) -> str:
    try:
        return clean_text(json.dumps(value, ensure_ascii=False, indent=2), limit)
    except Exception:
        return clean_text(value, limit)


def _build_agent_repair_prompt(
    *,
    agent_name: str,
    original_prompt: str,
    raw_output: JsonDict,
    normalized_output: JsonDict,
    validation: ValidationResult,
    attempt: int,
) -> str:
    """
    Ask the SAME Gemini/ADK agent to repair its own weak output.
    This does not fake-fill content in Python.
    """
    repair_packet = {
        "task": "Repair your previous JSON output so it passes this agent's validator.",
        "agentName": agent_name,
        "repairAttempt": attempt + 1,
        "hardRules": [
            "Return ONLY the corrected JSON object.",
            "Do not return markdown.",
            "Do not explain the repair.",
            "Do not echo the schema.",
            "Do not invent unsupported facts.",
            "Use the original prompt/source context as truth.",
            "Fix every validation error exactly.",
        ],
        "validationErrors": safe_list(validation.errors),
        "validationWarnings": safe_list(validation.warnings),
        "previousRawOutput": raw_output,
        "previousNormalizedOutput": normalized_output,
        "originalPromptReminder": clean_text(original_prompt, 70000),
        "requiredBehavior": {
            "fallbackUsed": False,
            "usedSmartFallback": False,
            "agentSelfRepairLoopV1": True,
        },
    }
    return _safe_json_for_repair(repair_packet, 120000)


class BaseLiveTutorAgent(ABC):
    agent_name: str = "BaseLiveTutorAgent"
    agent_group: str = "base"
    default_mode: str = "run"
    uses_adk: bool = True

    # ── Structured Output (v3 GOLDEN RULE #3) ─────────────────────────────────
    # When an agent defines response_schema (OpenAPI-subset dict), its Gemini
    # call bypasses the ADK text path and uses response_schema enforcement:
    # guaranteed valid JSON, no truncation, no regex repair.
    response_schema: Optional[JsonDict] = None
    # Deep-reasoning agents (PedagogyPlanner, TeachingStrategy, RepairConfusion)
    # set use_thinking = True to enable the Gemini 2.5 thinking budget.
    use_thinking: bool = False

    def __init__(self, model: Optional[str] = None) -> None:
        self.model = model or model_name()

    @property
    @abstractmethod
    def instruction(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def validate_input(self, payload: JsonDict) -> ValidationResult:
        raise NotImplementedError

    @abstractmethod
    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        raise NotImplementedError

    @abstractmethod
    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        raise NotImplementedError

    @abstractmethod
    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        raise NotImplementedError

    def health(self) -> AgentResult:
        adk_ok = ADK_IMPORT_ERROR is None
        errors = [] if adk_ok or not self.uses_adk else [f"Google ADK import failed: {ADK_IMPORT_ERROR}"]

        validation = ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=[],
            validator=f"{self.agent_name}.health",
            fallbackUsed=False,
        )

        return AgentResult(
            ok=validation.ok,
            agentName=self.agent_name,
            mode="health",
            result={
                "agentName": self.agent_name,
                "agentGroup": self.agent_group,
                "usesAdk": self.uses_adk,
                "adkImported": adk_ok,
                "model": self.model,
                "fakeFallback": False,
            },
            validation=validation,
            errors=errors,
            warnings=[],
            metadata={
                "agentGroup": self.agent_group,
                "realSeparateAgent": True,
                "fallbackUsed": False,
            },
        )

    async def run_structured_json(self, prompt: str, context: AgentContext) -> JsonDict:
        """
        Structured-output Gemini call (response_schema enforced).
        Used automatically by run() when the agent defines response_schema.
        Returns a dict guaranteed to match the schema — or raises honestly.
        """
        try:
            from ..pipeline.gemini_structured import generate_structured_async
        except ImportError:
            from google_agent.pipeline.gemini_structured import generate_structured_async

        result = await generate_structured_async(
            prompt,
            self.response_schema,
            model=self.model,
            system_instruction=self.instruction,
            thinking=self.use_thinking,
        )
        if isinstance(result, list):
            return _wrap_top_level_array(result)
        return safe_dict(result)

    async def _generate_json(self, prompt: str, context: AgentContext) -> JsonDict:
        """Route to structured output when a schema is defined, else ADK text path."""
        if self.response_schema is not None:
            return await self.run_structured_json(prompt, context)
        return await self.run_adk_json(prompt, context)

    async def run_adk_json(self, prompt: str, context: AgentContext) -> JsonDict:
        if ADK_IMPORT_ERROR is not None:
            raise RuntimeError(f"Google ADK import failed: {ADK_IMPORT_ERROR}")

        session_service = InMemorySessionService()
        app_name = "advanced_live_tutor_separate_agents"
        user_id = context.ownerKey or context.offlineUserId or "demo_user"
        session_id = context.sessionId or "live_tutor_session"

        await create_session_if_needed(
            session_service=session_service,
            app_name=app_name,
            user_id=user_id,
            session_id=session_id,
        )

        agent = Agent(
            name=self.agent_name,
            model=self.model,
            description=f"{self.agent_name} for the human-like Live Tutor.",
            instruction=self.instruction,
        )

        runner = Runner(
            agent=agent,
            app_name=app_name,
            session_service=session_service,
        )

        content = types.Content(
            role="user",
            parts=[types.Part(text=prompt)],
        )

        text_parts: List[str] = []

        async for event in runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=content,
        ):
            if getattr(event, "content", None) and getattr(event.content, "parts", None):
                for part in event.content.parts:
                    text = getattr(part, "text", None)
                    if text:
                        text_parts.append(text)

        raw_text = "\n".join(text_parts).strip()
        return extract_json_object(raw_text)

    async def run(self, payload: JsonDict) -> AgentResult:
        payload = safe_dict(payload)
        mode = clean_text(payload.get("mode") or self.default_mode, 80)
        context = AgentContext.from_payload(payload)

        input_validation = self.validate_input(payload)
        if not input_validation.ok:
            return AgentResult(
                ok=False,
                agentName=self.agent_name,
                mode=mode,
                result={},
                validation=input_validation,
                errors=input_validation.errors,
                warnings=input_validation.warnings,
                metadata={
                    "agentGroup": self.agent_group,
                    "realSeparateAgent": True,
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                    "stage": "separate-agent-input-validation",
                    "agentSelfRepairLoopV1": True,
                },
            )

        repair_attempts = int(os.getenv("LIVE_TUTOR_AGENT_REPAIR_ATTEMPTS", "1") or "1")
        repair_attempts = max(0, min(repair_attempts, 2))

        try:
            prompt = self.build_prompt(payload, context)

            if self.uses_adk or self.response_schema is not None:
                raw = await self._generate_json(prompt, context)
            else:
                raw = self.run_without_adk(payload, context)

            normalized = self.normalize_output(raw, payload, context)
            output_validation = self.validate_output(normalized, payload, context)

            repair_history: List[JsonDict] = []

            if (self.uses_adk or self.response_schema is not None) and not output_validation.ok and repair_attempts > 0:
                for attempt in range(repair_attempts):
                    repair_history.append(
                        {
                            "attempt": attempt + 1,
                            "errors": safe_list(output_validation.errors),
                            "warnings": safe_list(output_validation.warnings),
                        }
                    )

                    repair_prompt = _build_agent_repair_prompt(
                        agent_name=self.agent_name,
                        original_prompt=prompt,
                        raw_output=raw,
                        normalized_output=normalized,
                        validation=output_validation,
                        attempt=attempt,
                    )

                    raw = await self._generate_json(repair_prompt, context)
                    normalized = self.normalize_output(raw, payload, context)
                    output_validation = self.validate_output(normalized, payload, context)

                    if output_validation.ok:
                        break

            return AgentResult(
                ok=output_validation.ok,
                agentName=self.agent_name,
                mode=mode,
                result=normalized if output_validation.ok else {},
                validation=output_validation,
                errors=output_validation.errors,
                warnings=output_validation.warnings,
                sourceRefs=safe_list(normalized.get("sourceRefs")) if output_validation.ok else [],
                boardCommands=safe_list(normalized.get("boardCommands")) if output_validation.ok else [],
                voiceScript=safe_list(normalized.get("voiceScript")) if output_validation.ok else [],
                subtitles=safe_list(normalized.get("subtitles")) if output_validation.ok else [],
                metadata={
                    "agentGroup": self.agent_group,
                    "realSeparateAgent": True,
                    "usesAdk": self.uses_adk,
                    "model": self.model,
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                    "agentSelfRepairLoopV1": True,
                    "repairAttemptCount": len(repair_history),
                    "repairHistory": repair_history,
                },
            )

        except Exception as exc:
            return AgentResult(
                ok=False,
                agentName=self.agent_name,
                mode=mode,
                result={},
                validation=ValidationResult(
                    ok=False,
                    errors=[str(exc)],
                    warnings=[],
                    validator=f"{self.agent_name}.exception",
                    fallbackUsed=False,
                ),
                errors=[str(exc)],
                warnings=[],
                metadata={
                    "agentGroup": self.agent_group,
                    "realSeparateAgent": True,
                    "usesAdk": self.uses_adk,
                    "fallbackUsed": False,
                    "usedSmartFallback": False,
                    "agentSelfRepairLoopV1": True,
                    "traceback": traceback.format_exc() if os.getenv("NODE_ENV") == "development" else "",
                },
            )


    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        raise RuntimeError(f"{self.agent_name} requires ADK and cannot run without it.")

    def run_sync(self, payload: JsonDict) -> JsonDict:
        return asyncio.run(self.run(payload)).to_dict()

    @staticmethod
    def compact_chunks_for_prompt(chunks: List[Any], max_chars: int = 90000) -> str:
        blocks: List[str] = []
        used = 0

        for index, raw in enumerate(chunks):
            chunk = safe_dict(raw)
            text = clean_text(chunk.get("text") or chunk.get("textPreview") or "", 2600)
            if not text:
                continue

            block = (
                f"[chunkId={chunk.get('chunkId', '')}] "
                f"[sourceRef={chunk.get('sourceRef', '')}] "
                f"[page={chunk.get('page', 1)}] "
                f"[chunkIndex={chunk.get('chunkIndex', index)}]\n"
                f"heading: {clean_text(chunk.get('heading') or chunk.get('title') or '', 180)}\n"
                f"{text}"
            )

            if used + len(block) > max_chars:
                break

            blocks.append(block)
            used += len(block)

        return "\n\n---SOURCE-CHUNK---\n\n".join(blocks)