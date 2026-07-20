// server/controllers/study.controller.js

import * as studyService from "../services/study.service.js";
import StudyUserSettings from "../models/StudyUserSettings.js";

function success(res, data, message = "OK", status = 200) {
  return res.status(status).json({
    ok: true,
    message,
    data,
  });
}

function failure(res, error, fallbackStatus = 500) {
  const status = error?.statusCode || error?.status || fallbackStatus;

  return res.status(status).json({
    ok: false,
    message: error?.message || "Study request failed",
    details: error?.details || undefined,
  });
}

function clean(value = "") {
  return String(value || "").trim();
}

function getDeviceId(req) {
  return clean(
    req.params?.deviceId ||
      req.body?.deviceId ||
      req.query?.deviceId ||
      ""
  );
}

function getUserId(req) {
  return clean(
    req.body?.userId ||
      req.query?.userId ||
      req.user?._id ||
      req.user?.id ||
      ""
  );
}

function requireDeviceId(req) {
  const deviceId = getDeviceId(req);

  if (!deviceId) {
    const error = new Error("deviceId is required");
    error.statusCode = 400;
    throw error;
  }

  return deviceId;
}

function getLimit(req, fallback = 100) {
  const raw = Number(req.query?.limit || req.body?.limit || fallback);

  if (!Number.isFinite(raw)) return fallback;

  return Math.max(1, Math.min(500, Math.round(raw)));
}

function payload(req) {
  return {
    ...(req.query || {}),
    ...(req.body || {}),
    deviceId: getDeviceId(req),
    userId: getUserId(req),
  };
}

async function callService(names = [], args = []) {
  for (const name of names) {
    if (typeof studyService[name] === "function") {
      return studyService[name](...args);
    }
  }

  throw new Error(`Missing study service method: ${names.join(" or ")}`);
}

/**
 * Health
 */
export async function getStudyHealth(req, res) {
  try {
    const data =
      typeof studyService.getStudyHealth === "function"
        ? await studyService.getStudyHealth()
        : {
            status: "online",
            service: "study",
            at: new Date().toISOString(),
          };

    return success(res, data, "Study backend online");
  } catch (error) {
    return failure(res, error, 503);
  }
}

/**
 * Goal
 */
export async function setGoal(req, res) {
  try {
    const body = payload(req);

    if (!body.deviceId) {
      return failure(res, new Error("deviceId is required"), 400);
    }

    if (!clean(body.goal)) {
      return failure(res, new Error("goal is required"), 400);
    }

    const data = await callService(
      ["setStudyGoal", "saveStudyGoal", "createStudyGoal"],
      [body]
    );

    return success(res, data, "Study goal saved");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function getGoal(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await callService(
      ["getStudyGoal", "readStudyGoal", "getGoalDoc"],
      [
        {
          deviceId,
          userId,
        },
      ]
    );

    return success(res, data, "Study goal loaded");
  } catch (error) {
    return failure(res, error, 404);
  }
}

/**
 * Session
 */
export async function startSession(req, res) {
  try {
    const body = payload(req);

    if (!body.deviceId) {
      return failure(res, new Error("deviceId is required"), 400);
    }

    const data = await callService(
      ["startStudySession", "createStudySession"],
      [body]
    );

    return success(res, data, "Study session started");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function endSession(req, res) {
  try {
    const body = payload(req);

    if (!body.deviceId) {
      return failure(res, new Error("deviceId is required"), 400);
    }

    const data = await callService(["endStudySession", "stopStudySession"], [
      body,
    ]);

    return success(res, data, "Study session ended");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function getCurrentSession(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await callService(
      ["getCurrentStudySession", "getActiveStudySession"],
      [
        {
          deviceId,
          userId,
        },
      ]
    );

    return success(res, data, "Current session loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function getSessions(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await callService(["getStudySessions", "listStudySessions"], [
      deviceId,
      {
        userId,
        limit: getLimit(req, 50),
      },
    ]);

    return success(res, data, "Sessions loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

/**
 * Signals
 */
export async function receiveSignal(req, res) {
  try {
    const body = payload(req);

    if (!body.deviceId) {
      return failure(res, new Error("deviceId is required"), 400);
    }

    const data = await callService(
      ["processStudySignal", "receiveStudySignal", "analyzeStudySignal"],
      [body]
    );

    return success(res, data, "Signal analyzed");
  } catch (error) {
    console.error("STUDY SIGNAL ERROR:", error);
    return failure(res, error, 400);
  }
}

export async function receiveSignalBatch(req, res) {
  try {
    const body = payload(req);

    const data = await callService(
      ["processStudySignalBatch", "processSignalBatch", "receiveStudySignalBatch"],
      [body]
    );

    return success(res, data, "Signal batch analyzed");
  } catch (error) {
    console.error("STUDY SIGNAL BATCH ERROR:", error);
    return failure(res, error, 400);
  }
}

/**
 * Feedback / popup
 */
export async function submitFeedback(req, res) {
  try {
    const body = payload(req);

    // activityId is optional now. If it is missing, the service will use
    // the latest StudyActivity for this device/session so the user can open
    // the AI coach and talk without clicking a specific popup first.

    const data = await callService(
      ["submitUserFeedback", "sendFeedback", "saveUserFeedback"],
      [body]
    );

    return success(res, data, "Feedback saved");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function popupIgnored(req, res) {
  try {
    const body = payload(req);

    // activityId is optional now. If it is missing, the service will use
    // the latest StudyActivity for this device/session so the user can open
    // the AI coach and talk without clicking a specific popup first.

    const data = await callService(
      ["markPopupIgnored", "savePopupIgnored", "ignorePopup"],
      [body]
    );

    return success(res, data, "Popup ignore saved");
  } catch (error) {
    return failure(res, error, 400);
  }
}

/**
 * Voice reply
 *
 * Frontend should call:
 * POST /api/study/voice-reply
 *
 * This controller calls your service processVoiceReply().
 * That service should use local Ollama for chat.
 */
export async function voiceReply(req, res) {
  try {
    const body = payload(req);

    if (!body.deviceId) {
      return failure(res, new Error("deviceId is required"), 400);
    }

    // activityId is optional now. If it is missing, the service will use
    // the latest StudyActivity for this device/session so the user can open
    // the AI coach and talk without clicking a specific popup first.

    if (!clean(body.message || body.voiceAnswer || body.userAnswer)) {
      return failure(res, new Error("message is required"), 400);
    }

    const data = await callService(
      ["processVoiceReply", "processStudyVoiceReply", "handleVoiceReply"],
      [body]
    );

    return success(res, data, "Voice reply processed");
  } catch (error) {
    console.error("STUDY VOICE ERROR:", error);
    return failure(res, error, 400);
  }
}

/**
 * Dashboard / analytics / timeline / insights
 */
export async function getDashboard(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await callService(
      ["getDashboard", "getStudyDashboard", "buildDashboardData"],
      [
        deviceId,
        {
          userId,
          range: req.query?.range || "all",
          limit: getLimit(req, 140),
        },
      ]
    );

    return success(res, data, "Dashboard loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function getAnalytics(req, res) {
  try {
    const deviceId = getDeviceId(req);
    const userId = getUserId(req);

    if (!deviceId) {
      return failure(res, new Error("deviceId is required"), 400);
    }

    const data = await callService(
      ["getDashboard", "getStudyDashboard", "getStudyAnalytics"],
      [
        deviceId,
        {
          userId,
          range: req.query?.range || "all",
          limit: getLimit(req, 180),
        },
      ]
    );

    return success(res, data, "Analytics loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function getTodayAnalytics(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await callService(
      ["getDashboard", "getStudyDashboard", "getStudyAnalytics"],
      [
        deviceId,
        {
          userId,
          range: "today",
          limit: getLimit(req, 140),
        },
      ]
    );

    return success(res, data, "Today analytics loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function getWeeklyAnalytics(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await callService(
      ["getDashboard", "getStudyDashboard", "getStudyAnalytics"],
      [
        deviceId,
        {
          userId,
          range: "week",
          limit: getLimit(req, 180),
        },
      ]
    );

    return success(res, data, "Weekly analytics loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function getTimeline(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await callService(
      ["getTimeline", "getStudyTimeline", "listStudyTimeline"],
      [
        deviceId,
        {
          userId,
          range: req.query?.range || "all",
          limit: getLimit(req, 220),
          sessionId: req.query?.sessionId,
        },
      ]
    );

    return success(res, data, "Timeline loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function getInsights(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await callService(
      ["getInsights", "getStudyInsights", "buildStudyInsights"],
      [
        deviceId,
        {
          userId,
          range: req.query?.range || "week",
          limit: getLimit(req, 180),
        },
      ]
    );

    return success(res, data, "Insights loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

/**
 * Devices
 */
export async function getConnectedDevices(req, res) {
  try {
    const data = await callService(
      ["getConnectedStudyDevices", "getConnectedDevices", "listConnectedDevices"],
      [
        {
          deviceId: getDeviceId(req),
          userId: getUserId(req),
        },
      ]
    );

    return success(res, data, "Connected devices loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

/**
 * Settings
 *
 * This directly uses StudyUserSettings so it works even if your study.service.js
 * has no settings helpers yet.
 */
export async function getSettings(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await StudyUserSettings.findOneAndUpdate(
      {
        deviceId,
        userId,
      },
      {
        $setOnInsert: {
          deviceId,
          userId,
          screenshotEnabled: true,
          blurSensitiveInputs: true,
          voiceEnabled: true,
          strictness: "adaptive",
          privacyMode: "standard",
          screenshotMode: "adaptive",
          signalIntervalMs: 8000,
          screenshotIntervalMs: 45000,
          allowBrowserOverlay: true,
          allowNotifications: true,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    return success(res, data, "Settings loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function updateSettings(req, res) {
  try {
    const deviceId = getDeviceId(req);

    if (!deviceId) {
      return failure(res, new Error("deviceId is required"), 400);
    }

    const userId = getUserId(req);

    const allowed = [
      "screenshotEnabled",
      "blurSensitiveInputs",
      "voiceEnabled",
      "strictness",
      "privacyMode",
      "screenshotMode",
      "signalIntervalMs",
      "screenshotIntervalMs",
      "allowBrowserOverlay",
      "allowNotifications",
    ];

    const patch = {};

    for (const key of allowed) {
      if (req.body?.[key] !== undefined) {
        patch[key] = req.body[key];
      }
    }

    const data = await StudyUserSettings.findOneAndUpdate(
      {
        deviceId,
        userId,
      },
      {
        $set: {
          ...patch,
          deviceId,
          userId,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    return success(res, data, "Settings saved");
  } catch (error) {
    return failure(res, error, 400);
  }
}

/**
 * Conversations
 */
export async function getConversations(req, res) {
  try {
    const deviceId = requireDeviceId(req);
    const userId = getUserId(req);

    const data = await callService(
      ["getStudyConversations", "getConversations", "listStudyConversations"],
      [
        deviceId,
        {
          userId,
          sessionId: req.query?.sessionId,
          activityId: req.query?.activityId,
          limit: getLimit(req, 80),
        },
      ]
    );

    return success(res, data, "Conversations loaded");
  } catch (error) {
    return failure(res, error, 400);
  }
}

/**
 * Worker status optional
 */
export async function getWorkerStatus(req, res) {
  try {
    if (typeof studyService.getStudyWorkerStatus === "function") {
      const data = await studyService.getStudyWorkerStatus();
      return success(res, data, "Worker status loaded");
    }

    return success(
      res,
      {
        enabled: false,
        status: "not-configured",
      },
      "Worker status loaded"
    );
  } catch (error) {
    return failure(res, error, 400);
  }
}

export async function getWorkerJob(req, res) {
  try {
    if (typeof studyService.getStudyWorkerJob === "function") {
      const data = await studyService.getStudyWorkerJob(req.params?.jobId);
      return success(res, data, "Worker job loaded");
    }

    return success(
      res,
      {
        id: req.params?.jobId,
        status: "not-configured",
      },
      "Worker job loaded"
    );
  } catch (error) {
    return failure(res, error, 400);
  }
}