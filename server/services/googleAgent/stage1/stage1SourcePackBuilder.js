"use strict";

const arr = (v) => (Array.isArray(v) ? v : []);

function buildRichSourcePack(node, pagePackets) {
  const pageNums = [...new Set([
    ...arr(node.pageRefs),
    ...arr(node.sourceRefs).map((r) => Number(r.page)).filter(Boolean),
  ])];

  const pages = pagePackets.filter((p) => pageNums.includes(p.page));

  const selectedPageFullText = pages
    .map((p) => `[Page ${p.page}]\n${p.text}`)
    .join("\n\n---\n\n")
    .trim()
    .slice(0, 24000);

  const pageImages = pages
    .filter((p) => p.pageImagePath || p.pageImageUrl)
    .map((p) => ({
      page:       p.page,
      imagePath:  p.pageImagePath || null,
      imageUrl:   p.pageImageUrl  || null,
      exists:     !!p.pageImagePath,
      base64:     null,
      evidenceRole: "roadmapTreeNodePageImage",
    }));

  const tables = pages
    .flatMap((p) => arr(p.tables).map((t, i) => ({ page: p.page, index: i, text: String(t || "").slice(0, 3000) })))
    .slice(0, 40);

  const figures = pages
    .flatMap((p) => arr(p.figures).map((f, i) => ({ page: p.page, index: i, text: String(f || "").slice(0, 3000) })))
    .slice(0, 40);

  const selectedEvidence = arr(node.sourceRefs).map((r) => ({
    chunkId:   r.chunkId,
    page:      r.page,
    sourceRef: r.sourceRef,
    quote:     r.quote || "",
    confidence: r.confidence || 0.82,
    text:      r.quote || "",
    textPreview: (r.quote || "").slice(0, 300),
  })).slice(0, 16);

  return {
    selectedEvidence,
    selectedPageFullText,
    samePageChunks:   selectedEvidence,
    pageImages,
    tables,
    figures,
    pageRefs:         pageNums,
    hasPageImages:    pageImages.length > 0,
    pageImageCount:   pageImages.length,
    fullPageAvailable: pages.length > 0,
    fullPageImagesAvailableForGeminiVision: pageImages.length > 0,
  };
}

function attachSourcePacksToNodes(nodes, pagePackets, fullPdfSummary, fullPdfOutline, roadmapModules) {
  return nodes.map((node) => {
    const pack = buildRichSourcePack(node, pagePackets);
    return {
      ...node,
      richSourcePack: { ...pack, fullPdfSummary, fullPdfOutline, roadmapModules },
      metadata: {
        ...node.metadata,
        richSourcePack:               pack,
        pageImagesAttachedToNode:     pack.hasPageImages,
        pageImageCount:               pack.pageImageCount,
        fallbackUsed:                 false,
      },
    };
  });
}

module.exports = { buildRichSourcePack, attachSourcePacksToNodes };
