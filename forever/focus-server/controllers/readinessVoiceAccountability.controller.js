import {
  getVoiceAccountabilitySettings,
  updateVoiceAccountabilitySettings,
  getNextVoiceAccountabilityTask,
  replyToVoiceAccountabilityTask,
  getVoiceAccountabilityHistory,
} from "../services/readiness/readinessVoiceAccountability.service.js";

/**
 * Daily Voice Accountability Controller
 *
 * Routes:
 * GET    /api/readiness-coach/voice/accountability/settings
 * PATCH  /api/readiness-coach/voice/accountability/settings
 * POST   /api/readiness-coach/voice/accountability/settings
 * GET    /api/readiness-coach/voice/accountability/next
 * POST   /api/readiness-coach/voice/accountability/reply
 * GET    /api/readiness-coach/voice/accountability/history
 */

function ok(res, data = {}, status = 200) {
  return res.status(status).json({
    ok: true,
    ...data,
  });
}

function fail(res, error) {
  const status = error?.status || error?.statusCode || 500;

  console.error("[Voice Accountability Controller]", error);

  return res.status(status).json({
    ok: false,
    message: error?.message || "Voice accountability request failed.",
    error: error?.message || "Voice accountability request failed.",
    code: error?.code || "voice_accountability_error",
  });
}

function getAuthUserId(req) {
  return String(
    req.user?._id ||
      req.user?.id ||
      req.user?.userId ||
      req.user?.email ||
      ""
  ).trim();
}

function withUser(req) {
  const userId = getAuthUserId(req);

  if (!userId) {
    const err = new Error("Authenticated user id missing.");
    err.status = 401;
    err.statusCode = 401;
    err.code = "auth_user_missing";
    throw err;
  }

  return {
    ...(req.query || {}),
    ...(req.body || {}),
    userId,
  };
}

export async function getVoiceAccountabilitySettingsHandler(req, res) {
  try {
    const data = await getVoiceAccountabilitySettings(withUser(req));
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

export async function updateVoiceAccountabilitySettingsHandler(req, res) {
  try {
    const data = await updateVoiceAccountabilitySettings(withUser(req));
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

export async function getNextVoiceAccountabilityTaskHandler(req, res) {
  try {
    const data = await getNextVoiceAccountabilityTask(withUser(req));
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

export async function replyToVoiceAccountabilityTaskHandler(req, res) {
  try {
    const data = await replyToVoiceAccountabilityTask(withUser(req));
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}

export async function getVoiceAccountabilityHistoryHandler(req, res) {
  try {
    const data = await getVoiceAccountabilityHistory(withUser(req));
    return ok(res, data);
  } catch (error) {
    return fail(res, error);
  }
}