import mongoose from "mongoose";

const GoodContentJobSchema = new mongoose.Schema(
  {
    userId: { type: String, trim: true, default: "guest" },
    deviceId: { type: String, trim: true, default: "web" },

    url: { type: String, trim: true, required: true },
    title: { type: String, trim: true, default: "Untitled content" },

    platform: {
      type: String,
      enum: ["youtube", "webpage", "text", "unknown"],
      default: "unknown",
    },

    userGoal: { type: String, trim: true, required: true },

    userLevel: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },

    contentNeed: { type: String, trim: true, default: "full explanation" },
    extraRequirement: { type: String, trim: true, default: "" },
    timeAvailableMinutes: { type: Number, default: 0 },

    status: {
      type: String,
      enum: [
        "queued",
        "fetching",
        "chunking",
        "processing",
        "merging",
        "ready",
        "failed",
      ],
      default: "queued",
    },

    phase: { type: String, trim: true, default: "queued" },
    message: { type: String, trim: true, default: "Queued for analysis." },

    durationSeconds: { type: Number, default: 0 },
    transcriptSource: { type: String, trim: true, default: "" },
    transcriptChars: { type: Number, default: 0 },

    requestPageText: { type: String, default: "" },
    requestTranscript: { type: String, default: "" },
    requestSegments: { type: mongoose.Schema.Types.Mixed, default: [] },

    totalChunks: { type: Number, default: 0 },
    processedChunks: { type: Number, default: 0 },
    failedChunks: { type: Number, default: 0 },
    progress: { type: Number, default: 0 },

    strategy: {
      type: String,
      enum: ["direct", "parallel", "long_background"],
      default: "direct",
    },

    chunkSeconds: { type: Number, default: 300 },
    concurrency: { type: Number, default: 2 },

    fitScore: { type: Number, default: 0 },

    recommendation: {
      type: String,
      enum: ["watch", "partial_watch", "skip", "unknown"],
      default: "unknown",
    },

    finalRoadmap: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    error: { type: String, trim: true, default: "" },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

GoodContentJobSchema.index({ userId: 1, createdAt: -1 });
GoodContentJobSchema.index({ deviceId: 1, createdAt: -1 });
GoodContentJobSchema.index({ status: 1, createdAt: -1 });
GoodContentJobSchema.index({ url: 1, userGoal: 1, userLevel: 1 });

export default mongoose.models.GoodContentJob ||
  mongoose.model("GoodContentJob", GoodContentJobSchema);