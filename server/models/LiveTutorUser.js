"use strict";

/**
 * server/models/LiveTutorUser.js
 * =============================================================================
 * Real backend user model for AI Live Tutor.
 *
 * Why this exists:
 * - Frontend-only ownerKey/password is fake security.
 * - Real separation requires server-side user + password hash.
 * - After login, backend issues signed token containing ownerKey.
 * - Existing resource/tree/session ownership then uses that ownerKey.
 *
 * No external dependencies:
 * - Uses Node crypto.pbkdf2Sync instead of bcrypt.
 * =============================================================================
 */

const crypto = require("crypto");
const mongoose = require("mongoose");

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function normalizeName(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function makeOwnerKeyFromName(name) {
  const slug = normalizeName(name);
  return `glt_user_${slug || "student"}`;
}

function makeSalt() {
  return crypto.randomBytes(24).toString("hex");
}

function hashPassword(password, salt, iterations = 160000) {
  const cleanPassword = safeString(password);

  if (!cleanPassword) {
    throw new Error("Password is required.");
  }

  return crypto
    .pbkdf2Sync(cleanPassword, salt, iterations, 64, "sha512")
    .toString("hex");
}

function timingSafeEqualHex(a, b) {
  const aBuf = Buffer.from(String(a || ""), "hex");
  const bBuf = Buffer.from(String(b || ""), "hex");

  if (aBuf.length !== bBuf.length) return false;

  return crypto.timingSafeEqual(aBuf, bBuf);
}

const LiveTutorUserSchema = new mongoose.Schema(
  {
    ownerKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    displayName: {
      type: String,
      required: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    passwordSalt: {
      type: String,
      required: true,
      select: false,
    },

    passwordIterations: {
      type: Number,
      default: 160000,
      select: false,
    },

    tokenVersion: {
      type: Number,
      default: 1,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    lastDeviceId: {
      type: String,
      default: "",
      trim: true,
    },

    devices: [
      {
        deviceId: { type: String, trim: true },
        lastSeenAt: { type: Date, default: Date.now },
        userAgent: { type: String, default: "" },
      },
    ],

    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "livetutorusers",
  }
);

LiveTutorUserSchema.statics.normalizeName = normalizeName;
LiveTutorUserSchema.statics.makeOwnerKeyFromName = makeOwnerKeyFromName;

LiveTutorUserSchema.statics.createWithPassword = async function createWithPassword({
  name,
  password,
  ownerKey,
  deviceId,
  userAgent,
}) {
  const displayName = safeString(name);
  const username = normalizeName(displayName);
  const finalOwnerKey = safeString(ownerKey) || makeOwnerKeyFromName(displayName);

  if (!displayName) {
    throw new Error("Name is required.");
  }

  if (!username) {
    throw new Error("Name must contain letters or numbers.");
  }

  if (safeString(password).length < 3) {
    throw new Error("Password must be at least 3 characters.");
  }

  const existing = await this.findOne({
    $or: [{ username }, { ownerKey: finalOwnerKey }],
  }).lean();

  if (existing) {
    const error = new Error(
      existing.username === username
        ? "This name is already registered. Please login."
        : "This ownerKey is already registered. Please login."
    );
    error.statusCode = 409;
    throw error;
  }

  const passwordSalt = makeSalt();
  const passwordIterations = 160000;
  const passwordHash = hashPassword(password, passwordSalt, passwordIterations);

  const cleanDeviceId = safeString(deviceId, `${finalOwnerKey}_device`);

  const user = await this.create({
    ownerKey: finalOwnerKey,
    username,
    displayName,
    passwordHash,
    passwordSalt,
    passwordIterations,
    lastLoginAt: new Date(),
    lastDeviceId: cleanDeviceId,
    devices: [
      {
        deviceId: cleanDeviceId,
        lastSeenAt: new Date(),
        userAgent: safeString(userAgent),
      },
    ],
    metadata: {
      createdBy: "liveTutorAuth",
      fallbackUsed: false,
      usedSmartFallback: false,
    },
  });

  return user;
};

LiveTutorUserSchema.methods.verifyPassword = function verifyPassword(password) {
  const candidate = hashPassword(
    password,
    this.passwordSalt,
    this.passwordIterations || 160000
  );

  return timingSafeEqualHex(candidate, this.passwordHash);
};

LiveTutorUserSchema.methods.recordLogin = async function recordLogin({ deviceId, userAgent }) {
  const cleanDeviceId = safeString(deviceId, `${this.ownerKey}_device`);
  const now = new Date();

  this.lastLoginAt = now;
  this.lastDeviceId = cleanDeviceId;

  const existingDevice = this.devices.find((d) => d.deviceId === cleanDeviceId);

  if (existingDevice) {
    existingDevice.lastSeenAt = now;
    existingDevice.userAgent = safeString(userAgent);
  } else {
    this.devices.push({
      deviceId: cleanDeviceId,
      lastSeenAt: now,
      userAgent: safeString(userAgent),
    });
  }

  await this.save();
};

LiveTutorUserSchema.methods.toSafeAuthJSON = function toSafeAuthJSON() {
  return {
    userId: String(this._id),
    ownerKey: this.ownerKey,
    offlineUserId: this.ownerKey,
    username: this.username,
    displayName: this.displayName,
    deviceId: this.lastDeviceId || `${this.ownerKey}_device`,
    tokenVersion: this.tokenVersion || 1,
    status: this.status,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    lastLoginAt: this.lastLoginAt,
  };
};

module.exports =
  mongoose.models.LiveTutorUser ||
  mongoose.model("LiveTutorUser", LiveTutorUserSchema);