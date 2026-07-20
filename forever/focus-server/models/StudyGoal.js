import mongoose from "mongoose";

/**
 * File purpose:
 * Stores the user's active study goal per device.
 *
 * Important fix:
 * - userId is optional.
 * - Chrome extension can work without login using userId: "".
 * - study.service.js uses { deviceId, userId } in findOneAndUpdate().
 */
const StudyGoalSchema = new mongoose.Schema(
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
      trim: true,
    },

    goal: {
      type: String,
      required: true,
      trim: true,
    },

    focusAreas: {
      type: [String],
      default: [],
    },

    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

StudyGoalSchema.index({ deviceId: 1, userId: 1, active: 1 });
StudyGoalSchema.index({ deviceId: 1, updatedAt: -1 });
StudyGoalSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.models.StudyGoal ||
  mongoose.model("StudyGoal", StudyGoalSchema);