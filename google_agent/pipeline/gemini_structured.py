"""
google_agent/pipeline/gemini_structured.py
===============================================================================
Shared structured-output Gemini client.  THE foundation of the v3 pipeline.

GOLDEN RULE #3: Every Gemini call uses Structured Output (response_schema)
— guaranteed valid JSON, no truncation, no regex repair hacks.

Usage:
    from google_agent.pipeline.gemini_structured import (
        generate_structured, generate_structured_async,
    )

    result = generate_structured(
        prompt="Plan a lesson on star schema...",
        schema={
            "type": "object",
            "properties": {
                "screens": {"type": "array", "items": {...}},
            },
            "required": ["screens"],
        },
    )
    # result is a parsed dict matching the schema — always.

Rules:
- Schemas are OpenAPI-subset dicts (type/properties/required/items/enum).
- Raises GeminiStructuredError on real failure — NEVER returns fake content.
- One retry with backoff on transient errors (429/500/503/timeout).
- thinking=True enables Gemini 2.5 thinking for deep-reasoning agents
  (PedagogyPlanner, TeachingStrategy, RepairConfusion).
===============================================================================
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Optional

try:
    from google import genai
    from google.genai import types as genai_types
    _GENAI_OK = True
except ImportError:  # pragma: no cover
    genai = None
    genai_types = None
    _GENAI_OK = False

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


FLASH_MODEL = os.getenv("GEMINI_FLASH_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"
PRO_MODEL = os.getenv("GEMINI_PRO_MODEL") or "gemini-2.5-pro"

_RETRYABLE_MARKERS = ("429", "500", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE",
                      "DEADLINE_EXCEEDED", "timeout", "timed out", "overloaded")


class GeminiStructuredError(RuntimeError):
    """Raised when a structured Gemini call genuinely fails. No fake fallback."""


def _api_key() -> str:
    key = (
        os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_GENAI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or ""
    )
    if not key:
        raise GeminiStructuredError("GEMINI_API_KEY not set")
    return key


_client_singleton: Optional["genai.Client"] = None


def _client() -> "genai.Client":
    global _client_singleton
    if not _GENAI_OK:
        raise GeminiStructuredError("google.genai SDK not installed")
    if _client_singleton is None:
        _client_singleton = genai.Client(api_key=_api_key())
    return _client_singleton


def _build_config(
    schema: Optional[dict],
    *,
    temperature: float,
    max_output_tokens: int,
    system_instruction: Optional[str],
    thinking: bool,
    cached_content: Optional[str],
    tools: Optional[list],
) -> "genai_types.GenerateContentConfig":
    kwargs: dict[str, Any] = {
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
    }
    if schema is not None:
        kwargs["response_mime_type"] = "application/json"
        kwargs["response_schema"] = schema
    if system_instruction:
        kwargs["system_instruction"] = system_instruction
    if thinking:
        # Let the model reason before answering (Gemini 2.5 thinking budget).
        kwargs["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=8192)
    if cached_content:
        kwargs["cached_content"] = cached_content
    if tools:
        kwargs["tools"] = tools
    return genai_types.GenerateContentConfig(**kwargs)


def _parse_response(response: Any, schema: Optional[dict]) -> Any:
    # SDK populates .parsed when response_schema was given and parsing succeeded.
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        return parsed
    text = (getattr(response, "text", None) or "").strip()
    if not text:
        finish = ""
        try:
            finish = str(response.candidates[0].finish_reason)
        except Exception:
            pass
        raise GeminiStructuredError(f"Gemini returned empty response (finish_reason={finish})")
    if schema is None:
        return text
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise GeminiStructuredError(
            f"Gemini structured response was not valid JSON despite schema: {exc}. "
            f"First 200 chars: {text[:200]}"
        ) from exc


def _is_retryable(exc: Exception) -> bool:
    msg = str(exc)
    return any(marker in msg for marker in _RETRYABLE_MARKERS)


def generate_structured(
    prompt: str,
    schema: Optional[dict] = None,
    *,
    model: Optional[str] = None,
    temperature: float = 0.4,
    max_output_tokens: int = 65536,
    system_instruction: Optional[str] = None,
    thinking: bool = False,
    cached_content: Optional[str] = None,
    tools: Optional[list] = None,
    contents: Optional[list] = None,
    retries: int = 1,
) -> Any:
    """
    Synchronous structured Gemini call.
    Returns dict/list matching schema (or raw text when schema is None).
    `contents` overrides `prompt` for multimodal calls (e.g. page images).
    """
    config = _build_config(
        schema,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        system_instruction=system_instruction,
        thinking=thinking,
        cached_content=cached_content,
        tools=tools,
    )
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            response = _client().models.generate_content(
                model=model or FLASH_MODEL,
                contents=contents if contents is not None else prompt,
                config=config,
            )
            return _parse_response(response, schema)
        except GeminiStructuredError:
            raise
        except Exception as exc:  # transport / API errors
            last_exc = exc
            if attempt < retries and _is_retryable(exc):
                wait = 2.0 * (attempt + 1)
                print(f"[gemini_structured] retryable error, attempt {attempt + 1}: "
                      f"{str(exc)[:160]} — retrying in {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            raise GeminiStructuredError(f"Gemini call failed: {str(exc)[:400]}") from exc
    raise GeminiStructuredError(f"Gemini call failed after retries: {str(last_exc)[:400]}")


async def generate_structured_async(
    prompt: str,
    schema: Optional[dict] = None,
    *,
    model: Optional[str] = None,
    temperature: float = 0.4,
    max_output_tokens: int = 65536,
    system_instruction: Optional[str] = None,
    thinking: bool = False,
    cached_content: Optional[str] = None,
    tools: Optional[list] = None,
    contents: Optional[list] = None,
    retries: int = 1,
) -> Any:
    """Async variant — used inside the ADK agent event loop."""
    import asyncio

    config = _build_config(
        schema,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        system_instruction=system_instruction,
        thinking=thinking,
        cached_content=cached_content,
        tools=tools,
    )
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            response = await _client().aio.models.generate_content(
                model=model or FLASH_MODEL,
                contents=contents if contents is not None else prompt,
                config=config,
            )
            return _parse_response(response, schema)
        except GeminiStructuredError:
            raise
        except Exception as exc:
            last_exc = exc
            if attempt < retries and _is_retryable(exc):
                wait = 2.0 * (attempt + 1)
                print(f"[gemini_structured] retryable error (async), attempt {attempt + 1}: "
                      f"{str(exc)[:160]} — retrying in {wait}s", file=sys.stderr)
                await asyncio.sleep(wait)
                continue
            raise GeminiStructuredError(f"Gemini call failed: {str(exc)[:400]}") from exc
    raise GeminiStructuredError(f"Gemini call failed after retries: {str(last_exc)[:400]}")
