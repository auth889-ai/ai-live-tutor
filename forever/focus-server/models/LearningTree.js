// server/models/LearningTree.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const EdgeSchema = new Schema(
  {
    // Canonical current schema fields.
    source: {
      type: Schema.Types.ObjectId,
      ref: "LearningNode",
      index: true,
    },
    target: {
      type: Schema.Types.ObjectId,
      ref: "LearningNode",
      index: true,
    },

    // Compatibility aliases used by older UI/service code.
    fromNodeId: {
      type: Schema.Types.ObjectId,
      ref: "LearningNode",
      index: true,
      default: null,
    },
    toNodeId: {
      type: Schema.Types.ObjectId,
      ref: "LearningNode",
      index: true,
      default: null,
    },

    sourceTitle: {
      type: String,
      trim: true,
      default: "",
    },
    targetTitle: {
      type: String,
      trim: true,
      default: "",
    },

    relation: {
      type: String,
      trim: true,
      default: "related",
      index: true,
    },

    label: {
      type: String,
      trim: true,
      default: "",
    },

    relationType: {
      type: String,
      trim: true,
      enum: [
        "contains",
        "related",
        "related_to",
        "depends_on",
        "part_of",
        "explains",
        "example_of",
        "causes",
        "contrasts_with",
        "leads_to",
        "prerequisite_of",
        "supports",
        "has_step",
        "uses_tool",
        "warning_for",
        "compared_with",
        "shown_in_visual",
        "contradicts",
        "prerequisite_for",
        "implemented_by",
        "child",
        "ai_inferred",
      ],
      default: "related_to",
      index: true,
    },

    reason: {
      type: String,
      trim: true,
      default: "",
    },

    evidenceQuote: {
      type: String,
      trim: true,
      default: "",
    },

    aiReason: {
      type: String,
      trim: true,
      default: "",
    },

    pageRefs: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    pageNumber: {
      type: Number,
      default: 0,
      index: true,
    },

    chunkId: {
      type: String,
      trim: true,
      default: "",
    },

    relatedChunkIds: {
      type: [String],
      default: [],
    },

    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.6,
      index: true,
    },

    sourceKind: {
      type: String,
      enum: ["ai_pdf_evidence", "manual", "system"],
      default: "ai_pdf_evidence",
    },
  },
  { _id: true, timestamps: true }
);

const PdfChunkSchema = new Schema(
  {
    chunkId: {
      type: String,
      required: true,
      trim: true,
    },
    pageStart: {
      type: Number,
      default: 0,
    },
    pageEnd: {
      type: Number,
      default: 0,
    },
    text: {
      type: String,
      default: "",
    },
    charCount: {
      type: Number,
      default: 0,
    },
    visualCandidates: {
      type: [Schema.Types.Mixed],
      default: [],
    },
  },
  { _id: false }
);

const PdfPageSchema = new Schema(
  {
    pageNumber: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      default: "",
    },
    ocrText: {
      type: String,
      default: "",
    },
    mergedText: {
      type: String,
      default: "",
    },
    charCount: {
      type: Number,
      default: 0,
    },
    extractionMethod: {
      type: String,
      enum: ["text", "ocr", "mixed", "empty"],
      default: "text",
    },
    visualCandidates: {
      type: [Schema.Types.Mixed],
      default: [],
    },
  },
  { _id: false }
);

const LearningTreeSchema = new Schema(
  {
    deviceId: {
      type: String,
      trim: true,
      index: true,
      default: "",
    },

    userId: {
      type: String,
      trim: true,
      index: true,
      default: "",
    },

    userEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    title: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },

    summary: {
      type: String,
      default: "",
    },

    description: {
      type: String,
      default: "",
    },

    sourceType: {
      type: String,
      enum: ["pdf", "manual", "webpage", "video", "mixed"],
      default: "manual",
      index: true,
    },

    // compatibility with current service
    source: {
      type: String,
      trim: true,
      default: "manual",
      index: true,
    },

    sourceUrl: {
      type: String,
      trim: true,
      default: "",
    },

    sourceFileName: {
      type: String,
      trim: true,
      default: "",
    },

    sourceFilePath: {
      type: String,
      trim: true,
      default: "",
    },

    originalName: {
      type: String,
      trim: true,
      default: "",
    },

    fileName: {
      type: String,
      trim: true,
      default: "",
    },

    studyGoal: {
      type: String,
      trim: true,
      default: "",
    },

    category: {
      type: String,
      trim: true,
      default: "general",
      index: true,
    },

    tags: {
      type: [String],
      default: [],
      index: true,
    },

    status: {
      type: String,
      enum: [
        "draft",
        "queued",
        "extracting",
        "building_tree",
        "ready",
        "failed",
        "archived",
        "not_started",
        "in_progress",
        "completed",
      ],
      default: "draft",
      index: true,
    },

    progressPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    nodeCount: {
      type: Number,
      default: 0,
    },

    edgeCount: {
      type: Number,
      default: 0,
    },

    resourceCount: {
      type: Number,
      default: 0,
    },

    edges: {
      type: [EdgeSchema],
      default: [],
    },

    pdf: {
      pageCount: {
        type: Number,
        default: 0,
      },

      pages: {
        type: [PdfPageSchema],
        default: [],
      },

      chunks: {
        type: [PdfChunkSchema],
        default: [],
      },

      visualCandidates: {
        type: [Schema.Types.Mixed],
        default: [],
      },

      extractionStats: {
        type: Schema.Types.Mixed,
        default: {},
      },

      textCharCount: {
        type: Number,
        default: 0,
      },
    },

    ai: {
      model: {
        type: String,
        default: "",
      },
      confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: 0,
      },
      warnings: {
        type: [String],
        default: [],
      },
      rawConceptCount: {
        type: Number,
        default: 0,
      },
      rawRelationCount: {
        type: Number,
        default: 0,
      },
      mergedConceptCount: {
        type: Number,
        default: 0,
      },
    },

    rawAIOutput: {
      type: Schema.Types.Mixed,
      default: null,
    },

    lastError: {
      type: String,
      default: "",
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    lastOpenedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

LearningTreeSchema.index({ deviceId: 1, createdAt: -1 });
LearningTreeSchema.index({ userId: 1, createdAt: -1 });
LearningTreeSchema.index({ sourceType: 1, status: 1 });
LearningTreeSchema.index({ source: 1, status: 1 });
LearningTreeSchema.index({ title: "text", summary: "text", studyGoal: "text", tags: "text" });

LearningTreeSchema.methods.toClient = function toClient() {
  const obj = this.toObject();

  return {
    ...obj,
    id: String(obj._id),
    _id: String(obj._id),
  };
};

LearningTreeSchema.pre("save", function preSave(next) {
  if (Array.isArray(this.edges)) {
    this.edgeCount = this.edges.length;
  }

  if (Array.isArray(this.edges)) {
    this.edges = this.edges.map((edge) => {
      if (!edge) return edge;
      const relationValue = edge.relationType || edge.relation || "related";
      const pageNumber = Number(edge.pageNumber || edge.pageRefs?.[0]?.pageNumber || edge.pageRefs?.[0]?.page || edge.pageRefs?.[0] || 0);
      return {
        ...edge,
        source: edge.source || edge.fromNodeId || null,
        target: edge.target || edge.toNodeId || null,
        fromNodeId: edge.fromNodeId || edge.source || null,
        toNodeId: edge.toNodeId || edge.target || null,
        relation: relationValue,
        relationType: relationValue,
        label: edge.label || String(relationValue).replace(/_/g, " "),
        reason: edge.reason || edge.aiReason || "",
        aiReason: edge.aiReason || edge.reason || "",
        pageNumber: Number.isFinite(pageNumber) ? pageNumber : 0,
      };
    });
  }

  if (Array.isArray(this.tags)) {
    this.tags = [...new Set(this.tags.map((tag) => String(tag).trim()).filter(Boolean))];
  }

  if (!this.source && this.sourceType) this.source = this.sourceType;
  if (!this.sourceType && this.source) this.sourceType = this.source;

  if (!this.fileName && this.sourceFileName) this.fileName = this.sourceFileName;
  if (!this.sourceFileName && this.fileName) this.sourceFileName = this.fileName;

  next();
});

const LearningTree =
  mongoose.models.LearningTree || mongoose.model("LearningTree", LearningTreeSchema);

export default LearningTree;