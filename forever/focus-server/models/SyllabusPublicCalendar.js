import mongoose from "mongoose";

const syllabusPublicCalendarSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SyllabusCourse",
      index: true,
      required: true,
    },
    calendarId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SyllabusCalendar",
      index: true,
      required: true,
    },
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SyllabusDraft",
      index: true,
      required: true,
    },
    ownerUserId: { type: String, trim: true, index: true, default: "" },
    publicSlug: { type: String, unique: true, index: true, required: true },
    version: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ["published", "needs_reverification"],
      default: "published",
      index: true,
    },
    trustLevel: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Low",
    },
    vouches: [
      {
        userId: String,
        userEmail: String,
        vouchedAt: { type: Date, default: Date.now },
      },
    ],
    vouchCount: { type: Number, default: 0 },
    searchText: { type: String, index: true, default: "" },
    courseSnapshot: { type: Object, default: {} },
    events: [{ type: Object }],
    tasks: [{ type: Object }],
    workload: { type: Object, default: {} },
    icsText: { type: String, default: "" },
    editHistory: [{ type: Object }],
  },
  { timestamps: true }
);

syllabusPublicCalendarSchema.index({ searchText: "text" });

export default mongoose.model(
  "SyllabusPublicCalendar",
  syllabusPublicCalendarSchema
);