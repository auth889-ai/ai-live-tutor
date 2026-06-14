"""
google_agent/pipeline/model_router.py
===============================================================================
MODEL ROUTER — DESIGN v4 section D (B1).

Every structured call declares a ROLE; the router picks the provider and a
fallback chain. Roles are CONFIG, not code — fully dynamic, covers any
category of work:

  ROLE        PRIMARY            WHY
  vision      gemini (Flash)     native multimodal page reading
  pedagogy    gemini (Pro+think) deep lesson-contract reasoning
  generation  gemini (Flash)     fast structured screens/commands
  critic      OPENAI             independent judge — different model family
                                 cannot share the generator's blind spots
  polish      GROQ               near-free timing/format transforms
  (any role)  OPENROUTER         provider-level fallback when primary fails

All providers return SCHEMA-SHAPED JSON:
  gemini     → response_schema (native)
  openai     → response_format json_schema (native strict)
  groq       → json_object mode + schema embedded in prompt
  openrouter → json_object mode + schema embedded in prompt

Honest: a role with no working provider raises — never silent degradation.
===============================================================================
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import urllib.request
from typing import Any, Dict, List, Optional

try:
    from .gemini_structured import generate_structured_async, FLASH_MODEL, PRO_MODEL
except ImportError:  # pragma: no cover
    from google_agent.pipeline.gemini_structured import (  # type: ignore
        generate_structured_async, FLASH_MODEL, PRO_MODEL)

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


# ── Role table (config — extend freely) ──────────────────────────────────────

ROLES: Dict[str, Dict[str, Any]] = {
    "vision":     {"chain": ["gemini"],                       "model": None,  "thinking": False},
    "pedagogy":   {"chain": ["gemini", "openrouter"],         "model": "pro", "thinking": True},
    "generation": {"chain": ["gemini", "openrouter"],         "model": None,  "thinking": False},
    "critic":     {"chain": ["openai", "gemini", "openrouter"], "model": None, "thinking": True},
    "polish":     {"chain": ["groq", "gemini"],               "model": None,  "thinking": False},
}

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")


class ModelRouterError(RuntimeError):
    """No provider in the role's chain could serve the call."""


def _post_json(url: str, headers: Dict[str, str], body: Dict[str, Any],
               timeout: int = 120) -> Dict[str, Any]:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _openai_compatible(base_url: str, api_key: str, model: str,
                       prompt: str, schema: Optional[dict],
                       system: Optional[str], temperature: float,
                       native_schema: bool) -> Any:
    """OpenAI / Groq / OpenRouter share the chat.completions shape."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    user = prompt
    if schema and not native_schema:
        user += ("\n\nReturn ONLY valid JSON matching exactly this schema "
                 "(no prose):\n" + json.dumps(schema))
    messages.append({"role": "user", "content": user})

    body: Dict[str, Any] = {"model": model, "messages": messages,
                            "temperature": temperature}
    if schema and native_schema:
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "out", "schema": schema, "strict": False},
        }
    elif schema:
        body["response_format"] = {"type": "json_object"}

    data = _post_json(f"{base_url}/chat/completions",
                      {"Authorization": f"Bearer {api_key}"}, body)
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if schema is None:
        return text
    return json.loads(text)


async def _call_provider(provider: str, role_cfg: Dict[str, Any], prompt: str,
                         schema: Optional[dict], *, system: Optional[str],
                         temperature: float, max_output_tokens: int,
                         contents: Optional[list]) -> Any:
    if provider == "gemini":
        model = PRO_MODEL if role_cfg.get("model") == "pro" else FLASH_MODEL
        return await generate_structured_async(
            prompt, schema, model=model, system_instruction=system,
            temperature=temperature, thinking=bool(role_cfg.get("thinking")),
            max_output_tokens=max_output_tokens, contents=contents)

    key_env = {"openai": "OPENAI_API_KEY", "groq": "GROQ_API_KEY",
               "openrouter": "OPENROUTER_API_KEY"}[provider]
    api_key = os.getenv(key_env, "")
    if not api_key:
        raise ModelRouterError(f"{key_env} not set")
    base, model, native = {
        "openai":     ("https://api.openai.com/v1", OPENAI_MODEL, True),
        "groq":       ("https://api.groq.com/openai/v1", GROQ_MODEL, False),
        "openrouter": ("https://openrouter.ai/api/v1", OPENROUTER_MODEL, False),
    }[provider]
    return await asyncio.to_thread(
        _openai_compatible, base, api_key, model, prompt, schema,
        system, temperature, native)


async def route_structured(role: str, prompt: str, schema: Optional[dict] = None,
                           *, system: Optional[str] = None,
                           temperature: float = 0.3,
                           max_output_tokens: int = 16384,
                           contents: Optional[list] = None) -> Dict[str, Any]:
    """
    THE entry point. Returns {"result": <schema-shaped>, "provider": <used>}.
    Walks the role's fallback chain; raises ModelRouterError if all fail.
    """
    cfg = ROLES.get(role)
    if not cfg:
        raise ModelRouterError(f"unknown role: {role}")

    errors: List[str] = []
    for provider in cfg["chain"]:
        try:
            result = await _call_provider(
                provider, cfg, prompt, schema, system=system,
                temperature=temperature, max_output_tokens=max_output_tokens,
                contents=contents)
            if provider != cfg["chain"][0]:
                print(f"[model_router] role={role} fell back to {provider}",
                      file=sys.stderr)
            return {"result": result, "provider": provider}
        except Exception as exc:
            errors.append(f"{provider}: {str(exc)[:160]}")
            print(f"[model_router] role={role} provider={provider} failed: "
                  f"{str(exc)[:160]}", file=sys.stderr)

    raise ModelRouterError(f"role={role}: all providers failed — {errors}")
