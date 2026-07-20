// server/models/GemmaResourceBook.js

import mongoose from "mongoose";

const { Schema } = mongoose;

const SourceRefSchema = new Schema(
  {
    resourceId: { type: Schema.Types.ObjectId, ref: "GemmaResource", default: null, index: true },
    chunkMongoId: { type: Schema.Types.ObjectId, ref: "GemmaResourceChunk", default: null },
    chunkId: { type: String, trim: true, default: "" },
    index: { type: Number, default: 0 },
    sourceRef: { type: String, trim: true, default: "" },
    page: { type: String, trim: true, default: "" },
    timestamp: { type: String, trim: true, default: "" },
    line: { type: String, trim: true, default: "" },
    title: { type: String, trim: true, default: "" },
    textPreview: { type: String, trim: true, default: "" },
    ragScore: { type: Number, default: 0 },
    whyUsed: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const BoardCommandSchema = new Schema(
  {
    id: { type: String, trim: true, default: "" },
    type: {
      type: String,
      trim: true,
      default: "write",
      enum: [
        "heading",
        "write",
        "formula",
        "box",
        "sticky",
        "arrow",
        "flow",
        "diagram",
        "table",
        "timeline",
        "badge",
        "callout",
        "imagePrompt",
        "mermaid",
        "reactFlow",
        "quizCard",
        "dryRunTable",
      ],
    },
    title: { type: String, default: "" },
    text: { type: String, default: "" },
    mermaid: { type: String, default: "" },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    w: { type: Number, default: 0 },
    h: { type: Number, default: 0 },
    from: { type: String, default: "" },
    to: { type: String, default: "" },
    items: { type: [Schema.Types.Mixed], default: [] },
    rows: { type: [Schema.Types.Mixed], default: [] },
    nodes: { type: [Schema.Types.Mixed], default: [] },
    edges: { type: [Schema.Types.Mixed], default: [] },
    style: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const BookPageSchema = new Schema(
  {
    pageNo: { type: Number, required: true, index: true },
    spreadNo: { type: Number, default: 1, index: true },
    chapterNo: { type: Number, default: 1, index: true },
    pageType: {
      type: String,
      trim: true,
      default: "lesson",
      enum: [
        "cover",
        "toc",
        "chapter",
        "lesson",
        "big_picture",
        "visual",
        "formula",
        "example",
        "dry_run",
        "quiz",
        "summary",
        "source",
      ],
    },
    title: { type: String, trim: true, default: "" },
    subtitle: { type: String, trim: true, default: "" },
    body: { type: String, default: "" },
    keyTakeaways: { type: [String], default: [] },
    misconceptionFix: { type: String, default: "" },
    didYouKnow: { type: String, default: "" },
    example: { type: String, default: "" },
    equation: { type: String, default: "" },
    quiz: {
      question: { type: String, default: "" },
      answer: { type: String, default: "" },
      hint: { type: String, default: "" },
    },
    boardCommands: { type: [BoardCommandSchema], default: [] },
    sourceRefs: { type: [SourceRefSchema], default: [] },
    design: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const ChapterSchema = new Schema(
  {
    chapterNo: { type: Number, default: 1 },
    title: { type: String, trim: true, default: "" },
    learningGoal: { type: String, default: "" },
    pageStart: { type: Number, default: 1 },
    pageEnd: { type: Number, default: 1 },
    sourceRefs: { type: [SourceRefSchema], default: [] },
  },
  { _id: false }
);

const BookAgentTraceSchema = new Schema(
  {
    step: { type: String, trim: true, default: "" },
    ok: { type: Boolean, default: true },
    message: { type: String, default: "" },
    model: { type: String, default: "" },
    usedFallback: { type: Boolean, default: false },
    at: { type: Date, default: Date.now },
    diagnostics: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const GemmaResourceBookSchema = new Schema(
  {
    deviceId: { type: String, required: true, trim: true, index: true },
    userId: { type: String, trim: true, default: "", index: true },

    title: { type: String, required: true, trim: true, index: true },
    subtitle: { type: String, trim: true, default: "" },

    status: {
      type: String,
      enum: ["building", "ready", "failed", "archived"],
      default: "ready",
      index: true,
    },

    sourceResourceIds: [{ type: Schema.Types.ObjectId, ref: "GemmaResource", index: true }],
    joinedFromBookIds: [{ type: Schema.Types.ObjectId, ref: "GemmaResourceBook" }],

    theme: {
      type: String,
      trim: true,
      enum: ["warm", "botanical", "ocean", "dark", "minimal", "sunset"],
      default: "warm",
    },

    goal: { type: String, trim: true, default: "" },
    audience: { type: String, trim: true, default: "student" },
    difficulty: { type: String, trim: true, default: "adaptive" },

    chapters: { type: [ChapterSchema], default: [] },
    pages: { type: [BookPageSchema], default: [] },
    sourceRefs: { type: [SourceRefSchema], default: [] },

    summary: { type: String, default: "" },
    concepts: { type: [String], default: [], index: true },

    generation: {
      model: { type: String, trim: true, default: "" },
      embeddingModel: { type: String, trim: true, default: "" },
      mode: { type: String, trim: true, default: "agentic_offline_book" },
      usedFallback: { type: Boolean, default: false },
      generatedAt: { type: Date, default: Date.now },
      retrievalMode: { type: String, default: "" },
    },

    agentTrace: { type: [BookAgentTraceSchema], default: [] },
    error: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

GemmaResourceBookSchema.index({ deviceId: 1, updatedAt: -1 });
GemmaResourceBookSchema.index({ deviceId: 1, status: 1, updatedAt: -1 });
GemmaResourceBookSchema.index({ sourceResourceIds: 1, updatedAt: -1 });
GemmaResourceBookSchema.index({
  title: "text",
  subtitle: "text",
  summary: "text",
  concepts: "text",
});

GemmaResourceBookSchema.methods.toClient = function toClient() {
  return {
    id: String(this._id),
    deviceId: this.deviceId,
    userId: this.userId,
    title: this.title,
    subtitle: this.subtitle,
    status: this.status,
    sourceResourceIds: (this.sourceResourceIds || []).map(String),
    joinedFromBookIds: (this.joinedFromBookIds || []).map(String),
    theme: this.theme,
    goal: this.goal,
    audience: this.audience,
    difficulty: this.difficulty,
    chapters: this.chapters || [],
    pages: this.pages || [],
    sourceRefs: this.sourceRefs || [],
    summary: this.summary,
    concepts: this.concepts || [],
    generation: this.generation || {},
    agentTrace: this.agentTrace || [],
    error: this.error,
    metadata: this.metadata || {},
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const GemmaResourceBook =
  mongoose.models.GemmaResourceBook ||
  mongoose.model("GemmaResourceBook", GemmaResourceBookSchema);

export default GemmaResourceBook;