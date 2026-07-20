import mongoose from "mongoose";

/**
 * Google Calendar sync metadata for a readiness task.
 * Kept from your old model so existing Calendar sync does not break.
 */
const readinessTaskCalendarSchema = new mongoose.Schema(
  {
    googleEventId: { type: String, default: "", index: true },

    lastSyncedAt: { type: Date, default: null },

    syncStatus: {
      type: String,
      enum: ["not_synced", "synced", "failed"],
      default: "not_synced",
      index: true,
    },

    syncError: { type: String, default: "" },
  },
  { _id: false }
);

/**
 * One voice check-in memory item for ONE task.
 *
 * This is task-specific memory:
 * - AI asked something
 * - user replied
 * - AI answered
 * - intent/mood/progress/nextCheckAt saved
 *
 * This helps the coach remember what happened for this task.
 */
const readinessTaskVoiceCheckInSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["start", "followup", "progress", "recovery", "complete"],
      default: "followup",
      index: true,
    },

    aiQuestion: {
      type: String,
      default: "",
    },

    userText: {
      type: String,
      default: "",
    },

    aiText: {
      type: String,
      default: "",
    },

    intent: {
      type: String,
      enum: [
        "",
        "ready",
        "delayed",
        "stuck",
        "tired",
        "stressed",
        "progress",
        "completed",
        "cannot_today",
        "no_response",
        "unknown",
      ],
      default: "",
      index: true,
    },

    mood: {
      type: String,
      enum: [
        "",
        "focused",
        "tired",
        "stressed",
        "confused",
        "sad",
        "neutral",
        "motivated",
      ],
      default: "",
      index: true,
    },

    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    nextCheckAt: {
      type: Date,
      default: null,
      index: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { _id: false }
);

/**
 * Voice accountability state for each task.
 *
 * Important:
 * - each task has its own voice memory
 * - delayed task keeps its own nextCheckAt
 * - completed task gets progressPercent = 100
 * - checkIns stores task-specific summary memory
 */
const readinessTaskVoiceSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },

    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      index: true,
    },

    nextCheckAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastAskedAt: {
      type: Date,
      default: null,
    },

    lastAnsweredAt: {
      type: Date,
      default: null,
    },

    lastIntent: {
      type: String,
      default: "",
      index: true,
    },

    lastMood: {
      type: String,
      default: "",
      index: true,
    },

    lastAiQuestion: {
      type: String,
      default: "",
    },

    lastAiText: {
      type: String,
      default: "",
    },

    checkIns: {
      type: [readinessTaskVoiceCheckInSchema],
      default: [],
    },
  },
  { _id: false }
);

const readinessTaskSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    deadlineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessDeadline",
      required: true,
      index: true,
    },

    courseCode: {
      type: String,
      default: "",
      index: true,
    },

    courseTitle: {
      type: String,
      default: "",
    },

    deadlineTitle: {
      type: String,
      default: "",
    },

    title: {
      type: String,
      required: true,
      index: true,
    },

    topic: {
      type: String,
      default: "",
      index: true,
    },

    topics: [{ type: String, index: true }],

    type: {
      type: String,
      enum: [
        "prep",
        "practice",
        "review",
        "outline",
        "implementation",
        "test",
        "submit",
        "mock",
        "recovery",
        "carry_over",
        "buffer",
        "quiz_day",
        "exam_day",
        "other",
      ],
      default: "prep",
      index: true,
    },

    /**
     * Calendar 2 tasks should use "preparation".
     */
    calendarType: {
      type: String,
      enum: ["preparation", "official", "recovery"],
      default: "preparation",
      index: true,
    },

    scheduledDate: {
      type: Date,
      required: true,
      index: true,
    },

    startTime: {
      type: String,
      default: "19:00",
    },

    endTime: {
      type: String,
      default: "",
    },

    durationMinutes: {
      type: Number,
      default: 25,
      min: 5,
      max: 240,
    },

    mode: {
      type: String,
      enum: ["minimum", "normal", "strong"],
      default: "normal",
      index: true,
    },

    priority: {
      type: Number,
      default: 60,
      min: 1,
      max: 100,
      index: true,
    },

    difficulty: {
      type: Number,
      default: 3,
      min: 1,
      max: 5,
    },

    reason: {
      type: String,
      default: "",
    },

    instructions: {
      type: String,
      default: "",
    },

    expectedOutput: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: [
        "planned",
        "done",
        "half_done",
        "not_started",
        "confused",
        "skipped",
        "rescheduled",
        "cancelled",
      ],
      default: "planned",
      index: true,
    },

    blockedReason: {
      type: String,
      enum: [
        "",
        "forgot",
        "too_many_deadlines",
        "topic_confusing",
        "stressed",
        "no_time",
        "other",
      ],
      default: "",
      index: true,
    },

    recoveryOfTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessTask",
      default: null,
      index: true,
    },

    carryOverFromTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessTask",
      default: null,
      index: true,
    },

    aiGenerated: {
      type: Boolean,
      default: true,
      index: true,
    },

    autoReplanned: {
      type: Boolean,
      default: false,
      index: true,
    },

    replanBatchId: {
      type: String,
      default: "",
      index: true,
    },

    checkinCount: {
      type: Number,
      default: 0,
    },

    lastCheckinAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    reminder: {
      enabled: { type: Boolean, default: true },
      smsSentForDate: { type: String, default: "", index: true },
      voicePromptedForDate: { type: String, default: "" },
      lastReminderAt: { type: Date, default: null },
    },

    /**
     * New Daily Voice Accountability Coach fields.
     * This is additive, so old Calendar 2 features remain preserved.
     */
    voice: {
      type: readinessTaskVoiceSchema,
      default: () => ({}),
    },

    googleCalendar: {
      type: readinessTaskCalendarSchema,
      default: () => ({}),
    },

    aiPayload: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

/**
 * Existing useful indexes.
 */
readinessTaskSchema.index({ userId: 1, scheduledDate: 1, status: 1 });
readinessTaskSchema.index({ userId: 1, deadlineId: 1, scheduledDate: 1 });
readinessTaskSchema.index({ userId: 1, calendarType: 1, scheduledDate: 1 });
readinessTaskSchema.index({ userId: 1, type: 1, status: 1 });
readinessTaskSchema.index({ userId: 1, "reminder.smsSentForDate": 1 });

/**
 * New voice-accountability indexes.
 * These help background polling find delayed/due tasks.
 */
readinessTaskSchema.index({ userId: 1, "voice.nextCheckAt": 1, status: 1 });
readinessTaskSchema.index({ userId: 1, "voice.lastIntent": 1, status: 1 });
readinessTaskSchema.index({
  userId: 1,
  calendarType: 1,
  status: 1,
  "voice.nextCheckAt": 1,
});

export default mongoose.models.ReadinessTask ||
  mongoose.model("ReadinessTask", readinessTaskSchema);