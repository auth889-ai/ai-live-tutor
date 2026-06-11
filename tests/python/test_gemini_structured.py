"""
tests/python/test_gemini_structured.py
Tests for the shared structured-output Gemini client (v3 foundation).
All Gemini calls are mocked — no network needed.
"""

import json
import sys
from unittest.mock import MagicMock, patch

import pytest

from google_agent.pipeline import gemini_structured as gs
from google_agent.pipeline.gemini_structured import (
    GeminiStructuredError,
    _build_config,
    _is_retryable,
    _parse_response,
    generate_structured,
)


SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {"type": "string"}}},
    "required": ["items"],
}


def _mock_response(parsed=None, text=""):
    resp = MagicMock()
    resp.parsed = parsed
    resp.text = text
    return resp


# ── _parse_response ───────────────────────────────────────────────────────────

class TestParseResponse:
    def test_prefers_parsed_field(self):
        resp = _mock_response(parsed={"items": ["a"]})
        assert _parse_response(resp, SCHEMA) == {"items": ["a"]}

    def test_falls_back_to_text_json(self):
        resp = _mock_response(parsed=None, text='{"items": ["b"]}')
        assert _parse_response(resp, SCHEMA) == {"items": ["b"]}

    def test_raises_on_empty_response(self):
        resp = _mock_response(parsed=None, text="")
        resp.candidates = []
        with pytest.raises(GeminiStructuredError, match="empty"):
            _parse_response(resp, SCHEMA)

    def test_raises_on_invalid_json_with_schema(self):
        resp = _mock_response(parsed=None, text="not json at all")
        with pytest.raises(GeminiStructuredError, match="not valid JSON"):
            _parse_response(resp, SCHEMA)

    def test_returns_raw_text_when_no_schema(self):
        resp = _mock_response(parsed=None, text="plain prose answer")
        assert _parse_response(resp, None) == "plain prose answer"


# ── _build_config ─────────────────────────────────────────────────────────────

class TestBuildConfig:
    def test_schema_sets_json_mime(self):
        cfg = _build_config(SCHEMA, temperature=0.4, max_output_tokens=1000,
                            system_instruction=None, thinking=False,
                            cached_content=None, tools=None)
        assert cfg.response_mime_type == "application/json"
        assert cfg.response_schema is not None

    def test_no_schema_no_mime(self):
        cfg = _build_config(None, temperature=0.4, max_output_tokens=1000,
                            system_instruction=None, thinking=False,
                            cached_content=None, tools=None)
        assert cfg.response_mime_type is None

    def test_thinking_sets_budget(self):
        cfg = _build_config(SCHEMA, temperature=0.4, max_output_tokens=1000,
                            system_instruction=None, thinking=True,
                            cached_content=None, tools=None)
        assert cfg.thinking_config is not None
        assert cfg.thinking_config.thinking_budget == 8192

    def test_system_instruction_passed(self):
        cfg = _build_config(SCHEMA, temperature=0.4, max_output_tokens=1000,
                            system_instruction="You are a tutor.", thinking=False,
                            cached_content=None, tools=None)
        assert cfg.system_instruction == "You are a tutor."


# ── retry classification ──────────────────────────────────────────────────────

class TestRetryable:
    def test_429_is_retryable(self):
        assert _is_retryable(Exception("429 RESOURCE_EXHAUSTED"))

    def test_503_is_retryable(self):
        assert _is_retryable(Exception("503 UNAVAILABLE: overloaded"))

    def test_timeout_is_retryable(self):
        assert _is_retryable(Exception("request timed out"))

    def test_schema_error_not_retryable(self):
        assert not _is_retryable(Exception("400 INVALID_ARGUMENT: bad schema"))


# ── generate_structured (mocked client) ──────────────────────────────────────

class TestGenerateStructured:
    def test_returns_parsed_dict(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = _mock_response(
            parsed={"items": ["x", "y"]}
        )
        with patch.object(gs, "_client", return_value=mock_client):
            result = generate_structured("prompt", SCHEMA)
        assert result == {"items": ["x", "y"]}

    def test_retries_on_transient_error_then_succeeds(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = [
            Exception("503 UNAVAILABLE"),
            _mock_response(parsed={"items": ["ok"]}),
        ]
        with patch.object(gs, "_client", return_value=mock_client), \
             patch.object(gs.time, "sleep"):
            result = generate_structured("prompt", SCHEMA, retries=1)
        assert result == {"items": ["ok"]}
        assert mock_client.models.generate_content.call_count == 2

    def test_raises_after_retries_exhausted(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = Exception("503 UNAVAILABLE")
        with patch.object(gs, "_client", return_value=mock_client), \
             patch.object(gs.time, "sleep"):
            with pytest.raises(GeminiStructuredError):
                generate_structured("prompt", SCHEMA, retries=1)

    def test_non_retryable_error_raises_immediately(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = Exception("400 INVALID_ARGUMENT")
        with patch.object(gs, "_client", return_value=mock_client):
            with pytest.raises(GeminiStructuredError):
                generate_structured("prompt", SCHEMA, retries=1)
        assert mock_client.models.generate_content.call_count == 1

    def test_never_returns_fake_content_on_failure(self):
        """GOLDEN RULE #5: fail loudly, never placeholder."""
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = _mock_response(
            parsed=None, text=""
        )
        mock_client.models.generate_content.return_value.candidates = []
        with patch.object(gs, "_client", return_value=mock_client):
            with pytest.raises(GeminiStructuredError):
                generate_structured("prompt", SCHEMA, retries=0)


# ── BaseLiveTutorAgent integration ───────────────────────────────────────────

class TestBaseAgentIntegration:
    def test_base_agent_has_schema_attributes(self):
        from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
        assert BaseLiveTutorAgent.response_schema is None
        assert BaseLiveTutorAgent.use_thinking is False

    @pytest.mark.asyncio
    async def test_generate_json_routes_to_structured_when_schema_set(self):
        from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
        from google_agent.live_tutor_agents.contracts import AgentContext

        class FakeAgent(BaseLiveTutorAgent):
            agent_name = "FakeAgent"
            response_schema = SCHEMA

            @property
            def instruction(self):
                return "test"

            def validate_input(self, payload):
                raise NotImplementedError

            def build_prompt(self, payload, context):
                raise NotImplementedError

            def normalize_output(self, raw, payload, context):
                raise NotImplementedError

            def validate_output(self, output, payload, context):
                raise NotImplementedError

        agent = FakeAgent()
        context = AgentContext.from_payload({})

        async def fake_structured(prompt, schema, **kwargs):
            assert schema == SCHEMA
            return {"items": ["routed"]}

        with patch("google_agent.pipeline.gemini_structured.generate_structured_async",
                   side_effect=fake_structured):
            result = await agent._generate_json("prompt", context)
        assert result == {"items": ["routed"]}
