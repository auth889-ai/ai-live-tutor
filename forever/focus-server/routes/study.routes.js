// server/routes/study.routes.js

import express from "express";
import {
  getStudyHealth,
  setGoal,
  getGoal,
  startSession,
  endSession,
  getCurrentSession,
  getSessions,
  receiveSignal,
  receiveSignalBatch,
  submitFeedback,
  popupIgnored,
  voiceReply,
  getDashboard,
  getAnalytics,
  getTodayAnalytics,
  getWeeklyAnalytics,
  getTimeline,
  getInsights,
  getConnectedDevices,
  getSettings,
  updateSettings,
  getConversations,
  getWorkerStatus,
  getWorkerJob,
} from "../controllers/study.controller.js";

const router = express.Router();

/**
 * Health
 */
router.get("/health", getStudyHealth);

/**
 * Goal
 */
router.post("/goal", setGoal);
router.get("/goal/:deviceId", getGoal);

/**
 * Session
 *
 * Keep both /session/current/:deviceId and /session/:deviceId
 * because some frontend versions call one, some call the other.
 */
router.post("/session/start", startSession);
router.post("/session/end", endSession);
router.get("/session/current/:deviceId", getCurrentSession);
router.get("/session/:deviceId", getCurrentSession);
router.get("/sessions/:deviceId", getSessions);

/**
 * Signal
 */
router.post("/signal", receiveSignal);
router.post("/signals/batch", receiveSignalBatch);

/**
 * Feedback / popup
 */
router.post("/feedback", submitFeedback);
router.post("/popup-ignored", popupIgnored);

/**
 * Voice
 *
 * Keep both route names:
 * - /voice-reply = your newer frontend service
 * - /voice/reply = previous patch / alternate frontend
 */
router.post("/voice-reply", voiceReply);
router.post("/voice/reply", voiceReply);

/**
 * Dashboard / analytics
 */
router.get("/dashboard/:deviceId", getDashboard);

router.get("/analytics", getAnalytics);
router.get("/analytics/:deviceId", getAnalytics);
router.get("/analytics/today/:deviceId", getTodayAnalytics);
router.get("/analytics/week/:deviceId", getWeeklyAnalytics);

/**
 * Timeline / insights
 */
router.get("/timeline/:deviceId", getTimeline);
router.get("/insights/:deviceId", getInsights);

/**
 * Devices
 */
router.get("/devices", getConnectedDevices);
router.get("/devices/:deviceId", getConnectedDevices);

/**
 * Settings
 *
 * Keep POST and PATCH both.
 */
router.get("/settings/:deviceId", getSettings);
router.post("/settings", updateSettings);
router.put("/settings/:deviceId", updateSettings);
router.patch("/settings/:deviceId", updateSettings);

/**
 * Voice conversation history
 */
router.get("/conversations/:deviceId", getConversations);

/**
 * Optional worker/debug
 */
router.get("/worker/status", getWorkerStatus);
router.get("/worker/jobs/:jobId", getWorkerJob);

export default router;