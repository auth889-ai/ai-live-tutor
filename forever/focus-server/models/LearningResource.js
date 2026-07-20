// server/models/LearningResource.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const LearningResourceSchema = new Schema(
  {
    treeId: {
      type: Schema.Types.ObjectId,
      ref: "LearningTree",
      required: true,
      index: true,
    },

    nodeId: {
      type: Schema.Types.ObjectId,
      ref: "LearningNode",
      required: true,
      index: true,
    },

    deviceId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    userId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    sourceType: {
      type: String,
      enum: [
        "lecture",
        "note",
        "notes",
        "video",
        "chart",
        "diagram",
        "key_points",
        "related_link",
        "related_links",
        "pdf",
        "webpage",
        "manual",
        "voice",
        "image",
        "screenshot",
        "table",
        "code",
        "audio",
        "file",
        "question",
        "flashcard",
      ],
      required: true,
      index: true,
    },

    title: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },

    normalizedTitle: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    url: {
      type: String,
      trim: true,
      default: "",
    },

    sourceUrl: {
      type: String,
      trim: true,
      default: "",
    },

    creator: {
      type: String,
      trim: true,
      default: "",
    },

    domain: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    thumbnail: {
      type: String,
      trim: true,
      default: "",
    },

    thumbnailUrl: {
      type: String,
      trim: true,
      default: "",
    },

    duration: {
      type: String,
      trim: true,
      default: "",
    },

    summary: {
      type: String,
      default: "",
    },

    content: {
      type: String,
      default: "",
    },

    extractedText: {
      type: String,
      default: "",
    },

    transcript: {
      type: String,
      default: "",
    },

    keyPoints: {
      type: [String],
      default: [],
    },

    concepts: {
      type: [String],
      default: [],
      index: true,
    },

    tags: {
      type: [String],
      default: [],
      index: true,
    },

    bookPages: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    qualityScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.65,
      index: true,
    },

    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.65,
      index: true,
    },

    pageRefs: {
      type: [Schema.Types.Mixed],
      default: [],
      index: true,
    },

    evidence: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    relatedChunkIds: {
      type: [String],
      default: [],
    },

    openMode: {
      type: String,
      enum: [
        "internal",
        "external",
        "pdf_page",
        "modal",
        "inline",
        "reader",
        "video",
        "flip_book",
        "pdf_evidence",
      ],
      default: "internal",
    },

    matchType: {
      type: String,
      enum: [
        "exact",
        "same_topic",
        "background",
        "manual",
        "pdf_evidence",
        "visual",
        "unknown",
      ],
      default: "unknown",
      index: true,
    },

    status: {
      type: String,
      enum: ["ready", "generating", "failed", "archived"],
      default: "ready",
      index: true,
    },

    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    completed: {
      type: Boolean,
      default: false,
      index: true,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    isUserAdded: {
      type: Boolean,
      default: false,
      index: true,
    },

    isUserCreated: {
      type: Boolean,
      default: false,
      index: true,
    },

    isUserEditable: {
      type: Boolean,
      default: false,
    },

    fileName: {
      type: String,
      trim: true,
      default: "",
    },

    mimeType: {
      type: String,
      trim: true,
      default: "",
    },

    fileSize: {
      type: Number,
      default: 0,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    rawAIOutput: {
      type: Schema.Types.Mixed,
      default: null,
    },

    lastOpenedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

function normalizeTitle(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueCleanArray(values = []) {
  return [...new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean))];
}

LearningResourceSchema.index({ treeId: 1, nodeId: 1, sourceType: 1 });
LearningResourceSchema.index({ treeId: 1, qualityScore: -1 });
LearningResourceSchema.index({ nodeId: 1, qualityScore: -1 });
LearningResourceSchema.index({
  title: "text",
  normalizedTitle: "text",
  summary: "text",
  content: "text",
  extractedText: "text",
  transcript: "text",
  keyPoints: "text",
  evidence: "text",
  tags: "text",
  concepts: "text",
});

LearningResourceSchema.pre("save", function preSave(next) {
  this.normalizedTitle = normalizeTitle(this.title);
  this.keyPoints = uniqueCleanArray(this.keyPoints).slice(0, 30);
  this.concepts = uniqueCleanArray(this.concepts).slice(0, 30);
  this.tags = uniqueCleanArray(this.tags).slice(0, 30);
  this.relatedChunkIds = uniqueCleanArray(this.relatedChunkIds);

  if (!this.sourceUrl && this.url) this.sourceUrl = this.url;
  if (!this.thumbnailUrl && this.thumbnail) this.thumbnailUrl = this.thumbnail;

  next();
});

LearningResourceSchema.methods.toClient = function toClient() {
  const obj = this.toObject();

  return {
    ...obj,
    id: String(obj._id),
    _id: String(obj._id),
    treeId: obj.treeId ? String(obj.treeId) : "",
    nodeId: obj.nodeId ? String(obj.nodeId) : "",
  };
};

const LearningResource =
  mongoose.models.LearningResource ||
  mongoose.model("LearningResource", LearningResourceSchema);

export default LearningResource;