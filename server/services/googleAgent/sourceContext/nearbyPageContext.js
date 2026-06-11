"use strict";

const { loadChunksByPages, groupByPage, getPageText } = require("./chunkLoader");

async function getNearbyPageContext(resourceId, selectedPages = [], allChunks = null) {
  if (!selectedPages.length) {
    return { samePage: [], prevPage: [], nextPage: [], selectedPageFullText: "" };
  }

  const nearbyNums = new Set(selectedPages);
  selectedPages.forEach((p) => {
    if (p > 1) nearbyNums.add(p - 1);
    nearbyNums.add(p + 1);
  });

  const chunks = allChunks || await loadChunksByPages(resourceId, [...nearbyNums]);
  const byPage  = groupByPage(chunks);

  function pickPage(pageNum) {
    return (byPage.get(Number(pageNum)) || []).sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
  }

  const samePage = dedupeChunks(selectedPages.flatMap((p) => pickPage(p)));
  const prevPage = dedupeChunks(selectedPages.flatMap((p) => pickPage(p - 1)));
  const nextPage = dedupeChunks(selectedPages.flatMap((p) => pickPage(p + 1)));

  const selectedPageFullText = selectedPages
    .map((p) => `[Page ${p}]\n${getPageText(chunks, p)}`)
    .join("\n\n---\n\n")
    .trim()
    .slice(0, 24000);

  return {
    // UNCAPPED — every chunk on the node's pages and adjacent pages.
    // Semantic search (hybridSearch.service) covers the rest of the PDF.
    samePage,
    prevPage,
    nextPage,
    selectedPageFullText,
  };
}

function dedupeChunks(chunks) {
  const seen = new Set();
  return chunks.filter((c) => {
    const key = c.chunkId || c._id?.toString() || "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getPageRange(pages = [], window = 2) {
  if (!pages.length) return [];
  const min = Math.max(1, Math.min(...pages) - window);
  const max = Math.max(...pages) + window;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

module.exports = { getNearbyPageContext, dedupeChunks, getPageRange };
