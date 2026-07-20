import mongoose from "mongoose";

/**
 * Stores memory/RAG update events for audit/debugging.
 */

const StudyMemoryEventSchema = new mongoose.Schema(
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
      enum: ["rag-save", "pattern-update", "feedback", "voice-feedback", "insight"],
      default: "rag-save",
    },

    goal: { type: String, default: "" },
    text: { type: String, default: "" },
    url: { type: String, default: "" },
    domain: { type: String, default: "" },

    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

StudyMemoryEventSchema.index({ deviceId: 1, createdAt: -1 });
StudyMemoryEventSchema.index({ sessionId: 1, createdAt: -1 });

export default mongoose.models.StudyMemoryEvent ||
  mongoose.model("StudyMemoryEvent", StudyMemoryEventSchema);