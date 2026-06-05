"use strict";

/**
 * server/models/GoogleLiveTutorStage2Session.js
 * =============================================================================
 * VERSION 8 FIX — 16MB-safe Stage 2 persistence
 *
 * Stage2 sessions are metadata-first.
 * Heavy arrays are saved in google_live_tutor_stage2_artifacts:
 * - premiumBoardScreens / boardSections / boardCommands
 * - voiceScript / subtitles
 * - compiledDiagrams / htmlPreviews / imagePreviews / sourceCards
 * - externalResources / agentTrace
 *
 * This prevents MongoDB 16MB BSON failures while replay/debug endpoints can still
 * return the full board lesson by loading chunked artifacts.
 * =============================================================================
 */

const mongoose = require("mongoose");

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const SourceRefSchema = new Schema(
  {
    chunkId: { type: String, default: "", index: true },
    sourceRef: { type: String, default: "", index: true },
    pageRef: { type: String, default: "", index: true },
    page: { type: Number, default: 0, index: true },
    quote: { type: String, default: "" },
    confidence: { type: Number, default: 0.75 },
    resourceId: { type: String, default: "", index: true },
    kind: { type: String, default: "" },
    evidenceRole: { type: String, default: "" },
    metadata: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const PlaybackStateSchema = new Schema(
  {
    currentSceneId: { type: String, default: "" },
    currentScreenId: { type: String, default: "" },
    currentTime: { type: Number, default: 0 },
    currentCommandIndex: { type: Number, default: 0 },
    visibleCommandIds: { type: [String], default: [] },
    visibleBlockIds: { type: [String], default: [] },
    completedCommandIds: { type: [String], default: [] },
    selectedNodeId: { type: String, default: "", index: true },
    paused: { type: Boolean, default: false },
    pauseReason: { type: String, default: "" },
    lastInterruptId: { type: String, default: "" },
    lastSavedAt: { type: Date, default: Date.now },
    metadata: { type: Mixed, default: {} },
  },
  { _id: false, strict: false }
);

const Stage2SessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    ownerKey: { type: String, required: true, index: true },
    offlineUserId: { type: String, default: "", index: true },
    deviceId: { type: String, default: "", index: true },

    resourceId: { type: String, default: "", index: true },
    treeId: { type: String, default: "", index: true },
    boardId: { type: String, default: "", index: true },

    selectedNodeId: { type: String, default: "", index: true },
    nodeId: { type: String, default: "", index: true },
    nodeTitle: { type: String, default: "" },
    selectedNode: { type: Mixed, default: {} },

    title: { type: String, default: "Stage 2 Live Tutor Session" },
    mode: { type: String, default: "teach_node_pipeline", index: true },
    status: {
      type: String,
      enum: ["created", "running", "ready", "paused", "repaired", "completed", "failed"],
      default: "ready",
      index: true,
    },

    requestSummary: { type: Mixed, default: {} },

    sourceRefs: { type: [SourceRefSchema], default: [] },
    selectedEvidence: { type: [SourceRefSchema], default: [] },
    relatedEvidence: { type: [SourceRefSchema], default: [] },

    counts: {
      premiumBoardScreens: { type: Number, default: 0 },
      boardSections: { type: Number, default: 0 },
      boardCommands: { type: Number, default: 0 },
      voiceScript: { type: Number, default: 0 },
      subtitles: { type: Number, default: 0 },
      compiledDiagrams: { type: Number, default: 0 },
      htmlPreviews: { type: Number, default: 0 },
      imagePreviews: { type: Number, default: 0 },
      sourceCards: { type: Number, default: 0 },
      externalResources: { type: Number, default: 0 },
      agentTrace: { type: Number, default: 0 },
      artifacts: { type: Number, default: 0 },
    },

    // Legacy compatibility only. New saves keep these empty/small.
    premiumBoardScreens: { type: [Mixed], default: [] },
    boardScreens: { type: [Mixed], default: [] },
    boardSections: { type: [Mixed], default: [] },
    boardCommands: { type: [Mixed], default: [] },
    commands: { type: [Mixed], default: [] },
    voiceScript: { type: [Mixed], default: [] },
    subtitles: { type: [Mixed], default: [] },
    compiledDiagrams: { type: [Mixed], default: [] },

    quiz: { type: Mixed, default: {} },
    playbackState: { type: PlaybackStateSchema, default: () => ({}) },
    resumeState: { type: Mixed, default: {} },
    interrupts: { type: [Mixed], default: [] },

    visualContextSummary: { type: Mixed, default: {} },
    fullPdfSummaryPreview: { type: String, default: "" },
    fullPdfOutlinePreview: { type: String, default: "" },
    externalResourceSummary: { type: Mixed, default: {} },
    text2DiagramPlanSummary: { type: Mixed, default: {} },
    teacherPromptPackSummary: { type: Mixed, default: {} },

    agentTrace: { type: [Mixed], default: [] },
    missionTrace: { type: [Mixed], default: [] },
    mcpTrace: { type: [Mixed], default: [] },
    toolTrace: { type: [Mixed], default: [] },
    partnerPower: { type: Mixed, default: {} },

    artifactMode: { type: String, default: "chunked", index: true },
    metadata: { type: Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: "google_live_tutor_stage2_sessions",
    minimize: false,
    strict: false,
  }
);

const Stage2ArtifactSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    ownerKey: { type: String, required: true, index: true },
    resourceId: { type: String, default: "", index: true },
    treeId: { type: String, default: "", index: true },
    boardId: { type: String, default: "", index: true },

    type: { type: String, required: true, index: true },
    chunkIndex: { type: Number, default: 0, index: true },
    itemCount: { type: Number, default: 0 },
    byteSize: { type: Number, default: 0 },

    items: { type: [Mixed], default: [] },
    payload: { type: Mixed, default: null },

    metadata: { type: Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: "google_live_tutor_stage2_artifacts",
    minimize: false,
    strict: false,
  }
);

Stage2SessionSchema.index({ ownerKey: 1, sessionId: 1 }, { unique: true });
Stage2SessionSchema.index({ ownerKey: 1, resourceId: 1, createdAt: -1 });
Stage2SessionSchema.index({ ownerKey: 1, treeId: 1, selectedNodeId: 1, createdAt: -1 });
Stage2SessionSchema.index({ ownerKey: 1, nodeId: 1, updatedAt: -1 });
Stage2SessionSchema.index({ ownerKey: 1, status: 1, updatedAt: -1 });
Stage2SessionSchema.index({ ownerKey: 1, mode: 1, updatedAt: -1 });

Stage2ArtifactSchema.index({ ownerKey: 1, sessionId: 1, type: 1, chunkIndex: 1 });
Stage2ArtifactSchema.index({ ownerKey: 1, resourceId: 1, type: 1, updatedAt: -1 });

function hasTruthyFallback(value, depth = 0) {
  if (!value || depth > 14) return false;

  if (Array.isArray(value)) {
    return value.some((item) => hasTruthyFallback(item, depth + 1));
  }

  if (typeof value !== "object") return false;

  if (
    value.fallbackUsed === true ||
    value.fakeFallbackUsed === true ||
    value.usedSmartFallback === true
  ) {
    return true;
  }

  return Object.values(value).some((item) => hasTruthyFallback(item, depth + 1));
}

Stage2SessionSchema.pre("validate", function preventFakeFallback(next) {
  if (hasTruthyFallback(this.metadata)) {
    next(new Error("Stage2 session rejected: fallbackUsed=true/fakeFallbackUsed=true is not allowed."));
    return;
  }
  next();
});

Stage2ArtifactSchema.pre("validate", function preventFakeFallbackArtifact(next) {
  if (hasTruthyFallback(this.metadata) || hasTruthyFallback(this.items) || hasTruthyFallback(this.payload)) {
    next(new Error("Stage2 artifact rejected: fallbackUsed=true/fakeFallbackUsed=true is not allowed."));
    return;
  }
  next();
});

const GoogleLiveTutorStage2Session =
  mongoose.models.GoogleLiveTutorStage2Session ||
  mongoose.model("GoogleLiveTutorStage2Session", Stage2SessionSchema);

const GoogleLiveTutorStage2Artifact =
  mongoose.models.GoogleLiveTutorStage2Artifact ||
  mongoose.model("GoogleLiveTutorStage2Artifact", Stage2ArtifactSchema);

module.exports = {
  GoogleLiveTutorStage2Session,
  GoogleLiveTutorStage2Artifact,
  SourceRefSchema,
  PlaybackStateSchema,
};
