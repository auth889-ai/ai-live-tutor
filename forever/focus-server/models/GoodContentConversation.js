import mongoose from "mongoose";

const GoodContentConversationSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GoodContentJob",
      required: true,
    },

    userId: { type: String, trim: true, default: "guest" },
    deviceId: { type: String, trim: true, default: "web" },

    question: { type: String, trim: true, required: true },
    answer: { type: String, trim: true, default: "" },

    selectedStartSeconds: { type: Number, default: null },
    selectedEndSeconds: { type: Number, default: null },

    relatedChunkIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "GoodContentChunk",
      },
    ],

    error: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

GoodContentConversationSchema.index({ jobId: 1, createdAt: -1 });
GoodContentConversationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.GoodContentConversation ||
  mongoose.model("GoodContentConversation", GoodContentConversationSchema);