import mongoose from "mongoose";

/**
 * StudyConversation
 * -----------------
 * Permanent AI coach / voice / motivation history.
 *
 * Supports both:
 * - one-message documents: role, text, source
 * - multi-turn documents: turns[]
 */
const StudyConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      default: "",
      index: true,
    },

    deviceId: {
      type: String,
      required: true,
      index: true,
    },

    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudySession",
      default: null,
      index: true,
    },

    activityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudyActivity",
      default: null,
      index: true,
    },

    goal: {
      type: String,
      default: "",
    },

    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      default: "assistant",
      index: true,
    },

    text: {
      type: String,
      default: "",
    },

    source: {
      type: String,
      enum: [
        "voice",
        "text",
        "manual_chat",
        "extension",
        "app",
        "system",
        "popup_motivation",
        "coach_update",
        "voice_reply",
        "recovery",
        "feedback",
        "popup_ignored",
        "auto_motivation",
      ],
      default: "text",
      index: true,
    },

    metadata: {
      type: Object,
      default: {},
    },

    status: {
      type: String,
      enum: ["active", "completed", "archived"],
      default: "active",
      index: true,
    },

    turns: [
      {
        role: {
          type: String,
          enum: ["user", "assistant", "system"],
          default: "assistant",
        },

        text: {
          type: String,
          default: "",
        },

        source: {
          type: String,
          enum: [
            "voice",
            "text",
            "manual_chat",
            "extension",
            "app",
            "system",
            "popup_motivation",
            "coach_update",
            "voice_reply",
            "recovery",
            "feedback",
            "popup_ignored",
            "auto_motivation",
          ],
          default: "text",
        },

        stage: {
          type: Number,
          default: 0,
        },

        activityId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "StudyActivity",
          default: null,
        },

        metadata: {
          type: Object,
          default: {},
        },

        at: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    summary: {
      type: String,
      default: "",
    },

    finalDecisionMade: {
      type: Boolean,
      default: false,
    },

    lastAiType: {
      type: String,
      enum: ["study", "partial", "non-study", "unknown"],
      default: "unknown",
    },

    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

StudyConversationSchema.index({ deviceId: 1, createdAt: -1 });
StudyConversationSchema.index({ userId: 1, createdAt: -1 });
StudyConversationSchema.index({ deviceId: 1, sessionId: 1, createdAt: -1 });
StudyConversationSchema.index({ activityId: 1, createdAt: -1 });

export default mongoose.models.StudyConversation ||
  mongoose.model("StudyConversation", StudyConversationSchema);