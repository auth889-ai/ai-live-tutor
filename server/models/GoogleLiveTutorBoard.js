"use strict";

/**
 * server/models/GoogleLiveTutorBoard.js
 * =============================================================================
 * Advanced Live Tutor Tree Board MongoDB Models.
 *
 * Fixes found after extracting your zips:
 * - Old ConceptTreeNodeSchema did not save:
 *   shortDefinition, pageRefs, evidenceQuotes, children, confidence.
 * - So even if Gemini produced accurate nodes, MongoDB could strip important
 *   fields or frontend would not receive them consistently.
 *
 * This version stores the full accurate tree contract:
 * nodeId, title, shortDefinition, pageRefs, evidenceQuotes, parentId, children,
 * confidence, sourceRefs.
 * =============================================================================
 */

const mongoose = require("mongoose");

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const SourceRefSchema = new Schema(
  {
    chunkId: {
      type: String,
      required: true,
      index: true,
    },
    sourceRef: {
      type: String,
      default: "",
      index: true,
    },
    pageRef: {
      type: String,
      default: "",
      index: true,
    },
    page: {
      type: Number,
      default: 1,
      index: true,
    },
    quote: {
      type: String,
      default: "",
    },
    confidence: {
      type: Number,
      default: 0.75,
      min: 0,
      max: 1,
    },
  },
  { _id: false }
);

const EvidenceQuoteSchema = new Schema(
  {
    page: {
      type: Number,
      default: 1,
      index: true,
    },
    quote: {
      type: String,
      required: true,
    },
    confidence: {
      type: Number,
      default: 0.75,
      min: 0,
      max: 1,
    },
  },
  { _id: false }
);

const ConceptTreeNodeSchema = new Schema(
  {
    nodeId: {
      type: String,
      required: true,
    },
    id: {
      type: String,
      default: "",
    },
    label: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      default: "",
    },

    shortDefinition: {
      type: String,
      default: "",
    },
    pageRefs: {
      type: [Number],
      default: [],
    },
    evidenceQuotes: {
      type: [EvidenceQuoteSchema],
      default: [],
    },
    children: {
      type: [String],
      default: [],
    },
    confidence: {
      type: Number,
      default: 0.75,
      min: 0,
      max: 1,
    },

    summary: {
      type: String,
      default: "",
    },
    level: {
      type: Number,
      default: 0,
    },
    parentId: {
      type: String,
      default: "",
    },
    order: {
      type: Number,
      default: 0,
    },
    nodeType: {
      type: String,
      enum: [
        "root",
        "module",
        "concept",
        "definition",
        "process",
        "example",
        "warning",
        "question",
        "unknown",
      ],
      default: "concept",
    },
    importance: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },
    sourceRefs: {
      type: [SourceRefSchema],
      default: [],
    },
    tags: {
      type: [String],
      default: [],
    },
    visualHints: {
      type: [String],
      default: [],
    },
    metadata: {
      type: Mixed,
      default: {},
    },
  },
  { _id: false }
);

const ConceptTreeEdgeSchema = new Schema(
  {
    edgeId: {
      type: String,
      required: true,
    },
    id: {
      type: String,
      default: "",
    },
    from: {
      type: String,
      required: true,
    },
    to: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      default: "",
    },
    target: {
      type: String,
      default: "",
    },
    label: {
      type: String,
      default: "",
    },
    type: {
      type: String,
      enum: [
        "parent-child",
        "prerequisite",
        "related",
        "causes",
        "contrasts",
        "example-of",
      ],
      default: "parent-child",
    },
    sourceRefs: {
      type: [SourceRefSchema],
      default: [],
    },
    metadata: {
      type: Mixed,
      default: {},
    },
  },
  { _id: false }
);

const BoardViewportSchema = new Schema(
  {
    x: {
      type: Number,
      default: 0,
    },
    y: {
      type: Number,
      default: 0,
    },
    zoom: {
      type: Number,
      default: 0.85,
    },
  },
  { _id: false }
);

const GoogleLiveTutorConceptTreeSchema = new Schema(
  {
    treeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    resourceId: {
      type: String,
      required: true,
      index: true,
    },
    ownerKey: {
      type: String,
      required: true,
      index: true,
    },
    offlineUserId: {
      type: String,
      default: "demo_user",
      index: true,
    },
    deviceId: {
      type: String,
      default: "demo_device",
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    rootNodeId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["ready", "invalid", "failed"],
      default: "ready",
      index: true,
    },
    nodes: {
      type: [ConceptTreeNodeSchema],
      default: [],
    },
    edges: {
      type: [ConceptTreeEdgeSchema],
      default: [],
    },
    sourceCoverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    agentTrace: {
      type: [String],
      default: [],
    },
    validation: {
      ok: {
        type: Boolean,
        default: false,
      },
      errors: {
        type: [String],
        default: [],
      },
      warnings: {
        type: [String],
        default: [],
      },
    },
    generation: {
      model: {
        type: String,
        default: "",
      },
      method: {
        type: String,
        default: "gemini-page-wise-source-grounded-concept-tree-v2",
      },
      realGeminiCall: {
        type: Boolean,
        default: false,
      },
      fallbackUsed: {
        type: Boolean,
        default: false,
      },
      generatedAt: {
        type: Date,
        default: Date.now,
      },
    },
    metadata: {
      type: Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "live_tutor_concept_trees",
  }
);

const GoogleLiveTutorBoardSchema = new Schema(
  {
    boardId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    treeId: {
      type: String,
      required: true,
      index: true,
    },
    resourceId: {
      type: String,
      required: true,
      index: true,
    },
    ownerKey: {
      type: String,
      required: true,
      index: true,
    },
    offlineUserId: {
      type: String,
      default: "demo_user",
      index: true,
    },
    deviceId: {
      type: String,
      default: "demo_device",
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    flow: {
      nodes: {
        type: [Mixed],
        default: [],
      },
      edges: {
        type: [Mixed],
        default: [],
      },
      viewport: {
        type: BoardViewportSchema,
        default: () => ({}),
      },
    },
    selectedNodeId: {
      type: String,
      default: "",
      index: true,
    },
    expandedNodeIds: {
      type: [String],
      default: [],
    },
    collapsedNodeIds: {
      type: [String],
      default: [],
    },
    annotations: {
      type: [Mixed],
      default: [],
    },
    sourceBadges: {
      type: [Mixed],
      default: [],
    },
    autoscale: {
      enabled: {
        type: Boolean,
        default: true,
      },
      lastFitViewAt: {
        type: Date,
        default: null,
      },
      contentBounds: {
        type: Mixed,
        default: {},
      },
      recommendedZoom: {
        type: Number,
        default: 0.85,
      },
      layoutVersion: {
        type: String,
        default: "stage1-gemini-source-grounded-auto-scale-v2",
      },
    },
    saveReason: {
      type: String,
      default: "manual",
    },
    metadata: {
      type: Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "live_tutor_boards",
  }
);

const GoogleLiveTutorNodeExplanationSchema = new Schema(
  {
    explanationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    treeId: {
      type: String,
      required: true,
      index: true,
    },
    boardId: {
      type: String,
      default: "",
      index: true,
    },
    resourceId: {
      type: String,
      required: true,
      index: true,
    },
    nodeId: {
      type: String,
      required: true,
      index: true,
    },
    ownerKey: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    language: {
      type: String,
      default: "english",
    },
    studentLevel: {
      type: String,
      default: "beginner",
    },
    explanation: {
      type: String,
      required: true,
    },
    simpleExample: {
      type: String,
      default: "",
    },
    whyItMatters: {
      type: [String],
      default: [],
    },
    commonMistakes: {
      type: [String],
      default: [],
    },
    relatedNodeIds: {
      type: [String],
      default: [],
    },
    sourceRefs: {
      type: [SourceRefSchema],
      default: [],
    },
    boardCommands: {
      type: [Mixed],
      default: [],
    },
    validation: {
      ok: {
        type: Boolean,
        default: false,
      },
      errors: {
        type: [String],
        default: [],
      },
      warnings: {
        type: [String],
        default: [],
      },
    },
    generation: {
      model: {
        type: String,
        default: "",
      },
      method: {
        type: String,
        default: "source-grounded-node-explain",
      },
      realGeminiCall: {
        type: Boolean,
        default: false,
      },
      fallbackUsed: {
        type: Boolean,
        default: false,
      },
      generatedAt: {
        type: Date,
        default: Date.now,
      },
    },
    metadata: {
      type: Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "live_tutor_node_explanations",
  }
);

const GoogleLiveTutorBoardSceneSchema = new Schema(
  {
    sceneId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    boardId: {
      type: String,
      required: true,
      index: true,
    },
    treeId: {
      type: String,
      required: true,
      index: true,
    },
    resourceId: {
      type: String,
      required: true,
      index: true,
    },
    nodeId: {
      type: String,
      default: "",
      index: true,
    },
    ownerKey: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    boardCommands: {
      type: [Mixed],
      default: [],
    },
    currentCommandIndex: {
      type: Number,
      default: 0,
    },
    replayable: {
      type: Boolean,
      default: true,
    },
    sourceRefs: {
      type: [SourceRefSchema],
      default: [],
    },
    viewportBefore: {
      type: BoardViewportSchema,
      default: () => ({}),
    },
    viewportAfter: {
      type: BoardViewportSchema,
      default: () => ({}),
    },
    metadata: {
      type: Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "live_tutor_board_scenes",
  }
);

GoogleLiveTutorConceptTreeSchema.index({
  ownerKey: 1,
  resourceId: 1,
  updatedAt: -1,
});

GoogleLiveTutorConceptTreeSchema.index({
  ownerKey: 1,
  treeId: 1,
});

GoogleLiveTutorBoardSchema.index({
  ownerKey: 1,
  resourceId: 1,
  updatedAt: -1,
});

GoogleLiveTutorBoardSchema.index({
  ownerKey: 1,
  treeId: 1,
});

GoogleLiveTutorNodeExplanationSchema.index({
  ownerKey: 1,
  treeId: 1,
  nodeId: 1,
  updatedAt: -1,
});

GoogleLiveTutorBoardSceneSchema.index({
  ownerKey: 1,
  boardId: 1,
  updatedAt: -1,
});

const GoogleLiveTutorConceptTree =
  mongoose.models.GoogleLiveTutorConceptTree ||
  mongoose.model("GoogleLiveTutorConceptTree", GoogleLiveTutorConceptTreeSchema);

const GoogleLiveTutorBoard =
  mongoose.models.GoogleLiveTutorBoard ||
  mongoose.model("GoogleLiveTutorBoard", GoogleLiveTutorBoardSchema);

const GoogleLiveTutorNodeExplanation =
  mongoose.models.GoogleLiveTutorNodeExplanation ||
  mongoose.model(
    "GoogleLiveTutorNodeExplanation",
    GoogleLiveTutorNodeExplanationSchema
  );

const GoogleLiveTutorBoardScene =
  mongoose.models.GoogleLiveTutorBoardScene ||
  mongoose.model("GoogleLiveTutorBoardScene", GoogleLiveTutorBoardSceneSchema);

module.exports = {
  GoogleLiveTutorConceptTree,
  GoogleLiveTutorBoard,
  GoogleLiveTutorNodeExplanation,
  GoogleLiveTutorBoardScene,
  SourceRefSchema,
  EvidenceQuoteSchema,
  ConceptTreeNodeSchema,
  ConceptTreeEdgeSchema,
  BoardViewportSchema,
};