// server/controllers/gemmaResourceLiveTutor.controller.js
//
// FULL REPLACEMENT
//
// Separate controller for Gemma Resource Live Tutor only.
// Does NOT mix Ask Gemma / Book / Study Pack controller logic.
//
// Exports exactly the names routes/gemmaResourceLiveTutor.routes.js imports:
// - startResourceLiveTutor
// - controlResourceLiveTutor
// - interruptResourceLiveTutor
// - pauseResourceLiveTutor
// - resumeResourceLiveTutor
// - simplifyResourceLiveTutor
// - goBackResourceLiveTutor
// - quizResourceLiveTutor
// - getResourceLiveTutorSession
// - listResourceLiveTutorSessions
// - deleteResourceLiveTutorSession
//
// Flow:
// saved resource / PDF / YouTube transcript
// -> RAG
// -> Gemma boardCommands + voiceScript
// -> frontend teacher-like board
// -> interrupt / repair / continue
//
// No fake fallback.
// No static demo.
// No raw prompt/chunk/model internals exposed.

import {
  startLiveTutorSession,
  controlLiveTutorSession,
  interruptLiveTutorSession,
  getLiveTutorSession as serviceGetLiveTutorSession,
  listLiveTutorSessions as serviceListLiveTutorSessions,
  deleteLiveTutorSession as serviceDeleteLiveTutorSession,
} from "../services/gemmaResource/liveTutor/liveTutorSession.service.js";

function clean(value = "") {
  return String(value ?? "").trim();
}

function textClean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function num(value, fallback = undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback = false) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return "";
}

function getRequestId(req) {
  return (
    clean(req.headers?.["x-request-id"]) ||
    clean(req.headers?.["x-correlation-id"]) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function getClientIp(req) {
  return (
    clean(req.headers?.["x-forwarded-for"]) ||
    clean(req.headers?.["x-real-ip"]) ||
    clean(req.ip) ||
    clean(req.socket?.remoteAddress) ||
    ""
  );
}

function getIdentityFromReq(req) {
  const body = req.body || {};
  const query = req.query || {};
  const liveTutorIdentity = req.liveTutorIdentity || {};

  const deviceId = firstNonEmpty(
    liveTutorIdentity.deviceId,
    req.headers?.["x-device-id"],
    req.headers?.["x-gemma-device-id"],
    body.deviceId,
    query.deviceId
  );

  const offlineUserId = firstNonEmpty(
    liveTutorIdentity.offlineUserId,
    req.headers?.["x-offline-user-id"],
    req.headers?.["x-gemma-offline-user-id"],
    req.headers?.["x-local-user-id"],
    body.offlineUserId,
    query.offlineUserId
  );

  const userId = firstNonEmpty(
    liveTutorIdentity.userId,
    req.user?._id,
    req.user?.id,
    req.user?.userId,
    req.auth?.userId,
    body.userId,
    query.userId
  );

  const ownerKey = firstNonEmpty(
    liveTutorIdentity.ownerKey,
    req.headers?.["x-owner-key"],
    req.headers?.["x-gemma-owner-key"],
    body.ownerKey,
    query.ownerKey,
    offlineUserId ? `offline:${offlineUserId}` : "",
    userId ? `user:${userId}` : "",
    deviceId ? `device:${deviceId}` : ""
  );

  return {
    deviceId,
    offlineUserId,
    ownerKey,
    userId,
  };
}

function getDepthFromReq(req) {
  const body = req.body || {};
  const query = req.query || {};
  const runtimeState = body.runtimeState || {};
  const depth = runtimeState.depth || {};

  const lessonDurationMode = firstNonEmpty(
    body.lessonDurationMode,
    body.durationMode,
    body.depth,
    body.explainDepth,
    runtimeState.lessonDurationMode,
    depth.mode,
    query.lessonDurationMode,
    query.durationMode,
    query.depth,
    query.explainDepth
  );

  const targetTotalMinutes = num(
    firstNonEmpty(
      body.targetTotalMinutes,
      body.totalMinutes,
      runtimeState.targetTotalMinutes,
      depth.targetTotalMinutes,
      query.targetTotalMinutes,
      query.totalMinutes
    ),
    undefined
  );

  const segmentDurationSec = num(
    firstNonEmpty(
      body.segmentDurationSec,
      body.segmentSeconds,
      body.targetSegmentSeconds,
      runtimeState.segmentDurationSec,
      runtimeState.targetSegmentSec,
      depth.targetSegmentSec,
      query.segmentDurationSec,
      query.segmentSeconds,
      query.targetSegmentSeconds
    ),
    undefined
  );

  return {
    ...(lessonDurationMode ? { lessonDurationMode } : {}),
    ...(targetTotalMinutes !== undefined ? { targetTotalMinutes } : {}),
    ...(segmentDurationSec !== undefined ? { segmentDurationSec } : {}),
  };
}

function getRuntimeStateFromReq(req) {
  const body = req.body || {};
  const runtimeState = body.runtimeState || {};
  const boardState = body.boardState || runtimeState.boardState || {};

  return {
    currentTime: num(body.currentTime ?? body.currentTimeSec ?? runtimeState.currentTime, 0),
    currentTimeSec: num(body.currentTimeSec ?? body.currentTime ?? runtimeState.currentTimeSec, 0),
    currentVoiceTime: num(body.currentVoiceTime ?? body.currentTime ?? body.currentTimeSec, 0),
    currentCommandIndex: num(body.currentCommandIndex ?? runtimeState.currentCommandIndex, 0),
    currentCommandId: clean(body.currentCommandId || runtimeState.currentCommandId || ""),
    currentVoiceLineIndex: num(body.currentVoiceLineIndex ?? runtimeState.currentVoiceLineIndex, 0),
    currentVoiceLineId: clean(body.currentVoiceLineId || runtimeState.currentVoiceLineId || ""),
    visibleCommandIds: asArray(body.visibleCommandIds || runtimeState.visibleCommandIds).map(clean).filter(Boolean),
    visibleCommands: asArray(body.visibleCommands || runtimeState.visibleCommands).slice(0, 120),
    boardState,
    runtimeState,
  };
}

function getSelectionFromReq(req) {
  const body = req.body || {};
  const query = req.query || {};

  return {
    selectedText: firstNonEmpty(body.selectedText, body.selection, query.selectedText),
    sectionId: firstNonEmpty(body.sectionId, body.selectedSectionId, query.sectionId),
    sectionTitle: firstNonEmpty(body.sectionTitle, body.selectedSection?.title, query.sectionTitle),
    selectedChunkIds: Array.isArray(body.selectedChunkIds) ? body.selectedChunkIds : [],
  };
}

function buildLiveTutorInput(req, overrides = {}) {
  const body = req.body || {};
  const query = req.query || {};
  const params = req.params || {};

  const identity = getIdentityFromReq(req);
  const depth = getDepthFromReq(req);
  const runtime = getRuntimeStateFromReq(req);
  const selection = getSelectionFromReq(req);

  const resourceId = firstNonEmpty(
    overrides.resourceId,
    params.resourceId,
    params.id,
    body.resourceId,
    query.resourceId
  );

  const sessionId = firstNonEmpty(
    overrides.sessionId,
    params.sessionId,
    params.boardId,
    body.sessionId,
    body.boardId,
    body.sessionKey,
    query.sessionId,
    query.boardId,
    query.sessionKey
  );

  const action = firstNonEmpty(overrides.action, body.action, query.action, "start");

  return {
    ...body,
    ...identity,
    ...depth,
    ...runtime,
    ...selection,

    resourceId,
    sessionId,
    boardId: sessionId,
    sessionKey: firstNonEmpty(body.sessionKey, query.sessionKey, sessionId),

    action,

    question: firstNonEmpty(body.question, body.prompt, body.instruction, query.question, query.prompt),
    instruction: firstNonEmpty(body.instruction, body.prompt, query.instruction, query.prompt),
    interruptText: firstNonEmpty(body.interruptText, body.voiceText, body.message, query.interruptText),

    language: firstNonEmpty(body.language, query.language, "auto"),
    limit: num(firstNonEmpty(body.limit, query.limit), 18),

    allowExternal: bool(body.allowExternal ?? query.allowExternal, false),
    externalKnowledge: bool(body.externalKnowledge ?? query.externalKnowledge, false),
    autoContinue: body.autoContinue !== false && query.autoContinue !== "false",

    nextCursor: firstNonEmpty(
      body.nextCursor,
      body.cursor,
      body.runtimeState?.nextCursor,
      query.nextCursor,
      query.cursor
    ),
    cursor: firstNonEmpty(
      body.cursor,
      body.nextCursor,
      body.runtimeState?.nextCursor,
      query.cursor,
      query.nextCursor
    ),

    model: firstNonEmpty(body.model, query.model),

    runtimeState: {
      ...(body.runtimeState || {}),
      ...depth,
      currentTime: num(body.currentTime ?? body.currentTimeSec, 0),
      currentTimeSec: num(body.currentTimeSec ?? body.currentTime, 0),
      currentVoiceTime: num(body.currentVoiceTime ?? body.currentTime ?? body.currentTimeSec, 0),
      currentCommandIndex: num(body.currentCommandIndex, 0),
      currentCommandId: clean(body.currentCommandId || ""),
      currentVoiceLineIndex: num(body.currentVoiceLineIndex, 0),
      currentVoiceLineId: clean(body.currentVoiceLineId || ""),
      visibleCommandIds: asArray(body.visibleCommandIds).map(clean).filter(Boolean),
      visibleCommands: asArray(body.visibleCommands).slice(0, 120),
      boardState: body.boardState || {},
      nextCursor: firstNonEmpty(body.nextCursor, body.cursor, body.runtimeState?.nextCursor),
    },

    clientMeta: {
      ...(body.clientMeta || {}),
      userAgent: clean(req.headers?.["user-agent"]),
      ip: getClientIp(req),
      requestId: getRequestId(req),
      identity: {
        ownerKey: identity.ownerKey,
        hasOfflineUser: Boolean(identity.offlineUserId),
        hasSafeDevice: Boolean(identity.deviceId && identity.deviceId.length >= 8),
      },
      depth,
    },
  };
}

function unwrapServiceData(result) {
  if (result && result.ok === true && result.data) return result.data;
  return result || {};
}

function stripPrivateFields(data = {}) {
  if (!data || typeof data !== "object") return data;

  const safe = { ...data };

  delete safe.rag;
  delete safe.rawRag;
  delete safe.rawChunks;
  delete safe.internalContext;
  delete safe.externalContext;
  delete safe.rawGemma;
  delete safe.prompt;
  delete safe.modelPrompt;
  delete safe.modelUrl;
  delete safe.apiKey;
  delete safe.env;
  delete safe.stack;
  delete safe.debug;

  if (safe.diagnostics && typeof safe.diagnostics === "object") {
    safe.diagnostics = {
      ragChunks: safe.diagnostics.ragChunks,
      grounded: safe.diagnostics.grounded,
      ragUsed: safe.diagnostics.ragUsed,
      langGraphUsed: safe.diagnostics.langGraphUsed,
      langChainUsed: safe.diagnostics.langChainUsed,
      gemmaPlanRich: safe.diagnostics.gemmaPlanRich,
      boardCommandsReady: safe.diagnostics.boardCommandsReady,
      voiceScriptReady: safe.diagnostics.voiceScriptReady,
      visualCommandTypes: safe.diagnostics.visualCommandTypes,
      voiceSeconds: safe.diagnostics.voiceSeconds,
      noDuplicate: safe.diagnostics.noDuplicate,
      noFakeFallback: safe.diagnostics.noFakeFallback,
      noStaticDemo: safe.diagnostics.noStaticDemo,
      quality: safe.diagnostics.quality,
    };
  }

  return safe;
}

function sendOk(res, message, data, status = 200) {
  const payload = stripPrivateFields(unwrapServiceData(data));

  return res.status(status).json({
    ok: true,
    message,
    ...payload,
    data: payload,
  });
}

function statusFromError(error) {
  const message = clean(error?.message || "").toLowerCase();

  if (message.includes("not found")) return 404;

  if (
    message.includes("privacy") ||
    message.includes("forbidden") ||
    message.includes("do not have access") ||
    message.includes("unauthorized") ||
    message.includes("not accessible")
  ) {
    return 403;
  }

  if (
    message.includes("resourceid is required") ||
    message.includes("invalid resourceid") ||
    message.includes("deviceid is required") ||
    message.includes("offline") ||
    message.includes("identity")
  ) {
    return 400;
  }

  if (message.includes("no rag chunks") || message.includes("not indexed")) return 422;
  if (message.includes("timed out") || message.includes("timeout")) return 504;

  return 500;
}

function publicErrorMessage(error) {
  const message = clean(error?.message || String(error || "Live tutor request failed."));

  if (/api[_-]?key|token|secret|password|authorization/i.test(message)) {
    return "Live tutor request failed because a server configuration is missing.";
  }

  return message || "Live tutor request failed.";
}

function sendError(res, error, status = 500) {
  const message = publicErrorMessage(error);

  return res.status(status).json({
    ok: false,
    message,
    error: {
      name: error?.name || "Error",
      message,
    },
  });
}

/**
 * Health
 */
export async function liveTutorHealth(_req, res) {
  return res.json({
    ok: true,
    service: "gemma-resource-live-tutor",
    purpose: "Offline saved-resource human-like AI tutor board",
    mode: process.env.OFFLINE_MODE === "true" ? "offline" : "hybrid",
    strict: {
      fakeFallbackAllowed: false,
      staticDemoAllowed: false,
      requiresSavedResource: true,
      requiresRagGrounding: true,
      requiresBoardCommands: true,
      requiresVoiceScript: true,
    },
    privacy: {
      perUserSession: true,
      perOfflineUserSession: true,
      perDeviceGuestSession: true,
      sharedGuestBlocked: true,
      serviceOwnershipCheckRequired: true,
      acceptedHeaders: [
        "x-device-id",
        "x-offline-user-id",
        "x-gemma-offline-user-id",
        "x-owner-key",
      ],
    },
    tools: {
      rag: true,
      embeddings: true,
      langChain: true,
      langGraph: true,
      boardCommands: true,
      voiceScript: true,
      sessionReplay: true,
      interruptRepair: true,
    },
    depth: {
      acceptedFields: [
        "lessonDurationMode",
        "durationMode",
        "depth",
        "explainDepth",
        "targetTotalMinutes",
        "totalMinutes",
        "segmentDurationSec",
        "segmentSeconds",
        "targetSegmentSeconds",
      ],
      modes: ["quick", "normal", "deep", "masterclass"],
    },
    endpoints: {
      start: "POST /resource/:resourceId/start",
      control: "POST /resource/:resourceId/control",
      interrupt: "POST /resource/:resourceId/interrupt",
      pause: "POST /session/:sessionId/pause",
      resume: "POST /session/:sessionId/resume",
      readSession: "GET /session/:sessionId",
      listSessions: "GET /sessions",
      deleteSession: "DELETE /session/:sessionId",
    },
  });
}

/**
 * Resource live tutor actions
 */
export async function startResourceLiveTutor(req, res) {
  try {
    const input = buildLiveTutorInput(req, { action: "start" });
    const data = await startLiveTutorSession(input);
    return sendOk(res, "Live tutor started from saved resource.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

export async function controlResourceLiveTutor(req, res) {
  try {
    const input = buildLiveTutorInput(req);
    const data = await controlLiveTutorSession(input);
    return sendOk(res, "Live tutor control action completed.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

export async function interruptResourceLiveTutor(req, res) {
  try {
    const input = buildLiveTutorInput(req, { action: "interrupt" });
    const data = await interruptLiveTutorSession(input);
    return sendOk(res, "Live tutor repaired from interrupt point.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

export async function pauseResourceLiveTutor(req, res) {
  try {
    const input = buildLiveTutorInput(req, { action: "pause" });
    const data = await controlLiveTutorSession(input);
    return sendOk(res, "Live tutor paused.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

export async function resumeResourceLiveTutor(req, res) {
  try {
    const input = buildLiveTutorInput(req, { action: "continue" });
    const data = await controlLiveTutorSession(input);
    return sendOk(res, "Live tutor resumed.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

export async function simplifyResourceLiveTutor(req, res) {
  try {
    const input = buildLiveTutorInput(req, { action: "simpler" });
    const data = await controlLiveTutorSession(input);
    return sendOk(res, "Live tutor simplified the current step.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

export async function goBackResourceLiveTutor(req, res) {
  try {
    const input = buildLiveTutorInput(req, { action: "go_back" });
    const data = await controlLiveTutorSession(input);
    return sendOk(res, "Live tutor moved one step back.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

export async function quizResourceLiveTutor(req, res) {
  try {
    const input = buildLiveTutorInput(req, { action: "quiz" });
    const data = await controlLiveTutorSession(input);
    return sendOk(res, "Live tutor created a check question.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

/**
 * Session actions
 */
export async function getResourceLiveTutorSession(req, res) {
  try {
    const input = buildLiveTutorInput(req, {
      action: "read",
      sessionId: req.params?.sessionId,
    });

    const data = await serviceGetLiveTutorSession(input.sessionId, input);
    return sendOk(res, "Live tutor session loaded.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

export async function listResourceLiveTutorSessions(req, res) {
  try {
    const input = buildLiveTutorInput(req, { action: "list" });
    const data = await serviceListLiveTutorSessions(input);
    return sendOk(res, "Live tutor sessions loaded.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

export async function deleteResourceLiveTutorSession(req, res) {
  try {
    const input = buildLiveTutorInput(req, {
      action: "delete",
      sessionId: req.params?.sessionId,
    });

    const data = await serviceDeleteLiveTutorSession(input.sessionId, input);
    return sendOk(res, "Live tutor session deleted.", data);
  } catch (error) {
    return sendError(res, error, statusFromError(error));
  }
}

/**
 * Compatibility aliases.
 */
export const health = liveTutorHealth;
export const liveTutorHealthCheck = liveTutorHealth;
export const getLiveTutorHealth = liveTutorHealth;

export const start = startResourceLiveTutor;
export const startLiveTutor = startResourceLiveTutor;
export const startLiveTutorFromResource = startResourceLiveTutor;
export const startLiveTutorBoard = startResourceLiveTutor;
export const startResourceLiveTutorSession = startResourceLiveTutor;
export const startLiveTutorSessionFromResource = startResourceLiveTutor;
export const createResourceLiveTutorSession = startResourceLiveTutor;
export const createLiveTutorSession = startResourceLiveTutor;

export const control = controlResourceLiveTutor;
export const controlLiveTutor = controlResourceLiveTutor;
export const controlLiveTutorFromResource = controlResourceLiveTutor;
export const controlLiveTutorBoard = controlResourceLiveTutor;
export const controlResourceLiveTutorSession = controlResourceLiveTutor;
export const updateResourceLiveTutorSession = controlResourceLiveTutor;

export const interrupt = interruptResourceLiveTutor;
export const interruptLiveTutor = interruptResourceLiveTutor;
export const interruptLiveTutorFromResource = interruptResourceLiveTutor;
export const interruptLiveTutorBoard = interruptResourceLiveTutor;
export const interruptResourceLiveTutorSession = interruptResourceLiveTutor;

export const pause = pauseResourceLiveTutor;
export const pauseLiveTutorSession = pauseResourceLiveTutor;
export const pauseResourceLiveTutorSession = pauseResourceLiveTutor;

export const resume = resumeResourceLiveTutor;
export const resumeLiveTutorSession = resumeResourceLiveTutor;
export const resumeResourceLiveTutorSession = resumeResourceLiveTutor;

export const stop = pauseResourceLiveTutor;
export const stopLiveTutorSession = pauseResourceLiveTutor;
export const stopResourceLiveTutorSession = pauseResourceLiveTutor;

export const simplifyLiveTutor = simplifyResourceLiveTutor;
export const simplerResourceLiveTutor = simplifyResourceLiveTutor;
export const simplifyLiveTutorBoard = simplifyResourceLiveTutor;
export const simplifyResourceLiveTutorSession = simplifyResourceLiveTutor;

export const goBackLiveTutor = goBackResourceLiveTutor;
export const goBackLiveTutorBoard = goBackResourceLiveTutor;
export const goBackResourceLiveTutorSession = goBackResourceLiveTutor;

export const quizLiveTutor = quizResourceLiveTutor;
export const quizLiveTutorBoard = quizResourceLiveTutor;
export const quizResourceLiveTutorSession = quizResourceLiveTutor;

export const read = getResourceLiveTutorSession;
export const get = getResourceLiveTutorSession;
export const getLiveTutor = getResourceLiveTutorSession;
export const getLiveTutorSessionById = getResourceLiveTutorSession;
export const readLiveTutorSession = getResourceLiveTutorSession;
export const readResourceLiveTutorSession = getResourceLiveTutorSession;

export const list = listResourceLiveTutorSessions;
export const listLiveTutorSessions = listResourceLiveTutorSessions;
export const getLiveTutorSessions = listResourceLiveTutorSessions;

export const remove = deleteResourceLiveTutorSession;
export const deleteLiveTutorSession = deleteResourceLiveTutorSession;
export const deleteLiveTutorSessionById = deleteResourceLiveTutorSession;

export default {
  liveTutorHealth,
  health,
  liveTutorHealthCheck,
  getLiveTutorHealth,

  startResourceLiveTutor,
  start,
  startLiveTutor,
  startLiveTutorFromResource,
  startLiveTutorBoard,
  startResourceLiveTutorSession,
  startLiveTutorSessionFromResource,
  createResourceLiveTutorSession,
  createLiveTutorSession,

  controlResourceLiveTutor,
  control,
  controlLiveTutor,
  controlLiveTutorFromResource,
  controlLiveTutorBoard,
  controlResourceLiveTutorSession,
  updateResourceLiveTutorSession,

  interruptResourceLiveTutor,
  interrupt,
  interruptLiveTutor,
  interruptLiveTutorFromResource,
  interruptLiveTutorBoard,
  interruptResourceLiveTutorSession,

  pauseResourceLiveTutor,
  pause,
  pauseLiveTutorSession,
  pauseResourceLiveTutorSession,

  resumeResourceLiveTutor,
  resume,
  resumeLiveTutorSession,
  resumeResourceLiveTutorSession,

  simplifyResourceLiveTutor,
  simplifyLiveTutor,
  simplerResourceLiveTutor,
  simplifyLiveTutorBoard,
  simplifyResourceLiveTutorSession,

  goBackResourceLiveTutor,
  goBackLiveTutor,
  goBackLiveTutorBoard,
  goBackResourceLiveTutorSession,

  quizResourceLiveTutor,
  quizLiveTutor,
  quizLiveTutorBoard,
  quizResourceLiveTutorSession,

  getResourceLiveTutorSession,
  read,
  get,
  getLiveTutor,
  getLiveTutorSessionById,
  readLiveTutorSession,
  readResourceLiveTutorSession,

  listResourceLiveTutorSessions,
  list,
  listLiveTutorSessions,
  getLiveTutorSessions,

  deleteResourceLiveTutorSession,
  remove,
  deleteLiveTutorSession,
  deleteLiveTutorSessionById,
};