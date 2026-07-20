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
 * Public health check.
 */
router.get("/health", health);

/**
 * PUBLIC CALLBACK ROUTES
 *
 * Important:
 * Google redirects browser here directly.
 * Browser callback does NOT include Authorization: Bearer token.
 * So these routes must stay before router.use(authMiddleware).
 *
 * User is recovered from OAuth state.
 */
router.get("/google/callback", googleCallbackHandler);
router.get("/google-classroom/callback", googleCallbackHandler);

/**
 * Twilio webhook must also be public.
 */
router.post("/sms/webhook", smsWebhookHandler);

/**
 * Protected routes below this line.
 */
router.use(authMiddleware);

router.get("/dashboard", dashboard);

/**
 * Calendar 1: Official Deadline Calendar
 *
 * Source of truth:
 * - Manual deadlines
 * - Google Classroom assignments/coursework
 * - Google Classroom quiz/exam/course material announcements
 *
 * AI never changes these. User may manually edit them.
 */
router.post("/deadlines", createDeadlineHandler);
router.get("/deadlines", listDeadlinesHandler);
router.patch("/deadlines/:deadlineId", updateDeadlineHandler);
router.delete("/deadlines/:deadlineId", deleteDeadlineHandler);

/**
 * Calendar 2: AI Preparation Calendar generation.
 *
 * Uses existing planner route.
 * The planner filters active/current Calendar 1 deadlines and saves
 * AI-generated preparation tasks into ReadinessTask with calendarType="preparation".
 */
router.post("/plans/generate", generatePlanHandler);

/**
 * Recovery and workload smoothing.
 */
router.post("/recovery/regenerate", regenerateRecoveryHandler);
router.post("/recovery/rebalance", crossDeadlineRebalanceHandler);

/**
 * Today and Calendar 2 task CRUD.
 *
 * Calendar 2 is editable:
 * - Add task manually
 * - Change title/date/time/duration/status
 * - Move task to another slot
 * - Delete task
 */
router.get("/today", todayHandler);

router.post("/tasks", createTaskHandler);
router.patch("/tasks/:taskId", updateTaskHandler);
router.delete("/tasks/:taskId", deleteTaskHandler);
router.post("/tasks/:taskId/checkin", checkinTaskHandler);

/**
 * Calendar views.
 *
 * /calendar/official  = Calendar 1 only
 * /calendar/readiness = Calendar 2 only
 * /calendar/two       = Calendar 1 + Calendar 2 combined
 */
router.get("/calendar/official", officialCalendarHandler);
router.get("/calendar/readiness", readinessCalendarHandler);
router.get("/calendar/two", twoCalendarHandler);
router.get("/calendar/export.ics", exportIcsHandler);
router.post("/calendar/google/sync", googleCalendarSyncHandler);

router.get("/heavy-weeks", heavyWeeksHandler);

/**
 * Google Classroom import.
 */
router.get("/google-classroom/auth-url", googleAuthUrlHandler);
router.post("/google-classroom/exchange", googleExchangeHandler);
router.post("/google-classroom/import", googleImportHandler);

/**
 * General readiness preferences.
 */
router.get("/preferences", getPreferencesHandler);
router.patch("/preferences", updatePreferencesHandler);
router.post("/preferences", updatePreferencesHandler);

/**
 * Planning preferences:
 * - user saved time slots
 * - max daily study minutes
 * - soft workload limit
 *
 * Priority:
 * DB saved slots → .env READINESS_TIME_SLOTS → hard fallback.
 */
router.get("/planning/preferences", getPlanningPreferencesHandler);
router.patch("/planning/preferences", updatePlanningPreferencesHandler);

/**
 * Reminder and notification intelligence.
 */
router.post("/reminders/daily", generateDailyRemindersHandler);
router.post("/reminders/heavy-week", generateHeavyWeekRemindersHandler);
router.post("/reminders/run-scheduler", reminderSchedulerRunHandler);

router.post("/sms/schedule", scheduleSmsHandler);
router.post("/sms/worker/run", smsWorkerRunHandler);

/**
 * Old/general voice coach.
 *
 * Kept for compatibility with your existing project.
 */
router.get("/voice/conversation", voiceConversationHandler);
router.post("/voice/turn", voiceCoachTurnHandler);

/**
 * Offline voice bridge.
 *
 * Kept for compatibility with your existing offline voice feature.
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
 * New feature:
 * - background desktop voice assistant
 * - Calendar 2 task-aware check-in
 * - per-task GPT-style chat history
 * - per-task nextCheckAt tracking
 * - text or voice user replies
 *
 * Mounted under:
 * /api/readiness-coach/voice/accountability
 * and also alias:
 * /api/readiness/voice/accountability
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