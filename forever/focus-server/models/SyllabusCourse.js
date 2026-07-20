import mongoose from "mongoose";

const syllabusCourseSchema = new mongoose.Schema(
  {
    userId: { type: String, trim: true, index: true, default: "" },
    userEmail: { type: String, trim: true, lowercase: true, default: "" },
    university: { type: String, trim: true, default: "" },
    department: { type: String, trim: true, default: "" },
    courseCode: { type: String, trim: true, index: true, default: "" },
    courseTitle: { type: String, trim: true, index: true, default: "" },
    semester: { type: String, trim: true, index: true, default: "" },
    section: { type: String, trim: true, default: "" },
    instructor: { type: String, trim: true, default: "" },
    timezone: { type: String, trim: true, default: "Asia/Dhaka" },
    status: {
      type: String,
      enum: ["profile", "uploaded", "draft", "confirmed", "published"],
      default: "profile",
      index: true,
    },
    source: { type: String, trim: true, default: "syllabus-relay" },
  },
  { timestamps: true }
);

syllabusCourseSchema.index({
  university: 1,
  department: 1,
  courseCode: 1,
  semester: 1,
  section: 1,
});

syllabusCourseSchema.index({
  courseCode: "text",
  courseTitle: "text",
  instructor: "text",
  university: "text",
  department: "text",
  semester: "text",
});

export default mongoose.model("SyllabusCourse", syllabusCourseSchema);