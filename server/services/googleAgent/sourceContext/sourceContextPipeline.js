"use strict";

/**
 * sourceContextPipeline.js
 * Chains all 6 sourceContext modules + richSourcePackAssembler.
 * Called when a student clicks a node to start Stage 2 teaching.
 * Old monolith (sourceContextBuilder.service.js) is untouched.
 */

const { loadResource }                     = require("./resourceLoader");
const { loadChunksByResource, chunksToSourceRefs } = require("./chunkLoader");
const { findNodeInTree, buildNodeContext, assertNodeHasSource } = require("./selectedNodeContext");
const { getNearbyPageContext }             = require("./nearbyPageContext");
const { getPageImages, getAllPageImages } = require("./pageImageContext");
const { assembleRichSourcePack }           = require("./richSourcePackAssembler");
const { assertQuality }                    = require("./contextAudit");
const { getConceptTree }                   = require("../stage1/stage1TreePersistence");

async function buildSourceContext({ ownerKey, resourceId, treeId, nodeId }) {
  // 1 — load resource (validates ownership)
  const resource = await loadResource({ ownerKey, resourceId });

  // 2 — load tree, find clicked node, validate it has source refs
  const treeDoc  = await getConceptTree(treeId, ownerKey);
  const rawNode  = findNodeInTree(treeDoc, nodeId);
  const nodeCtx  = buildNodeContext(rawNode, resourceId);
  assertNodeHasSource(nodeCtx);

  // 3 — load ALL chunks for this resource (needed for nearby context)
  const allChunks    = await loadChunksByResource(resourceId, { limit: 1200 });
  const nodeChunks   = allChunks.filter((c) => nodeCtx.pageNums.includes(Number(c.page)));
  const sourceRefs   = chunksToSourceRefs(nodeChunks, resourceId);

  // 4 — same/prev/next page chunks + full page text
  const nearbyCtx = await getNearbyPageContext(resourceId, nodeCtx.pageNums, allChunks);

  // 5 — page images from correct disk path
  // Primary: load selected node's pages with base64 for Gemini Vision
  // Also load ALL resource pages so Vision agents can reference any diagram
  const nodePageImages = await getPageImages(resourceId, nodeCtx.pageNums, { includeBase64: true });
  const allPageImages  = getAllPageImages(resourceId, { includeBase64: false });
  const pageImages = nodePageImages.length > 0 ? nodePageImages : allPageImages.filter((img) => nodeCtx.pageNums.includes(img.page));

  // 6 — assemble complete source pack (all data Stage2 Python agents need)
  const chunkData = {
    ...nearbyCtx,
    selectedEvidence:      nodeCtx.selectedEvidence,
    selectedPageFullText:  nearbyCtx.selectedPageFullText,
  };
  const pack = assembleRichSourcePack(resource, rawNode, chunkData, { pageImages });

  // 7 — audit quality, throw if context too weak to teach from
  const audit = assertQuality(pack, 30);

  return {
    ...pack,
    sourceRefs:   sourceRefs.length ? sourceRefs : pack.sourceRefs,
    treeId,
    nodeId:       nodeCtx.nodeId,
    resourceId,
    ownerKey,
    audit,
    metadata: {
      fallbackUsed:   false,
      contextScore:   audit.score,
      contextFlags:   audit.flags,
      pipelineSource: "sourceContextPipeline",
    },
  };
}

module.exports = { buildSourceContext };
