// server/models/LiveTutorBoard.js
//
// FULL REPLACEMENT
//
// Flexible Mongo model for real AI Live Tutor Board.
//
// Fixes:
// - accepts status: playing / repairing / stopped / archived
// - accepts rich boardCommands
// - accepts teacherActions / boardActions
// - accepts boardPages + layoutPlan
// - accepts voiceScript with actionId + linkedCommandIds + boardNote
// - accepts sourceRefs/internalSourceRefs/knowledgeRefs
// - accepts continuousTutor + runtimeState
// - accepts quality + diagnostics
// - accepts rich pages/blocks/replayTimeline
// - avoids enum validation crashes from Gemma dynamic tools
// - keeps backward compatibility with commands/pages/voiceText
//
// Used by:
// server/services/gemmaResource/liveTutor/liveTutorSession.service.js

import mongoose from "mongoose";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const LiveTutorStatusValues = [
  "idle",
  "ready",
  "preparing",
  "loading",
  "playing",
  "paused",
  "repairing",
  "completed",
  "ended",
  "stopped",
  "error",
  "archived",
];

const OwnerTypeValues = [
  "offline",
  "device",
  "user",
  "guest",
  "ownerKey",
  "",
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
  "voiceLine",
  "unknown",
];

const TeacherActionTypeValues = [
  "cameraUpdate",
  "drawHeading",
  "drawText",
  "drawParagraph",
  "drawBox",
  "drawCallout",
  "drawKeyPoints",
  "drawFormula",
  "drawTable",
  "drawFlowchart",
  "drawTree",
  "drawMermaid",
  "drawCode",
  "drawCodeTrace",
  "drawArray",
  "drawArrow",
  "drawHighlight",
  "drawSourceRef",
  "drawQuiz",
  "pause",
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

const ColumnSchema = new Schema(
  {
    id: { type: String, default: "" },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    role: { type: String, default: "" },
    meta: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const BoardPageSchema = new Schema(
  {
    id: { type: String, default: "" },
    pageId: { type: String, default: "" },
    title: { type: String, default: "" },
    heading: { type: String, default: "" },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 1500 },
    height: { type: Number, default: 1050 },
    columns: { type: [ColumnSchema], default: [] },
    meta: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const VoiceLineSchema = new Schema(
  {
    id: { type: String, default: "" },
    voiceId: { type: String, default: "" },
    t: { type: Number, default: 0 },
    time: { type: Number, default: undefined },
    second: { type: Number, default: undefined },
    startAt: { type: Number, default: undefined },

    text: { type: String, default: "" },
    speech: { type: String, default: "" },
    line: { type: String, default: "" },
    boardNote: { type: String, default: "" },

    language: { type: String, default: "" },
    lang: { type: String, default: "" },

    actionId: { type: String, default: "" },
    teacherActionId: { type: String, default: "" },
    linkedActionId: { type: String, default: "" },
    linkedCommandIds: { type: [String], default: [] },
    commandIds: { type: [String], default: [] },

    sourceRef: { type: String, default: "" },
    ref: { type: String, default: "" },
    citation: { type: String, default: "" },

    segmentIndex: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    meta: { type: Mixed, default: {} },
    original: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const BoardCommandSchema = new Schema(
  {
    id: { type: String, default: "" },
    commandId: { type: String, default: "" },
    actionId: { type: String, default: "" },
    teacherActionId: { type: String, default: "" },

    type: { type: String, default: "write" },

    t: { type: Number, default: 0 },
    time: { type: Number, default: undefined },
    second: { type: Number, default: undefined },
    startAt: { type: Number, default: undefined },
    duration: { type: Number, default: 4 },
    durationSec: { type: Number, default: undefined },

    slot: { type: String, default: "auto" },
    columnId: { type: String, default: "" },
    column: { type: String, default: "" },
    pageId: { type: String, default: "page_1" },
    page: { type: String, default: "" },

    title: { type: String, default: "" },
    heading: { type: String, default: "" },
    text: { type: String, default: "" },
    content: { type: String, default: "" },
    body: { type: String, default: "" },

    sourceRef: { type: String, default: "" },
    ref: { type: String, default: "" },
    citation: { type: String, default: "" },

    emphasis: { type: String, default: "normal" },
    color: { type: String, default: "" },

    children: { type: [Mixed], default: [] },
    blocks: { type: [Mixed], default: [] },
    commands: { type: [Mixed], default: [] },

    points: { type: [Mixed], default: [] },
    bullets: { type: [Mixed], default: [] },
    nodes: { type: [Mixed], default: [] },
    edges: { type: [Mixed], default: [] },
    links: { type: [Mixed], default: [] },
    items: { type: [Mixed], default: [] },
    values: { type: [Mixed], default: [] },
    rows: { type: [Mixed], default: [] },
    columns: { type: [Mixed], default: [] },
    headers: { type: [Mixed], default: [] },

    code: { type: String, default: "" },
    language: { type: String, default: "" },
    lang: { type: String, default: "" },
    highlightLine: { type: Number, default: 0 },

    formula: { type: String, default: "" },
    latex: { type: String, default: "" },

    mermaid: { type: String, default: "" },
    mermaidSyntax: { type: String, default: "" },

    question: { type: String, default: "" },
    choices: { type: [Mixed], default: [] },
    options: { type: [Mixed], default: [] },
    answer: { type: String, default: "" },
    solution: { type: String, default: "" },
    explanation: { type: String, default: "" },

    data: { type: Mixed, default: {} },
    meta: { type: Mixed, default: {} },

    segmentIndex: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
  },
  { _id: false, strict: false }
);

const TeacherActionSchema = new Schema(
  {
    id: { type: String, default: "" },
    actionId: { type: String, default: "" },
    type: {
      type: String,
      enum: TeacherActionTypeValues,
      default: "drawText",
    },

    t: { type: Number, default: 0 },
    time: { type: Number, default: undefined },
    second: { type: Number, default: undefined },
    duration: { type: Number, default: 4 },

    pageId: { type: String, default: "page_1" },
    page: { type: String, default: "" },
    columnId: { type: String, default: "" },
    slot: { type: String, default: "" },

    title: { type: String, default: "" },
    text: { type: String, default: "" },
    speech: { type: String, default: "" },
    voice: { type: String, default: "" },

    sourceRef: { type: String, default: "" },
    ref: { type: String, default: "" },
    citation: { type: String, default: "" },

    camera: { type: Mixed, default: {} },

    points: { type: [Mixed], default: [] },
    columns: { type: [Mixed], default: [] },
    rows: { type: [Mixed], default: [] },
    traceColumns: { type: [Mixed], default: [] },
    traceRows: { type: [Mixed], default: [] },

    nodes: { type: [Mixed], default: [] },
    edges: { type: [Mixed], default: [] },
    steps: { type: [Mixed], default: [] },

    code: { type: String, default: "" },
    language: { type: String, default: "" },
    formula: { type: String, default: "" },
    mermaid: { type: String, default: "" },

    question: { type: String, default: "" },
    choices: { type: [Mixed], default: [] },
    answer: { type: String, default: "" },

    data: { type: Mixed, default: {} },
    meta: { type: Mixed, default: {} },
    segmentIndex: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
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

const ContinuousTutorSchema = new Schema(
  {
    currentSegmentNumber: { type: Number, default: 1 },
    estimatedSegmentCount: { type: Number, default: 6 },
    targetTotalMinutes: { type: Number, default: 60 },
    targetTotalSeconds: { type: Number, default: 3600 },
    segmentDurationSec: { type: Number, default: 600 },
    shouldContinue: { type: Boolean, default: true },
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
      enum: OwnerTypeValues,
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
    offlineKnowledgeUsed: { type: Boolean, default: false },
    resourceGroundedRatio: { type: Number, default: 0.8 },

    shortAnswer: { type: String, default: "" },

    layoutPlan: { type: Mixed, default: {} },
    boardPages: { type: [BoardPageSchema], default: [] },

    teacherActions: { type: [TeacherActionSchema], default: [] },
    boardActions: { type: [TeacherActionSchema], default: [] },

    boardCommands: { type: [BoardCommandSchema], default: [] },
    commands: { type: [BoardCommandSchema], default: [] },

    voiceScript: { type: [VoiceLineSchema], default: [] },
    voiceText: { type: String, default: "" },

    repairOptions: { type: [String], default: [] },
    citations: { type: [String], default: [] },
    sourceRefs: { type: [String], default: [] },
    internalSourceRefs: { type: [String], default: [] },
    knowledgeRefs: { type: [String], default: [] },

    retrievedChunks: { type: [Mixed], default: [] },

    replayTimeline: { type: [ReplayStepSchema], default: [] },
    pages: { type: [PageSchema], default: [] },

    runtimeState: { type: Mixed, default: {} },
    continuousTutor: { type: ContinuousTutorSchema, default: () => ({}) },

    diagnostics: { type: Mixed, default: {} },
    quality: { type: Mixed, default: {} },
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
LiveTutorBoardSchema.index({ offlineUserId: 1, updatedAt: -1 });
LiveTutorBoardSchema.index({ deviceId: 1, updatedAt: -1 });

function cleanValue(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function arrayValue(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

LiveTutorBoardSchema.pre("validate", function normalizeBeforeValidate(next) {
  if (!this.commands?.length && this.boardCommands?.length) {
    this.commands = this.boardCommands;
  }

  if (!this.boardCommands?.length && this.commands?.length) {
    this.boardCommands = this.commands;
  }

  if (!this.boardActions?.length && this.teacherActions?.length) {
    this.boardActions = this.teacherActions;
  }

  if (!this.teacherActions?.length && this.boardActions?.length) {
    this.teacherActions = this.boardActions;
  }

  if (!this.sourceRefs?.length && this.citations?.length) {
    this.sourceRefs = this.citations;
  }

  if (!this.citations?.length && this.sourceRefs?.length) {
    this.citations = this.sourceRefs;
  }

  if (!this.internalSourceRefs?.length && this.sourceRefs?.length) {
    this.internalSourceRefs = this.sourceRefs;
  }

  if (!this.knowledgeRefs?.length && this.offlineKnowledgeUsed) {
    this.knowledgeRefs = ["Gemma offline same-topic knowledge"];
  }

  if (!this.voiceText && Array.isArray(this.voiceScript)) {
    this.voiceText = this.voiceScript
      .map((line) => line?.text || line?.speech || line?.boardNote || "")
      .filter(Boolean)
      .join(" ");
  }

  if (!this.title && this.topic) {
    this.title = this.topic;
  }

  if (!this.status) {
    this.status = "ready";
  }

  if (!this.continuousTutor) {
    this.continuousTutor = {};
  }

  if (!this.continuousTutor.targetTotalMinutes) {
    this.continuousTutor.targetTotalMinutes = 60;
  }

  if (!this.continuousTutor.targetTotalSeconds) {
    this.continuousTutor.targetTotalSeconds =
      Number(this.continuousTutor.targetTotalMinutes || 60) * 60;
  }

  if (!this.continuousTutor.segmentDurationSec) {
    this.continuousTutor.segmentDurationSec = 600;
  }

  if (!this.continuousTutor.estimatedSegmentCount) {
    this.continuousTutor.estimatedSegmentCount = Math.max(
      1,
      Math.ceil(
        Number(this.continuousTutor.targetTotalSeconds || 3600) /
          Number(this.continuousTutor.segmentDurationSec || 600)
      )
    );
  }

  if (!this.runtimeState || typeof this.runtimeState !== "object") {
    this.runtimeState = {};
  }

  if (!this.runtimeState.targetTotalMinutes) {
    this.runtimeState.targetTotalMinutes = this.continuousTutor.targetTotalMinutes || 60;
  }

  if (!this.runtimeState.targetTotalSeconds) {
    this.runtimeState.targetTotalSeconds =
      Number(this.runtimeState.targetTotalMinutes || 60) * 60;
  }

  if (!this.runtimeState.segmentDurationSec) {
    this.runtimeState.segmentDurationSec = this.continuousTutor.segmentDurationSec || 600;
  }

  if (!this.runtimeState.status) {
    this.runtimeState.status = this.status;
  }

  if (!this.runtimeState.nextCursor && this.nextCursor) {
    this.runtimeState.nextCursor = this.nextCursor;
  }

  if (!this.runtimeState.continueMode && this.continueMode !== undefined) {
    this.runtimeState.continueMode = this.continueMode;
  }

  if (!this.ownerType && this.ownerKey) {
    const key = cleanValue(this.ownerKey);
    if (key.startsWith("offline:")) this.ownerType = "offline";
    else if (key.startsWith("device:")) this.ownerType = "device";
    else if (key.startsWith("user:")) this.ownerType = "user";
    else this.ownerType = "ownerKey";
  }

  if (!this.ownerKey && this.offlineUserId) {
    this.ownerKey = `offline:${cleanValue(this.offlineUserId)}`;
    this.ownerType = "offline";
  }

  if (!this.ownerKey && this.deviceId) {
    this.ownerKey = `device:${cleanValue(this.deviceId)}`;
    this.ownerType = "device";
  }

  if (!this.ownerKey) {
    this.ownerKey = "guest:unknown";
    this.ownerType = "guest";
  }

  this.repairOptions = arrayValue(this.repairOptions)
    .map(cleanValue)
    .filter(Boolean);

  this.citations = arrayValue(this.citations)
    .map(cleanValue)
    .filter(Boolean);

  this.sourceRefs = arrayValue(this.sourceRefs)
    .map(cleanValue)
    .filter(Boolean);

  this.internalSourceRefs = arrayValue(this.internalSourceRefs)
    .map(cleanValue)
    .filter(Boolean);

  this.knowledgeRefs = arrayValue(this.knowledgeRefs)
    .map(cleanValue)
    .filter(Boolean);

  next();
});

LiveTutorBoardSchema.pre("findOneAndUpdate", function normalizeUpdate(next) {
  const update = this.getUpdate() || {};

  if (update.$set) {
    if (update.$set.boardCommands && !update.$set.commands) {
      update.$set.commands = update.$set.boardCommands;
    }

    if (update.$set.commands && !update.$set.boardCommands) {
      update.$set.boardCommands = update.$set.commands;
    }

    if (update.$set.teacherActions && !update.$set.boardActions) {
      update.$set.boardActions = update.$set.teacherActions;
    }

    if (update.$set.boardActions && !update.$set.teacherActions) {
      update.$set.teacherActions = update.$set.boardActions;
    }

    if (update.$set.citations && !update.$set.sourceRefs) {
      update.$set.sourceRefs = update.$set.citations;
    }

    if (update.$set.sourceRefs && !update.$set.citations) {
      update.$set.citations = update.$set.sourceRefs;
    }

    if (Array.isArray(update.$set.voiceScript) && !update.$set.voiceText) {
      update.$set.voiceText = update.$set.voiceScript
        .map((line) => line?.text || line?.speech || line?.boardNote || "")
        .filter(Boolean)
        .join(" ");
    }

    if (update.$set.continuousTutor) {
      const targetTotalMinutes = Number(update.$set.continuousTutor.targetTotalMinutes || 60);
      const segmentDurationSec = Number(update.$set.continuousTutor.segmentDurationSec || 600);

      update.$set.continuousTutor.targetTotalMinutes = targetTotalMinutes;
      update.$set.continuousTutor.targetTotalSeconds =
        Number(update.$set.continuousTutor.targetTotalSeconds || targetTotalMinutes * 60);
      update.$set.continuousTutor.segmentDurationSec = segmentDurationSec;
      update.$set.continuousTutor.estimatedSegmentCount = Math.max(
        1,
        Math.ceil(update.$set.continuousTutor.targetTotalSeconds / segmentDurationSec)
      );
    }
  }

  this.setUpdate(update);
  next();
});

const LiveTutorBoard =
  mongoose.models.LiveTutorBoard ||
  mongoose.model("LiveTutorBoard", LiveTutorBoardSchema);

export default LiveTutorBoard;