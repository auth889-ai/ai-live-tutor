"use strict";

/**
 * Stage 2 power-tools readiness.
 *
 * This module reports which external tools are configured without exposing
 * secret values. It is intentionally product-facing: the UI and curl tests can
 * use it to decide whether the tutor can run in basic, strong, or world-best
 * mode.
 */

function hasEnv(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

function firstPresent(names) {
  return names.find(hasEnv) || "";
}

function envStatus(names) {
  const present = names.filter(hasEnv);
  return {
    configured: present.length > 0,
    present,
    acceptedEnv: names,
    using: present[0] || "",
  };
}

const POWER_TOOLS = [
  {
    id: "gemini",
    label: "Gemini ADK + Vision",
    tier: "required",
    purpose: "Main ADK generation, source-grounded reasoning, selected-page vision.",
    env: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENAI_API_KEY"],
  },
  {
    id: "mongodb",
    label: "MongoDB Source + Session Store",
    tier: "required",
    purpose: "Resources, chunks, concept trees, boards, Stage 2 sessions, lesson book.",
    env: ["MONGODB_URI", "MONGO_URI"],
  },
  {
    id: "redis",
    label: "Redis Job Queue",
    tier: "world_best",
    purpose: "Background 2-hour segment generation and progress polling.",
    env: ["REDIS_URL"],
  },
  {
    id: "google_tts",
    label: "Google TTS",
    tier: "strong",
    purpose: "Server-side teacher voice audio using existing Google TTS service.",
    env: [
      "GOOGLE_TTS_API_KEY",
      "GOOGLE_CLOUD_TTS_API_KEY",
      "GOOGLE_TEXT_TO_SPEECH_API_KEY",
      "GOOGLE_API_KEY",
    ],
  },
  {
    id: "openai_judge_tts",
    label: "OpenAI",
    tier: "world_best",
    purpose: "Optional second-pass lesson quality judge and high-quality TTS.",
    env: ["OPENAI_API_KEY"],
  },
  {
    id: "elevenlabs_tts",
    label: "ElevenLabs TTS",
    tier: "optional",
    purpose: "Optional premium long-form teacher voice.",
    env: ["ELEVENLABS_API_KEY"],
  },
  {
    id: "mineru",
    label: "MinerU PDF Parser",
    tier: "world_best",
    purpose: "PDF OCR, tables, formulas, layout, and image extraction.",
    env: ["MINERU_BASE_URL", "MINERU_API_KEY"],
  },
  {
    id: "document_ai",
    label: "Google Document AI",
    tier: "strong",
    purpose: "Existing advanced PDF/document extraction path.",
    env: ["DOCUMENT_AI_PROCESSOR_NAME", "GOOGLE_APPLICATION_CREDENTIALS"],
    requireAll: true,
  },
  {
    id: "mongodb_mcp",
    label: "MongoDB MCP",
    tier: "strong",
    purpose: "Agent tool access to source/session collections.",
    env: ["MONGODB_MCP_COMMAND", "MONGODB_MCP_ARGS"],
  },
  {
    id: "web_search",
    label: "Web Search",
    tier: "optional",
    purpose: "Current external context when a lesson is not only PDF-grounded.",
    env: [
      "TAVILY_API_KEY",
      "LIVE_TUTOR_TAVILY_API_KEY",
      "BRAVE_API_KEY",
      "SERPAPI_API_KEY",
    ],
  },
  {
    id: "qdrant",
    label: "Qdrant Vector Store",
    tier: "optional",
    purpose: "Optional vector retrieval alternative to MongoDB vector search.",
    env: ["QDRANT_URL", "QDRANT_API_KEY"],
  },
  {
    id: "speech_timestamps",
    label: "Speech Timestamp Provider",
    tier: "world_best",
    purpose: "Word/line-level timestamp alignment for precise subtitles.",
    alternatives: [
      ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"],
      ["DEEPGRAM_API_KEY"],
    ],
  },
  {
    id: "youtube",
    label: "YouTube API",
    tier: "optional",
    purpose: "Optional external video references for non-PDF enrichment.",
    env: ["YOUTUBE_API_KEY", "GOOGLE_YOUTUBE_API_KEY", "LIVE_TUTOR_YOUTUBE_API_KEY"],
  },
];

function toolConfigured(tool) {
  if (tool.alternatives) {
    return tool.alternatives.some((group) => group.every(hasEnv));
  }
  if (tool.requireAll) {
    return tool.env.every(hasEnv);
  }
  return tool.env.some(hasEnv);
}

function toolAcceptedEnv(tool) {
  if (tool.alternatives) {
    return tool.alternatives.map((group) => group.join(" + "));
  }
  return tool.env;
}

function toolPresentEnv(tool) {
  if (tool.alternatives) {
    return tool.alternatives
      .filter((group) => group.every(hasEnv))
      .map((group) => group.join(" + "));
  }
  return tool.env.filter(hasEnv);
}

function describeTool(tool) {
  const configured = toolConfigured(tool);
  return {
    id: tool.id,
    label: tool.label,
    tier: tool.tier,
    purpose: tool.purpose,
    configured,
    presentEnv: toolPresentEnv(tool),
    acceptedEnv: toolAcceptedEnv(tool),
    missingEnv:
      configured || tool.alternatives
        ? []
        : tool.requireAll
          ? tool.env.filter((name) => !hasEnv(name))
          : tool.env,
  };
}

function buildPowerToolsReport() {
  const tools = POWER_TOOLS.map(describeTool);
  const byId = Object.fromEntries(tools.map((tool) => [tool.id, tool]));

  const minimumReady = Boolean(byId.gemini.configured && byId.mongodb.configured);
  const strongReady = Boolean(
    minimumReady &&
      (byId.google_tts.configured || byId.elevenlabs_tts.configured) &&
      (byId.document_ai.configured || byId.mineru.configured) &&
      byId.mongodb_mcp.configured
  );
  const worldBestReady = Boolean(
    strongReady &&
      byId.redis.configured &&
      byId.mineru.configured &&
      (byId.openai_judge_tts.configured || byId.elevenlabs_tts.configured) &&
      byId.speech_timestamps.configured
  );

  const missingRequired = tools
    .filter((tool) => tool.tier === "required" && !tool.configured)
    .flatMap((tool) => tool.acceptedEnv);

  const missingForWorldBest = tools
    .filter((tool) => tool.tier === "world_best" && !tool.configured)
    .map((tool) => ({
      id: tool.id,
      label: tool.label,
      acceptedEnv: tool.acceptedEnv,
    }));

  return {
    ok: minimumReady,
    service: "stage2-power-tools",
    readiness: {
      minimumReady,
      strongReady,
      worldBestReady,
      mode: worldBestReady ? "world_best" : strongReady ? "strong" : minimumReady ? "basic" : "blocked",
    },
    tools,
    missingRequired,
    missingForWorldBest,
    selectedProviders: {
      geminiKeyEnv: firstPresent(["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENAI_API_KEY"]),
      mongoEnv: firstPresent(["MONGODB_URI", "MONGO_URI"]),
      ttsEnv: firstPresent([
        "GOOGLE_TTS_API_KEY",
        "GOOGLE_CLOUD_TTS_API_KEY",
        "GOOGLE_TEXT_TO_SPEECH_API_KEY",
        "GOOGLE_API_KEY",
      ]),
      webSearchEnv: firstPresent([
        "TAVILY_API_KEY",
        "LIVE_TUTOR_TAVILY_API_KEY",
        "BRAVE_API_KEY",
        "SERPAPI_API_KEY",
      ]),
    },
    envGroups: {
      gemini: envStatus(["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENAI_API_KEY"]),
      mongodb: envStatus(["MONGODB_URI", "MONGO_URI"]),
      redis: envStatus(["REDIS_URL"]),
      mineru: envStatus(["MINERU_BASE_URL", "MINERU_API_KEY"]),
      openai: envStatus(["OPENAI_API_KEY"]),
      elevenlabs: envStatus(["ELEVENLABS_API_KEY"]),
      timestampSpeech: {
        configured: byId.speech_timestamps.configured,
        acceptedEnv: byId.speech_timestamps.acceptedEnv,
        presentEnv: byId.speech_timestamps.presentEnv,
      },
    },
    notes: [
      "Secrets are intentionally not returned.",
      "Basic mode can run with Gemini and MongoDB.",
      "World-best mode requires Redis jobs, strong PDF parsing, vision, premium voice or judge model, and timestamp alignment.",
    ],
  };
}

module.exports = {
  POWER_TOOLS,
  buildPowerToolsReport,
};
