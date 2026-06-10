"use strict";

/**
 * pageImageContext.js
 * Loads real PDF page images from disk for Gemini Vision.
 *
 * Actual storage (from pdfPageImageRenderer.service.js):
 *   server/public/live-tutor-page-images/{resourceId}/page-01.png
 *   server/public/live-tutor-page-images/{resourceId}/page-02.png
 *   Fallback: pdftocairo-page-01.png
 */

const fs   = require("fs");
const path = require("path");

// server/public/live-tutor-page-images/
const BASE_DIR = path.resolve(__dirname, "../../../public/live-tutor-page-images");

function pageImageDir(resourceId) {
  return path.join(BASE_DIR, resourceId);
}

function pageImagePath(resourceId, pageNum) {
  const pad  = String(pageNum).padStart(2, "0");
  const primary  = path.join(pageImageDir(resourceId), `page-${pad}.png`);
  const fallback = path.join(pageImageDir(resourceId), `pdftocairo-page-${pad}.png`);
  if (fs.existsSync(primary))  return primary;
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

function pageImageUrl(resourceId, pageNum) {
  return `/live-tutor-page-images/${resourceId}/page-${String(pageNum).padStart(2, "0")}.png`;
}

function readBase64Safe(filePath) {
  try {
    if (!filePath) return null;
    const buf = fs.readFileSync(filePath);
    if (buf.length > 6 * 1024 * 1024) return null; // skip >6MB
    return buf.toString("base64");
  } catch { return null; }
}

// Load ALL pages of a resource — every page image that exists on disk
function getAllPageImages(resourceId, { includeBase64 = false } = {}) {
  const dir = pageImageDir(resourceId);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => /^page-\d+\.png$/i.test(f)).sort();
  return files.map((filename) => {
    const match = filename.match(/(\d+)/);
    const page  = match ? Number(match[1]) : 0;
    const p     = path.join(dir, filename);
    return {
      page,
      imagePath: p,
      imageUrl:  pageImageUrl(resourceId, page),
      exists:    true,
      mimeType:  "image/png",
      base64:    includeBase64 ? readBase64Safe(p) : null,
    };
  }).filter((img) => img.page > 0);
}

// Load page images for specific page numbers
async function getPageImages(resourceId, pageNums = [], { includeBase64 = false } = {}) {
  if (!pageNums.length) return getAllPageImages(resourceId, { includeBase64 });
  return pageNums.map((pageNum) => {
    const p = pageImagePath(resourceId, pageNum);
    if (!p) return null;
    return {
      page:      Number(pageNum),
      imagePath: p,
      imageUrl:  pageImageUrl(resourceId, pageNum),
      exists:    true,
      mimeType:  "image/png",
      base64:    includeBase64 ? readBase64Safe(p) : null,
    };
  }).filter(Boolean);
}

module.exports = { getPageImages, getAllPageImages, pageImageDir, pageImagePath, pageImageUrl };
