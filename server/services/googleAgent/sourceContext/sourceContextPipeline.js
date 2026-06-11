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
  const allChunks    = await loadChunksByResource(resourceId);
  const nodeChunks   = allChunks.filter((c) => nodeCtx.pageNums.includes(Number(c.page)));
  const sourceRefs   = chunksToSourceRefs(nodeChunks, resourceId);

  // 3.5 — HYBRID SEMANTIC RETRIEVAL (POWERFUL_WORKFLOW 2.5c)
  // Atlas $vectorSearch (meaning) + $search (exact terms) finds relevant
  // chunks from ANYWHERE in the PDF — sourceRefs are a starting point,
  // never a fence. Degrades gracefully if Atlas search is unavailable.
  let semanticChunks = [];
  let hybridMeta = { ok: false, vectorCount: 0, textCount: 0 };
  try {
    const { hybridSearchChunks } = require("../hybridSearch.service");
    const keywords = Array.isArray(rawNode?.keywords) ? rawNode.keywords : [];
    const query = [nodeCtx.title, nodeCtx.shortDefinition, ...keywords]
      .filter(Boolean).join(" ").slice(0, 600);
    const hybrid = await hybridSearchChunks({ resourceId, query });
    semanticChunks = hybrid.chunks;
    hybridMeta = { ok: hybrid.ok, vectorCount: hybrid.vectorCount,
                   textCount: hybrid.textCount, warning: hybrid.warning };
    if (hybrid.warning) console.warn(`[sourceContext] hybrid search: ${hybrid.warning}`);
  } catch (err) {
    console.warn(`[sourceContext] hybrid search skipped: ${err.message}`);
  }

  // 4 — same/prev/next page chunks + full page text
  const nearbyCtx = await getNearbyPageContext(resourceId, nodeCtx.pageNums, allChunks);

  // 5 — page images from correct disk path
  // Primary: load selected node's pages with base64 for Gemini Vision
  // Also load ALL resource pages so Vision agents can reference any diagram
  const nodePageImages = await getPageImages(resourceId, nodeCtx.pageNums, { includeBase64: true });
  const allPageImages  = getAllPageImages(resourceId, { includeBase64: false });
  const pageImages = nodePageImages.length > 0 ? nodePageImages : allPageImages.filter((img) => nodeCtx.pageNums.includes(img.page));

  const expectedPages = [...new Set(nodeCtx.pageNums.map(Number).filter(Boolean))];
  const imagePages = new Set(pageImages.map((img) => Number(img.page)).filter(Boolean));
  const missingImagePages = expectedPages.filter((page) => !imagePages.has(page));
  if (expectedPages.length && missingImagePages.length) {
    const err = new Error(
      `Stage 2 requires real PDF page images for every selected node page. Missing page image(s): ${missingImagePages.join(", ")}`
    );
    err.statusCode = 422;
    err.details = {
      resourceId,
      nodeId,
      expectedPages,
      imagePages: [...imagePages],
      missingImagePages,
    };
    throw err;
  }

  // 6 — assemble complete source pack (all data Stage2 Python agents need)
  const chunkData = {
    ...nearbyCtx,
    semanticChunks,                              // hybrid vector+text hits
    selectedEvidence:      nodeCtx.selectedEvidence,
    selectedPageFullText:  nearbyCtx.selectedPageFullText,
  };
  const pack = assembleRichSourcePack(resource, rawNode, chunkData, { pageImages });

  // 7 — audit quality, throw if context too weak to teach from
  const audit = assertQuality(pack, 30);
  const mergedSourceRefs = [...sourceRefs, ...(pack.sourceRefs || [])]
    .filter(Boolean)
    .filter((ref, index, arr) => {
      const key = `${ref.chunkId || ""}:${ref.page || ""}:${ref.sourceRef || ""}`;
      return key !== "::" && arr.findIndex((item) => `${item.chunkId || ""}:${item.page || ""}:${item.sourceRef || ""}` === key) === index;
    });

  return {
    ...pack,
    sourceRefs:   mergedSourceRefs.length ? mergedSourceRefs : pack.sourceRefs,
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
