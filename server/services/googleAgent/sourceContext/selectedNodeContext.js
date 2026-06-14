"use strict";

const s = (v) => (typeof v === "string" ? v.trim() : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

function findNodeInTree(treeDoc, nodeId) {
  const nodes = arr(treeDoc?.nodes || treeDoc?.conceptTree?.nodes || []);
  const nid = s(nodeId);
  if (!nid) return null;
  return (
    nodes.find((n) => s(n.nodeId) === nid) ||
    nodes.find((n) => s(n.id) === nid) ||
    nodes.find((n) => s(n.data?.nodeId) === nid) ||
    null
  );
}

function getNodePages(node) {
  const fromRefs = arr(node?.sourceRefs).map((r) => Number(obj(r).page)).filter(Boolean);
  const fromPageRefs = arr(node?.pageRefs).map(Number).filter(Boolean);
  return [...new Set([...fromPageRefs, ...fromRefs])].sort((a, b) => a - b);
}

function getNodeSourceRefs(node) {
  return arr(node?.sourceRefs || node?.data?.sourceRefs || [])
    .filter((r) => obj(r).chunkId || Number(obj(r).page) > 0);
}

function buildNodeContext(node, resourceId) {
  if (!node) return null;
  const refs     = getNodeSourceRefs(node);
  const pages    = getNodePages(node);
  const rsp      = obj(node?.richSourcePack || node?.metadata?.richSourcePack || {});
  return {
    nodeId:           s(node.nodeId || node.id || ""),
    title:            s(node.label  || node.title || node.nodeId || ""),
    nodeType:         s(node.nodeType || node.conceptType || "concept"),
    shortDefinition:  s(node.shortDefinition || node.summary || "").slice(0, 800),
    pageNums:         pages,
    sourceRefs:       refs,
    evidenceQuotes:   arr(node.evidenceQuotes || []),
    richSourcePack:   rsp,
    pageImages:       arr(rsp.pageImages       || []),
    selectedEvidence: arr(rsp.selectedEvidence || refs),   // keep ALL evidence — never cut
    hasCodeExample:   Boolean(node.hasCodeExample),
    hasDiagram:       Boolean(node.hasDiagram),
    complexity:       s(node.complexity || "medium"),
    resourceId,
  };
}

function assertNodeHasSource(nodeCtx) {
  if (!nodeCtx) {
    throw Object.assign(new Error("Node not found in tree."), { statusCode: 404 });
  }
  if (!nodeCtx.sourceRefs.length && !nodeCtx.pageNums.length) {
    throw Object.assign(
      new Error(`Node "${nodeCtx.title}" has no sourceRefs. Rebuild the concept tree first.`),
      { statusCode: 422 }
    );
  }
}

module.exports = { findNodeInTree, getNodePages, getNodeSourceRefs, buildNodeContext, assertNodeHasSource };
