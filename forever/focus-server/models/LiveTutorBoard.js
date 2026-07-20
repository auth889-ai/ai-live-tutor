// server/models/LiveTutorBoard.js
//
// Full replacement.
// Flexible schema for real AI live tutor board.
// Fixes validation crashes:
// - status: "playing" allowed
// - voiceScript: array allowed
// - pages.purpose: external_question allowed
// - pages.blocks.type: section/classDiagram/flowDiagram/codeBox/etc allowed
// - boardCommands can store rich command schema
// - replayTimeline can store speak/write actions
// - editHistory supports continue/ai_patch/update/repair
//
// This model is intentionally flexible because Gemma creates dynamic board tools.

import mongoose from "mongoose";

const { Schema } = mongoose;

const Mixed = Schema.Types.Mixed;

const LiveTutorStatusValues = [
  "idle",
  "ready",
  "preparing",
  "playing",
  "paused",
  "repairing",
  "completed",
  "stopped",
  "error",
  "archived",
];

const PagePurposeValues = [
  "visual_lesson",
  "auto_teach",
  "external_question",
  "internal_resource",
  "interrupt_answer",
  "continue",
  "dry_run",
  "compare",
  "quiz",
  "simplify",
  "go_back",
  "explain_marked_area",
  "resource_lesson",
  "code_tutor",
  "unknown",
];

const BlockTypeValues = [
  "boardPage",
  "section",
  "heading",
  "write",
  "paragraph",
  "text",
  "formulaBox",
  "formula",
  "table",
  "dryRunTable",
  "dpTable",
  "compareBox",
  "compare",
  "codeBox",
  "code",
  "array",
  "hashmap",
  "stack",
  "queue",
  "tree",
  "recursionTree",
  "flowDiagram",
  "flow",
  "timeline",
  "diagram",
  "classDiagram",
  "sequenceDiagram",
  "mermaidDiagram",
  "arrow",
  "bracketNote",
  "callout",
  "highlight",
  "underline",
  "sketchPath",
  "complexityNote",
  "sourceRef",
  "quizCheck",
  "quiz",
  "repair",
  "dry_run_table",
  "pause",
  "erase",
  "unknown",
];

const EditActionValues = [
  "create",
  "start",
  "update",
  "continue",
  "ai_patch",
  "append",
  "repair",
  "interrupt",
  "pause",
  "resume",
  "stop",
  "clear",
  "delete",
  "export",
  "replay",
];

const VoiceLineSchema = new Schema(
  {
    id: { type: String, default: "" },
    voiceId: { type: String, default: "" },
    t: { type: Number, default: 0 },
    time: { type: Number, default: undefined },
    second: { type: Number, default: undefined },
    text: { type: String, default: "" },
    speech: { type: String, default: "" },
    language: { type: String, default: "" },
    segmentIndex: { type: Number, default: 0 },
    meta: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const BoardCommandSchema = new Schema(
  {
    id: { type: String, default: "" },
    commandId: { type: String, default: "" },
    type: { type: String, default: "write" },
    t: { type: Number, default: 0 },
    time: { type: Number, default: undefined },
    second: { type: Number, default: undefined },
    slot: { type: String, default: "auto" },
    title: { type: String, default: "" },
    text: { type: String, default: "" },
    content: { type: String, default: "" },
    sourceRef: { type: String, default: "" },
    citation: { type: String, default: "" },
    emphasis: { type: String, default: "normal" },
    children: { type: [Mixed], default: [] },
    nodes: { type: [Mixed], default: [] },
    edges: { type: [Mixed], default: [] },
    items: { type: [Mixed], default: [] },
    rows: { type: [Mixed], default: [] },
    columns: { type: [Mixed], default: [] },
    code: { type: String, default: "" },
    language: { type: String, default: "" },
    formula: { type: String, default: "" },
    mermaid: { type: String, default: "" },
    question: { type: String, default: "" },
    choices: { type: [Mixed], default: [] },
    answer: { type: String, default: "" },
    explanation: { type: String, default: "" },
    data: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const ReplayStepSchema = new Schema(
  {
    stepId: { type: String, default: "" },
    atMs: { type: Number, default: 0 },
    action: { type: String, default: "write_block" },
    blockId: { type: String, default: "" },
    text: { type: String, default: "" },
    data: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const PageBlockSchema = new Schema(
  {
    blockId: { type: String, default: "" },
    type: {
      type: String,
      enum: BlockTypeValues,
      default: "unknown",
    },
    title: { type: String, default: "" },
    content: { type: String, default: "" },
    data: { type: Mixed, default: {} },
    order: { type: Number, default: 0 },
    editable: { type: Boolean, default: true },
    generatedBy: { type: String, default: "ai" },
    linkedTranscriptTime: { type: Number, default: 0 },
    style: { type: Mixed, default: {} },
    linkedRect: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const PageSchema = new Schema(
  {
    pageId: { type: String, default: "" },
    title: { type: String, default: "" },
    purpose: {
      type: String,
      enum: PagePurposeValues,
      default: "visual_lesson",
    },
    blocks: { type: [PageBlockSchema], default: [] },
    autoExpanded: { type: Boolean, default: true },
    meta: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const EditHistorySchema = new Schema(
  {
    action: {
      type: String,
      enum: EditActionValues,
      default: "update",
    },
    at: { type: Date, default: Date.now },
    note: { type: String, default: "" },
    data: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const LiveTutorBoardSchema = new Schema(
  {
    resourceId: {
      type: Schema.Types.ObjectId,
      ref: "GemmaResource",
      index: true,
    },

    sessionKey: {
      type: String,
      default: "",
      index: true,
    },

    ownerType: {
      type: String,
      enum: ["offline", "device", "user", "guest", ""],
      default: "",
      index: true,
    },

    ownerKey: {
      type: String,
      default: "",
      index: true,
    },

    offlineUserId: {
      type: String,
      default: "",
      index: true,
    },

    deviceId: {
      type: String,
      default: "",
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: undefined,
      index: true,
    },

    status: {
      type: String,
      enum: LiveTutorStatusValues,
      default: "ready",
      index: true,
    },

    title: { type: String, default: "" },
    topic: { type: String, default: "" },
    segmentTitle: { type: String, default: "" },

    intent: { type: String, default: "" },
    domain: { type: String, default: "" },
    topicFamily: { type: String, default: "" },

    continueMode: { type: Boolean, default: true },
    nextCursor: { type: String, default: "" },

    externalKnowledgeUsed: { type: Boolean, default: false },
    resourceGroundedRatio: { type: Number, default: 0.8 },

    shortAnswer: { type: String, default: "" },

    boardCommands: { type: [BoardCommandSchema], default: [] },
    commands: { type: [BoardCommandSchema], default: [] },

    voiceScript: { type: [VoiceLineSchema], default: [] },
    voiceText: { type: String, default: "" },

    repairOptions: { type: [String], default: [] },
    citations: { type: [String], default: [] },
    sourceRefs: { type: [String], default: [] },
    retrievedChunks: { type: [Mixed], default: [] },

    replayTimeline: { type: [ReplayStepSchema], default: [] },
    pages: { type: [PageSchema], default: [] },

    runtimeState: { type: Mixed, default: {} },
    diagnostics: { type: Mixed, default: {} },
    boardState: { type: Mixed, default: {} },

    editHistory: { type: [EditHistorySchema], default: [] },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: undefined },
  },
  {
    timestamps: true,
    minimize: false,
    strict: false,
  }
);

LiveTutorBoardSchema.index({ ownerKey: 1, updatedAt: -1 });
LiveTutorBoardSchema.index({ resourceId: 1, ownerKey: 1, updatedAt: -1 });
LiveTutorBoardSchema.index({ sessionKey: 1, ownerKey: 1 });

LiveTutorBoardSchema.pre("validate", function normalizeBeforeValidate(next) {
  if (!this.commands?.length && this.boardCommands?.length) {
    this.commands = this.boardCommands;
  }

  if (!this.boardCommands?.length && this.commands?.length) {
    this.boardCommands = this.commands;
  }

  if (!this.voiceText && Array.isArray(this.voiceScript)) {
    this.voiceText = this.voiceScript
      .map((line) => line?.text || line?.speech || "")
      .filter(Boolean)
      .join(" ");
  }

  if (!this.title && this.topic) {
    this.title = this.topic;
  }

  if (!this.status) {
    this.status = "ready";
  }

  next();
});

const LiveTutorBoard =
  mongoose.models.LiveTutorBoard || mongoose.model("LiveTutorBoard", LiveTutorBoardSchema);

export default LiveTutorBoard;