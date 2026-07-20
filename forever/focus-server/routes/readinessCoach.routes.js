import express from "express";
import multer from "multer";
import authMiddleware from "../middleware/authMiddleware.js";

import {
  health,
  dashboard,
  createDeadlineHandler,
  listDeadlinesHandler,
  updateDeadlineHandler,
  deleteDeadlineHandler,
  generatePlanHandler,
  regenerateRecoveryHandler,
  todayHandler,
  checkinTaskHandler,
  createTaskHandler,
  updateTaskHandler,
  deleteTaskHandler,
  officialCalendarHandler,
  readinessCalendarHandler,
  twoCalendarHandler,
  exportIcsHandler,
  heavyWeeksHandler,
  googleAuthUrlHandler,
  googleExchangeHandler,
  googleCallbackHandler,
  googleImportHandler,
  scheduleSmsHandler,
  smsWorkerRunHandler,
  smsWebhookHandler,
  getPreferencesHandler,
  updatePreferencesHandler,
  getPlanningPreferencesHandler,
  updatePlanningPreferencesHandler,
  generateDailyRemindersHandler,
  generateHeavyWeekRemindersHandler,
  reminderSchedulerRunHandler,
  googleCalendarSyncHandler,
  voiceCoachTurnHandler,
  voiceConversationHandler,
  offlineVoiceHealthHandler,
  offlineVoiceSpeakHandler,
  offlineVoiceCheckinHandler,
  crossDeadlineRebalanceHandler,
} from "../controllers/readinessCoach.controller.js";

import {
  getVoiceAccountabilitySettingsHandler,
  updateVoiceAccountabilitySettingsHandler,
  getNextVoiceAccountabilityTaskHandler,
  replyToVoiceAccountabilityTaskHandler,
  getVoiceAccountabilityHistoryHandler,
} from "../controllers/readinessVoiceAccountability.controller.js";

const router = express.Router();

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize:
      Number(process.env.READINESS_OFFLINE_VOICE_MAX_FILE_MB || 15) *
      1024 *
      1024,
  },
});

/**
 * Public health check
 */
router.get("/health", health);

/**
 * Public Google OAuth callbacks.
 *
 * These must stay before authMiddleware because Google redirects here without
 * Authorization Bearer token.
 */
router.get("/google/callback", googleCallbackHandler);
router.get("/google-classroom/callback", googleCallbackHandler);

/**
 * Public SMS webhook.
 *
 * Twilio will call this without user token.
 */
router.post("/sms/webhook", smsWebhookHandler);

/**
 * Everything below requires login token.
 */
router.use(authMiddleware);

/**
 * Dashboard
 */
router.get("/dashboard", dashboard);

/**
 * Calendar 1: Official deadlines
 */
router.post("/deadlines", createDeadlineHandler);
router.get("/deadlines", listDeadlinesHandler);
router.patch("/deadlines/:deadlineId", updateDeadlineHandler);
router.delete("/deadlines/:deadlineId", deleteDeadlineHandler);

/**
 * Calendar 2: AI preparation plan
 */
router.post("/plans/generate", generatePlanHandler);

/**
 * Recovery / rebalance
 */
router.post("/recovery/regenerate", regenerateRecoveryHandler);
router.post("/recovery/rebalance", crossDeadlineRebalanceHandler);

/**
 * Today + Calendar 2 task CRUD
 */
router.get("/today", todayHandler);

router.post("/tasks", createTaskHandler);
router.patch("/tasks/:taskId", updateTaskHandler);
router.delete("/tasks/:taskId", deleteTaskHandler);
router.post("/tasks/:taskId/checkin", checkinTaskHandler);

/**
 * Calendar views
 */
router.get("/calendar/official", officialCalendarHandler);
router.get("/calendar/readiness", readinessCalendarHandler);
router.get("/calendar/two", twoCalendarHandler);
router.get("/calendar/export.ics", exportIcsHandler);
router.post("/calendar/google/sync", googleCalendarSyncHandler);

/**
 * Heavy weeks
 */
router.get("/heavy-weeks", heavyWeeksHandler);

/**
 * Google Classroom
 */
router.get("/google-classroom/auth-url", googleAuthUrlHandler);
router.post("/google-classroom/exchange", googleExchangeHandler);
router.post("/google-classroom/import", googleImportHandler);

/**
 * Preferences
 */
router.get("/preferences", getPreferencesHandler);
router.patch("/preferences", updatePreferencesHandler);
router.post("/preferences", updatePreferencesHandler);

/**
 * Planning preferences
 */
router.get("/planning/preferences", getPlanningPreferencesHandler);
router.patch("/planning/preferences", updatePlanningPreferencesHandler);

/**
 * Reminders / SMS
 */
router.post("/reminders/daily", generateDailyRemindersHandler);
router.post("/reminders/heavy-week", generateHeavyWeekRemindersHandler);
router.post("/reminders/run-scheduler", reminderSchedulerRunHandler);

router.post("/sms/schedule", scheduleSmsHandler);
router.post("/sms/worker/run", smsWorkerRunHandler);

/**
 * Old generic voice coach.
 *
 * Keep this so old feature does not break.
 */
router.get("/voice/conversation", voiceConversationHandler);
router.post("/voice/turn", voiceCoachTurnHandler);

/**
 * Offline voice bridge.
 *
 * Keep this so old offline voice feature does not break.
 */
router.get("/voice/offline/health", offlineVoiceHealthHandler);
router.post("/voice/offline/speak", offlineVoiceSpeakHandler);
router.post(
  "/voice/offline/checkin",
  voiceUpload.single("audio"),
  offlineVoiceCheckinHandler
);

/**
 * Daily Voice Accountability Coach
 *
 * New task-wise chat system:
 *
 * GET    /api/readiness-coach/voice/accountability/settings
 * PATCH  /api/readiness-coach/voice/accountability/settings
 * POST   /api/readiness-coach/voice/accountability/settings
 * GET    /api/readiness-coach/voice/accountability/next
 * POST   /api/readiness-coach/voice/accountability/reply
 * GET    /api/readiness-coach/voice/accountability/history
 *
 * Also available through alias because server.js mounts same router at:
 * /api/readiness
 */
router.get(
  "/voice/accountability/settings",
  getVoiceAccountabilitySettingsHandler
);

router.patch(
  "/voice/accountability/settings",
  updateVoiceAccountabilitySettingsHandler
);

router.post(
  "/voice/accountability/settings",
  updateVoiceAccountabilitySettingsHandler
);

router.get(
  "/voice/accountability/next",
  getNextVoiceAccountabilityTaskHandler
);

router.post(
  "/voice/accountability/reply",
  replyToVoiceAccountabilityTaskHandler
);

router.get(
  "/voice/accountability/history",
  getVoiceAccountabilityHistoryHandler
);

export default router;