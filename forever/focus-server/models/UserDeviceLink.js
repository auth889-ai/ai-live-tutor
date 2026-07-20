import mongoose from "mongoose";

/**
 * File purpose:
 * Links a user/device pair for realtime dashboard + extension sync.
 *
 * Works for:
 * - extension without login: userId = ""
 * - logged-in user later: userId = actual user id
 */
const UserDeviceLinkSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      default: "",
      index: true,
    },

    deviceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    deviceType: {
      type: String,
      enum: ["extension", "mobile", "web", "unknown"],
      default: "unknown",
      index: true,
    },

    label: {
      type: String,
      default: "Study device",
      trim: true,
    },

    active: {
      type: Boolean,
      default: true,
      index: true,
    },

    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

UserDeviceLinkSchema.index(
  { deviceId: 1, userId: 1 },
  { unique: true }
);

UserDeviceLinkSchema.index({ userId: 1, lastSeenAt: -1 });
UserDeviceLinkSchema.index({ deviceId: 1, lastSeenAt: -1 });

export default mongoose.models.UserDeviceLink ||
  mongoose.model("UserDeviceLink", UserDeviceLinkSchema);