"use strict";

/**
 * server/services/googleAgent/pdfCrop.service.js
 *
 * Accurate PDF region cropper.
 *
 * Rules:
 * - Always crop from ORIGINAL full page image.
 * - BBox is normalized fraction: x,y,w,h from top-left.
 * - Add safe margin so diagrams/tables do not cut edges.
 * - Attach cropUrl/cropPath/pageImageUrl to every matching pdf crop element.
 * - Do not invent crops. If page image or bbox missing, keep honest warning.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const {
  pageImagePath,
  pageImageUrl,
} = require("./sourceContext/pageImageContext");

const CROP_BASE_DIR = path.resolve(__dirname, "../../public/live-tutor-crops");

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function safeObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function normalizeBbox(raw = {}) {
  const x = clamp(raw.x, 0, 1);
  const y = clamp(raw.y, 0, 1);
  const w = clamp(raw.w, 0.001, 1 - x);
  const h = clamp(raw.h, 0.001, 1 - y);

  return {
    x,
    y,
    w: clamp(w, 0.001, 1 - x),
    h: clamp(h, 0.001, 1 - y),
  };
}

function marginForRegion(region = {}) {
  const type = String(region.type || region.regionType || "").toLowerCase();

  if (["diagram", "chart", "figure", "image", "screenshot"].includes(type)) return 0.08;
  if (["table", "code", "formula"].includes(type)) return 0.05;
  return 0.025;
}

function expandBbox(bbox, margin = 0.04) {
  const x = clamp(bbox.x - margin, 0, 1);
  const y = clamp(bbox.y - margin, 0, 1);
  const right = clamp(bbox.x + bbox.w + margin, 0, 1);
  const bottom = clamp(bbox.y + bbox.h + margin, 0, 1);

  return {
    x,
    y,
    w: clamp(right - x, 0.001, 1 - x),
    h: clamp(bottom - y, 0.001, 1 - y),
  };
}

function bboxToPixels(bbox, imageWidth, imageHeight) {
  const left = Math.round(bbox.x * imageWidth);
  const top = Math.round(bbox.y * imageHeight);

  const maxW = imageWidth - left;
  const maxH = imageHeight - top;

  const width = Math.max(8, Math.min(Math.round(bbox.w * imageWidth), maxW));
  const height = Math.max(8, Math.min(Math.round(bbox.h * imageHeight), maxH));

  return { left, top, width, height };
}

function collectVisionRegions(result = {}) {
  const candidates = [
    result.visionIndex,
    result.visualContext?.visionIndex,
    result.visualContextSummary?.visionIndex,
    result.metadata?.visionIndex,
    result.sourceTruthPacket?.visionIndex,
    result.sourcePack?.visionIndex,
  ];

  const regions = [];

  for (const c of candidates) {
    if (Array.isArray(c)) regions.push(...c);
  }

  const map = new Map();

  for (const r of regions) {
    if (!r || !r.regionId) continue;
    map.set(String(r.regionId), r);
  }

  return map;
}

function visitObjects(root, visitor) {
  if (!root || typeof root !== "object") return;

  if (Array.isArray(root)) {
    for (const item of root) visitObjects(item, visitor);
    return;
  }

  visitor(root);

  for (const value of Object.values(root)) {
    if (value && typeof value === "object") visitObjects(value, visitor);
  }
}

function isPdfFocusObject(obj = {}) {
  const kind = String(obj.kind || obj.type || obj.action || obj.commandType || "").toLowerCase();

  if (kind.includes("pdf_crop")) return true;
  if (kind.includes("pdfcrop")) return true;
  if (kind.includes("source_crop")) return true;
  if (kind.includes("showpdfcrop")) return true;
  if (kind.includes("zoomregion")) return true;
  if (kind.includes("circleregion")) return true;

  return Boolean(obj.regionId || obj.focusRegionId);
}

function attachToMatchingObjects(result, regionId, attach = {}) {
  let touched = 0;

  visitObjects(result, (obj) => {
    if (!isPdfFocusObject(obj)) return;

    const rid = String(obj.regionId || obj.focusRegionId || "");
    if (rid !== String(regionId)) return;

    obj.cropUrl = attach.cropUrl;
    obj.cropPath = attach.cropPath;
    obj.pageImageUrl = attach.pageImageUrl;
    obj.pageImagePath = attach.pageImagePath;
    obj.sourceMode = obj.sourceMode || "full_page_with_focus";
    obj.focusBbox = obj.focusBbox || attach.bbox;
    obj.regionType = obj.regionType || attach.regionType;
    touched += 1;
  });

  return touched;
}

async function cropOneRegion({ resourceId, region }) {
  const page = Number(region.page || region.pageNum || region.pageNumber || 0);
  if (!resourceId || !page) {
    return { ok: false, reason: "missing_resource_or_page" };
  }

  const src = pageImagePath(resourceId, page);
  if (!src || !fs.existsSync(src)) {
    return { ok: false, reason: "page_image_missing", page };
  }

  const meta = await sharp(src).metadata();
  if (!meta.width || !meta.height) {
    return { ok: false, reason: "bad_page_image_metadata", page };
  }

  const rawBox = normalizeBbox(region.bbox || region.focusBbox || {});
  const expanded = expandBbox(rawBox, marginForRegion(region));
  const rect = bboxToPixels(expanded, meta.width, meta.height);

  const outDir = path.join(CROP_BASE_DIR, resourceId);
  fs.mkdirSync(outDir, { recursive: true });

  const safeRegionId = String(region.regionId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const outPath = path.join(outDir, `${safeRegionId}.png`);
  const outUrl = `/live-tutor-crops/${resourceId}/${safeRegionId}.png`;

  // CRITICAL: crop from original full page image, never from a previous crop.
  await sharp(src)
    .extract(rect)
    .png()
    .toFile(outPath);

  return {
    ok: true,
    page,
    regionId: region.regionId,
    regionType: region.type || region.regionType || "",
    bbox: rawBox,
    expandedBbox: expanded,
    pixelRect: rect,
    pageImagePath: src,
    pageImageUrl: pageImageUrl(resourceId, page),
    cropPath: outPath,
    cropUrl: outUrl,
    pageSize: { width: meta.width, height: meta.height },
  };
}

async function cropLessonRegions(resourceId, result = {}) {
  const regionMap = collectVisionRegions(result);

  const needed = new Set();

  visitObjects(result, (obj) => {
    if (!isPdfFocusObject(obj)) return;
    const rid = obj.regionId || obj.focusRegionId;
    if (rid) needed.add(String(rid));
  });

  const stats = {
    ok: true,
    resourceId,
    needed: needed.size,
    cropped: 0,
    attached: 0,
    missingRegions: [],
    failed: [],
    crops: [],
  };

  for (const regionId of needed) {
    const region = regionMap.get(regionId);

    if (!region) {
      stats.missingRegions.push(regionId);
      continue;
    }

    try {
      const crop = await cropOneRegion({ resourceId, region });

      if (!crop.ok) {
        stats.failed.push({ regionId, reason: crop.reason, page: crop.page });
        continue;
      }

      const attached = attachToMatchingObjects(result, regionId, crop);

      stats.cropped += 1;
      stats.attached += attached;
      stats.crops.push(crop);
    } catch (err) {
      stats.failed.push({ regionId, reason: err.message });
    }
  }

  result.cropStats = stats;
  result.metadata = {
    ...(result.metadata || {}),
    cropStats: stats,
    sourceModeDefault: "full_page_with_focus",
  };

  return stats;
}

module.exports = {
  cropLessonRegions,
  cropOneRegion,
  normalizeBbox,
  expandBbox,
  bboxToPixels,
};