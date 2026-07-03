"""
google_agent/pipeline/adk_runtime.py
===============================================================================
ADK RUNTIME — the production foundation that makes every agent a REAL Google ADK
agent. Instead of calling the Gemini SDK directly, agents run as a google.adk
LlmAgent through the ADK Runner. This is the single, reusable way to do that.

Capabilities (production):
  - Real ADK LlmAgent executed via the ADK Runner (returns ADK event proof).
  - Multimodal: page images passed as genai Parts.
  - Structured output via output_schema — accepts EITHER a Pydantic model OR one
    of our existing OpenAPI-subset dict schemas (auto-converted to Pydantic), so
    no agent has to rewrite its schema to become a real ADK agent.
  - Tools: google_search / code_execution / FunctionTool (and later MCPToolset),
    honoring ADK's rule that output_schema and tools are mutually exclusive.
  - Hardening: retry-with-backoff on transient errors, per-run timeout, robust
    final-JSON extraction, clean honest errors. NO fake fallback.
  - Observability: logs events + tool calls per run.

Public API:
  schema_to_pydantic(dict_schema, name) -> Type[BaseModel]
  run_adk_agent(...) -> {result, adkEvents, adkToolCalls, ranThroughAdkRunner, rawText}
  adk_available() -> bool
===============================================================================
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple, Type

# ── ADK + genai imports (degrade honestly if missing) ────────────────────────
try:
    from google.adk.agents import LlmAgent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as genai_types
    _ADK_OK = True
    _ADK_ERR: Optional[Exception] = None
except Exception as exc:  # pragma: no cover
    LlmAgent = Runner = InMemorySessionService = genai_types = None  # type: ignore
    _ADK_OK = False
    _ADK_ERR = exc

try:
    from pydantic import BaseModel, create_model
    _PYD_OK = True
except Exception as exc:  # pragma: no cover
    BaseModel = object  # type: ignore
    create_model = None  # type: ignore
    _PYD_OK = False

try:
    from .gemini_structured import FLASH_MODEL
except ImportError:  # pragma: no cover
    from google_agent.pipeline.gemini_structured import FLASH_MODEL  # type: ignore


_APP_NAME = "advanced_live_tutor"
_DEFAULT_TIMEOUT_S = 180.0
_RETRYABLE = ("429", "500", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE",
              "DEADLINE_EXCEEDED", "timeout", "timed out", "overloaded", "INTERNAL")


class AdkRuntimeError(RuntimeError):
    """ADK agent run failed honestly (no fake fallback)."""


def adk_available() -> bool:
    return _ADK_OK and _PYD_OK


# ─────────────────────────────────────────────────────────────────────────────
# OpenAPI-subset dict schema  ->  Pydantic model  (so existing agents stay as-is)
# ─────────────────────────────────────────────────────────────────────────────

_SAFE = re.compile(r"[^A-Za-z0-9_]")
_model_cache: Dict[str, Type[Any]] = {}


def _safe_name(name: str) -> str:
    n = _SAFE.sub("_", str(name or "Model")).strip("_") or "Model"
    if n[0].isdigit():
        n = "M_" + n
    return n


def _py_type(schema: Dict[str, Any], name: str) -> Any:
    schema = schema if isinstance(schema, dict) else {}
    t = schema.get("type")
    if t == "object" or ("properties" in schema and t in (None, "object")):
        return schema_to_pydantic(schema, name)
    if t == "array":
        item = schema.get("items") or {}
        return List[_py_type(item, name + "Item")]  # type: ignore[index]
    if t == "string":
        return str
    if t == "number":
        return float
    if t == "integer":
        return int
    if t == "boolean":
        return bool
    return Any  # type: ignore[return-value]


def schema_to_pydantic(dict_schema: Dict[str, Any], name: str = "Output") -> Type[Any]:
    """
    Build a Pydantic model from an OpenAPI-subset dict schema
    (type/properties/required/items/enum). Recursive. Cached by name.
    """
    if not _PYD_OK:
        raise AdkRuntimeError("pydantic not available — cannot build ADK output_schema")
    cls_name = _safe_name(name)
    if cls_name in _model_cache:
        return _model_cache[cls_name]

    dict_schema = dict_schema if isinstance(dict_schema, dict) else {}
    props: Dict[str, Any] = dict_schema.get("properties") or {}
    required = set(dict_schema.get("required") or [])

    fields: Dict[str, Tuple[Any, Any]] = {}
    for key, sub in props.items():
        ftype = _py_type(sub if isinstance(sub, dict) else {}, f"{cls_name}_{key}")
        if key in required:
            fields[key] = (ftype, ...)
        else:
            fields[key] = (Optional[ftype], None)  # type: ignore[index]

    if not fields:
        # objects with no declared props -> permissive container
        model = create_model(cls_name, __base__=BaseModel)  # type: ignore[call-arg]
    else:
        model = create_model(cls_name, **fields)  # type: ignore[arg-type]
    _model_cache[cls_name] = model
    return model


# ─────────────────────────────────────────────────────────────────────────────
# Session + content helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _ensure_session(session_service: Any, user_id: str, session_id: str) -> None:
    result = session_service.create_session(
        app_name=_APP_NAME, user_id=user_id, session_id=session_id
    )
    if hasattr(result, "__await__"):
        await result


def _content(prompt: str, images: Optional[List[bytes]]) -> Any:
    parts = [genai_types.Part(text=prompt)]
    for img in images or []:
        if img:
            parts.append(genai_types.Part.from_bytes(data=img, mime_type="image/png"))
    return genai_types.Content(role="user", parts=parts)


def _extract_json(text: str) -> Any:
    stripped = (text or "").strip()
    if not stripped:
        return text
    # strip code fences
    stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
    stripped = re.sub(r"\s*```$", "", stripped)
    if stripped[:1] in "{[":
        try:
            return json.loads(stripped)
        except Exception:
            # tolerate trailing extra data: parse first JSON value
            try:
                dec = json.JSONDecoder()
                obj, _ = dec.raw_decode(stripped)
                return obj
            except Exception:
                return text
    return text


def _is_retryable(exc: Exception) -> bool:
    msg = str(exc)
    return any(m in msg for m in _RETRYABLE)


# ─────────────────────────────────────────────────────────────────────────────
# The runner
# ─────────────────────────────────────────────────────────────────────────────

async def _run_once(
    *, name: str, instruction: str, prompt: str, model: str,
    images: Optional[List[bytes]], output_schema: Optional[Type[Any]],
    tools: Optional[List[Any]], code_executor: Optional[Any],
    temperature: float, max_output_tokens: int,
    user_id: str, session_id: str,
) -> Dict[str, Any]:
    session_service = InMemorySessionService()
    await _ensure_session(session_service, user_id, session_id)

    agent_kwargs: Dict[str, Any] = {"name": name, "model": model, "instruction": instruction}
    try:
        agent_kwargs["generate_content_config"] = genai_types.GenerateContentConfig(
            temperature=temperature, max_output_tokens=max_output_tokens,
        )
    except Exception:
        pass  # older ADK/genai — fall back to defaults
    if output_schema is not None:
        agent_kwargs["output_schema"] = output_schema
        agent_kwargs["output_key"] = f"{name}_out"
    if tools:
        agent_kwargs["tools"] = tools
    if code_executor is not None:
        agent_kwargs["code_executor"] = code_executor

    agent = LlmAgent(**agent_kwargs)
    runner = Runner(agent=agent, app_name=_APP_NAME, session_service=session_service)

    events = 0
    tool_calls = 0
    final_text = ""
    async for event in runner.run_async(
        user_id=user_id, session_id=session_id, new_message=_content(prompt, images)
    ):
        events += 1
        content = getattr(event, "content", None)
        if content and getattr(content, "parts", None):
            for part in content.parts:
                txt = getattr(part, "text", None)
                if txt:
                    final_text = txt
                if getattr(part, "function_call", None):
                    tool_calls += 1
                # code-execution (BuiltInCodeExecutor) emits these part types, not function_call
                if getattr(part, "executable_code", None) or getattr(part, "code_execution_result", None):
                    tool_calls += 1

    if events == 0:
        raise AdkRuntimeError(f"ADK agent '{name}' emitted no events")

    return {
        "result": _extract_json(final_text),
        "adkEvents": events,
        "adkToolCalls": tool_calls,
        "ranThroughAdkRunner": True,
        "rawText": final_text,
    }


async def run_adk_agent(
    *,
    name: str,
    instruction: str,
    prompt: str,
    model: Optional[str] = None,
    images: Optional[List[bytes]] = None,
    output_schema: Optional[Any] = None,     # Pydantic model OR OpenAPI dict schema
    tools: Optional[List[Any]] = None,
    code_executor: Optional[Any] = None,
    temperature: float = 0.3,
    max_output_tokens: int = 65536,
    timeout_s: float = _DEFAULT_TIMEOUT_S,
    retries: int = 1,
    user_id: str = "tutor_user",
    session_id: str = "tutor_session",
) -> Dict[str, Any]:
    """
    Run ONE real ADK LlmAgent through the ADK Runner. Production-hardened:
    timeout + retry-with-backoff on transient errors. No fake fallback.

    `output_schema` may be a Pydantic model class OR one of our dict schemas
    (auto-converted). It is mutually exclusive with tools/code_executor.
    """
    if not _ADK_OK:
        raise AdkRuntimeError(f"Google ADK not available: {_ADK_ERR}")
    if not _PYD_OK and output_schema is not None:
        raise AdkRuntimeError("pydantic not available — cannot enforce output_schema")
    if output_schema is not None and (tools or code_executor):
        raise AdkRuntimeError("ADK forbids output_schema with tools/code_executor — pass one.")

    schema_model: Optional[Type[Any]] = None
    if output_schema is not None:
        if isinstance(output_schema, dict):
            schema_model = schema_to_pydantic(output_schema, name + "Output")
        elif isinstance(output_schema, type) and issubclass(output_schema, BaseModel):  # type: ignore[arg-type]
            schema_model = output_schema
        else:
            raise AdkRuntimeError("output_schema must be a dict schema or a Pydantic model class")

    model = model or FLASH_MODEL
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            return await asyncio.wait_for(
                _run_once(
                    name=name, instruction=instruction, prompt=prompt, model=model,
                    images=images, output_schema=schema_model, tools=tools,
                    code_executor=code_executor, temperature=temperature,
                    max_output_tokens=max_output_tokens,
                    user_id=user_id, session_id=session_id,
                ),
                timeout=timeout_s,
            )
        except AdkRuntimeError:
            raise
        except Exception as exc:
            last_exc = exc
            transient = _is_retryable(exc) or isinstance(exc, asyncio.TimeoutError)
            if attempt < retries and transient:
                wait = 2.0 * (attempt + 1)
                print(f"[adk_runtime] '{name}' transient error (attempt {attempt + 1}): "
                      f"{str(exc)[:140]} — retrying in {wait}s", file=sys.stderr)
                await asyncio.sleep(wait)
                continue
            raise AdkRuntimeError(f"ADK agent '{name}' failed: {str(exc)[:300]}") from exc

    raise AdkRuntimeError(f"ADK agent '{name}' failed after retries: {str(last_exc)[:300]}")
