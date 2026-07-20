import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true },
    eventUid: { type: String, default: "" },
    title: { type: String, trim: true, default: "" },
    date: { type: String, trim: true, default: "" },
    type: { type: String, trim: true, default: "study_task" },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    description: { type: String, default: "" },
  },
  { _id: false }
);

const syllabusCalendarSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SyllabusCourse",
      unique: true,
      index: true,
      required: true,
    },
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SyllabusDraft",
      index: true,
      required: true,
    },
    userId: { type: String, trim: true, index: true, default: "" },
    version: { type: Number, default: 1 },
    events: [{ type: Object }],
    tasks: [taskSchema],
    workload: { type: Object, default: {} },
    icsText: { type: String, default: "" },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("SyllabusCalendar", syllabusCalendarSchema);