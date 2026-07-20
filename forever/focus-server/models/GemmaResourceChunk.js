// server/models/GemmaResourceChunk.js

import mongoose from "mongoose";

const { Schema } = mongoose;

const GemmaResourceChunkSchema = new Schema(
  {
    resourceId: {
      type: Schema.Types.ObjectId,
      ref: "GemmaResource",
      required: true,
      index: true,
    },

    deviceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    userId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    chunkId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    index: {
      type: Number,
      required: true,
      index: true,
    },

    sourceType: {
      type: String,
      enum: ["youtube", "webpage", "pdf", "notes", "text", "code"],
      required: true,
      index: true,
    },

    title: {
      type: String,
      trim: true,
      default: "",
    },

    text: {
      type: String,
      required: true,
    },

    textPreview: {
      type: String,
      trim: true,
      default: "",
    },

    textChars: {
      type: Number,
      default: 0,
    },

    tokenCountEstimate: {
      type: Number,
      default: 0,
    },

    /**
     * YouTube / video transcript references.
     */
    timestampStart: {
      type: String,
      trim: true,
      default: "",
    },

    timestampEnd: {
      type: String,
      trim: true,
      default: "",
    },

    startSeconds: {
      type: Number,
      default: null,
      index: true,
    },

    endSeconds: {
      type: Number,
      default: null,
      index: true,
    },

    /**
     * PDF references.
     */
    pageNumber: {
      type: Number,
      default: null,
      index: true,
    },

    pageStart: {
      type: Number,
      default: null,
      index: true,
    },

    pageEnd: {
      type: Number,
      default: null,
      index: true,
    },

    /**
     * Text/code line references.
     */
    lineStart: {
      type: Number,
      default: null,
      index: true,
    },

    lineEnd: {
      type: Number,
      default: null,
      index: true,
    },

    /**
     * Useful for RAG/search later.
     * Step 2 uses keyword retrieval first.
     * Later we can add embeddings.
     */
    keywords: {
      type: [String],
      default: [],
      index: true,
    },

    concepts: {
      type: [String],
      default: [],
      index: true,
    },

    embeddingModel: {
      type: String,
      trim: true,
      default: "",
    },

    embedding: {
      type: [Number],
      default: undefined,
    },

    sourceRef: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    cachePath: {
      type: String,
      trim: true,
      default: "",
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

GemmaResourceChunkSchema.index({ resourceId: 1, index: 1 }, { unique: true });
GemmaResourceChunkSchema.index({ resourceId: 1, chunkId: 1 }, { unique: true });
GemmaResourceChunkSchema.index({ resourceId: 1, pageNumber: 1 });
GemmaResourceChunkSchema.index({ resourceId: 1, startSeconds: 1 });
GemmaResourceChunkSchema.index({ resourceId: 1, sourceRef: 1 });

GemmaResourceChunkSchema.index({
  text: "text",
  textPreview: "text",
  title: "text",
  keywords: "text",
  concepts: "text",
});

function estimateTokens(text = "") {
  return Math.ceil(String(text || "").length / 4);
}

function makePreview(text = "", max = 280) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= max) return clean;

  return `${clean.slice(0, max).trim()}...`;
}

function cleanStringArray(values = [], max = 60) {
  if (!Array.isArray(values)) return [];

  return [
    ...new Set(
      values
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ].slice(0, max);
}

function secondsToTimestamp(value = 0) {
  const total = Math.max(0, Number(value || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildSourceRef(doc) {
  if (doc.timestampStart || doc.timestampEnd) {
    const start = doc.timestampStart || secondsToTimestamp(doc.startSeconds || 0);
    const end = doc.timestampEnd || secondsToTimestamp(doc.endSeconds || 0);

    if (start && end) return `${start}–${end}`;
    if (start) return start;
  }

  if (doc.pageNumber) return `Page ${doc.pageNumber}`;

  if (doc.pageStart && doc.pageEnd && doc.pageStart !== doc.pageEnd) {
    return `Pages ${doc.pageStart}–${doc.pageEnd}`;
  }

  if (doc.pageStart) return `Page ${doc.pageStart}`;

  if (doc.lineStart && doc.lineEnd) return `Lines ${doc.lineStart}–${doc.lineEnd}`;

  if (doc.lineStart) return `Line ${doc.lineStart}`;

  return `Chunk ${Number(doc.index || 0) + 1}`;
}

GemmaResourceChunkSchema.pre("save", function beforeSave(next) {
  this.text = String(this.text || "").trim();
  this.textChars = this.text.length;
  this.textPreview = makePreview(this.text);
  this.tokenCountEstimate = this.tokenCountEstimate || estimateTokens(this.text);

  this.keywords = cleanStringArray(this.keywords, 80);
  this.concepts = cleanStringArray(this.concepts, 80);

  if (!this.sourceRef) {
    this.sourceRef = buildSourceRef(this);
  }

  if (!this.chunkId) {
    this.chunkId = `chunk_${Number(this.index || 0) + 1}`;
  }

  next();
});

GemmaResourceChunkSchema.methods.toClient = function toClient({
  includeText = false,
} = {}) {
  return {
    id: String(this._id),
    resourceId: String(this.resourceId),
    deviceId: this.deviceId,
    userId: this.userId,
    chunkId: this.chunkId,
    index: this.index,
    sourceType: this.sourceType,
    title: this.title,
    text: includeText ? this.text : undefined,
    textPreview: this.textPreview,
    textChars: this.textChars,
    tokenCountEstimate: this.tokenCountEstimate,
    timestampStart: this.timestampStart,
    timestampEnd: this.timestampEnd,
    startSeconds: this.startSeconds,
    endSeconds: this.endSeconds,
    pageNumber: this.pageNumber,
    pageStart: this.pageStart,
    pageEnd: this.pageEnd,
    lineStart: this.lineStart,
    lineEnd: this.lineEnd,
    keywords: this.keywords,
    concepts: this.concepts,
    sourceRef: this.sourceRef,
    metadata: this.metadata,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

GemmaResourceChunkSchema.statics.publicFields = function publicFields() {
  return {
    embedding: 0,
    embeddingModel: 0,
    cachePath: 0,
  };
};

const GemmaResourceChunk =
  mongoose.models.GemmaResourceChunk ||
  mongoose.model("GemmaResourceChunk", GemmaResourceChunkSchema);

export default GemmaResourceChunk;