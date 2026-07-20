 import mongoose from "mongoose";

/**
 * Stores privacy and behavior settings for Feature 1.
 */

const StudyUserSettingsSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "", index: true },
    deviceId: { type: String, required: true, unique: true, index: true },

    screenshotEnabled: { type: Boolean, default: true },
    blurSensitiveInputs: { type: Boolean, default: true },
    voiceEnabled: { type: Boolean, default: true },

    strictness: {
      type: String,
      enum: ["relaxed", "adaptive", "strict"],
      default: "adaptive",
    },

    privacyMode: {
      type: String,
      enum: ["standard", "high"],
      default: "standard",
    },

    screenshotMode: {
      type: String,
      enum: ["adaptive", "interval", "off"],
      default: "adaptive",
    },

    signalIntervalMs: { type: Number, default: 8000 },
    screenshotIntervalMs: { type: Number, default: 45000 },

    allowBrowserOverlay: { type: Boolean, default: true },
    allowNotifications: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.StudyUserSettings ||
  mongoose.model("StudyUserSettings", StudyUserSettingsSchema);