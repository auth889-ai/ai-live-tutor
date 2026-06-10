"use strict";

const express = require("express");
const controller = require("../controllers/googleLiveTutorStage2.controller");

const router = express.Router();

// ── Existing routes ───────────────────────────────────────────────────────────
router.get("/health",      controller.health);
router.get("/power-tools", controller.powerTools);
router.post("/teach-node", controller.teachNode);
router.post("/interrupt",  controller.interruptRepair);

// ── New non-blocking session routes ──────────────────────────────────────────
// Start a lesson in background, returns sessionId immediately
router.post("/sessions/start", controller.startSession);

// Poll session status (boardCommands count, status, segment progress)
router.get("/sessions/:sessionId/status", controller.getSessionStatus);

// SSE stream: frontend subscribes to real-time progress events
router.get("/sessions/:sessionId/stream", controller.streamSession);

// Return full lesson as flipbook (all segments)
router.get("/sessions/:sessionId/book", controller.getBook);

// Existing session routes
router.post("/sessions/:sessionId/playback-state", controller.savePlaybackState);
router.get("/sessions/:sessionId", controller.getSession);

module.exports = router;
