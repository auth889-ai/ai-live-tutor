// server/models/GemmaResourceJob.js

import mongoose from "mongoose";

const { Schema } = mongoose;

export const GEMMA_RESOURCE_JOB_STATUSES = [
  "queued",
  "detecting_source",
  "fetching_content",
  "processing",
  "extracting_text",
  "cleaning_content",
  "chunking",
  "building_semantic_index",
  "building_pack",
  "saving_cache",
  "ready",
  "failed",
];

const JOB_STATUS_ALIASES = {
  indexing: "building_semantic_index",
  semantic_index: "building_semantic_index",
  semantic_indexing: "building_semantic_index",
  creating_embeddings: "building_semantic_index",
  embedding: "building_semantic_index",
  embeddings: "building_semantic_index",
  generating_pack: "building_pack",
  study_pack: "building_pack",
  saved: "ready",
  complete: "ready",
  completed: "ready",
  error: "failed",
};

export function normalizeGemmaResourceJobStatus(status = "") {
  const raw = String(status || "").trim();
  if (!raw) return "";
  const normalized = JOB_STATUS_ALIASES[raw] || raw;
  return GEMMA_RESOURCE_JOB_STATUSES.includes(normalized) ? normalized : "processing";
}

const JobLogSchema = new Schema(
  {
    at: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      trim: true,
      default: "",
    },
    stage: {
      type: String,
      trim: true,
      default: "",
    },
    message: {
      type: String,
      trim: true,
      default: "",
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
  },
  { _id: false }
);

const GemmaResourceJobSchema = new Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
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

    resourceId: {
      type: Schema.Types.ObjectId,
      ref: "GemmaResource",
      default: null,
      index: true,
    },

    sourceType: {
      type: String,
      enum: ["youtube", "webpage", "pdf", "notes", "text", "code", ""],
      default: "",
      index: true,
    },

    title: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: GEMMA_RESOURCE_JOB_STATUSES,
      default: "queued",
      index: true,
    },

    stage: {
      type: String,
      trim: true,
      default: "Queued",
    },

    message: {
      type: String,
      trim: true,
      default: "Waiting to start.",
    },

    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    input: {
      deviceId: {
        type: String,
        trim: true,
        default: "",
      },
      userId: {
        type: String,
        trim: true,
        default: "",
      },
      sourceType: {
        type: String,
        trim: true,
        default: "",
      },
      url: {
        type: String,
        trim: true,
        default: "",
      },
      title: {
        type: String,
        trim: true,
        default: "",
      },
      studyGoal: {
        type: String,
        trim: true,
        default: "",
      },
      textChars: {
        type: Number,
        default: 0,
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
      tags: {
        type: [String],
        default: [],
      },
    },

    output: {
      sourceType: {
        type: String,
        trim: true,
        default: "",
      },
      resourceId: {
        type: String,
        trim: true,
        default: "",
      },
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
      chunkCount: {
        type: Number,
        default: 0,
      },
      sectionCount: {
        type: Number,
        default: 0,
      },
      rawTextChars: {
        type: Number,
        default: 0,
      },
      estimatedStudyMinutes: {
        type: Number,
        default: 0,
      },
    },

    error: {
      type: String,
      default: "",
    },

    logs: {
      type: [JobLogSchema],
      default: [],
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

GemmaResourceJobSchema.index({ deviceId: 1, updatedAt: -1 });
GemmaResourceJobSchema.index({ deviceId: 1, status: 1, updatedAt: -1 });
GemmaResourceJobSchema.index({ resourceId: 1, updatedAt: -1 });

GemmaResourceJobSchema.methods.addLog = async function addLog({
  status = "",
  stage = "",
  message = "",
  progress = null,
} = {}) {
  const nextProgress =
    typeof progress === "number"
      ? Math.max(0, Math.min(100, progress))
      : this.progress;

  const safeStatus = normalizeGemmaResourceJobStatus(status);

  this.logs.push({
    at: new Date(),
    status: safeStatus || this.status,
    stage: stage || this.stage,
    message: message || this.message,
    progress: nextProgress,
  });

  if (safeStatus) this.status = safeStatus;
  if (stage) this.stage = stage;
  if (message) this.message = message;

  this.progress = nextProgress;

  if (!this.startedAt && safeStatus && safeStatus !== "queued") {
    this.startedAt = new Date();
  }

  if (safeStatus === "ready") {
    this.completedAt = new Date();
    this.failedAt = null;
    this.error = "";
    this.progress = 100;
  }

  if (safeStatus === "failed") {
    this.failedAt = new Date();
    this.completedAt = new Date();
    this.progress = 100;
  }

  return this.save();
};

GemmaResourceJobSchema.methods.toClient = function toClient() {
  return {
    id: String(this._id),
    jobId: this.jobId,
    deviceId: this.deviceId,
    userId: this.userId,
    resourceId: this.resourceId ? String(this.resourceId) : "",
    sourceType: this.sourceType,
    title: this.title,
    status: this.status,
    stage: this.stage,
    message: this.message,
    progress: this.progress,
    input: this.input,
    output: this.output,
    error: this.error,
    logs: this.logs,
    startedAt: this.startedAt,
    completedAt: this.completedAt,
    failedAt: this.failedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

GemmaResourceJobSchema.statics.updateProgress = async function updateProgress(
  jobId,
  {
    status = "",
    stage = "",
    message = "",
    progress = null,
    resourceId = null,
    output = null,
    error = "",
    metadata = null,
  } = {}
) {
  const job = await this.findOne({ jobId });

  if (!job) {
    throw new Error(`Gemma Resource job not found: ${jobId}`);
  }

  if (resourceId) {
    job.resourceId = resourceId;
  }

  if (output && typeof output === "object") {
    const currentOutput = job.output?.toObject?.() || job.output || {};

    job.output = {
      ...currentOutput,
      ...output,
    };
  }

  if (typeof error === "string") {
    job.error = error;
  }

  if (metadata && typeof metadata === "object") {
    job.metadata = {
      ...(job.metadata || {}),
      ...metadata,
    };
  }

  await job.addLog({
    status,
    stage,
    message,
    progress,
  });

  return job;
};

const GemmaResourceJob =
  mongoose.models.GemmaResourceJob ||
  mongoose.model("GemmaResourceJob", GemmaResourceJobSchema);

export default GemmaResourceJob;