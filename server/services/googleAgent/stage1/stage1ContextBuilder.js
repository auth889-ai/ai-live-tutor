"use strict";

const { pageImagePath, pageImageUrl } = require("../sourceContext/pageImageContext");

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

function buildPagePackets(resource, chunks) {
  const byPage = new Map();

  for (const chunk of chunks) {
    const page = Number(chunk.page || 1);
    if (!byPage.has(page)) {
      byPage.set(page, { page, text: "", chunkIds: [], tables: [], figures: [],
        layoutBlocks: [], ocrText: "", pageImagePath: null, pageImageUrl: null });
    }
    const p = byPage.get(page);
    p.text += (p.text ? "\n\n" : "") + (chunk.text || chunk.textPreview || "");
    if (chunk.chunkId) p.chunkIds.push(chunk.chunkId);
    p.tables.push(...arr(obj(chunk.metadata).tables));
    p.figures.push(...arr(obj(chunk.metadata).figures));
    p.layoutBlocks.push(...arr(obj(chunk.metadata).layoutBlocks));
    if (obj(chunk.metadata).ocrText) p.ocrText += obj(chunk.metadata).ocrText + "\n";
  }

  _attachPageImages(resource, byPage);
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

function _attachPageImages(resource, byPage) {
  const resourceId = resource.resourceId || resource._id?.toString() || "";

  // First try real disk images using correct path format
  for (const [page] of byPage) {
    const p    = byPage.get(page);
    const diskPath = resourceId ? pageImagePath(resourceId, page) : null;
    if (diskPath) {
      p.pageImagePath = diskPath;
      p.pageImageUrl  = pageImageUrl(resourceId, page);
      continue;
    }
    // Fallback: resource metadata (legacy)
    for (const img of arr(obj(resource.metadata).pageImagePaths)) {
      if (Number(img.page || img.pageNum) === page) {
        p.pageImagePath = img.path || img.imagePath || null;
        p.pageImageUrl  = img.url  || img.imageUrl  || null;
      }
    }
  }
}

function extractTeachingAnchors(pagePackets, max = 70) {
  const anchors = [];
  const seen    = new Set();
  const patterns = [
    /(?:^|\n)([A-Z][^.!?\n]{8,80})\s+(?:is|means|refers to|defined as)\s+([^.\n]{20,200})/gm,
    /(?:^|\n)\d+[.)]\s+([A-Z][^.\n]{8,60})[:\s]+([^.\n]{20,200})/gm,
    /(?:^|\n)[•\-*]\s+([A-Z][^.\n]{8,60})[:\s]+([^.\n]{20,200})/gm,
  ];

  for (const packet of pagePackets) {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(packet.text)) !== null && anchors.length < max) {
        const title = m[1].trim().slice(0, 80);
        const key   = title.toLowerCase();
        if (seen.has(key) || title.length < 5) continue;
        seen.add(key);
        anchors.push({ title, quote: m[2].trim().slice(0, 200), page: packet.page, chunkIds: packet.chunkIds });
      }
    }
    if (anchors.length >= max) break;
  }
  return anchors;
}

function compactPagesForPrompt(pagePackets, maxChars = 200000) {
  let total = 0;
  const lines = [];
  for (const p of pagePackets) {
    const chunk = `[PAGE ${p.page}]\n${p.text.slice(0, 3000)}`;
    if (total + chunk.length > maxChars) break;
    lines.push(chunk);
    total += chunk.length;
  }
  return lines.join("\n\n---\n\n");
}

module.exports = { buildPagePackets, extractTeachingAnchors, compactPagesForPrompt };
