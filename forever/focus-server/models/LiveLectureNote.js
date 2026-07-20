import mongoose from "mongoose";

const { Schema } = mongoose;

const LectureSectionSchema = new Schema(
  {
    heading: { type: String, trim: true, default: "" },
    bullets: { type: [String], default: [] },
  },
  { _id: false }
);

const TranscriptSegmentSchema = new Schema(
  {
    start: { type: Number, default: 0 },
    end: { type: Number, default: 0 },
    text: { type: String, default: "" },
  },
  { _id: false }
);

const LiveLectureNoteSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },

    ownerKey: { type: String, required: true, trim: true, index: true },
    offlineUserId: { type: String, trim: true, default: "", index: true },
    userId: { type: String, trim: true, default: "", index: true },
    deviceId: { type: String, trim: true, default: "", index: true },
    ownerType: {
      type: String,
      enum: ["offline", "user", "device", "unknown"],
      default: "unknown",
      index: true,
    },

    topic: { type: String, trim: true, default: "Untitled Lecture", index: true },
    language: { type: String, trim: true, default: "en" },

    sourceType: {
      type: String,
      enum: ["audio", "transcript", "manual"],
      default: "transcript",
      index: true,
    },

    status: {
      type: String,
      enum: ["created", "transcribing", "generating", "completed", "failed"],
      default: "created",
      index: true,
    },

    audio: {
      originalName: { type: String, default: "" },
      filename: { type: String, default: "" },
      path: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      sizeBytes: { type: Number, default: 0 },
      durationSeconds: { type: Number, default: 0 },
    },

    transcript: { type: String, default: "" },
    transcriptSegments: { type: [TranscriptSegmentSchema], default: [] },
    detectedLanguage: { type: String, trim: true, default: "" },

    note: {
      title: { type: String, default: "" },
      lectureTopic: { type: String, default: "" },
      overview: { type: String, default: "" },
      learningObjectives: { type: [String], default: [] },
      keyConcepts: { type: [String], default: [] },
      definitions: { type: [LectureSectionSchema], default: [] },
      detailedNotes: { type: [LectureSectionSchema], default: [] },
      stepByStepExplanation: { type: [LectureSectionSchema], default: [] },
      examples: { type: [LectureSectionSchema], default: [] },
      formulas: { type: [String], default: [] },
      summary: { type: String, default: "" },
      examFocus: { type: [String], default: [] },
      questionsToReview: { type: [String], default: [] },
      possibleExamQuestions: { type: [String], default: [] },
      uncertainParts: { type: [String], default: [] },
    },

    ai: {
      provider: { type: String, default: "ollama" },
      model: { type: String, default: "" },
      url: { type: String, default: "" },
      latencyMs: { type: Number, default: 0 },
      confidence: { type: Number, default: 0 },
      generatedAt: { type: Date, default: null },
      strictTranscriptOnly: { type: Boolean, default: true },
      fakeFallbackUsed: { type: Boolean, default: false },
    },

    metrics: {
      transcriptChars: { type: Number, default: 0 },
      noteSections: { type: Number, default: 0 },
      keyConceptCount: { type: Number, default: 0 },
      durationSeconds: { type: Number, default: 0 },
    },

    error: { type: String, default: "" },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

LiveLectureNoteSchema.index({ ownerKey: 1, createdAt: -1 });
LiveLectureNoteSchema.index({ offlineUserId: 1, createdAt: -1 });
LiveLectureNoteSchema.index({ userId: 1, createdAt: -1 });
LiveLectureNoteSchema.index({ deviceId: 1, createdAt: -1 });
LiveLectureNoteSchema.index({
  topic: "text",
  transcript: "text",
  "note.title": "text",
});

LiveLectureNoteSchema.pre("save", function updateMetrics(next) {
  const note = this.note || {};

  const sectionGroups = [
    note.definitions,
    note.detailedNotes,
    note.stepByStepExplanation,
    note.examples,
  ];

  this.metrics.transcriptChars = String(this.transcript || "").length;

  this.metrics.keyConceptCount = Array.isArray(note.keyConcepts)
    ? note.keyConcepts.length
    : 0;

  this.metrics.noteSections = sectionGroups.reduce(
    (sum, group) => sum + (Array.isArray(group) ? group.length : 0),
    0
  );

  this.metrics.durationSeconds = Number(this.audio?.durationSeconds || 0);

  next();
});

LiveLectureNoteSchema.methods.toClient = function toClient() {
  const obj = this.toObject({ virtuals: true });
  obj.id = String(obj._id);
  delete obj.__v;
  return obj;
};

LiveLectureNoteSchema.statics.publicFields = function publicFields() {
  return {
    __v: 0,
    "audio.path": 0,
  };
};

const LiveLectureNote =
  mongoose.models.LiveLectureNote ||
  mongoose.model("LiveLectureNote", LiveLectureNoteSchema);

export default LiveLectureNote;