// server/models/LearningNode.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const RelationshipSchema = new Schema(
  {
    // New service shape
    nodeId: {
      type: Schema.Types.ObjectId,
      ref: "LearningNode",
      index: true,
      default: null,
    },
    relation: {
      type: String,
      trim: true,
      default: "related",
    },
    label: {
      type: String,
      trim: true,
      default: "",
    },
    direction: {
      type: String,
      enum: ["incoming", "outgoing", "both"],
      default: "both",
    },
    pageNumber: {
      type: Number,
      default: 0,
    },
    chunkId: {
      type: String,
      trim: true,
      default: "",
    },

    // Older / graph shape compatibility
    targetNodeId: {
      type: Schema.Types.ObjectId,
      ref: "LearningNode",
      index: true,
      default: null,
    },
    targetTitle: {
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

    pageRefs: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.6,
    },
  },
  { _id: true }
);

const LearningNodeSchema = new Schema(
  {
    treeId: {
      type: Schema.Types.ObjectId,
      ref: "LearningTree",
      required: true,
      index: true,
    },

    parentId: {
      type: Schema.Types.ObjectId,
      ref: "LearningNode",
      default: null,
      index: true,
    },

    deviceId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    userId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    title: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },

    normalizedTitle: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    type: {
      type: String,
      enum: [
        "root",
        "main_topic",
        "subtopic",
        "process",
        "method",
        "principle",
        "tool",
        "example",
        "problem",
        "definition",
        "manual",
        "core_concept",
        "step",
        "warning",
        "formula",
        "diagram",
        "table",
        "code",
        "best_practice",
        "common_mistake",
        "resource",
      ],
      default: "subtopic",
      index: true,
    },

    nodeType: {
      type: String,
      trim: true,
      default: "",
    },

    sourceType: {
      type: String,
      trim: true,
      default: "manual",
      index: true,
    },

    sourceKind: {
      type: String,
      enum: ["ai_pdf_evidence", "manual", "imported"],
      default: "ai_pdf_evidence",
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

    pdfEvidence: {
      type: String,
      default: "",
    },

    tags: {
      type: [String],
      default: [],
      index: true,
    },

    concepts: {
      type: [String],
      default: [],
    },

    aliases: {
      type: [String],
      default: [],
    },

    pageRefs: {
      type: [Schema.Types.Mixed],
      default: [],
      index: true,
    },

    evidenceQuotes: {
      type: [String],
      default: [],
    },

    relatedChunkIds: {
      type: [String],
      default: [],
      index: true,
    },

    visualPageNumbers: {
      type: [Number],
      default: [],
    },

    relationships: {
      type: [RelationshipSchema],
      default: [],
    },

    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.65,
      index: true,
    },

    order: {
      type: Number,
      default: 0,
      index: true,
    },

    depth: {
      type: Number,
      default: 0,
      index: true,
    },

    level: {
      type: Number,
      default: 0,
      index: true,
    },

    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },

    status: {
      type: String,
      enum: ["new", "learning", "review", "completed", "archived"],
      default: "new",
      index: true,
    },

    resourceStatus: {
      type: String,
      enum: [
        "empty",
        "ready",
        "generating",
        "failed",
        "not_generated",
        "generated",
        "partial",
      ],
      default: "not_generated",
      index: true,
    },

    resourceCount: {
      type: Number,
      default: 0,
    },

    progressPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    resourceGenerationError: {
      type: String,
      default: "",
    },

    lastGeneratedAt: {
      type: Date,
      default: null,
    },

    lastOpenedAt: {
      type: Date,
      default: null,
      index: true,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    rawAIOutput: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

function normalizeTitle(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\b(the|a|an|and|or|of|to|in|for|with|by)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueCleanArray(values = []) {
  return [...new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean))];
}

function pageNumberFromRef(ref) {
  if (typeof ref === "number") return ref;
  if (typeof ref === "string") return Number(ref);
  if (ref && typeof ref === "object") {
    return Number(ref.pageNumber || ref.page || ref.pageIndex || ref.pageStart || 0);
  }
  return 0;
}

LearningNodeSchema.index({ treeId: 1, normalizedTitle: 1 }, { unique: false });
LearningNodeSchema.index({ treeId: 1, order: 1 });
LearningNodeSchema.index({ treeId: 1, parentId: 1 });
LearningNodeSchema.index({
  title: "text",
  normalizedTitle: "text",
  summary: "text",
  description: "text",
  pdfEvidence: "text",
  tags: "text",
  concepts: "text",
  evidenceQuotes: "text",
});

LearningNodeSchema.pre("save", function preSave(next) {
  this.normalizedTitle = normalizeTitle(this.title);

  this.tags = uniqueCleanArray(this.tags);
  this.concepts = uniqueCleanArray(this.concepts);
  this.aliases = uniqueCleanArray([...(this.aliases || []), this.title]);

  this.visualPageNumbers = [
    ...new Set((this.visualPageNumbers || []).map(Number).filter(Number.isFinite)),
  ].sort((a, b) => a - b);

  this.relatedChunkIds = uniqueCleanArray(this.relatedChunkIds);
  this.evidenceQuotes = uniqueCleanArray(this.evidenceQuotes).slice(0, 12);

  // Keep pageRefs usable for frontend, but normalize plain/objects to page-number objects.
  this.pageRefs = (this.pageRefs || [])
    .map((ref) => {
      const pageNumber = pageNumberFromRef(ref);
      if (!Number.isFinite(pageNumber) || pageNumber <= 0) return null;

      if (ref && typeof ref === "object") {
        return {
          ...ref,
          pageNumber,
        };
      }

      return {
        pageNumber,
        source: "pdf",
      };
    })
    .filter(Boolean);

  next();
});

LearningNodeSchema.methods.toClient = function toClient() {
  const obj = this.toObject();

  return {
    ...obj,
    id: String(obj._id),
    _id: String(obj._id),
    treeId: obj.treeId ? String(obj.treeId) : "",
    parentId: obj.parentId ? String(obj.parentId) : null,
  };
};

const LearningNode =
  mongoose.models.LearningNode || mongoose.model("LearningNode", LearningNodeSchema);

export default LearningNode;