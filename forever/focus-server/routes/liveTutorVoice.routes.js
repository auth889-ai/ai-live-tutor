import express from "express";

import {
  getLiveTutorVoiceHealth,
  getLiveTutorVoiceConfig,
  transcribeLiveTutorAudio,
  synthesizeLiveTutorSpeech,
  buildVoiceTutorPayload,
} from "../services/liveTutor/liveTutorVoice.service.js";

import { runLiveTutorOrchestrator } from "../services/liveTutor/liveTutorOrchestrator.service.js";

const router = express.Router();

function sendOk(res, data, status = 200) {
  return res.status(status).json(data);
}

function sendError(res, error, status = 500) {
  return res.status(status).json({
    ok: false,
    message: error?.message || "Live tutor voice request failed.",
    error:
      process.env.NODE_ENV === "production"
        ? undefined
        : String(error?.stack || error),
  });
}

function getUserId(req) {
  return (
    req.body?.userId ||
    req.query?.userId ||
    req.user?.id ||
    req.user?._id ||
    req.user?.email ||
    req.headers["x-user-id"] ||
    "guest"
  );
}

function getDeviceId(req) {
  return (
    req.body?.deviceId ||
    req.query?.deviceId ||
    req.headers["x-device-id"] ||
    req.headers["x-client-id"] ||
    "web"
  );
}

function buildBasePayload(req) {
  return {
    ...(req.body?.payload || {}),
    ...(req.body?.context || {}),

    userId: req.body?.userId || getUserId(req),
    deviceId: req.body?.deviceId || getDeviceId(req),
    sessionKey: req.body?.sessionKey || req.body?.payload?.sessionKey || "",

    requestMeta: {
      ip: req.ip,
      origin: req.headers.origin || "",
      extensionVersion:
        req.body?.extensionVersion ||
        req.headers["x-learnlens-extension"] ||
        "",
      receivedAt: new Date().toISOString(),
      route: "live-tutor-voice",
    },
  };
}

router.get("/health", async (req, res) => {
  try {
    const result = await getLiveTutorVoiceHealth();
    return sendOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/config", async (req, res) => {
  try {
    return sendOk(res, getLiveTutorVoiceConfig());
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * JSON audio transcription.
 *
 * Body:
 * {
 *   audioDataUrl: "data:audio/webm;base64,...",
 *   mimeType: "audio/webm",
 *   language: "auto|english|bangla",
 *   mode: "question|interrupt|explain_back",
 *   payload: { current page/video/marked-region payload }
 * }
 */
router.post("/transcribe", async (req, res) => {
  try {
    const result = await transcribeLiveTutorAudio({
      audioBase64: req.body?.audioBase64 || "",
      audioDataUrl: req.body?.audioDataUrl || "",
      mimeType: req.body?.mimeType || "",
      filename: req.body?.filename || "",
      language: req.body?.language || req.body?.languageHint || "auto",
      mode: req.body?.mode || "question",
      userId: getUserId(req),
      sessionKey: req.body?.sessionKey || req.body?.payload?.sessionKey || "",
      metadata: {
        deviceId: getDeviceId(req),
        route: "transcribe",
      },
    });

    return sendOk(res, result, result.ok ? 200 : 400);
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * TTS speech.
 *
 * Body:
 * {
 *   text: "AI speech",
 *   language: "auto|english|bangla",
 *   voice: "auto"
 * }
 */
router.post("/speak", async (req, res) => {
  try {
    const result = await synthesizeLiveTutorSpeech({
      text: req.body?.text || "",
      language: req.body?.language || req.body?.languageHint || "auto",
      voice: req.body?.voice || "auto",
      speed: req.body?.speed || 1,
      userId: getUserId(req),
      sessionKey: req.body?.sessionKey || req.body?.payload?.sessionKey || "",
      metadata: {
        deviceId: getDeviceId(req),
        route: "speak",
      },
    });

    return sendOk(res, result, result.ok ? 200 : 400);
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * Voice → STT → Live Tutor Orchestrator.
 *
 * Body:
 * {
 *   audioDataUrl,
 *   mode: "interrupt" | "explain_back" | "explain_frame",
 *   payload: {
 *     url,title,platform,videoId,timestampSeconds,selectedRect,
 *     screenshotDataUrl,transcriptWindow,visibleText,pageText,markedElements
 *   }
 * }
 */
router.post("/ask", async (req, res) => {
  try {
    const transcribed = await transcribeLiveTutorAudio({
      audioBase64: req.body?.audioBase64 || "",
      audioDataUrl: req.body?.audioDataUrl || "",
      mimeType: req.body?.mimeType || "",
      filename: req.body?.filename || "",
      language: req.body?.language || req.body?.languageHint || "auto",
      mode: req.body?.mode || "interrupt",
      userId: getUserId(req),
      sessionKey: req.body?.sessionKey || req.body?.payload?.sessionKey || "",
      metadata: {
        deviceId: getDeviceId(req),
        route: "ask",
      },
    });

    if (!transcribed.ok) {
      return sendOk(res, transcribed, 400);
    }

    const voicePayload = await buildVoiceTutorPayload({
      transcript: transcribed.text,
      mode: req.body?.mode || "interrupt",
      userQuestion: req.body?.userQuestion || "",
      studentAnswer: req.body?.studentAnswer || "",
      payload: buildBasePayload(req),
    });

    const tutorResult = await runLiveTutorOrchestrator(voicePayload.payload);

    return sendOk(res, {
      ok: tutorResult.ok !== false,
      transcript: transcribed,
      voicePayload,
      ...tutorResult,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * Voice transcript text → Live Tutor Orchestrator.
 * Useful when browser Web Speech API already transcribed audio.
 *
 * Body:
 * {
 *   transcript: "wait why complement?",
 *   mode: "interrupt" | "explain_back",
 *   payload: {...current context...}
 * }
 */
router.post("/ask-text", async (req, res) => {
  try {
    const voicePayload = await buildVoiceTutorPayload({
      transcript: req.body?.transcript || req.body?.voiceTranscript || "",
      mode: req.body?.mode || "interrupt",
      userQuestion: req.body?.userQuestion || "",
      studentAnswer: req.body?.studentAnswer || "",
      payload: buildBasePayload(req),
    });

    if (!voicePayload.transcript) {
      return sendOk(
        res,
        {
          ok: false,
          message: "transcript or voiceTranscript is required.",
        },
        400
      );
    }

    const tutorResult = await runLiveTutorOrchestrator(voicePayload.payload);

    return sendOk(res, {
      ok: tutorResult.ok !== false,
      voicePayload,
      ...tutorResult,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * AI text → TTS.
 * If bridge offline, returns fallback info so extension can use SpeechSynthesis.
 */
router.post("/speak-tutor-response", async (req, res) => {
  try {
    const text =
      req.body?.text ||
      req.body?.voiceScript?.fullSpeech ||
      req.body?.voiceScript?.shortSpeech ||
      req.body?.response?.shortAnswer ||
      req.body?.response?.explanation ||
      "";

    const result = await synthesizeLiveTutorSpeech({
      text,
      language:
        req.body?.language ||
        req.body?.voiceScript?.language ||
        req.body?.languageHint ||
        "auto",
      voice: req.body?.voice || "auto",
      speed: req.body?.speed || 1,
      userId: getUserId(req),
      sessionKey: req.body?.sessionKey || "",
      metadata: {
        deviceId: getDeviceId(req),
        route: "speak-tutor-response",
      },
    });

    return sendOk(res, result, result.ok ? 200 : 400);
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;