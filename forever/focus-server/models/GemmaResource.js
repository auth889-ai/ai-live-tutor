// server/models/GemmaResource.js

import mongoose from "mongoose";

const { Schema } = mongoose;

export const GEMMA_RESOURCE_STATUSES = [
  "draft",
  "queued",
  "detecting_source",
  "fetching_content",
  "processing",
  "extracting",
  "extracting_text",
  "cleaning_content",
  "chunking",
  "building_semantic_index",
  "building_pack",
  "saving_cache",
  "ready",
  "failed",
  "archived",
];

const SectionSchema = new Schema(
  {
    title: {
      type: String,
      trim: true,
      default: "",
    },
    summary: {
      type: String,
      trim: true,
      default: "",
    },
    sourceRef: {
      type: String,
      trim: true,
      default: "",
    },
    chunkIds: {
      type: [String],
      default: [],
    },
    start: {
      type: String,
      trim: true,
      default: "",
    },
    end: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const PracticeQuestionSchema = new Schema(
  {
    question: {
      type: String,
      trim: true,
      default: "",
    },
    answer: {
      type: String,
      trim: true,
      default: "",
    },
    type: {
      type: String,
      trim: true,
      default: "short_answer",
    },
    difficulty: {
      type: String,
      trim: true,
      default: "medium",
    },
    chunkIds: {
      type: [String],
      default: [],
    },
    sourceRef: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const RoadmapStepSchema = new Schema(
  {
    step: {
      type: String,
      trim: true,
      default: "",
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    whatToDo: {
      type: String,
      trim: true,
      default: "",
    },
    why: {
      type: String,
      trim: true,
      default: "",
    },
    sourceRef: {
      type: String,
      trim: true,
      default: "",
    },
    chunkIds: {
      type: [String],
      default: [],
    },
  },
  { _id: false }
);

const GemmaResourceSchema = new Schema(
  {
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

    title: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    normalizedTitle: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    sourceType: {
      type: String,
      enum: ["youtube", "webpage", "pdf", "notes", "text", "code"],
      required: true,
      index: true,
    },

    sourceUrl: {
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

    originalFileName: {
      type: String,
      trim: true,
      default: "",
    },

    mimeType: {
      type: String,
      trim: true,
      default: "",
    },

    studyGoal: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: GEMMA_RESOURCE_STATUSES,
      default: "queued",
      index: true,
    },

    offlineReady: {
      type: Boolean,
      default: false,
      index: true,
    },

    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    summary: {
      type: String,
      default: "",
    },

    deepExplanation: {
      type: String,
      default: "",
    },

    sections: {
      type: [SectionSchema],
      default: [],
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

    quickRevision: {
      type: [String],
      default: [],
    },

    roadmap: {
      type: [RoadmapStepSchema],
      default: [],
    },

    practiceQuestions: {
      type: [PracticeQuestionSchema],
      default: [],
    },

    rawTextPreview: {
      type: String,
      default: "",
    },

    rawTextChars: {
      type: Number,
      default: 0,
    },

    chunkCount: {
      type: Number,
      default: 0,
    },

    sectionCount: {
      type: Number,
      default: 0,
    },

    pageCount: {
      type: Number,
      default: 0,
    },

    durationSeconds: {
      type: Number,
      default: 0,
    },

    estimatedStudyMinutes: {
      type: Number,
      default: 0,
    },

    cacheDir: {
      type: String,
      default: "",
    },

    rawTextPath: {
      type: String,
      default: "",
    },

    chunksPath: {
      type: String,
      default: "",
    },

    packPath: {
      type: String,
      default: "",
    },

    bookPath: {
      type: String,
      default: "",
    },

    error: {
      type: String,
      default: "",
    },

    processingStartedAt: {
      type: Date,
      default: null,
    },

    processingCompletedAt: {
      type: Date,
      default: null,
    },

    lastOpenedAt: {
      type: Date,
      default: null,
    },

    localGemma: {
      baseUrl: {
        type: String,
        default: "",
      },
      model: {
        type: String,
        default: "",
      },
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

GemmaResourceSchema.index({
  title: "text",
  normalizedTitle: "text",
  summary: "text",
  deepExplanation: "text",
  tags: "text",
  concepts: "text",
  rawTextPreview: "text",
});

GemmaResourceSchema.index({ deviceId: 1, status: 1, updatedAt: -1 });
GemmaResourceSchema.index({ deviceId: 1, sourceType: 1, updatedAt: -1 });
GemmaResourceSchema.index({ deviceId: 1, offlineReady: 1, updatedAt: -1 });

function normalizeTitle(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanStringArray(values = [], max = 80) {
  if (!Array.isArray(values)) return [];

  return [
    ...new Set(
      values
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    ),
  ].slice(0, max);
}

function estimateStudyMinutes(rawTextChars = 0, chunkCount = 0) {
  const byChars = Math.ceil(Number(rawTextChars || 0) / 4500) * 5;
  const byChunks = Number(chunkCount || 0) * 4;

  return Math.max(5, Math.min(600, Math.max(byChars, byChunks)));
}

GemmaResourceSchema.pre("save", function beforeSave(next) {
  this.normalizedTitle = normalizeTitle(this.title);

  this.tags = cleanStringArray(this.tags, 40);
  this.concepts = cleanStringArray(this.concepts, 80);
  this.keyPoints = cleanStringArray(this.keyPoints, 80);
  this.quickRevision = cleanStringArray(this.quickRevision, 80);

  this.sectionCount = Array.isArray(this.sections) ? this.sections.length : 0;

  if (!this.estimatedStudyMinutes) {
    this.estimatedStudyMinutes = estimateStudyMinutes(
      this.rawTextChars,
      this.chunkCount
    );
  }

  if (
    [
      "detecting_source",
      "fetching_content",
      "processing",
      "extracting",
      "extracting_text",
      "cleaning_content",
      "chunking",
      "building_semantic_index",
      "building_pack",
      "saving_cache",
    ].includes(this.status)
  ) {
    this.offlineReady = false;

    if (!this.processingStartedAt) {
      this.processingStartedAt = new Date();
    }
  }

  if (this.status === "ready") {
    this.offlineReady = true;
    this.progress = 100;
    this.error = "";
    this.processingCompletedAt = new Date();

    if (!this.processingStartedAt) {
      this.processingStartedAt = new Date();
    }
  }

  if (this.status === "failed") {
    this.offlineReady = false;
    this.processingCompletedAt = new Date();
  }

  next();
});

GemmaResourceSchema.methods.toClient = function toClient() {
  return {
    id: String(this._id),
    deviceId: this.deviceId,
    userId: this.userId,
    title: this.title,
    sourceType: this.sourceType,
    sourceUrl: this.sourceUrl,
    domain: this.domain,
    originalFileName: this.originalFileName,
    mimeType: this.mimeType,
    studyGoal: this.studyGoal,
    status: this.status,
    offlineReady: this.offlineReady,
    progress: this.progress,
    summary: this.summary,
    deepExplanation: this.deepExplanation,
    sections: this.sections,
    keyPoints: this.keyPoints,
    concepts: this.concepts,
    tags: this.tags,
    quickRevision: this.quickRevision,
    roadmap: this.roadmap,
    practiceQuestions: this.practiceQuestions,
    rawTextPreview: this.rawTextPreview,
    rawTextChars: this.rawTextChars,
    chunkCount: this.chunkCount,
    sectionCount: this.sectionCount,
    pageCount: this.pageCount,
    durationSeconds: this.durationSeconds,
    estimatedStudyMinutes: this.estimatedStudyMinutes,
    error: this.error,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    lastOpenedAt: this.lastOpenedAt,
    metadata: this.metadata,
  };
};

GemmaResourceSchema.statics.publicFields = function publicFields() {
  return {
    cacheDir: 0,
    rawTextPath: 0,
    chunksPath: 0,
    packPath: 0,
    bookPath: 0,
    "localGemma.baseUrl": 0,
    "localGemma.model": 0,
  };
};

const GemmaResource =
  mongoose.models.GemmaResource ||
  mongoose.model("GemmaResource", GemmaResourceSchema);

export default GemmaResource;