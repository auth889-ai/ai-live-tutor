import mongoose from "mongoose";

/**
 * StudySession separates saved goal from active monitoring.
 *
 * Important:
 * - Goal can stay saved forever.
 * - Monitoring starts only when an active session exists.
 * - Extension/backend analyze signals only while session.active === true.
 */

const StudySessionSchema = new mongoose.Schema(
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

    deviceType: {
      type: String,
      enum: ["extension", "mobile", "web", "unknown"],
      default: "extension",
    },

    label: {
      type: String,
      default: "Study device",
    },

    goal: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Required because study.service.js reads/writes active:true.
     * Without this field, Start Session works but popup/dashboard may still show PAUSED.
     */
    active: {
      type: Boolean,
      default: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["active", "ended"],
      default: "active",
      index: true,
    },

    startedAt: {
      type: Date,
      default: Date.now,
    },

    endedAt: {
      type: Date,
      default: null,
    },

    reason: {
      type: String,
      default: "",
    },

    startReason: {
      type: String,
      default: "",
    },

    endReason: {
      type: String,
      default: "",
    },

    totals: {
      activities: { type: Number, default: 0 },
      study: { type: Number, default: 0 },
      partial: { type: Number, default: 0 },
      nonStudy: { type: Number, default: 0 },
      interventions: { type: Number, default: 0 },
      voiceTurns: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

StudySessionSchema.index({ deviceId: 1, userId: 1, active: 1, startedAt: -1 });
StudySessionSchema.index({ deviceId: 1, status: 1, startedAt: -1 });
StudySessionSchema.index({ userId: 1, status: 1, startedAt: -1 });

export default mongoose.models.StudySession ||
  mongoose.model("StudySession", StudySessionSchema);