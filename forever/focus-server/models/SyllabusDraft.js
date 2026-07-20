import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true },
    title: { type: String, trim: true, default: "Untitled event" },
    type: {
      type: String,
      enum: [
        "assignment",
        "quiz",
        "exam",
        "final",
        "project",
        "office_hour",
        "class",
        "topic",
        "resource",
        "other",
      ],
      default: "other",
    },
    date: { type: String, trim: true, default: "" },
    time: { type: String, trim: true, default: "" },
    endDate: { type: String, trim: true, default: "" },
    endTime: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    description: { type: String, default: "" },
    confidence: { type: Number, default: 0.5 },
    sourceText: { type: String, default: "" },
    reminderPlan: [{ type: String }],
    needsReview: { type: Boolean, default: false },
  },
  { _id: false }
);

const gradingSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    weight: { type: String, trim: true, default: "" },
    sourceText: { type: String, default: "" },
  },
  { _id: false }
);

const officeHourSchema = new mongoose.Schema(
  {
    day: { type: String, trim: true, default: "" },
    time: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    sourceText: { type: String, default: "" },
  },
  { _id: false }
);

const weeklyTopicSchema = new mongoose.Schema(
  {
    week: { type: Number, default: null },
    date: { type: String, trim: true, default: "" },
    topic: { type: String, trim: true, default: "" },
    sourceText: { type: String, default: "" },
  },
  { _id: false }
);

const syllabusDraftSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SyllabusCourse",
      index: true,
      required: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SyllabusDocument",
      index: true,
      required: true,
    },
    userId: { type: String, trim: true, index: true, default: "" },
    status: {
      type: String,
      enum: ["draft", "confirmed"],
      default: "draft",
      index: true,
    },
    version: { type: Number, default: 1 },
    aiProvider: { type: String, default: "ollama-gemma" },
    parseMode: {
      type: String,
      enum: ["ai", "fallback", "hybrid"],
      default: "hybrid",
    },
    parseMeta: { type: Object, default: {} },
    courseSnapshot: { type: Object, default: {} },
    events: [eventSchema],
    grading: [gradingSchema],
    officeHours: [officeHourSchema],
    weeklyTopics: [weeklyTopicSchema],
    resources: [{ label: String, url: String, sourceText: String }],
    warnings: [{ type: String }],
    confirmedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("SyllabusDraft", syllabusDraftSchema);