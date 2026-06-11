"use strict";

/**
 * server/server.js
 * =============================================================================
 * Hard-load root .env BEFORE app/routes/services import.
 * This fixes: MONGODB_URI or MONGO_URI missing.
 * =============================================================================
 */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

function loadEnvHard() {
  const serverDir = __dirname;
  const projectRoot = path.resolve(serverDir, "..");
  const requestedPort = process.env.PORT;

  const candidates = [
    path.join(projectRoot, ".env"),
    path.join(serverDir, ".env"),
  ];

  const loaded = [];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({
        path: envPath,
        override: true,
      });

      loaded.push({
        path: envPath,
        ok: !result.error,
        error: result.error ? result.error.message : "",
      });
    }
  }

  // Keep explicit CLI/runtime port overrides usable for local testing.
  // dotenv override is still used for API keys and DB config.
  if (requestedPort) {
    process.env.PORT = requestedPort;
  }

  function mask(v) {
    if (!v) return "";
    const s = String(v);
    return s.length > 14 ? `${s.slice(0, 8)}...${s.slice(-4)}` : "***";
  }

  console.log("[server.js] env load diagnostics:", {
    cwd: process.cwd(),
    serverDir,
    projectRoot,
    loaded,
    mongoPresent: Boolean(process.env.MONGODB_URI || process.env.MONGO_URI),
    mongoMasked: mask(process.env.MONGODB_URI || process.env.MONGO_URI),
    geminiPresent: Boolean(
      process.env.GOOGLE_GENAI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY
    ),
    mcpEnabled:
      process.env.LIVE_TUTOR_USE_MONGODB_MCP ||
      process.env.USE_MONGODB_MCP ||
      process.env.MONGODB_MCP_ENABLED,
    python: process.env.GOOGLE_LIVE_TUTOR_PYTHON,
  });
}

loadEnvHard();

const app = require("./app");
const mongoose = require("mongoose");

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  // Connect MongoDB
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (mongoUri) {
    try {
      await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DATABASE || "live-tutor" });
      console.log("[server.js] MongoDB connected");
    } catch (err) {
      console.error("[server.js] MongoDB connection failed:", err.message);
    }
  }

  // Start BullMQ worker for background lesson generation
  try {
    const bgJob = require("./services/googleAgent/stage2/stage2BackgroundJob.service");
    bgJob.startWorker();
    console.log("[server.js] BullMQ lesson worker started");
  } catch (err) {
    console.warn("[server.js] BullMQ worker failed to start (Redis may be offline):", err.message);
  }

  app.listen(PORT, () => {
    console.log(`[AI Live Tutor Rebuild] server running on http://localhost:${PORT}`);
    console.log(`[Agent 1 health]   http://localhost:${PORT}/api/google-agent/live-tutor/agent1/health`);
    console.log(`[Stage2 health]    http://localhost:${PORT}/api/google-agent/live-tutor/stage2/health`);
    console.log(`[Start lesson]     POST http://localhost:${PORT}/api/google-agent/live-tutor/stage2/sessions/start`);
  });
}

startServer().catch((err) => {
  console.error("[server.js] Fatal startup error:", err);
  process.exit(1);
});
