import mongoose from "mongoose";

/**
 * Stores every intervention separately:
 * popup, ask-user, voice nudge, refocus warning.
 */

const StudyInterventionSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "", index: true },
    deviceId: { type: String, required: true, index: true },

    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudySession",
      index: true,
    },

    activityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudyActivity",
      index: true,
    },

    type: {
      type: String,
      enum: ["popup", "voice", "ask", "motivation", "refocus", "system"],
      default: "popup",
    },

    title: { type: String, default: "" },
    message: { type: String, default: "" },
    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },

    status: {
      type: String,
      enum: ["shown", "ignored", "accepted", "dismissed", "resolved"],
      default: "shown",
    },

    aiType: {
      type: String,
      enum: ["study", "partial", "non-study", "unknown"],
      default: "unknown",
    },

    reason: { type: String, default: "" },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

StudyInterventionSchema.index({ deviceId: 1, createdAt: -1 });
StudyInterventionSchema.index({ sessionId: 1, createdAt: -1 });

export default mongoose.models.StudyIntervention ||
  mongoose.model("StudyIntervention", StudyInterventionSchema);