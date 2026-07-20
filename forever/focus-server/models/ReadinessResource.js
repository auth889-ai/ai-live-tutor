import mongoose from "mongoose";

/**
 * Resource Hub model.
 *
 * Supports:
 * - topic/course resources
 * - public community resources
 * - vouch count and trust level
 * - edit resets vouches and stores history
 */

const readinessResourceSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "", index: true },

    courseCode: { type: String, default: "", index: true },
    courseTitle: { type: String, default: "" },

    topic: { type: String, required: true, index: true },
    title: { type: String, required: true, index: true },

    type: {
      type: String,
      enum: ["video", "article", "note", "problem", "template", "book", "other"],
      default: "note",
      index: true,
    },

    level: {
      type: String,
      enum: ["beginner", "medium", "advanced"],
      default: "beginner",
    },

    url: { type: String, default: "" },
    content: { type: String, default: "" },

    public: { type: Boolean, default: false, index: true },

    vouches: [
      {
        userId: String,
        userEmail: String,
        at: Date,
      },
    ],

    vouchCount: { type: Number, default: 0, index: true },

    trustLevel: {
      type: String,
      enum: ["Low", "Medium", "High", "Needs Re-verification"],
      default: "Low",
    },

    version: { type: Number, default: 1 },

    editHistory: [
      {
        editedBy: String,
        patch: Object,
        at: Date,
        reason: String,
      },
    ],
  },
  { timestamps: true }
);

readinessResourceSchema.index({ courseCode: 1, topic: 1, public: 1 });

export default mongoose.models.ReadinessResource ||
  mongoose.model("ReadinessResource", readinessResourceSchema);