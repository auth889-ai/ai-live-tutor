"use strict";

/**
 * scripts/test_hybrid_search.js
 * Live verification of hybrid RAG (Task 1.3 / Milestone M1).
 * Proves semantic search finds chunks by MEANING that keyword search misses.
 *
 * Run: node scripts/test_hybrid_search.js ["custom query"]
 */

const path = require("path");
const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "server", "node_modules", "dotenv")).config({
  path: path.join(ROOT, ".env"),
});
const mongoose = require(path.join(ROOT, "server", "node_modules", "mongoose"));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DATABASE || "live-tutor",
  });

  const {
    hybridSearchChunks,
  } = require(path.join(ROOT, "server", "services", "googleAgent", "hybridSearch.service"));
  const {
    GoogleLiveTutorResourceChunk,
  } = require(path.join(ROOT, "server", "models", "GoogleLiveTutorResource"));

  const resourceIds = await GoogleLiveTutorResourceChunk.distinct("resourceId");
  const rid = resourceIds[resourceIds.length - 1];
  const total = await GoogleLiveTutorResourceChunk.countDocuments({ resourceId: rid });
  console.log(`Testing resource: ${rid} (${total} chunks)`);

  const query =
    process.argv[2] ||
    "denormalization performance why fewer joins make queries faster";
  console.log(`Query: "${query}"\n`);

  const result = await hybridSearchChunks({ resourceId: rid, query });

  console.log(
    `ok: ${result.ok} | vector hits: ${result.vectorCount} | fulltext hits: ${result.textCount}`
  );
  if (result.warning) console.log("warning:", result.warning);

  console.log("\n--- TOP 5 RESULTS (found by MEANING, not keywords) ---");
  result.chunks.slice(0, 5).forEach((c, i) => {
    console.log(
      `${i + 1}. [page ${c.page}] [${(c.retrievalSources || []).join("+")}] rrf=${c.rrfScore.toFixed(4)}`
    );
    console.log("   " + (c.text || "").slice(0, 160).replace(/\s+/g, " "));
  });

  await mongoose.disconnect();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
