import mongoose from "mongoose";

const readinessGoogleTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    accessToken: {
      type: String,
      default: "",
    },

    refreshToken: {
      type: String,
      default: "",
    },

    expiryDate: {
      type: Number,
      default: null,
    },

    scope: {
      type: String,
      default: "",
    },

    tokenType: {
      type: String,
      default: "Bearer",
    },

    connectedAt: {
      type: Date,
      default: Date.now,
    },

    lastImportedAt: {
      type: Date,
      default: null,
    },

    lastCalendarSyncedAt: {
      type: Date,
      default: null,
    },

    classroom: {
      enabled: { type: Boolean, default: true },
      lastCourseCount: { type: Number, default: 0 },
      lastCourseWorkCount: { type: Number, default: 0 },
      lastImportError: { type: String, default: "" },
    },

    calendar: {
      enabled: { type: Boolean, default: false },
      calendarId: { type: String, default: "primary" },
      lastSyncError: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

export default mongoose.models.ReadinessGoogleToken ||
  mongoose.model("ReadinessGoogleToken", readinessGoogleTokenSchema);