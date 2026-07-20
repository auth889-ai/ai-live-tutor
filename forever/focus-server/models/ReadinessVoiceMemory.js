import mongoose from "mongoose";

const readinessVoiceMemorySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    emotionalState: {
      current: {
        type: String,
        enum: ["neutral", "stressed", "overwhelmed", "confused", "tired", "motivated", "avoidant"],
        default: "neutral",
        index: true,
      },
      confidence: { type: Number, default: 0.35, min: 0, max: 1 },
      trend: {
        type: String,
        enum: ["stable", "improving", "worsening"],
        default: "stable",
      },
      lastDetectedAt: { type: Date, default: null },
      evidence: { type: [String], default: [] },
    },

    adaptiveTone: {
      current: {
        type: String,
        enum: ["gentle", "balanced", "direct", "strict", "reassuring"],
        default: "balanced",
        index: true,
      },
      reason: { type: String, default: "Default balanced coaching tone." },
      lastChangedAt: { type: Date, default: null },
    },

    struggleProfile: {
      repeatedSkips: { type: Number, default: 0, min: 0 },
      repeatedNotStarted: { type: Number, default: 0, min: 0 },
      repeatedConfusion: { type: Number, default: 0, min: 0 },
      repeatedStress: { type: Number, default: 0, min: 0 },
      lastStruggleAt: { type: Date, default: null },
      streakRiskLevel: {
        type: String,
        enum: ["low", "medium", "high", "critical"],
        default: "low",
        index: true,
      },
    },

    weakTopics: [
      {
        topic: { type: String, default: "", index: true },
        courseCode: { type: String, default: "", index: true },
        count: { type: Number, default: 1, min: 1 },
        lastMentionedAt: { type: Date, default: Date.now },
        evidence: { type: [String], default: [] },
      },
    ],

    longSummary: {
      type: String,
      default: "",
    },

    lastUserNeed: {
      type: String,
      default: "",
    },

    lastCoachPromise: {
      type: String,
      default: "",
    },

    counters: {
      totalVoiceTurns: { type: Number, default: 0, min: 0 },
      totalCheckinsFromVoice: { type: Number, default: 0, min: 0 },
      totalRecoveryMoments: { type: Number, default: 0, min: 0 },
    },

    lastSessionId: { type: String, default: "", index: true },
    lastActivityAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

readinessVoiceMemorySchema.index({ userId: 1, lastActivityAt: -1 });
readinessVoiceMemorySchema.index({ "weakTopics.topic": 1, userId: 1 });

export default mongoose.models.ReadinessVoiceMemory ||
  mongoose.model("ReadinessVoiceMemory", readinessVoiceMemorySchema);