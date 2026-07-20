import mongoose from "mongoose";

/**
 * Stores daily/weekly AI-generated insights.
 */

const StudyInsightSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "", index: true },
    deviceId: { type: String, required: true, index: true },

    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudySession",
      index: true,
    },

    range: {
      type: String,
      enum: ["session", "today", "week", "month"],
      default: "session",
      index: true,
    },

    title: { type: String, default: "" },
    summary: { type: String, default: "" },

    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    suggestions: { type: [String], default: [] },
    topics: { type: [String], default: [] },
    weakTopics: { type: [String], default: [] },

    metrics: {
      focusScore: { type: Number, default: 0 },
      studyMinutes: { type: Number, default: 0 },
      distractionCount: { type: Number, default: 0 },
      recoveryMinutes: { type: Number, default: 0 },
      confidenceAvg: { type: Number, default: 0 },
    },

    source: {
      type: String,
      enum: ["system", "ai", "manual"],
      default: "ai",
    },
  },
  { timestamps: true }
);

StudyInsightSchema.index({ deviceId: 1, range: 1, createdAt: -1 });
StudyInsightSchema.index({ sessionId: 1, createdAt: -1 });

export default mongoose.models.StudyInsight ||
  mongoose.model("StudyInsight", StudyInsightSchema);