"use strict";

/**
 * hybridSearch.service.js
 * ───────────────────────
 * Hybrid semantic retrieval — POWERFUL_WORKFLOW Phase 2 Step 2.5c.
 *
 *   query → gemini-embedding-2 (768-dim)
 *         → Atlas $vectorSearch  top-15  (MEANING — finds "star schema OLAP"
 *                                          for query "denormalization")
 *         → Atlas $search        top-10  (EXACT TERMS — formula names,
 *                                          function names, codes)
 *         → Reciprocal Rank Fusion merge
 *
 * Replaces keyword counting as the source of candidate evidence.
 * Graceful: if Atlas search is unavailable (index building, local mongo),
 * returns { ok:false, chunks:[] } and the caller falls back to page-order
 * chunks — NEVER crashes the lesson.
 */

const mongoose = require("mongoose");
const { embedQueryText } = require("./chunkEmbedding.service");

const VECTOR_INDEX =
  process.env.LIVE_TUTOR_VECTOR_INDEX || "live_tutor_resource_chunks_vector_index";
const TEXT_INDEX = "live_tutor_resource_chunks_text_index";
const RRF_K = 60; // standard reciprocal-rank-fusion constant

function chunksCollection() {
  const model =
    mongoose.models.GoogleLiveTutorResourceChunk ||
    require("../../models/GoogleLiveTutorResource").GoogleLiveTutorResourceChunk;
  return model.collection;
}

async function vectorSearch(resourceId, queryVector, limit) {
  return chunksCollection()
    .aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX,
          path: "embedding",
          queryVector,
          numCandidates: Math.max(150, limit * 10),
          limit,
          filter: { resourceId },
        },
      },
      {
        $project: {
          chunkId: 1, resourceId: 1, page: 1, chunkIndex: 1,
          text: 1, textPreview: 1, sourceRef: 1, title: 1, heading: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();
}

async function fullTextSearch(resourceId, query, limit) {
  return chunksCollection()
    .aggregate([
      {
        $search: {
          index: TEXT_INDEX,
          compound: {
            must: [{ text: { query, path: ["text", "title"] } }],
            filter: [{ equals: { path: "resourceId", value: resourceId } }],
          },
        },
      },
      { $limit: limit },
      {
        $project: {
          chunkId: 1, resourceId: 1, page: 1, chunkIndex: 1,
          text: 1, textPreview: 1, sourceRef: 1, title: 1, heading: 1,
          score: { $meta: "searchScore" },
        },
      },
    ])
    .toArray();
}

/**
 * Reciprocal Rank Fusion: rank-based merge so vector scores (0-1 cosine)
 * and text scores (unbounded BM25) combine fairly.
 */
function rrfMerge(vectorHits, textHits) {
  const byId = new Map();

  function add(hits, sourceName) {
    hits.forEach((hit, rank) => {
      const id = hit.chunkId || String(hit._id);
      const entry = byId.get(id) || { ...hit, rrfScore: 0, retrievalSources: [] };
      entry.rrfScore += 1 / (RRF_K + rank + 1);
      entry.retrievalSources.push(sourceName);
      byId.set(id, entry);
    });
  }

  add(vectorHits, "vector");
  add(textHits, "fulltext");

  return [...byId.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Main entry — hybrid semantic + exact-term retrieval for a node teach.
 * Returns { ok, chunks, vectorCount, textCount, warning? }.
 */
async function hybridSearchChunks({
  resourceId,
  query,
  vectorLimit = 15,
  textLimit = 10,
}) {
  const cleanQuery = String(query || "").trim();
  if (!resourceId || !cleanQuery) {
    return { ok: false, chunks: [], vectorCount: 0, textCount: 0,
             warning: "missing resourceId or query" };
  }

  let vectorHits = [];
  let textHits = [];
  let warning = "";

  // Vector search — semantic meaning
  try {
    const queryVector = await embedQueryText(cleanQuery);
    vectorHits = await vectorSearch(resourceId, queryVector, vectorLimit);
  } catch (err) {
    warning += `vectorSearch unavailable: ${err.message.slice(0, 160)}; `;
  }

  // Full-text search — exact terms
  try {
    textHits = await fullTextSearch(resourceId, cleanQuery, textLimit);
  } catch (err) {
    warning += `fullTextSearch unavailable: ${err.message.slice(0, 160)}; `;
  }

  const merged = rrfMerge(vectorHits, textHits);

  return {
    ok: merged.length > 0,
    chunks: merged,
    vectorCount: vectorHits.length,
    textCount: textHits.length,
    warning: warning.trim() || undefined,
  };
}

module.exports = { hybridSearchChunks, rrfMerge };
