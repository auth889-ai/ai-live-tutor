"use strict";

/**
 * scripts/setup_vector_search.js
 * ──────────────────────────────
 * One-time setup + idempotent maintenance for hybrid RAG:
 *   1. Backfills text-embedding-004 vectors on every chunk missing one
 *   2. Creates the Atlas Vector Search index (768-dim cosine)
 *   3. Creates the Atlas Full-Text Search index
 *
 * Run:  node scripts/setup_vector_search.js
 * Safe to re-run anytime.
 */

// Use the SAME mongoose instance the server models use — a second instance
// would leave models buffering forever on an unconnected connection.
const path = require("path");
require(path.join(__dirname, "..", "server", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", ".env"),
});
const mongoose = require(path.join(__dirname, "..", "server", "node_modules", "mongoose"));

const VECTOR_INDEX =
  process.env.LIVE_TUTOR_VECTOR_INDEX || "live_tutor_resource_chunks_vector_index";
const TEXT_INDEX = "live_tutor_resource_chunks_text_index";
const DIMS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768);

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("MONGODB_URI missing");
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DATABASE || "live-tutor",
  });
  console.log("Connected to MongoDB");

  const {
    GoogleLiveTutorResourceChunk,
  } = require("../server/models/GoogleLiveTutorResource");
  const { embedResourceChunks } = require("../server/services/googleAgent/chunkEmbedding.service");

  // ── 1. Backfill embeddings per resource ──────────────────────────────────
  const resourceIds = await GoogleLiveTutorResourceChunk.distinct("resourceId");
  console.log(`Found ${resourceIds.length} resources`);

  let totalEmbedded = 0;
  for (const resourceId of resourceIds) {
    const result = await embedResourceChunks(resourceId);
    totalEmbedded += result.embedded;
    if (result.failed > 0) {
      console.error(`  ${resourceId}: ${result.failed} chunks FAILED`);
    }
  }
  console.log(`Backfill done — ${totalEmbedded} chunks newly embedded`);

  const withVec = await GoogleLiveTutorResourceChunk.countDocuments({
    embedding: { $exists: true },
  });
  const total = await GoogleLiveTutorResourceChunk.countDocuments({});
  console.log(`Coverage: ${withVec}/${total} chunks have embeddings`);

  // ── 2. Atlas search indexes ───────────────────────────────────────────────
  const collection = GoogleLiveTutorResourceChunk.collection;

  let existing = [];
  try {
    existing = await collection.listSearchIndexes().toArray();
  } catch (err) {
    console.error(
      "\nCannot list search indexes — cluster may not support programmatic " +
        `search index management: ${err.message}\n` +
        "MANUAL FALLBACK — create in Atlas dashboard → Search:\n" +
        `  1. Vector index "${VECTOR_INDEX}" on this collection:\n` +
        `     { "fields": [{ "type": "vector", "path": "embedding", ` +
        `"numDimensions": ${DIMS}, "similarity": "cosine" }] }\n` +
        `  2. Search index "${TEXT_INDEX}" with dynamic mappings on "text"`
    );
    await mongoose.disconnect();
    process.exit(2);
  }
  const names = existing.map((i) => i.name);
  console.log("Existing search indexes:", names.length ? names.join(", ") : "(none)");

  if (!names.includes(VECTOR_INDEX)) {
    await collection.createSearchIndex({
      name: VECTOR_INDEX,
      type: "vectorSearch",
      definition: {
        fields: [
          { type: "vector", path: "embedding", numDimensions: DIMS, similarity: "cosine" },
          { type: "filter", path: "resourceId" },
          { type: "filter", path: "page" },
        ],
      },
    });
    console.log(`Created vector index: ${VECTOR_INDEX}`);
  } else {
    console.log(`Vector index already exists: ${VECTOR_INDEX}`);
  }

  if (!names.includes(TEXT_INDEX)) {
    await collection.createSearchIndex({
      name: TEXT_INDEX,
      type: "search",
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            text: { type: "string" },
            title: { type: "string" },
            resourceId: { type: "token" },
          },
        },
      },
    });
    console.log(`Created full-text index: ${TEXT_INDEX}`);
  } else {
    console.log(`Full-text index already exists: ${TEXT_INDEX}`);
  }

  console.log("\nNote: Atlas indexes take 1-2 minutes to become queryable after creation.");
  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
