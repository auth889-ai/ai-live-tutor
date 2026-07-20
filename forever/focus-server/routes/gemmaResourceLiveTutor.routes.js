// server/routes/gemmaResourceLiveTutor.routes.js
//
// FULL REPLACEMENT
//
// Separate route file for Gemma Resource Live Tutor only.
// Base can be mounted as:
//   /api/gemma-resource-live-tutor
// and/or alias:
//   /api/gemma-resource/live-tutor
//
// This route does not handle Ask Gemma / Book / Study Pack.
// It only handles:
// saved resource / uploaded PDF / saved YouTube transcript
// -> RAG
// -> Gemma boardCommands + voiceScript
// -> frontend teacher-like board
// -> interrupt / pause / continue

import express from "express";

import {
  offlineLiveTutorIdentity,
  requireOfflineLiveTutorIdentity,
  requireLiveTutorWriteIdentity,
  getLiveTutorIdentityDebug,
} from "../middleware/offlineLiveTutorIdentity.middleware.js";

import {
  liveTutorHealth,
  startResourceLiveTutor,
  controlResourceLiveTutor,
  interruptResourceLiveTutor,
  pauseResourceLiveTutor,
  resumeResourceLiveTutor,
  simplifyResourceLiveTutor,
  goBackResourceLiveTutor,
  quizResourceLiveTutor,
  getResourceLiveTutorSession,
  listResourceLiveTutorSessions,
  deleteResourceLiveTutorSession,
} from "../controllers/gemmaResourceLiveTutor.controller.js";

const router = express.Router();

router.use(express.json({ limit: process.env.JSON_LIMIT || "15mb" }));

function clean(value = "") {
  return String(value ?? "").trim();
}

function getHeader(req, name) {
  const lower = String(name || "").toLowerCase();
  return clean(req.headers?.[name] || req.headers?.[lower] || "");
}

function ensureBody(req) {
  if (!req.body || typeof req.body !== "object") {
    req.body = {};
  }
}

/**
 * Header compatibility bridge.
 *
 * Frontend may send:
 * - x-offline-user-id
 * - x-gemma-offline-user-id
 * - x-device-id
 * - x-owner-key
 *
 * Older middleware may only read one of them.
 * This bridge normalizes headers/body before identity middleware runs.
 */
function normalizeLiveTutorIdentityHeaders(req, _res, next) {
  ensureBody(req);

  const gemmaOfflineUserId = getHeader(req, "x-gemma-offline-user-id");
  const offlineUserId = getHeader(req, "x-offline-user-id");

  if (gemmaOfflineUserId && !offlineUserId) {
    req.headers["x-offline-user-id"] = gemmaOfflineUserId;
  }

  if (offlineUserId && !gemmaOfflineUserId) {
    req.headers["x-gemma-offline-user-id"] = offlineUserId;
  }

  const ownerKey = getHeader(req, "x-owner-key");
  if (ownerKey && !req.body.ownerKey) {
    req.body.ownerKey = ownerKey;
  }

  const deviceId = getHeader(req, "x-device-id");
  if (deviceId && !req.body.deviceId) {
    req.body.deviceId = deviceId;
  }

  const finalOfflineUserId = getHeader(req, "x-offline-user-id") || getHeader(req, "x-gemma-offline-user-id");
  if (finalOfflineUserId && !req.body.offlineUserId) {
    req.body.offlineUserId = finalOfflineUserId;
  }

  if (!req.body.ownerKey && finalOfflineUserId) {
    req.body.ownerKey = `offline:${finalOfflineUserId}`;
  }

  return next();
}

/**
 * Public health route.
 * No identity required.
 */
router.get("/health", liveTutorHealth);

/**
 * Identity + privacy guard applies after health only.
 */
router.use(normalizeLiveTutorIdentityHeaders);
router.use(offlineLiveTutorIdentity);
router.use(requireOfflineLiveTutorIdentity);
router.use(requireLiveTutorWriteIdentity);

/**
 * Safe identity debug.
 * No secret, no chunks, no transcript, no prompt.
 */
router.get("/debug/identity", (req, res) => {
  res.json({
    ok: true,
    identity: getLiveTutorIdentityDebug(req),
  });
});

/**
 * Main resource actions.
 *
 * Actual frontend should call:
 * POST /api/gemma-resource/live-tutor/resource/:resourceId/start
 * POST /api/gemma-resource/live-tutor/resource/:resourceId/control
 * POST /api/gemma-resource/live-tutor/resource/:resourceId/interrupt
 */
router.post("/resource/:resourceId/start", startResourceLiveTutor);
router.post("/resource/:resourceId/control", controlResourceLiveTutor);
router.post("/resource/:resourceId/interrupt", interruptResourceLiveTutor);

/**
 * Convenience resource action routes.
 */
router.post("/resource/:resourceId/pause", pauseResourceLiveTutor);
router.post("/resource/:resourceId/resume", resumeResourceLiveTutor);
router.post("/resource/:resourceId/continue", resumeResourceLiveTutor);
router.post("/resource/:resourceId/simpler", simplifyResourceLiveTutor);
router.post("/resource/:resourceId/simplify", simplifyResourceLiveTutor);
router.post("/resource/:resourceId/go-back", goBackResourceLiveTutor);
router.post("/resource/:resourceId/go_back", goBackResourceLiveTutor);
router.post("/resource/:resourceId/quiz", quizResourceLiveTutor);

/**
 * Session actions.
 */
router.post("/session/:sessionId/pause", pauseResourceLiveTutor);
router.post("/session/:sessionId/resume", resumeResourceLiveTutor);
router.post("/session/:sessionId/continue", resumeResourceLiveTutor);
router.post("/session/:sessionId/interrupt", interruptResourceLiveTutor);
router.post("/session/:sessionId/simpler", simplifyResourceLiveTutor);
router.post("/session/:sessionId/simplify", simplifyResourceLiveTutor);
router.post("/session/:sessionId/go-back", goBackResourceLiveTutor);
router.post("/session/:sessionId/go_back", goBackResourceLiveTutor);
router.post("/session/:sessionId/quiz", quizResourceLiveTutor);

/**
 * Session read/list/delete.
 */
router.get("/session/:sessionId", getResourceLiveTutorSession);
router.get("/sessions", listResourceLiveTutorSessions);
router.delete("/session/:sessionId", deleteResourceLiveTutorSession);

/**
 * Compatibility aliases for older Tutor Board frontend naming.
 */
router.post("/resource/:resourceId/tutor-board/start", startResourceLiveTutor);
router.post("/resource/:resourceId/tutor-board/control", controlResourceLiveTutor);
router.post("/resource/:resourceId/tutor-board/interrupt", interruptResourceLiveTutor);
router.post("/resource/:resourceId/live-board/start", startResourceLiveTutor);
router.post("/resource/:resourceId/live-board/control", controlResourceLiveTutor);
router.post("/resource/:resourceId/live-board/interrupt", interruptResourceLiveTutor);

/**
 * Compatibility aliases for old start paths.
 * Kept separate from main Gemma Resource routes; no Ask/Book/Study Pack mixing.
 */
router.post("/:resourceId/start", startResourceLiveTutor);
router.post("/:resourceId/control", controlResourceLiveTutor);
router.post("/:resourceId/interrupt", interruptResourceLiveTutor);

export default router;