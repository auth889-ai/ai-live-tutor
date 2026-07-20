import mongoose from "mongoose";

const readinessCheckinSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessTask",
      required: true,
      index: true,
    },

    deadlineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessDeadline",
      required: true,
      index: true,
    },

    answer: {
      type: String,
      enum: ["done", "half_done", "not_started", "confused", "skip"],
      required: true,
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

    note: {
      type: String,
      default: "",
    },

    source: {
      type: String,
      enum: ["app", "sms", "voice", "auto", "web"],
      default: "app",
      index: true,
    },

    aiText: {
      type: String,
      default: "",
    },

    voiceText: {
      type: String,
      default: "",
    },

    smsText: {
      type: String,
      default: "",
    },

    readinessBefore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    readinessAfter: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    readinessDelta: {
      type: Number,
      default: 0,
    },

    createdRecoveryTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessTask",
      default: null,
      index: true,
    },

    createdCarryOverTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadinessTask",
      default: null,
      index: true,
    },

    autoReplan: {
      type: Object,
      default: {},
    },

    recoveryPlan: {
      type: Object,
      default: {},
    },

    helpPack: {
      type: Object,
      default: {},
    },

    aiPayload: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

readinessCheckinSchema.index({ userId: 1, createdAt: -1 });
readinessCheckinSchema.index({ deadlineId: 1, createdAt: -1 });
readinessCheckinSchema.index({ userId: 1, answer: 1, createdAt: -1 });
readinessCheckinSchema.index({ userId: 1, source: 1, createdAt: -1 });

export default mongoose.models.ReadinessCheckin ||
  mongoose.model("ReadinessCheckin", readinessCheckinSchema);