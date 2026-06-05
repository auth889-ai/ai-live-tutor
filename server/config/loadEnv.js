"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function mask(value) {
  if (!value) return "";
  const text = String(value);
  if (text.length <= 12) return "***";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function loadEnv() {
  const serverDir = path.resolve(__dirname, "..");
  const projectRoot = path.resolve(serverDir, "..");

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

  const diagnostics = {
    loaded,
    cwd: process.cwd(),
    serverDir,
    projectRoot,
    mongoUriPresent: Boolean(process.env.MONGODB_URI || process.env.MONGO_URI),
    mongoUriMasked: mask(process.env.MONGODB_URI || process.env.MONGO_URI),
    geminiKeyPresent: Boolean(
      process.env.GOOGLE_GENAI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY
    ),
    geminiKeyMasked: mask(
      process.env.GOOGLE_GENAI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY
    ),
    mcpEnabled:
      process.env.LIVE_TUTOR_USE_MONGODB_MCP ||
      process.env.USE_MONGODB_MCP ||
      process.env.MONGODB_MCP_ENABLED ||
      "",
    python: process.env.GOOGLE_LIVE_TUTOR_PYTHON || process.env.LIVE_TUTOR_PYTHON || "python3",
  };

  console.log("[loadEnv] diagnostics:", diagnostics);

  return diagnostics;
}

module.exports = {
  loadEnv,
};