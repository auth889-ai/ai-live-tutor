"use strict";

/**
 * chunkEmbedding.service.js
 * ─────────────────────────
 * Generates 768-dim text-embedding-004 vectors for resource chunks and
 * saves them on chunk.embedding — the foundation of Atlas $vectorSearch
 * hybrid RAG (POWERFUL_WORKFLOW Phase 0.7).
 *
 * - batchEmbedContents: up to 100 texts per request
 * - embedQueryText(): single query embedding for RAG retrieval
 * - embedResourceChunks(resourceId): embeds every chunk missing a vector
 */

const { GoogleLiveTutorResourceChunk } = require("../../models/GoogleLiveTutorResource");

// Normalize legacy/wrong env names → real Gemini embedding models.
// API key was probed live (2026-06): available models are gemini-embedding-001,
// gemini-embedding-2, gemini-embedding-2-preview. text-embedding-004 is retired,
// and "gemini-embedding-004" never existed.
const _RAW_EMBED_MODEL = (
  process.env.GEMINI_EMBEDDING_MODEL ||
  process.env.LIVE_TUTOR_EMBEDDING_MODEL ||
  "gemini-embedding-2"
).replace(/^models\//, "");
const _VALID_EMBED_MODELS = new Set([
  "gemini-embedding-2",
  "gemini-embedding-2-preview",
  "gemini-embedding-001",
]);
const EMBED_MODEL = _VALID_EMBED_MODELS.has(_RAW_EMBED_MODEL)
  ? _RAW_EMBED_MODEL
  : "gemini-embedding-2";
const EMBED_DIMS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768);
const BATCH_SIZE = 100; // Gemini batchEmbedContents limit
const MAX_CHARS_PER_TEXT = 8000;

function apiKey() {
  const key =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";
  if (!key) throw new Error("GEMINI_API_KEY not set — cannot generate embeddings.");
  return key;
}

function modelPath() {
  return EMBED_MODEL.startsWith("models/") ? EMBED_MODEL : `models/${EMBED_MODEL}`;
}

async function callBatchEmbed(texts, taskType) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/${modelPath()}` +
    `:batchEmbedContents?key=${apiKey()}`;

  const requests = texts.map((text) => ({
    model: modelPath(),
    content: { parts: [{ text: text.slice(0, MAX_CHARS_PER_TEXT) }] },
    taskType,
    outputDimensionality: EMBED_DIMS,
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`batchEmbedContents failed ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const embeddings = (data.embeddings || []).map((e) => e.values || []);
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding count mismatch: sent ${texts.length}, got ${embeddings.length}`
    );
  }
  return embeddings;
}

/**
 * Embed a single retrieval query (used by hybrid RAG at teach time).
 * taskType RETRIEVAL_QUERY pairs with chunks embedded as RETRIEVAL_DOCUMENT.
 */
async function embedQueryText(query) {
  const [vector] = await callBatchEmbed([String(query || "").trim()], "RETRIEVAL_QUERY");
  if (!vector || vector.length !== EMBED_DIMS) {
    throw new Error(`Query embedding invalid: got ${vector ? vector.length : 0} dims`);
  }
  return vector;
}

/**
 * Embed all chunks of a resource that don't yet have a vector.
 * Idempotent — safe to re-run. Returns { embedded, skipped, failed }.
 */
async function embedResourceChunks(resourceId, { force = false } = {}) {
  const filter = { resourceId };
  if (!force) filter.embedding = { $exists: false };

  const chunks = await GoogleLiveTutorResourceChunk.find(filter)
    .select("chunkId text textPreview")
    .lean();

  if (!chunks.length) {
    return { ok: true, resourceId, embedded: 0, skipped: 0, failed: 0 };
  }

  let embedded = 0;
  let failed = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => (c.text || c.textPreview || "").trim() || "(empty)");

    try {
      // Per-minute quota on the embedding model: on 429 wait and retry the
      // same batch (up to 4 times) instead of dropping chunks.
      let vectors;
      for (let attempt = 0; ; attempt += 1) {
        try {
          vectors = await callBatchEmbed(texts, "RETRIEVAL_DOCUMENT");
          break;
        } catch (err) {
          if (err.message.includes("429") && attempt < 4) {
            console.log(
              `[chunkEmbedding] rate-limited — waiting 65s (attempt ${attempt + 1}/4)`
            );
            await sleep(65000);
            continue;
          }
          throw err;
        }
      }

      const ops = batch.map((chunk, j) => ({
        updateOne: {
          filter: { chunkId: chunk.chunkId },
          update: {
            $set: { embedding: vectors[j], embeddingModel: EMBED_MODEL },
          },
        },
      }));
      await GoogleLiveTutorResourceChunk.bulkWrite(ops, { ordered: false });
      embedded += batch.length;
      console.log(
        `[chunkEmbedding] ${resourceId}: embedded ${embedded}/${chunks.length}`
      );
    } catch (err) {
      failed += batch.length;
      console.error(
        `[chunkEmbedding] batch ${i / BATCH_SIZE} failed for ${resourceId}:`,
        err.message
      );
    }
  }

  return { ok: failed === 0, resourceId, embedded, skipped: 0, failed };
}

module.exports = {
  embedQueryText,
  embedResourceChunks,
  EMBED_MODEL,
  EMBED_DIMS,
};
