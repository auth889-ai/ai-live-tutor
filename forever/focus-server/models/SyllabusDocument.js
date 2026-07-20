import mongoose from "mongoose";

const syllabusDocumentSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SyllabusCourse",
      index: true,
      required: true,
    },
    userId: { type: String, trim: true, index: true, default: "" },
    originalName: { type: String, trim: true, default: "" },
    filename: { type: String, trim: true, default: "" },
    path: { type: String, trim: true, default: "" },
    mimeType: { type: String, trim: true, default: "" },
    sizeBytes: { type: Number, default: 0 },
    inputType: {
      type: String,
      enum: ["pdf", "docx", "txt", "text"],
      default: "text",
    },
    rawText: { type: String, default: "" },
    textPreview: { type: String, default: "" },
    extractionStatus: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
    extractionError: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("SyllabusDocument", syllabusDocumentSchema);