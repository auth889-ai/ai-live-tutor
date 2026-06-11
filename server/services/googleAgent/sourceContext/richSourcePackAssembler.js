"use strict";

function safeArr(v) { return Array.isArray(v) ? v : []; }
function safeObj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function trimText(v, max = 24000) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }

function dedupeChunks(chunks) {
  const seen = new Set();
  return chunks.filter((c) => {
    const key = c.chunkId || c._id?.toString() || JSON.stringify(c).slice(0, 40);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeChunk(c, resourceId) {
  const page = Number(c.page || c.pageNumber || 1);
  return {
    chunkId:     c.chunkId || c._id?.toString() || `${resourceId}_p${page}_auto`,
    page,
    text:        trimText(c.text || c.textPreview || c.content || "", 6000),
    textPreview: trimText(c.text || c.textPreview || "", 400),
    sourceRef:   c.sourceRef || `${resourceId}:page:${page}`,
    confidence:  Number(c.confidence || 0.82),
    resourceId,
    heading:     c.heading || "",
    hasPageImage: Boolean(c.pageImageUrl || c.pageImagePath),
    pageImageUrl: c.pageImageUrl || "",
  };
}

function assembleRichSourcePack(resource, node, chunkData, imageData) {
  const res    = safeObj(resource);
  const n      = safeObj(node);
  const chunks = safeObj(chunkData);
  const images = safeObj(imageData);
  const rid    = res.resourceId || "";

  const rsp      = safeObj(n.richSourcePack || n.metadata?.richSourcePack || {});
  const samePage = safeArr(chunks.samePage || chunks.samePageChunks || []);
  const prevPage = safeArr(chunks.prevPage || chunks.previousPageChunks || []);
  const nextPage = safeArr(chunks.nextPage || chunks.nextPageChunks || []);
  const semantic = safeArr(chunks.semanticChunks || []);
  const rspEv    = safeArr(rsp.selectedEvidence || n.evidence || chunks.selectedEvidence || []);

  // SourceTruthPacket (POWERFUL_WORKFLOW 2.5/2.6): the node gets EVERYTHING.
  // Priority: same-page → semantic hits (vector+fulltext, from ANYWHERE in
  // the PDF) → stored refs → prev/next pages.  NO CAP — sourceRefs are a
  // starting point, never a fence. Gemini context windows handle it easily.
  const allEvidence = dedupeChunks([...samePage, ...semantic, ...rspEv, ...prevPage, ...nextPage])
    .map((c) => normalizeChunk(c, rid))
    .filter((c) => c.text.length > 10);

  const pageImages = safeArr(images.pageImages || images.images || []).map((img) => ({
    page:      Number(img.page || 1),
    imagePath: img.imagePath || img.path || "",
    imageUrl:  img.imageUrl || img.url || "",
    base64:    img.base64 || "",
    mimeType:  "image/png",
    exists:    true,
  }));

  const sourceRefs = dedupeChunks(allEvidence).map((c) => ({
    chunkId:    c.chunkId,
    page:       c.page,
    sourceRef:  c.sourceRef,
    quote:      c.textPreview,
    confidence: c.confidence,
    resourceId: rid,
  }));

  const resMeta    = safeObj(res.metadata || {});
  const fullText   = trimText(chunks.selectedPageFullText || rsp.selectedPageFullText || "");

  return {
    selectedNode:          n,
    selectedNodeTitle:     trimText(n.label || n.title || "", 360),

    // Rich evidence — UNCAPPED SourceTruthPacket (vision-first sourcing)
    selectedEvidence:      allEvidence,
    exactChunks:           allEvidence,          // alias used by some ADK agents
    chunks:                allEvidence,           // alias used by RagRetrievalAgent
    semanticChunks:        semantic.map((c) => normalizeChunk(c, rid)),

    selectedPageFullText:  fullText,
    samePageChunks:        samePage.map((c) => normalizeChunk(c, rid)),
    previousPageChunks:    prevPage.map((c) => normalizeChunk(c, rid)),
    nextPageChunks:        nextPage.map((c) => normalizeChunk(c, rid)),

    pageImages:            pageImages,            // ALL node pages — no cap
    fullPdfSummary:        safeObj(resMeta.fullPdfSummary || {}),
    fullPdfOutline:        safeObj(resMeta.fullPdfOutline || {}),
    roadmapModules:        safeArr(resMeta.roadmapModules || []),
    sourceRefs:            sourceRefs,

    proof: {
      hasText:      fullText.length > 40,
      hasImages:    pageImages.length > 0,
      hasSummary:   !!(resMeta.fullPdfSummary),
      hasOutline:   !!(resMeta.fullPdfOutline),
      hasEvidence:  allEvidence.length > 0,
      evidenceCount: allEvidence.length,
      chunkCount:   allEvidence.length,
      imageCount:   pageImages.length,
      meetsMinimum: Boolean(fullText.length > 40 && pageImages.length > 0 && allEvidence.length > 0),
    },
  };
}

module.exports = { assembleRichSourcePack };
