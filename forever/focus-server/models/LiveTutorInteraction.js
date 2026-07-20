import mongoose from "mongoose";

const { Schema } = mongoose;

const RectSchema = new Schema(
  {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    pageWidth: { type: Number, default: 0 },
    pageHeight: { type: Number, default: 0 },
    viewportWidth: { type: Number, default: 0 },
    viewportHeight: { type: Number, default: 0 },
    scrollX: { type: Number, default: 0 },
    scrollY: { type: Number, default: 0 },
    devicePixelRatio: { type: Number, default: 1 },
  },
  { _id: false }
);

const TranscriptWindowSchema = new Schema(
  {
    current: { type: String, default: "" },
    before: { type: String, default: "" },
    after: { type: String, default: "" },
    full: { type: String, default: "" },
    startSeconds: { type: Number, default: 0 },
    endSeconds: { type: Number, default: 0 },
  },
  { _id: false }
);

const GraphTraceSchema = new Schema(
  {
    name: { type: String, default: "" },
    node: { type: String, default: "" },
    status: { type: String, default: "done" },
    detail: { type: String, default: "" },
    latencyMs: { type: Number, default: 0 },
    at: { type: Date, default: Date.now },

    mode: { type: String, default: "" },
    platform: { type: String, default: "" },
    hasMarkedRect: { type: Boolean, default: false },
    screenshotAvailable: { type: Boolean, default: false },
    hasTranscript: { type: Boolean, default: false },
    startSeconds: { type: Number, default: 0 },
    endSeconds: { type: Number, default: 0 },
    queryLength: { type: Number, default: 0 },
    retrievedCount: { type: Number, default: 0 },
    available: { type: Boolean, default: false },
    used: { type: Boolean, default: false },
    conceptTags: { type: [String], default: [] },
    priority: { type: String, default: "" },
    scope: { type: String, default: "" },
    blockCount: { type: Number, default: 0 },
    boardKind: { type: String, default: "" },
    needed: { type: Boolean, default: false },
    simulatorTypes: { type: [String], default: [] },
    language: { type: String, default: "" },
    askBack: { type: Boolean, default: false },
    hasResponse: { type: Boolean, default: false },
    saved: { type: Boolean, default: false },
    indexed: { type: Number, default: 0 },
  },
  { _id: false, strict: false }
);

const MemoryHitSchema = new Schema(
  {
    interactionId: { type: Schema.Types.Mixed, default: null },
    mode: { type: String, default: "" },
    title: { type: String, default: "" },
    weakness: { type: String, default: "" },
    preview: { type: String, default: "" },
    score: { type: Number, default: 0 },
    createdAt: { type: Date, default: null },
  },
  { _id: false, strict: false }
);

const BoardSummarySchema = new Schema(
  {
    boardId: { type: String, default: "" },
    blockCount: { type: Number, default: 0 },
    simulationCount: { type: Number, default: 0 },
    replayStepCount: { type: Number, default: 0 },
    boardMode: { type: String, default: "" },
    vectorIndexed: { type: Number, default: 0 },
  },
  { _id: false }
);

const ThinkingScoreSchema = new Schema(
  {
    level: {
      type: String,
      enum: ["passive", "active", "constructive", "reflective", "unknown"],
      default: "unknown",
    },
    score: { type: Number, default: 0 },
    reason: { type: String, default: "" },
    evidence: { type: String, default: "" },
    nextImprovement: { type: String, default: "" },
  },
  { _id: false }
);

const ExplainBackEvaluationSchema = new Schema(
  {
    studentClaimSummary: { type: String, default: "" },
    correctParts: { type: [String], default: [] },
    missingParts: { type: [String], default: [] },
    wrongParts: { type: [String], default: [] },
    improvedAnswer: { type: String, default: "" },
    score: { type: Number, default: 0 },
  },
  { _id: false }
);

const MisconceptionCheckSchema = new Schema(
  {
    likelyConfusion: { type: String, default: "" },
    wrongMentalModel: { type: String, default: "" },
    repairExplanation: { type: String, default: "" },
    askBackQuestion: { type: String, default: "" },
    severity: {
      type: String,
      enum: ["none", "low", "medium", "high"],
      default: "none",
    },
  },
  { _id: false }
);

const DryRunSchema = new Schema(
  {
    available: { type: Boolean, default: false },
    title: { type: String, default: "" },
    problemType: { type: String, default: "" },
    columns: { type: [String], default: [] },
    rows: { type: [Schema.Types.Mixed], default: [] },
    currentPointer: { type: String, default: "" },
    stateSummary: { type: String, default: "" },
    complexity: {
      time: { type: String, default: "" },
      space: { type: String, default: "" },
      why: { type: String, default: "" },
    },
  },
  { _id: false, strict: false }
);

const RoadmapSchema = new Schema(
  {
    nodes: { type: [Schema.Types.Mixed], default: [] },
    edges: { type: [Schema.Types.Mixed], default: [] },
    currentNodeId: { type: String, default: "" },
  },
  { _id: false, strict: false }
);

const TutorResponseSchema = new Schema(
  {
    mode: { type: String, default: "explain_frame" },

    headline: { type: String, default: "" },
    shortAnswer: { type: String, default: "" },
    explanation: { type: String, default: "" },

    tutorScratchpad: { type: [Schema.Types.Mixed], default: [] },
    visualBreakdown: { type: [Schema.Types.Mixed], default: [] },

    dryRun: { type: DryRunSchema, default: () => ({}) },
    misconceptionCheck: { type: MisconceptionCheckSchema, default: () => ({}) },
    thinkingScore: { type: ThinkingScoreSchema, default: () => ({}) },
    explainBackEvaluation: { type: ExplainBackEvaluationSchema, default: () => ({}) },
    roadmap: { type: RoadmapSchema, default: () => ({}) },

    suggestedPractice: { type: [Schema.Types.Mixed], default: [] },
    actions: { type: [Schema.Types.Mixed], default: [] },
    sourcesUsed: { type: [Schema.Types.Mixed], default: [] },

    weakConcepts: { type: [String], default: [] },
    masteredConcepts: { type: [String], default: [] },
    followUpQuestion: { type: String, default: "" },

    confidence: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },

    boardId: { type: String, default: "" },
    boardSummary: { type: BoardSummarySchema, default: () => ({}) },

    raw: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false, strict: false }
);

const LiveTutorInteractionSchema = new Schema(
  {
    userId: { type: String, trim: true, default: "guest", index: true },
    deviceId: { type: String, trim: true, default: "web", index: true },
    sessionKey: { type: String, trim: true, default: "", index: true },
    requestHash: { type: String, trim: true, default: "", index: true },

    platform: {
      type: String,
      enum: ["youtube", "webpage", "docs", "leetcode", "github", "pdf", "unknown"],
      default: "unknown",
      index: true,
    },

    url: { type: String, trim: true, default: "", index: true },
    origin: { type: String, trim: true, default: "", index: true },
    title: { type: String, trim: true, default: "" },

    videoId: { type: String, trim: true, default: "", index: true },
    timestampSeconds: { type: Number, default: 0, index: true },
    durationSeconds: { type: Number, default: 0 },

    mode: {
      type: String,
      enum: [
        "explain_frame",
        "explain_selection",
        "why_this_step",
        "simplify",
        "dry_run",
        "interrupt",
        "explain_back",
        "repair_confusion",
        "roadmap",
        "quiz_me",
      ],
      default: "explain_frame",
      index: true,
    },

    userQuestion: { type: String, default: "" },
    studentAnswer: { type: String, default: "" },
    voiceTranscript: { type: String, default: "" },

    selectedText: { type: String, default: "" },
    visibleText: { type: String, default: "" },
    pageText: { type: String, default: "" },
    pageStructure: { type: Schema.Types.Mixed, default: null },

    transcriptContext: { type: String, default: "" },
    transcriptWindow: { type: TranscriptWindowSchema, default: () => ({}) },
    currentCaption: { type: String, default: "" },

    selectedRect: { type: RectSchema, default: () => ({}) },
    markedElements: { type: [Schema.Types.Mixed], default: [] },

    screenshotDataUrl: { type: String, default: "" },
    screenshotMime: { type: String, default: "" },
    screenshotHash: { type: String, default: "", index: true },
    hasScreenshot: { type: Boolean, default: false },

    cropHash: { type: String, default: "", index: true },
    cropBox: { type: Schema.Types.Mixed, default: null },
    usedMarkedCrop: { type: Boolean, default: false },
    visionFocusText: { type: String, default: "" },

    languageHint: {
      type: String,
      enum: ["auto", "english", "bangla", "mixed"],
      default: "auto",
    },

    status: {
      type: String,
      enum: ["queued", "retrieving", "thinking", "ready", "failed"],
      default: "queued",
      index: true,
    },

    response: { type: TutorResponseSchema, default: () => ({}) },

    memoryHits: { type: [MemoryHitSchema], default: [] },

    embeddingText: { type: String, default: "" },
    embedding: { type: [Number], default: undefined },

    retrievedContext: { type: [Schema.Types.Mixed], default: [] },
    workflowContext: { type: Schema.Types.Mixed, default: null },

    graphTrace: { type: [GraphTraceSchema], default: [] },
    modelMeta: { type: Schema.Types.Mixed, default: null },

    latencyMs: { type: Number, default: 0 },

    clientMeta: { type: Schema.Types.Mixed, default: {} },
    requestMeta: { type: Schema.Types.Mixed, default: {} },

    error: { type: String, default: "" },
  },
  {
    timestamps: true,
    strict: true,
  }
);

LiveTutorInteractionSchema.index({ userId: 1, createdAt: -1 });
LiveTutorInteractionSchema.index({ deviceId: 1, createdAt: -1 });
LiveTutorInteractionSchema.index({ sessionKey: 1, createdAt: -1 });
LiveTutorInteractionSchema.index({ userId: 1, sessionKey: 1, createdAt: -1 });
LiveTutorInteractionSchema.index({ url: 1, createdAt: -1 });
LiveTutorInteractionSchema.index({ videoId: 1, timestampSeconds: 1 });
LiveTutorInteractionSchema.index({ mode: 1, status: 1, createdAt: -1 });
LiveTutorInteractionSchema.index({ "response.weakConcepts": 1 });
LiveTutorInteractionSchema.index({ "response.boardId": 1 });
LiveTutorInteractionSchema.index({ "response.confidence": 1 });

LiveTutorInteractionSchema.pre("save", function beforeSave(next) {
  if (this.screenshotDataUrl && !this.hasScreenshot) {
    this.hasScreenshot = true;
  }

  if (this.clientMeta) {
    if (this.clientMeta.usedMarkedCrop !== undefined) {
      this.usedMarkedCrop = Boolean(this.clientMeta.usedMarkedCrop);
    }

    if (this.clientMeta.cropHash && !this.cropHash) {
      this.cropHash = this.clientMeta.cropHash;
    }

    if (this.clientMeta.cropBox && !this.cropBox) {
      this.cropBox = this.clientMeta.cropBox;
    }

    if (this.clientMeta.visionFocusText && !this.visionFocusText) {
      this.visionFocusText = this.clientMeta.visionFocusText;
    }
  }

  next();
});

LiveTutorInteractionSchema.methods.markFailed = function markFailed(error) {
  this.status = "failed";
  this.error = error?.message || String(error || "Live tutor failed.");
};

LiveTutorInteractionSchema.methods.markReady = function markReady(response = {}) {
  this.status = "ready";
  this.response = {
    ...(this.response?.toObject ? this.response.toObject() : this.response || {}),
    ...response,
  };
};

const LiveTutorInteraction =
  mongoose.models.LiveTutorInteraction ||
  mongoose.model("LiveTutorInteraction", LiveTutorInteractionSchema);

export default LiveTutorInteraction;