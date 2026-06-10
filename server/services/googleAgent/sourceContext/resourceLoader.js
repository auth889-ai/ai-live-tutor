"use strict";

const mongoose = require("mongoose");
const { GoogleLiveTutorResource } = require("../../../models/GoogleLiveTutorResource");

async function ensureMongo() {
  if (mongoose.connection.readyState === 1) return;
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("MONGODB_URI missing — cannot load resource.");
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DATABASE, serverSelectionTimeoutMS: 20000 });
}

async function loadResource({ ownerKey, resourceId }) {
  await ensureMongo();
  const resource = await GoogleLiveTutorResource.findOne({ ownerKey, resourceId }).lean();
  if (resource) return resource;

  const other = await GoogleLiveTutorResource.findOne({ resourceId })
    .select("resourceId ownerKey title status").lean();
  if (other) {
    const err = new Error(`Resource "${resourceId}" belongs to ownerKey "${other.ownerKey}", not "${ownerKey}".`);
    err.statusCode = 403;
    throw err;
  }
  const err = new Error(`Resource not found: ${resourceId}. Upload a PDF first.`);
  err.statusCode = 404;
  throw err;
}

async function loadResourceById(resourceId) {
  await ensureMongo();
  const resource = await GoogleLiveTutorResource.findOne({ resourceId }).lean();
  if (!resource) {
    const err = new Error(`Resource not found: ${resourceId}`);
    err.statusCode = 404;
    throw err;
  }
  return resource;
}

function getResourceMeta(resource) {
  const meta = resource?.metadata || {};
  return {
    resourceId:      resource.resourceId,
    ownerKey:        resource.ownerKey,
    title:           resource.title || "Untitled",
    pageCount:       resource.extraction?.pageCount || 0,
    chunkCount:      resource.extraction?.chunkCount || 0,
    fullPdfSummary:  meta.fullPdfSummary  || null,
    fullPdfOutline:  meta.fullPdfOutline  || null,
    roadmapModules:  Array.isArray(meta.roadmapModules) ? meta.roadmapModules : [],
    pageImagePaths:  Array.isArray(meta.pageImagePaths) ? meta.pageImagePaths : [],
    status:          resource.status || "unknown",
  };
}

module.exports = { loadResource, loadResourceById, getResourceMeta };
