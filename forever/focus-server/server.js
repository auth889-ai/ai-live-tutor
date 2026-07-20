// server/server.js

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";

import studyRoutes from "./routes/study.routes.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import connectLearningRoutes from "./routes/connectLearning.routes.js";
import syllabusRelayRoutes from "./routes/syllabusRelay.routes.js";
import readinessCoachRoutes from "./routes/readinessCoach.routes.js";
import readinessVoiceAccountabilityRoutes from "./routes/readinessVoiceAccountability.routes.js";
import goodContentReachRoutes from "./routes/goodContentReach.routes.js";
import gemmaResourceRoutes from "./routes/gemmaResource.routes.js";
import gemmaResourceLiveTutorRoutes from "./routes/gemmaResourceLiveTutor.routes.js";
import liveTutorRoutes from "./routes/liveTutor.routes.js";
import liveTutorVoiceRoutes from "./routes/liveTutorVoice.routes.js";
import smallWinRoutes from "./routes/smallWin.routes.js";
import liveLectureNotesRoutes from "./routes/liveLectureNotes.routes.js";

import { startReadinessSmsWorker } from "./services/integrations/readinessSms.worker.js";
import { startReadinessVoiceSocketWorker } from "./workers/readinessVoiceSocket.worker.js";
import { initRealtime } from "./config/realtime.js";

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const JSON_LIMIT =
  process.env.JSON_LIMIT ||
  process.env.LIVE_TUTOR_JSON_LIMIT ||
  "35mb";

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigins = new Set([
      "http://localhost:8081",
      "http://127.0.0.1:8081",
      "http://localhost:19006",
      "http://127.0.0.1:19006",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);

    if (allowedOrigins.has(origin)) return callback(null, true);

    if (
      /^http:\/\/localhost:\d+$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
      /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin) ||
      /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/.test(origin)
    ) {
      return callback(null, true);
    }

    return callback(null, true);
  },

  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Content-Type",
    "content-type",
    "Authorization",
    "authorization",
    "Accept",
    "accept",
    "Origin",
    "origin",
    "X-Requested-With",
    "x-requested-with",
    "X-User-Id",
    "x-user-id",
    "X-Device-Id",
    "x-device-id",
    "X-DeviceID",
    "x-deviceid",
    "X-Client-Id",
    "x-client-id",
    "X-Installation-Id",
    "x-installation-id",
    "X-LearnLens-Extension",
    "x-learnlens-extension",
    "X-Gemma-Offline-User-Id",
    "x-gemma-offline-user-id",
    "X-Offline-User-Id",
    "x-offline-user-id",
    "X-Offline-UserID",
    "x-offline-userid",
    "X-Local-User-Id",
    "x-local-user-id",
    "X-Local-UserID",
    "x-local-userid",
    "X-Owner-Key",
    "x-owner-key",
    "X-Request-Id",
    "x-request-id",
  ],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json({ limit: JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_LIMIT }));

app.get("/", (_, res) => {
  res.json({
    ok: true,
    service: "study-feature-1",
    message: "Feature 1 backend is running",
    api: {
      study: "/api/study",
      connectLearning: "/api/connect-learning",
      syllabusRelay: "/api/syllabus-relay",
      readinessCoach: "/api/readiness-coach",
      readinessAlias: "/api/readiness",
      readinessVoiceAccountability:
        "/api/readiness-coach/voice/accountability",
      goodContentReach: "/api/good-content",
      gemmaResource: "/api/gemma-resource",
      gemmaResourceLiveTutor: "/api/gemma-resource-live-tutor",
      gemmaResourceLiveTutorAlias: "/api/gemma-resource/live-tutor",
      liveTutor: "/api/live-tutor",
      liveTutorVoice: "/api/live-tutor/voice",
      smallWin: "/api/small-win",
      liveLectureNotes: "/api/live-lecture-notes",
      auth: "/api/auth",
      user: "/api/user",
    },
    socket: "/socket.io",
    port: PORT,
  });
});

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    service: "study-feature-1",
    mode: "agentic-gemma",
    realtime: true,
    connectLearning: true,
    syllabusRelay: true,
    readinessCoach: true,
    readinessVoiceAccountability: true,
    readinessVoiceSocketWorker:
      process.env.READINESS_VOICE_SOCKET_WORKER_DISABLED !== "true",
    goodContentReach: true,
    gemmaResource: true,
    gemmaResourceLiveTutor: true,
    gemmaResourceLiveTutorEndpoint: "/api/gemma-resource-live-tutor/health",
    gemmaResourceLiveTutorAliasEndpoint:
      "/api/gemma-resource/live-tutor/health",
    liveTutor: true,
    liveTutorEndpoint: "/api/live-tutor/health",
    liveTutorVoice: true,
    liveTutorVoiceEndpoint: "/api/live-tutor/voice/health",
    smallWin: true,
    smallWinEndpoint: "/api/small-win/health",
    liveLectureNotes: true,
    liveLectureNotesEndpoint: "/api/live-lecture-notes/health",
    liveLectureNotesSeparateFeature: true,
    jsonLimit: JSON_LIMIT,
    port: PORT,
    at: new Date().toISOString(),
  });
});

/**
 * Existing app routes.
 * Do not remove these.
 */
app.use("/api/study", studyRoutes);
app.use("/api/connect-learning", connectLearningRoutes);
app.use("/api/syllabus-relay", syllabusRelayRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

app.use(
  "/api/readiness-coach/voice/accountability",
  readinessVoiceAccountabilityRoutes
);

app.use(
  "/api/readiness/voice/accountability",
  readinessVoiceAccountabilityRoutes
);

app.use("/api/readiness-coach", readinessCoachRoutes);
app.use("/api/readiness", readinessCoachRoutes);

app.use("/api/good-content", goodContentReachRoutes);

app.use("/api/gemma-resource", gemmaResourceRoutes);

app.use("/api/gemma-resource-live-tutor", gemmaResourceLiveTutorRoutes);
app.use("/api/gemma-resource/live-tutor", gemmaResourceLiveTutorRoutes);

app.use("/api/live-tutor/voice", liveTutorVoiceRoutes);

app.use("/api/live-tutor", liveTutorRoutes);

/**
 * Small-Win Opportunity Finder route.
 */
app.use("/api/small-win", smallWinRoutes);

/**
 * Separate Live Lecture Notes route.
 * Additive only: this does not touch Gemma Resource, Ask Gemma, Book, Tutor Board,
 * Live Tutor, Small-Win, Readiness, Connect Learning, or Study routes.
 */
app.use("/api/live-lecture-notes", liveLectureNotesRoutes);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);

  const status = err.status || err.statusCode || 500;

  res.status(status).json({
    ok: false,
    message: err.message || "Server error",
    code: err.code || "server_error",
  });
});

initRealtime(server);

function shouldUseOfflineMongo() {
  return String(process.env.OFFLINE_MODE || "").trim().toLowerCase() === "true";
}

function getMongoUri() {
  const offlineMode = shouldUseOfflineMongo();

  if (offlineMode) {
    return process.env.LOCAL_MONGO_URI || process.env.MONGO_URI || "";
  }

  return process.env.MONGO_URI || "";
}

async function connectMongo() {
  const offlineMode = shouldUseOfflineMongo();
  const mongoUri = getMongoUri();

  if (!mongoUri) {
    throw new Error(
      offlineMode
        ? "LOCAL_MONGO_URI or MONGO_URI missing"
        : "MONGO_URI missing"
    );
  }

  console.log(
    `[mongo] connecting to ${
      offlineMode ? "LOCAL offline MongoDB" : "configured MongoDB"
    }`
  );

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });

  console.log(`[mongo] connected db=${mongoose.connection.name}`);
}

function startBackgroundWorkers() {
  try {
    startReadinessSmsWorker();
  } catch (workerError) {
    console.warn(
      "[Readiness SMS Worker] Could not start:",
      workerError?.message || workerError
    );
  }

  try {
    startReadinessVoiceSocketWorker();
  } catch (workerError) {
    console.warn(
      "[Readiness Voice Socket Worker] Could not start:",
      workerError?.message || workerError
    );
  }
}

async function start() {
  await connectMongo();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Feature 1 server running on http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);

    console.log(
      `Readiness Coach: http://localhost:${PORT}/api/readiness-coach/health`
    );

    console.log(
      `Readiness Alias: http://localhost:${PORT}/api/readiness/health`
    );

    console.log(
      `Readiness Voice Accountability: http://localhost:${PORT}/api/readiness-coach/voice/accountability/settings`
    );

    console.log(
      `Good Content Reach: http://localhost:${PORT}/api/good-content/health`
    );

    console.log(
      `Gemma Resource & Tutor: http://localhost:${PORT}/api/gemma-resource/health`
    );

    console.log(
      `Gemma Resource Live Tutor: http://localhost:${PORT}/api/gemma-resource-live-tutor/health`
    );

    console.log(
      `Gemma Resource Live Tutor Alias: http://localhost:${PORT}/api/gemma-resource/live-tutor/health`
    );

    console.log(
      `Live AI Tutor: http://localhost:${PORT}/api/live-tutor/health`
    );

    console.log(
      `Live AI Tutor Voice: http://localhost:${PORT}/api/live-tutor/voice/health`
    );

    console.log(
      `Small-Win Opportunity Finder: http://localhost:${PORT}/api/small-win/health`
    );

    console.log(
      `Live Lecture Notes: http://localhost:${PORT}/api/live-lecture-notes/health`
    );

    startBackgroundWorkers();
  });
}

start().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});