
import mongoose from "mongoose";

const readinessMaterialSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: [
        "link",
        "drive_file",
        "youtube",
        "form",
        "pdf",
        "doc",
        "slide",
        "sheet",
        "image",
        "attachment",
        "rubric",
        "unknown",
      ],
      default: "unknown",
      index: true,
    },

    title: {
      type: String,
      default: "",
    },

    url: {
      type: String,
      default: "",
    },

    alternateLink: {
      type: String,
      default: "",
    },

    driveFileId: {
      type: String,
      default: "",
      index: true,
    },

    mimeType: {
      type: String,
      default: "",
    },

    thumbnailUrl: {
      type: String,
      default: "",
    },

    source: {
      type: String,
      enum: ["manual", "google_classroom", "google_drive", "web", "unknown"],
      default: "unknown",
    },

    extractedText: {
      type: String,
      default: "",
    },

    extractionStatus: {
      type: String,
      enum: ["not_started", "metadata_only", "extracted", "failed", "skipped"],
      default: "metadata_only",
      index: true,
    },

    extractionError: {
      type: String,
      default: "",
    },

    raw: {
      type: Object,
      default: {},
    },
  },
  { _id: false }
);

const readinessRubricSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    points: { type: Number, default: 0 },
    criteria: { type: [Object], default: [] },
    raw: { type: Object, default: {} },
  },
  { _id: false }
);

const readinessCalendarSyncSchema = new mongoose.Schema(
  {
    officialEventId: { type: String, default: "", index: true },
    preparationEventIds: { type: [String], default: [] },
    lastSyncedAt: { type: Date, default: null },
    syncStatus: {
      type: String,
      enum: ["not_synced", "synced", "partial", "failed"],
      default: "not_synced",
      index: true,
    },
    syncError: { type: String, default: "" },
  },
  { _id: false }
);

const readinessDeadlineSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    source: {
      type: String,
      enum: ["manual", "google_classroom", "import"],
      default: "manual",
      index: true,
    },

    externalId: {
      type: String,
      default: "",
      index: true,
    },

    classroomCourseId: {
      type: String,
      default: "",
      index: true,
    },

    classroomCourseWorkId: {
      type: String,
      default: "",
      index: true,
    },

    courseCode: {
      type: String,
      default: "",
      index: true,
    },

    courseTitle: {
      type: String,
      default: "",
      index: true,
    },

    section: {
      type: String,
      default: "",
    },

    instructor: {
      type: String,
      default: "",
    },

    title: {
      type: String,
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["assignment", "quiz", "exam", "lab", "project", "other"],
      default: "assignment",
      index: true,
    },

    dueDate: {
      type: Date,
      required: true,
      index: true,
    },

    dueTime: {
      type: String,
      default: "23:59",
    },

    timezone: {
      type: String,
      default: "Asia/Dhaka",
    },

    topics: [{ type: String, index: true }],

    difficulty: {
      type: Number,
      default: 3,
      min: 1,
      max: 5,
      index: true,
    },

    estimatedHours: {
      type: Number,
      default: 3,
      min: 0.25,
      max: 200,
    },

    weightPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    description: {
      type: String,
      default: "",
    },

    materialsText: {
      type: String,
      default: "",
    },

    materials: {
      type: [readinessMaterialSchema],
      default: [],
    },

    rubric: {
      type: readinessRubricSchema,
      default: () => ({}),
    },

    url: {
      type: String,
      default: "",
    },

    readinessScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      index: true,
    },

    riskLevel: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "High",
      index: true,
    },

    aiReason: {
      type: String,
      default: "",
    },

    nextAction: {
      type: String,
      default: "",
    },

    weakTopics: [{ type: String, index: true }],

    scoreEvidence: {
      type: Object,
      default: {},
    },

    heavyWeekEvidence: {
      type: Object,
      default: {},
    },

    latestRecoverySummary: {
      type: String,
      default: "",
    },

    latestRecoveryAt: {
      type: Date,
      default: null,
    },

    googleCalendar: {
      type: readinessCalendarSyncSchema,
      default: () => ({}),
    },

    status: {
      type: String,
      enum: ["active", "completed", "archived"],
      default: "active",
      index: true,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    lastPlannedAt: {
      type: Date,
      default: null,
    },

    lastScoredAt: {
      type: Date,
      default: null,
    },

    lastImportedAt: {
      type: Date,
      default: null,
    },

    raw: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

readinessDeadlineSchema.index({ userId: 1, dueDate: 1, status: 1 });
readinessDeadlineSchema.index({ userId: 1, source: 1, externalId: 1 });
readinessDeadlineSchema.index({ userId: 1, courseCode: 1, dueDate: 1 });
readinessDeadlineSchema.index({ userId: 1, riskLevel: 1, readinessScore: 1 });

export default mongoose.models.ReadinessDeadline ||
  mongoose.model("ReadinessDeadline", readinessDeadlineSchema);