"use strict";

/**
 * stage1BuildPipeline.js
 * Chains all 8 stage1 modules into one full tree-build flow.
 * Old monolith (stage1ConceptTree.service.js) is untouched.
 * This pipeline runs INSTEAD when called by the controller.
 */

const crypto = require("crypto");
const { loadResource }           = require("../sourceContext/resourceLoader");
const { loadChunksByResource }   = require("../sourceContext/chunkLoader");
const { buildPagePackets, extractTeachingAnchors } = require("./stage1ContextBuilder");
const { callGeminiJson, callGeminiWithRepair }     = require("./stage1GeminiClient");
const { buildSummaryPrompt, buildOutlinePrompt, buildTreePrompt } = require("./stage1PromptBuilder");
const { normalizeNodes, normalizeEdges, findRootNodeId } = require("./stage1TreeNormalizer");
const { assignReadOrder, assignRelations, checkCoverage } = require("./stage1RoadmapQuality");
const { attachSourcePacksToNodes } = require("./stage1SourcePackBuilder");
const { saveConceptTree, saveBoardState } = require("./stage1TreePersistence");
const { mirrorTreeToMcp }        = require("./stage1McpMirror");

const makeId = (p) => `${p}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

async function buildTree({ ownerKey, resourceId, body = {} }) {
  // 1 — load resource + chunks
  const resource    = await loadResource({ ownerKey, resourceId });
  const chunks      = await loadChunksByResource(resourceId);

  // 2 — build page packets and extract anchors from real PDF text
  const pagePackets = buildPagePackets(resource, chunks);
  const anchors     = extractTeachingAnchors(pagePackets);

  // 3 — Gemini pass 1: full PDF summary
  const summary = await callGeminiJson(buildSummaryPrompt(pagePackets), { maxTokens: 4096 });

  // 4 — Gemini pass 2: chapter outline + roadmap modules
  const outline = await callGeminiJson(buildOutlinePrompt(summary, pagePackets), { maxTokens: 8192 });
  const roadmapModules = (Array.isArray(outline.roadmapModules) ? outline.roadmapModules : []).slice(0, 20);

  // 5 — Gemini pass 3: full concept tree with repair loop
  const rawTree = await callGeminiWithRepair(
    buildTreePrompt(summary, outline, anchors, pagePackets),
    (r) => (!Array.isArray(r?.nodes) || r.nodes.length < 5) ? "nodes missing or < 5" : null,
    { maxTokens: 32000 }
  );

  // 6 — normalize raw Gemini output → stable IDs, valid types
  const nodes      = normalizeNodes(rawTree.nodes || [], resourceId);
  const edges      = normalizeEdges(rawTree.edges || [], nodes.map((n) => n.nodeId));
  const rootNodeId = findRootNodeId(nodes);

  // 7 — quality: readOrder, prerequisites, coverage report
  const ordered  = assignRelations(assignReadOrder(nodes, edges), edges);
  const coverage = checkCoverage(ordered, pagePackets.length);

  // 8 — attach richSourcePack (evidence + page images + tables) to every node
  const richNodes = attachSourcePacksToNodes(ordered, pagePackets, summary, outline, roadmapModules);

  // 9 — save tree + board to MongoDB
  const treeId  = makeId("tree");
  const boardId = makeId("board");
  const treeDoc = {
    treeId, boardId, resourceId, ownerKey, rootNodeId,
    title:  summary.title || resource.title || "Concept Tree",
    nodes:  richNodes,
    edges,
    metadata: { fullPdfSummary: summary, fullPdfOutline: outline, roadmapModules, coverage, fallbackUsed: false },
  };

  await saveConceptTree(treeDoc);
  await saveBoardState({ boardId, treeId, resourceId, ownerKey, nodes: richNodes, edges,
    metadata: { fallbackUsed: false } });

  // 10 — MCP mirror (non-blocking, failure silently logged)
  mirrorTreeToMcp(treeDoc, chunks).catch((e) => console.warn("[stage1BuildPipeline] MCP mirror:", e.message));

  return {
    ok: true, treeId, boardId, rootNodeId, nodes: richNodes, edges,
    title: treeDoc.title, fullPdfSummary: summary, fullPdfOutline: outline, roadmapModules,
    metadata: { fallbackUsed: false, nodeCount: richNodes.length, edgeCount: edges.length, coverage },
  };
}

module.exports = { buildTree };
