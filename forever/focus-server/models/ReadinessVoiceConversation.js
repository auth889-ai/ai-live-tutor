import mongoose from "mongoose";

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * One GPT-style chat turn.
 *
 * Example:
 * assistant: It is time for Practice Week 1 slide...
 * user: I feel weak and sad.
 * assistant: I hear you...
 */
const readinessVoiceTurnSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },

    text: {
      type: String,
      default: "",
    },

    intent: {
      type: String,
      enum: [
        "",

        /**
         * Old generic voice/check-in intents.
         * Kept so old voice features do not break.
         */
        "checkin_done",
        "checkin_half_done",
        "checkin_not_started",
        "checkin_confused",
        "ask_help",
        "ask_plan",
        "ask_motivation",
        "other",

        /**
         * New Daily Voice Accountability Coach intents.
         */
        "ready",
        "delayed",
        "stuck",
        "tired",
        "stressed",
        "progress",
        "completed",
        "cannot_today",
        "unknown",
      ],
      default: "",
      index: true,
    },

    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessTask",
      default: null,
    },

    deadlineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessDeadline",
      default: null,
    },

    metadata: {
      type: Object,
      default: {},
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const readinessVoiceConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    /**
     * For accountability feature:
     * accountability-<taskId>-<localDate>
     *
     * This keeps each task's chat separate.
     */
    sessionId: {
      type: String,
      required: true,
      index: true,
    },

    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessTask",
      default: null,
      index: true,
    },

    deadlineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessDeadline",
      default: null,
      index: true,
    },

    /**
     * generic = old voice system
     * accountability = Daily Voice Accountability Coach
     */
    feature: {
      type: String,
      enum: ["generic", "accountability"],
      default: "generic",
      index: true,
    },

    status: {
      type: String,
      enum: ["active", "closed"],
      default: "active",
      index: true,
    },

    /**
     * GPT-style visible chat history.
     */
    turns: {
      type: [readinessVoiceTurnSchema],
      default: [],
    },

    lastUserText: {
      type: String,
      default: "",
    },

    lastAssistantText: {
      type: String,
      default: "",
    },

    lastIntent: {
      type: String,
      default: "",
      index: true,
    },

    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    /**
     * Auto delete conversation after 15 days.
     *
     * IMPORTANT:
     * Do not put index:true here, because TTL index is declared below.
     * Otherwise Mongoose warns duplicate index on { expiresAt: 1 }.
     */
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + FIFTEEN_DAYS_MS),
    },
  },
  { timestamps: true }
);

/**
 * One conversation per user/session.
 * This prevents duplicated task chat sessions.
 */
readinessVoiceConversationSchema.index(
  { userId: 1, sessionId: 1 },
  { unique: true }
);

readinessVoiceConversationSchema.index({ userId: 1, lastActivityAt: -1 });

readinessVoiceConversationSchema.index({
  userId: 1,
  taskId: 1,
  lastActivityAt: -1,
});

readinessVoiceConversationSchema.index({
  userId: 1,
  feature: 1,
  lastActivityAt: -1,
});

/**
 * TTL index:
 * MongoDB will automatically delete conversation documents after expiresAt.
 *
 * Deletion is not instant; MongoDB TTL monitor may take about 60 seconds or more.
 */
readinessVoiceConversationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

export default mongoose.models.ReadinessVoiceConversation ||
  mongoose.model("ReadinessVoiceConversation", readinessVoiceConversationSchema);