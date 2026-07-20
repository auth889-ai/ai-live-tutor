import mongoose from "mongoose";

const readinessSmsReminderSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    phone: {
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

    kind: {
      type: String,
      enum: [
        "daily_checkin",
        "heavy_week",
        "deadline_warning",
        "recovery",
        "missed_task",
        "confused_help",
        "manual",
      ],
      default: "recovery",
      index: true,
    },

    message: {
      type: String,
      required: true,
    },

    sendAt: {
      type: Date,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "sent", "failed", "cancelled"],
      default: "pending",
      index: true,
    },

    provider: {
      type: String,
      enum: ["twilio", "mock"],
      default: "twilio",
    },

    providerId: {
      type: String,
      default: "",
    },

    error: {
      type: String,
      default: "",
    },

    reply: {
      raw: { type: String, default: "" },
      normalized: {
        type: String,
        enum: ["", "done", "help", "skip", "half_done", "not_started", "confused"],
        default: "",
        index: true,
      },
      receivedAt: { type: Date, default: null },
      processed: { type: Boolean, default: false, index: true },
      processError: { type: String, default: "" },
    },

    sentAt: {
      type: Date,
      default: null,
    },

    metadata: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

readinessSmsReminderSchema.index({ status: 1, sendAt: 1 });
readinessSmsReminderSchema.index({ userId: 1, kind: 1, sendAt: -1 });
readinessSmsReminderSchema.index({ userId: 1, taskId: 1, kind: 1, sendAt: 1 });

export default mongoose.models.ReadinessSmsReminder ||
  mongoose.model("ReadinessSmsReminder", readinessSmsReminderSchema);