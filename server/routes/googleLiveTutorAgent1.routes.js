"use strict";

/**
 * server/routes/googleLiveTutorAgent1.routes.js
 * =============================================================================
 * Agent 1 routes.
 *
 * Mount in server.js / app.js:
 *
 *   const googleLiveTutorAgent1Routes = require("./routes/googleLiveTutorAgent1.routes");
 *   app.use("/api/google-agent/live-tutor", googleLiveTutorAgent1Routes);
 *
 * Endpoints:
 *   GET  /api/google-agent/live-tutor/agent1/health
 *   POST /api/google-agent/live-tutor/resources/upload
 *   POST /api/google-agent/live-tutor/resources/text
 *   GET  /api/google-agent/live-tutor/resources
 *   GET  /api/google-agent/live-tutor/resources/:resourceId
 *   GET  /api/google-agent/live-tutor/resources/:resourceId/chunks
 *   POST /api/google-agent/live-tutor/resources/:resourceId/agent1/text-visual
 * =============================================================================
 */

const express = require("express");
const multer = require("multer");

const controller = require("../controllers/googleLiveTutorAgent1.controller");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.AGENT1_MAX_UPLOAD_BYTES || 80 * 1024 * 1024),
  },
});

function attachRequestId(req, res, next) {
  req.requestId =
    req.headers["x-request-id"] ||
    `agent1_req_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  res.setHeader("x-request-id", req.requestId);
  next();
}

router.use(attachRequestId);

/**
 * Health.
 */
router.get("/agent1/health", controller.health);

/**
 * Resource upload.
 * Field name must be "file".
 */
router.post("/resources/upload", upload.single("file"), controller.uploadResource);

/**
 * Text/transcript/url resource.
 *
 * Body examples:
 *   { "title":"Lecture transcript", "text":"..." }
 *   { "title":"YouTube transcript", "transcript":"..." }
 *   { "title":"URL transcript", "url":"https://..." }
 */
router.post("/resources/text", express.json({ limit: "20mb" }), controller.createTextResource);

/**
 * Resource navigation.
 */
router.get("/resources", controller.listResources);
router.get("/resources/:resourceId", controller.getResource);
router.get("/resources/:resourceId/chunks", controller.getChunks);

/**
 * Agent 1:
 * PDF/text/transcript resource -> Mermaid/table/text visuals.
 */
router.post(
  "/resources/:resourceId/agent1/text-visual",
  express.json({ limit: "30mb" }),
  controller.runAgent1TextVisual
);

module.exports = router;