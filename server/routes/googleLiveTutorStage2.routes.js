 "use strict";

/**
 * server/routes/googleLiveTutorStage2.routes.js
 * =============================================================================
 * Routes for Stage 2 Human-Like Live Tutor.
 * =============================================================================
 */

const express = require("express");

const controller = require("../controllers/googleLiveTutorStage2.controller");

const router = express.Router();

router.get("/health", controller.health);

router.post("/teach-node", controller.teachNode);

router.post("/interrupt", controller.interruptRepair);

router.post("/sessions/:sessionId/playback-state", controller.savePlaybackState);

router.get("/sessions/:sessionId", controller.getSession);

module.exports = router;