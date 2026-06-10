"use strict";

/**
 * server/app.js
 * =============================================================================
 * AI Live Tutor Rebuild — Agent 1 + Stage 1 Concept Tree + Stage 2 Live Tutor
 *
 * This app mounts:
 * - Agent 1:
 *   - PDF/text/transcript upload
 *   - MongoDB resource/chunk storage
 *   - real Python Gemini Agent 1
 *   - Mermaid/table visual generation
 *   - source refs / page refs / voiceScript / sceneGraph
 *
 * - Stage 1 Advanced Concept Tree:
 *   - source-grounded concept tree from resource chunks
 *   - clicked node explanation
 *   - auto-scalable saved board
 *   - React Flow save/restore state
 *
 * - Stage 2 Human-Like Live Tutor:
 *   - Node API connection to Python separate-agent orchestrator
 *   - teach clicked node with boardCommands + handwriting + voice + subtitles
 *   - interrupt/repair/resume
 *   - save playback state
 *   - restore Stage 2 session
 *
 * Mounted routes:
 *   GET  /health
 *   GET  /api/health
 *
 * Agent 1:
 *   GET  /api/google-agent/live-tutor/agent1/health
 *   POST /api/google-agent/live-tutor/resources/upload
 *   POST /api/google-agent/live-tutor/resources/text
 *   GET  /api/google-agent/live-tutor/resources
 *   GET  /api/google-agent/live-tutor/resources/:resourceId
 *   GET  /api/google-agent/live-tutor/resources/:resourceId/chunks
 *   POST /api/google-agent/live-tutor/resources/:resourceId/agent1/text-visual
 *
 * Stage 1 Concept Tree:
 *   GET  /api/google-agent/live-tutor/concept-tree/health
 *   POST /api/google-agent/live-tutor/resources/:resourceId/concept-tree
 *   GET  /api/google-agent/live-tutor/concept-trees/:treeId
 *   POST /api/google-agent/live-tutor/resources/:resourceId/explain-node
 *   POST /api/google-agent/live-tutor/boards/:boardId/save
 *   GET  /api/google-agent/live-tutor/boards/:boardId
 *
 * Stage 2 Live Tutor:
 *   GET  /api/google-agent/live-tutor/stage2/health
 *   GET  /api/google-agent/live-tutor/stage2/power-tools
 *   POST /api/google-agent/live-tutor/stage2/teach-node
 *   POST /api/google-agent/live-tutor/stage2/interrupt
 *   POST /api/google-agent/live-tutor/stage2/sessions/:sessionId/playback-state
 *   GET  /api/google-agent/live-tutor/stage2/sessions/:sessionId
 * =============================================================================
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const googleLiveTutorAgent1Routes = require("./routes/googleLiveTutorAgent1.routes");
const googleLiveTutorConceptTreeRoutes = require("./routes/googleLiveTutorConceptTree.routes");
const googleLiveTutorStage2Routes = require("./routes/googleLiveTutorStage2.routes");
const liveTutorAuthRoutes = require("./routes/liveTutorAuth.routes");

const app = express();

const PORT = Number(process.env.PORT || 3000);

function envBool(name, fallback = false) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  return ["1", "true", "yes", "y", "on"].includes(
    String(raw).trim().toLowerCase()
  );
}

function getAllowedOrigins() {
  const origins = new Set();

  [
    process.env.CLIENT_URL,
    process.env.FRONTEND_URL,
    process.env.VITE_CLIENT_URL,
    process.env.WEB_ORIGIN,

    "http://localhost:19006",
    "http://127.0.0.1:19006",

    "http://localhost:5173",
    "http://127.0.0.1:5173",

    "http://localhost:5174",
    "http://127.0.0.1:5174",

    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ].forEach((origin) => {
    if (origin && String(origin).trim()) {
      origins.add(String(origin).trim().replace(/\/+$/, ""));
    }
  });

  return [...origins];
}

const allowedOrigins = getAllowedOrigins();

app.set("trust proxy", 1);

/**
 * CORS.
 */
const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalized = String(origin).replace(/\/+$/, "");

    if (allowedOrigins.includes(normalized)) {
      callback(null, true);
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-request-id",
    "x-offline-user-id",
    "x-gemma-offline-user-id",
    "x-device-id",
    "x-owner-key",
  ],
  exposedHeaders: ["x-request-id"],
};

app.use(cors(corsOptions));

/**
 * IMPORTANT:
 * Do not use app.options("*", cors()) in newer Express/path-to-regexp setups.
 * It can throw:
 *   Missing parameter name
 *
 * RegExp route works safely for all preflight paths.
 */
app.options(/.*/, cors(corsOptions));

/**
 * Request ID.
 */
app.use((req, res, next) => {
  const requestId =
    req.headers["x-request-id"] ||
    `req_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  next();
});

/**
 * Body parsers.
 * Upload route uses multer, so JSON parser does not process multipart body.
 */
app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || "30mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: process.env.URLENCODED_BODY_LIMIT || "30mb",
  })
);

/**
 * Lightweight request log.
 */
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const ms = Date.now() - startedAt;

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[${req.requestId}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`
      );
    }
  });

  next();
});

/**
 * Root health.
 */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "ai-live-tutor-rebuild",
    mode: "agent1-plus-stage1-plus-stage2-live-tutor",
    message: "AI Live Tutor Rebuild server is running.",
    endpoints: {
      health: "/health",
      apiHealth: "/api/health",

      agent1Health: "/api/google-agent/live-tutor/agent1/health",
      upload: "/api/google-agent/live-tutor/resources/upload",
      text: "/api/google-agent/live-tutor/resources/text",
      agent1:
        "/api/google-agent/live-tutor/resources/:resourceId/agent1/text-visual",

      conceptTreeHealth:
        "/api/google-agent/live-tutor/concept-tree/health",
      buildConceptTree:
        "/api/google-agent/live-tutor/resources/:resourceId/concept-tree",
      getConceptTree:
        "/api/google-agent/live-tutor/concept-trees/:treeId",
      explainNode:
        "/api/google-agent/live-tutor/resources/:resourceId/explain-node",
      saveBoard:
        "/api/google-agent/live-tutor/boards/:boardId/save",
      getBoard:
        "/api/google-agent/live-tutor/boards/:boardId",

      stage2Health:
        "/api/google-agent/live-tutor/stage2/health",
      stage2PowerTools:
        "/api/google-agent/live-tutor/stage2/power-tools",
      stage2TeachNode:
        "/api/google-agent/live-tutor/stage2/teach-node",
      stage2Interrupt:
        "/api/google-agent/live-tutor/stage2/interrupt",
      stage2SavePlaybackState:
        "/api/google-agent/live-tutor/stage2/sessions/:sessionId/playback-state",
      stage2GetSession:
        "/api/google-agent/live-tutor/stage2/sessions/:sessionId",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    requestId: req.requestId,
    service: "ai-live-tutor-rebuild",
    mode: "agent1-plus-stage1-plus-stage2-live-tutor",
    port: PORT,
    nodeEnv: process.env.NODE_ENV || "development",
    cwd: process.cwd(),
    appFile: __filename,
    projectRoot: path.resolve(__dirname, ".."),

    mongoConfigured: Boolean(process.env.MONGODB_URI || process.env.MONGO_URI),
    database: process.env.MONGODB_DATABASE || "live-tutor",

    geminiConfigured: Boolean(
      process.env.GOOGLE_GENAI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY
    ),
    geminiModel:
      process.env.GOOGLE_GEMINI_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash",

    python:
      process.env.GOOGLE_LIVE_TUTOR_PYTHON ||
      process.env.LIVE_TUTOR_PYTHON ||
      "python3",

    mcpConfigured:
      envBool("LIVE_TUTOR_USE_MONGODB_MCP") ||
      envBool("USE_MONGODB_MCP") ||
      envBool("MONGODB_MCP_ENABLED"),

    allowedOrigins,

    agent1: {
      realPythonAgent: true,
      realGeminiAgent: true,
      mongoResourceChunkRead: true,
      supportedVisuals: [
        "flowchart",
        "er",
        "sequence",
        "timeline",
        "mindmap",
        "conceptMap",
        "class",
        "state",
        "roadmapTree",
        "table",
      ],
    },

    stage1ConceptTree: {
      enabled: true,
      sourceGroundedConceptTree: true,
      clickedNodeExplanation: true,
      autoScalableBoard: true,
      boardSaveRestore: true,
      fakeFallback: false,
      routes: {
        health: "/api/google-agent/live-tutor/concept-tree/health",
        build:
          "/api/google-agent/live-tutor/resources/:resourceId/concept-tree",
        get: "/api/google-agent/live-tutor/concept-trees/:treeId",
        explain:
          "/api/google-agent/live-tutor/resources/:resourceId/explain-node",
        saveBoard:
          "/api/google-agent/live-tutor/boards/:boardId/save",
        getBoard:
          "/api/google-agent/live-tutor/boards/:boardId",
      },
    },

    stage2LiveTutor: {
      enabled: true,
      separatePythonAgents: true,
      realSeparateAgents: true,
      nodeBridgeConnected: true,
      mongodbSessionSave: true,
      teachNodePipeline: true,
      interruptRepairPipeline: true,
      playbackStateSave: true,
      fakeFallback: false,
      routes: {
        health: "/api/google-agent/live-tutor/stage2/health",
        powerTools: "/api/google-agent/live-tutor/stage2/power-tools",
        teachNode: "/api/google-agent/live-tutor/stage2/teach-node",
        interrupt: "/api/google-agent/live-tutor/stage2/interrupt",
        savePlaybackState:
          "/api/google-agent/live-tutor/stage2/sessions/:sessionId/playback-state",
        getSession:
          "/api/google-agent/live-tutor/stage2/sessions/:sessionId",
      },
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    requestId: req.requestId,
    service: "ai-live-tutor-rebuild-api",
    mode: "agent1-plus-stage1-plus-stage2-live-tutor",
    agent1Health: "/api/google-agent/live-tutor/agent1/health",
    conceptTreeHealth:
      "/api/google-agent/live-tutor/concept-tree/health",
    stage2Health:
      "/api/google-agent/live-tutor/stage2/health",
  });
});

/**
 * Live Tutor Auth routes.
 *
 * Real backend auth:
 *   POST /api/google-agent/live-tutor/auth/register
 *   POST /api/google-agent/live-tutor/auth/login
 *   GET  /api/google-agent/live-tutor/auth/me
 *
 * optionalLiveTutorAuthContext keeps old curl tests working unless
 * LIVE_TUTOR_AUTH_REQUIRED=true.
 */
app.use("/api/google-agent/live-tutor/auth", liveTutorAuthRoutes.router);
app.use("/api/google-agent/live-tutor", liveTutorAuthRoutes.optionalLiveTutorAuthContext);

/**
 * Agent 1 routes.
 */
app.use("/api/google-agent/live-tutor", googleLiveTutorAgent1Routes);

/**
 * Stage 1 Concept Tree routes.
 *
 * This must be mounted before 404 handler.
 */
app.use("/api/google-agent/live-tutor", googleLiveTutorConceptTreeRoutes);

/**
 * Stage 2 Live Tutor routes.
 *
 * This connects:
 *   Express
 *     -> controller
 *     -> service
 *     -> Python stage2_live_tutor_orchestrator.py
 *     -> separate Python agents
 *
 * This must be mounted before 404 handler.
 */
app.use("/api/google-agent/live-tutor/stage2", googleLiveTutorStage2Routes);

/**
 * 404 handler.
 */
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    requestId: req.requestId,
    error: "Route not found.",
    method: req.method,
    path: req.originalUrl,
    availableRoutes: [
      "GET /health",
      "GET /api/health",

      "GET /api/google-agent/live-tutor/agent1/health",
      "POST /api/google-agent/live-tutor/resources/upload",
      "POST /api/google-agent/live-tutor/resources/text",
      "GET /api/google-agent/live-tutor/resources",
      "GET /api/google-agent/live-tutor/resources/:resourceId",
      "GET /api/google-agent/live-tutor/resources/:resourceId/chunks",
      "POST /api/google-agent/live-tutor/resources/:resourceId/agent1/text-visual",

      "GET /api/google-agent/live-tutor/concept-tree/health",
      "POST /api/google-agent/live-tutor/resources/:resourceId/concept-tree",
      "GET /api/google-agent/live-tutor/concept-trees/:treeId",
      "POST /api/google-agent/live-tutor/resources/:resourceId/explain-node",
      "POST /api/google-agent/live-tutor/boards/:boardId/save",
      "GET /api/google-agent/live-tutor/boards/:boardId",

      "GET /api/google-agent/live-tutor/stage2/health",
      "GET /api/google-agent/live-tutor/stage2/power-tools",
      "POST /api/google-agent/live-tutor/stage2/teach-node",
      "POST /api/google-agent/live-tutor/stage2/interrupt",
      "POST /api/google-agent/live-tutor/stage2/sessions/:sessionId/playback-state",
      "GET /api/google-agent/live-tutor/stage2/sessions/:sessionId",
    ],
  });
});

/**
 * Error handler.
 */
app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const statusCode = Number(error.statusCode || error.status || 500);
  const safeStatusCode = Number.isFinite(statusCode)
    ? Math.max(400, Math.min(599, statusCode))
    : 500;

  console.error("[app.js] error:", {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode: safeStatusCode,
    message: error.message,
    stack: error.stack,
  });

  res.status(safeStatusCode).json({
    ok: false,
    requestId: req.requestId,
    error: error.message || "Internal server error",
    details: process.env.NODE_ENV === "development" ? error.stack : undefined,
  });
});

module.exports = app;
