"use strict";

const mongoose = require("mongoose");
const { GoogleLiveTutorResourceChunk } = require("../../../models/GoogleLiveTutorResource");

async function ensureMongo() {
  if (mongoose.connection.readyState === 1) return;
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("MONGODB_URI missing.");
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DATABASE, serverSelectionTimeoutMS: 20000 });
}

async function loadChunksByResource(resourceId, { limit = 0 } = {}) {
  await ensureMongo();
  let query = GoogleLiveTutorResourceChunk.find({ resourceId })
    .sort({ page: 1, chunkIndex: 1 });
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    query = query.limit(Number(limit));
  }
  const chunks = await query.lean();
  if (!chunks.length) {
    const err = new Error(`No chunks found for resource "${resourceId}". Run PDF extraction first.`);
    err.statusCode = 404;
    throw err;
  }
  return chunks;
}

async function loadChunksByPages(resourceId, pages = []) {
  if (!pages.length) return [];
  await ensureMongo();
  return GoogleLiveTutorResourceChunk.find({ resourceId, page: { $in: pages.map(Number) } })
    .sort({ page: 1, chunkIndex: 1 }).lean();
}

function groupByPage(chunks) {
  const map = new Map();
  for (const chunk of chunks) {
    const page = Number(chunk.page || 1);
    if (!map.has(page)) map.set(page, []);
    map.get(page).push(chunk);
  }
  return map;
}

function getPageText(chunks, pageNum) {
  return chunks
    .filter((c) => Number(c.page) === Number(pageNum))
    .sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0))
    .map((c) => c.text || c.textPreview || "")
    .join("\n\n")
    .trim();
}

function chunksToSourceRefs(chunks, resourceId) {
  return chunks
    .map((c) => ({
      chunkId:   c.chunkId || c._id?.toString() || "",
      page:      Number(c.page || 1),
      sourceRef: c.sourceRef || `${resourceId}:page:${c.page}:chunk:${c.chunkIndex || 0}`,
      quote:     (c.text || c.textPreview || "").slice(0, 400),
      confidence: c.confidence || 0.82,
      resourceId,
    }))
    .filter((r) => r.chunkId);
}

module.exports = { loadChunksByResource, loadChunksByPages, groupByPage, getPageText, chunksToSourceRefs };
