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
const { buildSourceContext } = require("../services/googleAgent/sourceContext/sourceContextPipeline");
const { teachNodeWithAdkPipeline } = require("../services/googleAgent/stage2/stage2LessonOrchestrator");
const { buildPowerToolsReport } = require("../services/googleAgent/stage2/stage2PowerToolsConfig");
const persistence = require("../services/googleAgent/stage2/stage2SessionPersistence");
const backgroundJob = require("../services/googleAgent/stage2/stage2BackgroundJob.service");

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

  if (Array.isArray(voiceAudio.audioClips) && voiceAudio.audioClips.length) {
    const byLineId = new Map();
    voiceAudio.audioClips.forEach((clip, index) => {
      const url = clip.dataUrl || clip.audioUrl;
      if (!url) return;
      if (clip.lineId) byLineId.set(clip.lineId, url);
      if (clip.voiceId) byLineId.set(clip.voiceId, url);
      byLineId.set(`__index_${index}`, url);
    });

    voiceScript.forEach((line, index) => {
      const id = line?.lineId || line?.voiceId || line?.id;
      const url = byLineId.get(id) || byLineId.get(`__index_${index}`);
      if (url) line.audioUrl = url;
    });
  }

  return {
    ...normalized,
    voiceScript,
    voiceAudio,
    googleTts: voiceAudio,
    result: {
      ...safeObject(normalized.result),
      voiceScript,
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
    const powerTools = buildPowerToolsReport();

    res.status(result.ok ? 200 : 503).json({
      ...result,
      powerTools: {
        readiness: powerTools.readiness,
        missingRequired: powerTools.missingRequired,
        missingForWorldBest: powerTools.missingForWorldBest,
        selectedProviders: powerTools.selectedProviders,
      },
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

async function powerTools(req, res) {
  try {
    res.status(200).json(buildPowerToolsReport());
  } catch (error) {
    sendError(res, error, {
      endpoint: "powerTools",
    });
  }
}

async function teachNode(req, res) {
  try {
    const context    = getOwnerContext(req);
    const body       = safeObject(req.body);
    const resourceId = safeString(body.resourceId);
    const treeId     = safeString(body.treeId);
    const nodeId     = safeString(body.nodeId || safeObject(body.selectedNode).nodeId);

    // Build rich source context
    let enrichedBody = body;
    if (resourceId && treeId && nodeId) {
      try {
        const sourceCtx = await buildSourceContext({ ownerKey: context.ownerKey, resourceId, treeId, nodeId });
        enrichedBody = { ...body, ...sourceCtx, _sourceContextInjected: true };
      } catch (ctxErr) {
        console.warn("[teachNode] sourceContextPipeline failed, using original body:", ctxErr.message);
      }
    }

    // Try new ADK pipeline first (all agents connected, preprocessing optional)
    let result;
    try {
      result = await teachNodeWithAdkPipeline(enrichedBody, {
        studentLevel: safeString(body.studentLevel, "beginner"),
        lessonMode:   safeString(body.lessonMode, "masterclass"),
        timeoutMs:    numberFromBody(body.timeoutMs || body.stage2TimeoutMs, 840000, 60000, 1800000),
      });
      result._pipeline = "adk_v2";
    } catch (adkErr) {
      console.warn("[teachNode] ADK pipeline failed, falling back to monolith:", adkErr.message);
      result = await stage2Service.teachNode({
        ownerKey: context.ownerKey,
        body: enrichedBody,
        context,
      });
      result._pipeline = "monolith_fallback";
    }

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

// ── New non-blocking session handlers ────────────────────────────────────────

async function startSession(req, res) {
  try {
    const context = getOwnerContext(req);
    const body    = safeObject(req.body);

    const nodeId     = safeString(body.nodeId || safeObject(body.selectedNode).nodeId);
    const nodeTitle  = safeString(body.nodeTitle || safeObject(body.selectedNode).title || safeObject(body.selectedNode).label);
    const resourceId = safeString(body.resourceId);
    const treeId     = safeString(body.treeId);

    if (!resourceId || !treeId || !nodeId) {
      return res.status(400).json({
        ok: false,
        error: "resourceId, treeId, and nodeId are required",
        missing: {
          resourceId: !resourceId,
          treeId: !treeId,
          nodeId: !nodeId,
        },
      });
    }

    // Create session record immediately
    const session = await persistence.createSession({
      ownerKey:     context.ownerKey,
      offlineUserId: context.offlineUserId,
      deviceId:     context.deviceId,
      resourceId,
      treeId,
      nodeId,
      nodeTitle,
      selectedNode: safeObject(body.selectedNode),
      title: safeString(body.title) || `Lesson: ${nodeTitle || nodeId}`,
    });

    // Kick off background job. /sessions/start is only successful when Redis
    // accepted the BullMQ job; the frontend must not fall back to /teach-node.
    let job = null;
    try {
      job = await backgroundJob.enqueueLesson({
        sessionId:    session.sessionId,
        ownerKey:     context.ownerKey,
        resourceId,
        treeId,
        nodeId,
        nodeTitle,
        selectedNode: safeObject(body.selectedNode),
        body,
      });
    } catch (queueErr) {
      console.error("[startSession] BullMQ enqueue failed:", queueErr.message);
      await persistence.updateSessionStatus(session.sessionId, "failed", {
        "metadata.errorMessage": `BullMQ enqueue failed: ${queueErr.message}`,
        "metadata.failedAt": new Date().toISOString(),
      }).catch(() => {});

      return res.status(503).json({
        ok: false,
        sessionId: session.sessionId,
        status: "failed",
        jobQueued: false,
        error: "Background lesson job could not be queued. Redis/BullMQ must be healthy before teaching starts.",
        metadata: {
          fallbackUsed: false,
          enqueueError: queueErr.message,
        },
      });
    }

    res.status(201).json({
      ok:        true,
      sessionId: session.sessionId,
      status:    "created",
      jobQueued: true,
      jobId:     job?.jobId || `lesson_${session.sessionId}`,
      jobName:   job?.jobName || "teach_node",
      queueName: job?.queueName || backgroundJob.QUEUE_NAME,
      workerContractVersion: job?.workerContractVersion || backgroundJob.WORKER_CONTRACT_VERSION,
      streamUrl: `/api/google-agent/live-tutor/stage2/sessions/${session.sessionId}/stream`,
      statusUrl: `/api/google-agent/live-tutor/stage2/sessions/${session.sessionId}/status`,
      metadata:  {
        fallbackUsed: false,
        queueName: job?.queueName || backgroundJob.QUEUE_NAME,
        workerContractVersion: job?.workerContractVersion || backgroundJob.WORKER_CONTRACT_VERSION,
      },
    });
  } catch (error) {
    sendError(res, error, { endpoint: "startSession" });
  }
}

async function getSessionStatus(req, res) {
  try {
    const sessionId = safeString(req.params.sessionId);
    const statusDoc = await persistence.getSessionStatus(sessionId);

    if (!statusDoc) {
      return res.status(404).json({ ok: false, error: "Session not found", sessionId });
    }

    let jobStatus = null;
    try {
      jobStatus = await backgroundJob.getJobStatus(sessionId);
    } catch (_) {}

    const sessionMetadata = safeObject(statusDoc.metadata);

    res.status(200).json({
      ok: true,
      sessionId,
      status:   statusDoc.status,
      counts:   statusDoc.counts || {},
      nodeId:   statusDoc.nodeId,
      nodeTitle: statusDoc.nodeTitle,
      resourceId: statusDoc.resourceId,
      lastSegmentIndex: (statusDoc.metadata || {}).lastSegmentIndex,
      jobStatus,
      queueName: jobStatus?.queueName || backgroundJob.QUEUE_NAME,
      workerContractVersion: jobStatus?.workerContractVersion || backgroundJob.WORKER_CONTRACT_VERSION,
      sourceTruth: sessionMetadata.sourceTruth || jobStatus?.progress?.sourceTruth || null,
      metadata: {
        ...sessionMetadata,
        fallbackUsed: false,
        queueName: jobStatus?.queueName || backgroundJob.QUEUE_NAME,
        workerContractVersion: jobStatus?.workerContractVersion || backgroundJob.WORKER_CONTRACT_VERSION,
      },
    });
  } catch (error) {
    sendError(res, error, { endpoint: "getSessionStatus", sessionId: req.params.sessionId });
  }
}

function streamSession(req, res) {
  const sessionId = safeString(req.params.sessionId);

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Register this response for SSE events from the worker
  backgroundJob.sseRegister(sessionId, res);

  // Send initial heartbeat
  res.write(`event: connected\ndata: ${JSON.stringify({ sessionId, ts: Date.now() })}\n\n`);

  // Heartbeat every 25s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`:heartbeat ${Date.now()}\n\n`);
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    backgroundJob.sseUnregister(sessionId, res);
  });
}

async function getBook(req, res) {
  try {
    const context   = getOwnerContext(req);
    const sessionId = safeString(req.params.sessionId);

    const session = await persistence.loadSessionWithArtifacts(sessionId, context.ownerKey);
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found", sessionId });
    }

    res.status(200).json({
      ok:      true,
      sessionId,
      title:   session.title || session.nodeTitle,
      nodeId:  session.nodeId,
      status:  session.status,
      segments: session.segments || [],
      boardScreens:  session.boardScreens  || [],
      boardCommands: session.boardCommands || [],
      voiceScript:   session.voiceScript   || [],
      subtitles:     session.subtitles     || [],
      counts:  session.counts || {},
      metadata: { fallbackUsed: false },
    });
  } catch (error) {
    sendError(res, error, { endpoint: "getBook", sessionId: req.params.sessionId });
  }
}

async function getSessionSegment(req, res) {
  try {
    const context = getOwnerContext(req);
    const sessionId = safeString(req.params.sessionId);
    const segmentIndex = Number(req.params.segmentIndex);

    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
      return res.status(400).json({ ok: false, error: "segmentIndex must be a non-negative integer" });
    }

    const segment = await persistence.loadSessionSegment(sessionId, context.ownerKey, segmentIndex);
    if (!segment) {
      return res.status(404).json({ ok: false, error: "Segment not found", sessionId, segmentIndex });
    }

    res.status(200).json({
      ok: true,
      sessionId,
      segmentIndex,
      segment,
      boardScreens: segment.boardScreens || segment.premiumBoardScreens || [],
      boardCommands: segment.boardCommands || segment.commands || [],
      voiceScript: segment.voiceScript || [],
      subtitles: segment.subtitles || [],
      metadata: { fallbackUsed: false },
    });
  } catch (error) {
    sendError(res, error, {
      endpoint: "getSessionSegment",
      sessionId: req.params.sessionId,
    });
  }
}

module.exports = {
  health,
  powerTools,
  teachNode,
  interruptRepair,
  savePlaybackState,
  getSession,
  // New non-blocking session endpoints
  startSession,
  getSessionStatus,
  streamSession,
  getBook,
  getSessionSegment,
  debugVisionScan,
};

/**
 * STEP-3 CURL PROOF — POST /debug/vision-scan
 * Body: { ownerKey, resourceId, treeId, nodeId }
 * Runs the REAL chain: buildSourceContext → Python Vision Safety Net →
 * returns the vision proof JSON (pagesScanned, regions with bbox, ...).
 */
async function debugVisionScan(req, res) {
  const { spawn } = require("child_process");
  const path = require("path");
  try {
    const { ownerKey, resourceId, treeId, nodeId } = req.body || {};
    if (!resourceId || !nodeId) {
      return res.status(400).json({ ok: false, error: "resourceId and nodeId required" });
    }

    const packet = await buildSourceContext({
      ownerKey: ownerKey || "demo_user", resourceId, treeId, nodeId,
    });
    (packet.pageImages || []).forEach((i) => { delete i.base64; }); // paths suffice

    const python =
      process.env.GOOGLE_LIVE_TUTOR_PYTHON ||
      "/Users/jannatulferdouseva/miniconda3/envs/live-tutor-adk/bin/python";
    const script = path.resolve(__dirname, "../../google_agent/debug_vision_scan.py");

    const child = spawn(python, [script], {
      cwd: path.resolve(__dirname, "../.."),
      env: process.env,
    });
    let out = "", errOut = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { errOut += d; });
    child.stdin.write(JSON.stringify(packet));
    child.stdin.end();

    const code = await new Promise((r) => child.on("close", r));
    if (code !== 0) {
      return res.status(500).json({ ok: false, error: errOut.slice(-600) });
    }
    const vision = JSON.parse(out);
    return res.json({
      ok: vision.ok,
      step2: {
        evidence: (packet.selectedEvidence || []).length,
        sourceRefs: (packet.sourceRefs || []).length,
        pageImages: (packet.pageImages || []).map((i) => i.page),
        hasSummary: !!(packet.fullPdfSummary || {}).overview,
      },
      step3: vision,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
