"use strict";

const mongoose = require("mongoose");
const { GoogleLiveTutorConceptTree, GoogleLiveTutorBoard } = require("../../../models/GoogleLiveTutorBoard");

async function ensureMongo() {
  if (mongoose.connection.readyState === 1) return;
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("MONGODB_URI missing.");
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DATABASE, serverSelectionTimeoutMS: 20000 });
}

// Schema accepts only these nodeType values
const VALID_NODE_TYPES = new Set(["root","module","concept","definition","process","example","warning","question","unknown"]);

function sanitizeNodeForMongo(n) {
  return {
    nodeId:          n.nodeId,
    id:              n.nodeId,
    label:           n.title || n.label || n.nodeId,   // label is required
    title:           n.title || "",
    shortDefinition: n.shortDefinition || n.summary || "",
    pageRefs:        Array.isArray(n.pageRefs) ? n.pageRefs : [],
    evidenceQuotes:  (Array.isArray(n.evidenceQuotes) ? n.evidenceQuotes : [])
                       .map((q) => typeof q === "string" ? { text: q, page: 1, confidence: 0.8 } : q),
    children:        Array.isArray(n.childNodeIds) ? n.childNodeIds : [],
    confidence:      typeof n.confidence === "number" ? n.confidence : 0.82,
    summary:         n.shortDefinition || n.summary || "",
    level:           typeof n.level === "number" ? n.level : 1,
    parentId:        n.parentNodeId || n.parentId || "",
    order:           typeof n.readOrder === "number" ? n.readOrder : 0,
    nodeType:        VALID_NODE_TYPES.has(n.nodeType) ? n.nodeType : "concept",
    importance:      0.75,
    sourceRefs:      (Array.isArray(n.sourceRefs) ? n.sourceRefs : []),   // keep ALL sourceRefs — never cut
    tags:            [],
    visualHints:     Array.isArray(n.visualHints) ? n.visualHints : [],
    metadata: {
      ...((n.metadata && typeof n.metadata === "object") ? n.metadata : {}),
      richSourcePack:      n.richSourcePack || n.metadata?.richSourcePack || {},
      originalNodeType:    n.nodeType || "concept",
      complexity:          n.complexity || "medium",
      readOrder:           n.readOrder || 0,
      prerequisiteNodeIds: n.prerequisiteNodeIds || [],
      nextNodeIds:         n.nextNodeIds || [],
      hasCodeExample:      Boolean(n.hasCodeExample),
      hasDiagram:          Boolean(n.hasDiagram),
      hasComparison:       Boolean(n.hasComparison),
      fallbackUsed:        false,
    },
  };
}

async function saveConceptTree(treeDoc) {
  await ensureMongo();
  const doc = {
    ...treeDoc,
    nodes: (Array.isArray(treeDoc.nodes) ? treeDoc.nodes : []).map(sanitizeNodeForMongo),
    updatedAt: new Date(),
  };
  const filter = { treeId: doc.treeId };
  const update = { $set: doc };
  const opts   = { upsert: true, new: true, setDefaultsOnInsert: true };
  return GoogleLiveTutorConceptTree.findOneAndUpdate(filter, update, opts).lean();
}

async function getConceptTree(treeId, ownerKey) {
  await ensureMongo();
  const tree = await GoogleLiveTutorConceptTree.findOne({ treeId, ownerKey }).lean();
  if (tree) return tree;
  const other = await GoogleLiveTutorConceptTree.findOne({ treeId }).select("treeId ownerKey").lean();
  if (other) {
    const err = new Error(`Tree "${treeId}" belongs to ownerKey "${other.ownerKey}", not "${ownerKey}".`);
    err.statusCode = 403; throw err;
  }
  const err = new Error(`Concept tree not found: ${treeId}`);
  err.statusCode = 404; throw err;
}

async function listTrees(ownerKey, resourceId) {
  await ensureMongo();
  const query = { ownerKey };
  if (resourceId) query.resourceId = resourceId;
  return GoogleLiveTutorConceptTree.find(query)
    .select("treeId resourceId ownerKey title createdAt updatedAt metadata.coverage")
    .sort({ createdAt: -1 }).limit(20).lean();
}

async function saveBoardState(boardDoc) {
  await ensureMongo();
  const filter = { boardId: boardDoc.boardId };
  const update = { $set: { ...boardDoc, updatedAt: new Date() } };
  const opts   = { upsert: true, new: true, setDefaultsOnInsert: true };
  return GoogleLiveTutorBoard.findOneAndUpdate(filter, update, opts).lean();
}

async function getBoardState(boardId, ownerKey) {
  await ensureMongo();
  const board = await GoogleLiveTutorBoard.findOne({ boardId, ownerKey }).lean();
  if (board) return board;
  const err = new Error(`Board not found: ${boardId}`);
  err.statusCode = 404; throw err;
}

module.exports = { saveConceptTree, getConceptTree, listTrees, saveBoardState, getBoardState };
