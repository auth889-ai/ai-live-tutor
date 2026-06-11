"use strict";

/**
 * server/models/GoogleLiveTutorResource.js
 * =============================================================================
 * Agent 1 stable MongoDB models.
 *
 * Collections intentionally match your .env / MongoDB MCP naming:
 * - resources
 * - resource_chunks
 *
 * This model supports Agent 1:
 * - PDF/text/transcript resource storage
 * - page/chunk storage
 * - source refs
 * - MongoDB read proof
 * =============================================================================
 */

const mongoose = require("mongoose");

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const SOURCE_TYPES = ["pdf", "text", "transcript", "url", "note", "unknown"];
const RESOURCE_STATUSES = ["uploaded", "extracting", "chunked", "failed"];

const GoogleLiveTutorResourceSchema = new Schema(
  {
    resourceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    ownerKey: {
      type: String,
      required: true,
      index: true,
    },

    offlineUserId: {
      type: String,
      default: "demo_user",
      index: true,
    },

    deviceId: {
      type: String,
      default: "demo_device",
      index: true,
    },

    title: {
      type: String,
      required: true,
      index: true,
    },

    originalFilename: {
      type: String,
      default: "",
    },

    sourceType: {
      type: String,
      enum: SOURCE_TYPES,
      default: "unknown",
      index: true,
    },

    mimeType: {
      type: String,
      default: "",
    },

    sizeBytes: {
      type: Number,
      default: 0,
    },

    sourceUrl: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: RESOURCE_STATUSES,
      default: "uploaded",
      index: true,
    },

    extraction: {
      method: {
        type: String,
        default: "unknown",
      },

      ok: {
        type: Boolean,
        default: false,
      },

      pageCount: {
        type: Number,
        default: 0,
      },

      charCount: {
        type: Number,
        default: 0,
      },

      chunkCount: {
        type: Number,
        default: 0,
      },

      hasText: {
        type: Boolean,
        default: false,
      },

      error: {
        type: String,
        default: "",
      },

      warnings: [
        {
          type: String,
        },
      ],
    },

    summary: {
      type: String,
      default: "",
    },

    tags: [
      {
        type: String,
        index: true,
      },
    ],

    metadata: {
      type: Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "resources",
  }
);

const GoogleLiveTutorResourceChunkSchema = new Schema(
  {
    chunkId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    resourceId: {
      type: String,
      required: true,
      index: true,
    },

    ownerKey: {
      type: String,
      required: true,
      index: true,
    },

    sourceType: {
      type: String,
      enum: SOURCE_TYPES,
      default: "unknown",
      index: true,
    },

    title: {
      type: String,
      default: "",
      index: true,
    },

    page: {
      type: Number,
      default: 1,
      index: true,
    },

    chunkIndex: {
      type: Number,
      default: 0,
      index: true,
    },

    text: {
      type: String,
      required: true,
    },

    textPreview: {
      type: String,
      default: "",
    },

    charStart: {
      type: Number,
      default: 0,
    },

    charEnd: {
      type: Number,
      default: 0,
    },

    tokenEstimate: {
      type: Number,
      default: 0,
    },

    sourceRef: {
      type: String,
      required: true,
      index: true,
    },

    pageRef: {
      type: String,
      default: "",
      index: true,
    },

    // 768-dim text-embedding-004 vector for Atlas $vectorSearch (hybrid RAG).
    // Excluded from default queries via select:false — fetch only when needed.
    embedding: {
      type: [Number],
      default: undefined,
      select: false,
    },

    embeddingModel: {
      type: String,
      default: "",
    },

    retrieval: {
      lastScore: {
        type: Number,
        default: 0,
      },

      lastQuery: {
        type: String,
        default: "",
      },

      lastMode: {
        type: String,
        default: "page-order",
      },
    },

    metadata: {
      type: Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "resource_chunks",
  }
);

GoogleLiveTutorResourceSchema.index({
  title: "text",
  summary: "text",
  tags: "text",
});

GoogleLiveTutorResourceChunkSchema.index({
  title: "text",
  text: "text",
  textPreview: "text",
});

GoogleLiveTutorResourceChunkSchema.index({
  ownerKey: 1,
  resourceId: 1,
  page: 1,
  chunkIndex: 1,
});

GoogleLiveTutorResourceChunkSchema.index({
  ownerKey: 1,
  resourceId: 1,
  sourceRef: 1,
});

const GoogleLiveTutorResource =
  mongoose.models.GoogleLiveTutorResource ||
  mongoose.model("GoogleLiveTutorResource", GoogleLiveTutorResourceSchema);

const GoogleLiveTutorResourceChunk =
  mongoose.models.GoogleLiveTutorResourceChunk ||
  mongoose.model("GoogleLiveTutorResourceChunk", GoogleLiveTutorResourceChunkSchema);

module.exports = {
  GoogleLiveTutorResource,
  GoogleLiveTutorResourceChunk,
  SOURCE_TYPES,
};