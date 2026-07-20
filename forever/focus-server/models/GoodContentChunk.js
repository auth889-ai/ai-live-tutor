import mongoose from "mongoose";

const GoodContentChunkSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GoodContentJob",
      required: true,
    },

    userId: { type: String, trim: true, default: "guest" },
    deviceId: { type: String, trim: true, default: "web" },

    chunkIndex: { type: Number, required: true },

    startSeconds: { type: Number, default: 0 },
    endSeconds: { type: Number, default: 0 },

    text: { type: String, default: "" },
    textChars: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending", "processing", "done", "failed"],
      default: "pending",
    },

    topic: { type: String, trim: true, default: "" },

    difficulty: {
      type: String,
      enum: ["beginner", "intermediate", "advanced", "mixed", "unknown"],
      default: "unknown",
    },

    goalMatch: { type: Number, default: 0 },

    usefulness: {
      type: String,
      enum: ["low", "medium", "high", "unknown"],
      default: "unknown",
    },

    shouldWatch: { type: Boolean, default: false },

    summary: { type: String, trim: true, default: "" },
    reason: { type: String, trim: true, default: "" },

    keywords: { type: [String], default: [] },

    aiRaw: { type: mongoose.Schema.Types.Mixed, default: null },

    error: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

GoodContentChunkSchema.index({ jobId: 1, chunkIndex: 1 }, { unique: true });
GoodContentChunkSchema.index({ jobId: 1, status: 1 });
GoodContentChunkSchema.index({ jobId: 1, goalMatch: -1 });

export default mongoose.models.GoodContentChunk ||
  mongoose.model("GoodContentChunk", GoodContentChunkSchema);