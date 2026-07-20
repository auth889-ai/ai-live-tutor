import mongoose from "mongoose";

/**
 * server/models/PatternMemory.js
 * ------------------------------------------------------------
 * Stores learned user/device/goal/page-pattern memory.
 *
 * Why this file is fixed:
 * Your MongoDB error was:
 * E11000 duplicate key error:
 * deviceId_1_goalHash_1_patternKey_1
 * { goalHash: null, patternKey: null }
 *
 * So this model now always stores:
 * - goalHash
 * - patternKey
 *
 * This keeps old Mongo indexes safe and prevents duplicate null keys.
 */

function cleanText(value = "") {
  return String(value || "").trim();
}

function normalizeDomain(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
}

function hashText(value = "") {
  const text = cleanText(value).toLowerCase();

  if (!text) return "h0";

  let hash = 2166136261;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return `h${(hash >>> 0).toString(16)}`;
}

export function makePatternGoalHash(goal = "") {
  return hashText(goal || "");
}

export function makePatternKey({ domain = "", pageType = "", sourceType = "" } = {}) {
  const cleanDomain = normalizeDomain(domain) || "unknown-domain";
  const cleanPageType = cleanText(pageType || sourceType || "page")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${cleanDomain}:${cleanPageType || "page"}`;
}

const PatternMemorySchema = new mongoose.Schema(
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

    goal: {
      type: String,
      default: "",
      index: true,
    },

    goalHash: {
      type: String,
      required: true,
      default: "h0",
      index: true,
    },

    patternKey: {
      type: String,
      required: true,
      default: "unknown-domain:page",
      index: true,
    },

    domain: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
      index: true,
    },

    pageType: {
      type: String,
      default: "page",
    },

    sourceType: {
      type: String,
      default: "",
    },

    learnedType: {
      type: String,
      enum: ["study", "partial", "non-study", "unknown"],
      default: "unknown",
      index: true,
    },

    lastType: {
      type: String,
      enum: ["study", "partial", "non-study", "unknown"],
      default: "unknown",
    },

    correctedType: {
      type: String,
      enum: ["study", "partial", "non-study", "unknown"],
      default: "unknown",
    },

    confidence: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },

    memoryScore: {
      type: Number,
      default: 50,
      min: 0,
      max: 100,
    },

    studyCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    partialCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    nonStudyCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    positiveCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    negativeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    correctionCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastFeedback: {
      type: String,
      default: "",
    },

    lastReason: {
      type: String,
      default: "",
    },

    lastTitle: {
      type: String,
      default: "",
    },

    lastUrl: {
      type: String,
      default: "",
    },

    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

PatternMemorySchema.pre("validate", function preValidatePatternMemory(next) {
  this.userId = cleanText(this.userId || "");
  this.deviceId = cleanText(this.deviceId || "");
  this.goal = cleanText(this.goal || "");

  this.domain = normalizeDomain(this.domain || "");

  if (!this.goalHash || this.goalHash === "h0") {
    this.goalHash = makePatternGoalHash(this.goal);
  }

  if (!this.patternKey || this.patternKey === "unknown-domain:page") {
    this.patternKey = makePatternKey({
      domain: this.domain,
      pageType: this.pageType,
      sourceType: this.sourceType,
    });
  }

  if (!this.learnedType) this.learnedType = "unknown";
  if (!this.lastType) this.lastType = "unknown";
  if (!this.correctedType) this.correctedType = "unknown";

  this.confidence = Math.max(0, Math.min(1, Number(this.confidence || 0.5)));
  this.memoryScore = Math.max(0, Math.min(100, Number(this.memoryScore || 50)));

  next();
});

PatternMemorySchema.index(
  {
    deviceId: 1,
    goalHash: 1,
    patternKey: 1,
  },
  {
    unique: true,
  }
);

PatternMemorySchema.index({
  deviceId: 1,
  userId: 1,
  updatedAt: -1,
});

PatternMemorySchema.index({
  deviceId: 1,
  domain: 1,
  updatedAt: -1,
});

PatternMemorySchema.index({
  userId: 1,
  goalHash: 1,
  updatedAt: -1,
});

export default mongoose.models.PatternMemory ||
  mongoose.model("PatternMemory", PatternMemorySchema);