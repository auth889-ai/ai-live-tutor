"use strict";

const crypto = require("crypto");

const VALID_TYPES = new Set([
  "root","module","concept","definition","process","step",
  "example","comparison","schema","warning","quiz","sub_concept",
]);

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function normalizeNodeId(raw, fallback) {
  const s = String(raw || fallback || "node").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || fallback || makeId("node");
}

function normalizeNodes(rawNodes, resourceId) {
  const seen = new Set();
  const out   = [];

  for (const n of (Array.isArray(rawNodes) ? rawNodes : [])) {
    if (!n || typeof n !== "object") continue;
    const nodeId = normalizeNodeId(n.nodeId || n.id || n.title, makeId("node"));
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);

    const refs = (Array.isArray(n.sourceRefs) ? n.sourceRefs : []).map((r) => ({
      chunkId:   String(r.chunkId   || r.chunk_id || `${resourceId}_p${r.page || 1}_c0`),
      page:      Number(r.page      || 1),
      sourceRef: String(r.sourceRef || `${resourceId}:page:${r.page || 1}`),
      quote:     String(r.quote     || r.text || "").slice(0, 400),
      confidence: Number(r.confidence || 0.82),
      resourceId,
    })).filter((r) => r.chunkId);

    out.push({
      nodeId,
      title:           String(n.title || n.label || nodeId),
      nodeType:        VALID_TYPES.has(n.nodeType) ? n.nodeType : "concept",
      level:           Number(n.level  ?? 1),
      parentNodeId:    n.parentNodeId ? normalizeNodeId(n.parentNodeId, null) : null,
      pageRefs:        (Array.isArray(n.pageRefs) ? n.pageRefs : []).map(Number).filter(Boolean),
      sourceRefs:      refs,
      evidenceQuotes:  (Array.isArray(n.evidenceQuotes) ? n.evidenceQuotes : []).map(String).slice(0, 6),
      shortDefinition: String(n.shortDefinition || n.summary || "").slice(0, 800),
      hasCodeExample:  Boolean(n.hasCodeExample),
      hasDiagram:      Boolean(n.hasDiagram),
      hasComparison:   Boolean(n.hasComparison),
      complexity:      ["easy","medium","hard","advanced"].includes(n.complexity) ? n.complexity : "medium",
      metadata:        { richSourcePack: {}, fallbackUsed: false },
    });
  }
  return out;
}

function normalizeEdges(rawEdges, nodeIds) {
  const idSet = new Set(nodeIds);
  const seen  = new Set();
  return (Array.isArray(rawEdges) ? rawEdges : [])
    .filter((e) => e && idSet.has(e.from || e.source) && idSet.has(e.to || e.target))
    .map((e) => ({
      edgeId: makeId("edge"),
      from:   e.from || e.source,
      to:     e.to   || e.target,
      type:   e.type || "parent-child",
    }))
    .filter((e) => {
      const key = `${e.from}→${e.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function findRootNodeId(nodes) {
  return (nodes.find((n) => n.nodeType === "root" || n.level === 0) || nodes[0])?.nodeId || null;
}

module.exports = { normalizeNodes, normalizeEdges, findRootNodeId, normalizeNodeId };
