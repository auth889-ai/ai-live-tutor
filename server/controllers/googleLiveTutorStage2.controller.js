"use strict";

/**
 * server/controllers/googleLiveTutorStage2.controller.js
 * =============================================================================
 * FULL REPLACEMENT
 *
 * Fixes:
 * - preserves ownerKey/device headers
 * - returns service result as-is plus lifted mission/MCP fields
 * - adds real Google TTS audio to teach-node response when requested/configured
 * - exposes partnerPower, mcpTrace, missionTrace, toolTrace at top-level
 * - no fake fallback
 * =============================================================================
 */

const stage2Service = require("../services/googleAgent/stage2LiveTutor.service");
const googleTtsVoiceService = require("../services/googleAgent/googleTtsVoice.service");

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getHeader(req, name) {
  return safeString(req.headers[String(name).toLowerCase()]);
}

function getOwnerContext(req) {
  const body = req.body || {};
  const query = req.query || {};

  const offlineUserId =
    getHeader(req, "x-offline-user-id") ||
    safeString(body.offlineUserId) ||
    safeString(query.offlineUserId) ||
    getHeader(req, "x-owner-key") ||
    "demo_user";

  const ownerKey =
    getHeader(req, "x-owner-key") ||
    safeString(body.ownerKey) ||
    safeString(query.ownerKey) ||
    offlineUserId;

  const deviceId =
    getHeader(req, "x-device-id") ||
    safeString(body.deviceId) ||
    safeString(query.deviceId) ||
    "demo_device";

  return {
    ownerKey,
    offlineUserId,
    deviceId,
  };
}

function safeStatusCode(error) {
  const raw = Number(error?.statusCode || error?.status || 500);
  if (!Number.isFinite(raw)) return 500;
  return Math.max(400, Math.min(599, raw));
}

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(String(raw).trim().toLowerCase());
}

function boolFromBody(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

function numberFromBody(value, fallback, min = 1, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function nestedResult(result) {
  const root = safeObject(result);
  return safeObject(root.result);
}

function firstArray(...values) {
  for (const value of values) {
    const arr = safeArray(value);
    if (arr.length) return arr;
  }
  return [];
}

function firstObject(...values) {
  for (const value of values) {
    const obj = safeObject(value);
    if (Object.keys(obj).length) return obj;
  }
  return {};
}

function liftMissionFields(result) {
  const root = safeObject(result);
  const inner = nestedResult(root);

  const partnerPower = firstObject(root.partnerPower, inner.partnerPower);
  const mcpTrace = firstArray(root.mcpTrace, inner.mcpTrace);
  const missionTrace = firstArray(root.missionTrace, inner.missionTrace);
  const toolTrace = firstArray(root.toolTrace, inner.toolTrace);
  const agentTrace = firstArray(root.agentTrace, inner.agentTrace, root.trace, inner.trace);

  const metadata = {
    ...safeObject(inner.metadata),
    ...safeObject(root.metadata),
    fallbackUsed: false,
    usedSmartFallback: false,
  };

  if (partnerPower && Object.keys(partnerPower).length) {
    metadata.mcpUsed = Boolean(partnerPower.mcpUsed);
    metadata.mcpToolCallCount = Number(partnerPower.toolCallCount || 0);
    metadata.partner = partnerPower.partner || "MongoDB";
    metadata.partnerPowerCapabilities = safeArray(partnerPower.capabilitiesUsed);
  }

  return {
    ...root,

    partnerPower,
    mcpTrace,
    missionTrace,
    toolTrace,
    agentTrace,

    metadata,

    result: {
      ...inner,
      partnerPower,
      mcpTrace,
      missionTrace,
      toolTrace,
      agentTrace,
      metadata: {
        ...safeObject(inner.metadata),
        mcpUsed: metadata.mcpUsed,
        mcpToolCallCount: metadata.mcpToolCallCount,
        partner: metadata.partner,
        partnerPowerCapabilities: metadata.partnerPowerCapabilities,
        fallbackUsed: false,
        usedSmartFallback: false,
      },
    },
  };
}

function shouldSynthesizeVoice(req) {
  const body = safeObject(req.body);

  if (body.synthesizeVoice === false || body.generateVoiceAudio === false) return false;
  if (String(body.synthesizeVoice).toLowerCase() === "false") return false;
  if (String(body.generateVoiceAudio).toLowerCase() === "false") return false;

  return boolFromBody(
    body.synthesizeVoice ?? body.generateVoiceAudio,
    envBool("STAGE2_SYNTHESIZE_TTS_BY_DEFAULT", true)
  );
}

async function attachGoogleTts(result, req, context) {
  const body = safeObject(req.body);
  const normalized = liftMissionFields(result);

  if (!shouldSynthesizeVoice(req)) {
    return {
      ...normalized,
      voiceAudio: {
        ok: false,
        enabled: false,
        ttsUsed: false,
        reason: "disabled_by_request",
        fallbackUsed: false,
      },
      result: {
        ...safeObject(normalized.result),
        voiceAudio: {
          ok: false,
          enabled: false,
          ttsUsed: false,
          reason: "disabled_by_request",
          fallbackUsed: false,
        },
      },
    };
  }

  const voiceScript = firstArray(normalized.voiceScript, safeObject(normalized.result).voiceScript);
  const subtitles = firstArray(normalized.subtitles, safeObject(normalized.result).subtitles);

  const maxVoiceLines = numberFromBody(
    body.maxVoiceLines || body.ttsMaxLines,
    Number(process.env.GOOGLE_TTS_MAX_LINES || 8),
    1,
    200
  );

  const requireRealTts = boolFromBody(
    body.requireRealTts,
    envBool("GOOGLE_TTS_REQUIRE_REAL", false)
  );

  const voiceAudio = await googleTtsVoiceService.synthesizeLessonVoice({
    sessionId: normalized.sessionId,
    selectedNode: normalized.selectedNode,
    owner: context,
    voiceScript,
    subtitles,
    maxVoiceLines,
    requireRealTts,
    body,
  });

  return {
    ...normalized,
    voiceAudio,
    googleTts: voiceAudio,
    result: {
      ...safeObject(normalized.result),
      voiceAudio,
      googleTts: voiceAudio,
    },
    metadata: {
      ...safeObject(normalized.metadata),
      googleTtsUsed: Boolean(voiceAudio.ttsUsed),
      googleTtsEnabled: Boolean(voiceAudio.enabled),
      googleTtsSynthesizedCount: Number(voiceAudio.synthesizedCount || 0),
      fallbackUsed: false,
      usedSmartFallback: false,
    },
  };
}

function sendError(res, error, context = {}) {
  const statusCode = safeStatusCode(error);

  res.status(statusCode).json({
    ok: false,
    statusCode,
    error: error?.message || "Stage 2 request failed.",
    validation: error?.validation || undefined,

    stage2: process.env.NODE_ENV === "development" ? error?.stage2 : undefined,
    stderr: process.env.NODE_ENV === "development" ? error?.stderr : undefined,
    stack: process.env.NODE_ENV === "development" ? error?.stack : undefined,

    metadata: {
      stage: 2,
      fallbackUsed: false,
      usedSmartFallback: false,
      controller: "googleLiveTutorStage2.controller.js",
      ...context,
    },
  });
}

async function health(req, res) {
  try {
    const result = await stage2Service.health();

    res.status(result.ok ? 200 : 503).json({
      ...result,
      googleTts: {
        controllerIntegrated: true,
        synthesizeByDefault: envBool("STAGE2_SYNTHESIZE_TTS_BY_DEFAULT", true),
        apiKeyConfigured: Boolean(
          process.env.GOOGLE_TTS_API_KEY ||
            process.env.GOOGLE_CLOUD_TTS_API_KEY ||
            process.env.GOOGLE_TEXT_TO_SPEECH_API_KEY ||
            process.env.GOOGLE_API_KEY
        ),
        fallbackUsed: false,
      },
    });
  } catch (error) {
    sendError(res, error, {
      endpoint: "health",
    });
  }
}

async function teachNode(req, res) {
  try {
    const context = getOwnerContext(req);

    const result = await stage2Service.teachNode({
      ownerKey: context.ownerKey,
      body: req.body || {},
      context,
    });

    const withMissionFields = liftMissionFields(result);
    const withTts = await attachGoogleTts(withMissionFields, req, context);

    res.status(200).json(withTts);
  } catch (error) {
    sendError(res, error, {
      endpoint: "teachNode",
      resourceId: safeString(req.body?.resourceId),
      nodeId: safeString(req.body?.nodeId || req.body?.selectedNode?.nodeId),
    });
  }
}

async function interruptRepair(req, res) {
  try {
    const context = getOwnerContext(req);

    const result = await stage2Service.interruptRepair({
      ownerKey: context.ownerKey,
      body: req.body || {},
      context,
    });

    const withMissionFields = liftMissionFields(result);
    const withTts = await attachGoogleTts(withMissionFields, req, context);

    res.status(200).json(withTts);
  } catch (error) {
    sendError(res, error, {
      endpoint: "interruptRepair",
      sessionId: safeString(req.body?.sessionId),
    });
  }
}

async function savePlaybackState(req, res) {
  try {
    const context = getOwnerContext(req);

    const result = await stage2Service.savePlaybackState({
      ownerKey: context.ownerKey,
      sessionId: req.params.sessionId || req.body?.sessionId,
      body: req.body || {},
      context,
    });

    res.status(200).json({
      ...result,
      metadata: {
        ...safeObject(result.metadata),
        fallbackUsed: false,
        usedSmartFallback: false,
      },
    });
  } catch (error) {
    sendError(res, error, {
      endpoint: "savePlaybackState",
      sessionId: safeString(req.params.sessionId || req.body?.sessionId),
    });
  }
}

async function getSession(req, res) {
  try {
    const context = getOwnerContext(req);

    const result = await stage2Service.getSession({
      ownerKey: context.ownerKey,
      sessionId: req.params.sessionId,
    });

    res.status(200).json(liftMissionFields(result));
  } catch (error) {
    sendError(res, error, {
      endpoint: "getSession",
      sessionId: safeString(req.params.sessionId),
    });
  }
}

module.exports = {
  health,
  teachNode,
  interruptRepair,
  savePlaybackState,
  getSession,
};