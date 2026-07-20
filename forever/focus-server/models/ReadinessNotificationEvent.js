import mongoose from "mongoose";

const readinessNotificationEventSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    phone: {
      type: String,
      default: "",
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

    kind: {
      type: String,
      enum: [
        "daily_checkin",
        "inactive_user",
        "deadline_near",
        "repeated_skip",
        "heavy_week_spike",
        "confused_help",
        "dynamic_escalation",
      ],
      required: true,
      index: true,
    },

    channel: {
      type: String,
      enum: ["sms", "voice", "app", "none"],
      default: "sms",
      index: true,
    },

    escalationLevel: {
      type: Number,
      default: 1,
      min: 1,
      max: 5,
      index: true,
    },

    reason: {
      type: String,
      default: "",
    },

    decision: {
      type: String,
      enum: ["created", "skipped", "blocked_quiet_hours", "blocked_limit", "duplicate", "no_signal"],
      default: "created",
      index: true,
    },

    message: {
      type: String,
      default: "",
    },

    evidence: {
      type: Object,
      default: {},
    },

    sendAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

readinessNotificationEventSchema.index({ userId: 1, kind: 1, createdAt: -1 });
readinessNotificationEventSchema.index({ userId: 1, decision: 1, createdAt: -1 });
readinessNotificationEventSchema.index({ userId: 1, escalationLevel: -1, createdAt: -1 });

export default mongoose.models.ReadinessNotificationEvent ||
  mongoose.model("ReadinessNotificationEvent", readinessNotificationEventSchema);