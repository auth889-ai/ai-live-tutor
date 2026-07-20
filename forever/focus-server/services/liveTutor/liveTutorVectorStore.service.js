import crypto from "crypto";
import mongoose from "mongoose";
import { Document } from "@langchain/core/documents";

import { embedText } from "../ollamaCompat.service.js";

const VECTOR_COLLECTION =
  process.env.LIVE_TUTOR_VECTOR_COLLECTION || "livetutor_vector_chunks";

const VECTOR_INDEX_NAME =
  process.env.LIVE_TUTOR_VECTOR_INDEX_NAME || "live_tutor_vector_index";

const VECTOR_DIMENSIONS = Number(process.env.LIVE_TUTOR_VECTOR_DIMENSIONS || 768);

const ENABLE_ATLAS_VECTOR_SEARCH =
  String(process.env.LIVE_TUTOR_ENABLE_ATLAS_VECTOR_SEARCH || "false").toLowerCase() ===
  "true";

const ENABLE_EMBEDDINGS =
  String(process.env.LIVE_TUTOR_RAG_ENABLE_EMBEDDING || "true").toLowerCase() !== "false";

const EMBED_TIMEOUT_MS = Number(process.env.LIVE_TUTOR_RAG_EMBED_TIMEOUT_MS || 90000);

const DEFAULT_CHUNK_SIZE = Number(process.env.LIVE_TUTOR_VECTOR_CHUNK_SIZE || 1200);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.LIVE_TUTOR_VECTOR_CHUNK_OVERLAP || 160);

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function longClean(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimText(value = "", max = 2000) {
  const text = longClean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hashText(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableChunkId(parts = []) {
  return hashText(parts.filter(Boolean).join("::")).slice(0, 40);
}

function tokenize(text = "") {
  return clean(text)
    .toLowerCase()
    .split(/[^a-zA-Z0-9\u0980-\u09FF]+/)
    .filter((x) => x.length > 2)
    .slice(0, 240);
}

function lexicalScore(query = "", text = "") {
  const q = tokenize(query);
  const t = String(text || "").toLowerCase();

  if (!q.length || !t) return 0;

  let hits = 0;
  let weighted = 0;

  for (const term of q) {
    if (t.includes(term)) {
      hits += 1;
      weighted += Math.min(3, Math.max(1, term.length / 6));
    }
  }

  return hits / Math.max(1, q.length) + weighted / Math.max(12, q.length * 3);
}

function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (!a.length || !b.length) return 0;

  const len = Math.min(a.length, b.length);

  let dot = 0;
  let aa = 0;
  let bb = 0;

  for (let i = 0; i < len; i += 1) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    aa += av * av;
    bb += bv * bv;
  }

  if (!aa || !bb) return 0;

  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

function getVectorChunkModel() {
  if (mongoose.models.LiveTutorVectorChunk) {
    return mongoose.models.LiveTutorVectorChunk;
  }

  const schema = new mongoose.Schema(
    {
      chunkId: { type: String, required: true, unique: true, index: true },

      userId: { type: String, default: "guest", index: true },
      deviceId: { type: String, default: "web", index: true },
      sessionKey: { type: String, default: "", index: true },

      sourceType: {
        type: String,
        enum: [
          "transcript",
          "selected_text",
          "visible_text",
          "page_text",
          "marked_element",
          "interaction",
          "board",
          "board_block",
          "weak_concept",
          "student_answer",
          "system",
        ],
        default: "system",
        index: true,
      },

      sourceId: { type: String, default: "", index: true },
      sourceUrl: { type: String, default: "", index: true },
      sourceTitle: { type: String, default: "" },

      platform: { type: String, default: "unknown", index: true },
      videoId: { type: String, default: "", index: true },
      timestampSeconds: { type: Number, default: 0, index: true },

      conceptTags: { type: [String], default: [], index: true },
      weakConcepts: { type: [String], default: [], index: true },

      text: { type: String, required: true },
      textHash: { type: String, required: true, index: true },

      embedding: { type: [Number], default: undefined },
      embeddingModel: { type: String, default: "" },
      embeddingDim: { type: Number, default: 0 },

      metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

      quality: {
        tokenCount: { type: Number, default: 0 },
        charCount: { type: Number, default: 0 },
        hasEmbedding: { type: Boolean, default: false },
      },

      expiresAt: { type: Date, default: null, index: true },
    },
    {
      timestamps: true,
      collection: VECTOR_COLLECTION,
    }
  );

  schema.index({ userId: 1, sessionKey: 1, updatedAt: -1 });
  schema.index({ userId: 1, sourceUrl: 1, updatedAt: -1 });
  schema.index({ userId: 1, videoId: 1, timestampSeconds: 1 });
  schema.index({ textHash: 1, sourceType: 1, sessionKey: 1 });
  schema.index({ conceptTags: 1, updatedAt: -1 });
  schema.index({ weakConcepts: 1, updatedAt: -1 });

  return mongoose.model("LiveTutorVectorChunk", schema);
}

function splitTextIntoChunks(text = "", options = {}) {
  const chunkSize = Number(options.chunkSize || DEFAULT_CHUNK_SIZE);
  const overlap = Number(options.chunkOverlap || DEFAULT_CHUNK_OVERLAP);

  const value = longClean(text);
  if (!value) return [];

  if (value.length <= chunkSize) return [value];

  const chunks = [];
  let start = 0;

  while (start < value.length) {
    const hardEnd = Math.min(value.length, start + chunkSize);
    let end = hardEnd;

    const newline = value.lastIndexOf("\n", hardEnd);
    const sentence = Math.max(
      value.lastIndexOf(". ", hardEnd),
      value.lastIndexOf("। ", hardEnd),
      value.lastIndexOf("? ", hardEnd),
      value.lastIndexOf("! ", hardEnd)
    );

    const boundary = Math.max(newline, sentence);

    if (boundary > start + chunkSize * 0.45) {
      end = boundary + 1;
    }

    const chunk = value.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= value.length) break;

    start = Math.max(0, end - overlap);
  }

  return chunks;
}

async function embedChunkText(text = "") {
  if (!ENABLE_EMBEDDINGS) {
    return {
      embedding: undefined,
      embeddingModel: "",
      embeddingDim: 0,
      hasEmbedding: false,
      error: "embedding disabled",
    };
  }

  try {
    const embedding = await embedText(trimText(text, 2500), {
      timeoutMs: EMBED_TIMEOUT_MS,
    });

    if (!Array.isArray(embedding) || !embedding.length) {
      return {
        embedding: undefined,
        embeddingModel: "",
        embeddingDim: 0,
        hasEmbedding: false,
        error: "empty embedding",
      };
    }

    return {
      embedding,
      embeddingModel: process.env.OLLAMA_EMBED_MODEL || process.env.OLLAMA_EMBEDDING_MODEL || "",
      embeddingDim: embedding.length,
      hasEmbedding: true,
      error: "",
    };
  } catch (error) {
    return {
      embedding: undefined,
      embeddingModel: "",
      embeddingDim: 0,
      hasEmbedding: false,
      error: error?.message || "embedding failed",
    };
  }
}

function normalizeTags(tags = []) {
  return [...new Set(safeArray(tags).map((x) => clean(x).toLowerCase()).filter(Boolean))].slice(
    0,
    40
  );
}

function toLangChainDocument(chunk = {}, score = 0) {
  return new Document({
    pageContent: chunk.text || "",
    metadata: {
      chunkId: chunk.chunkId,
      sourceType: chunk.sourceType,
      sourceId: chunk.sourceId,
      sourceUrl: chunk.sourceUrl,
      sourceTitle: chunk.sourceTitle,
      platform: chunk.platform,
      videoId: chunk.videoId,
      timestampSeconds: chunk.timestampSeconds,
      conceptTags: chunk.conceptTags || [],
      weakConcepts: chunk.weakConcepts || [],
      score,
      createdAt: chunk.createdAt,
      updatedAt: chunk.updatedAt,
      ...(chunk.metadata || {}),
    },
  });
}

export async function indexLiveTutorText({
  userId = "guest",
  deviceId = "web",
  sessionKey = "",
  sourceType = "system",
  sourceId = "",
  sourceUrl = "",
  sourceTitle = "",
  platform = "unknown",
  videoId = "",
  timestampSeconds = 0,
  conceptTags = [],
  weakConcepts = [],
  text = "",
  metadata = {},
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
  expiresAt = null,
} = {}) {
  const VectorChunk = getVectorChunkModel();
  const normalizedText = longClean(text);

  if (!normalizedText) {
    return {
      ok: true,
      indexed: 0,
      skipped: true,
      reason: "empty text",
      chunks: [],
    };
  }

  const chunks = splitTextIntoChunks(normalizedText, { chunkSize, chunkOverlap });
  const indexed = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkText = chunks[index];
    const textHash = hashText(chunkText);

    const chunkId = stableChunkId([
      userId,
      sessionKey,
      sourceType,
      sourceId,
      sourceUrl,
      videoId,
      timestampSeconds,
      index,
      textHash,
    ]);

    const embeddingInfo = await embedChunkText(chunkText);

    const doc = {
      chunkId,

      userId: clean(userId) || "guest",
      deviceId: clean(deviceId) || "web",
      sessionKey: clean(sessionKey),

      sourceType,
      sourceId: clean(sourceId),
      sourceUrl: clean(sourceUrl),
      sourceTitle: clean(sourceTitle),

      platform: clean(platform) || "unknown",
      videoId: clean(videoId),
      timestampSeconds: safeNumber(timestampSeconds),

      conceptTags: normalizeTags(conceptTags),
      weakConcepts: normalizeTags(weakConcepts),

      text: chunkText,
      textHash,

      embedding: embeddingInfo.embedding,
      embeddingModel: embeddingInfo.embeddingModel,
      embeddingDim: embeddingInfo.embeddingDim,

      metadata: {
        ...metadata,
        chunkIndex: index,
        chunkCount: chunks.length,
        embeddingError: embeddingInfo.error || "",
      },

      quality: {
        tokenCount: tokenize(chunkText).length,
        charCount: chunkText.length,
        hasEmbedding: embeddingInfo.hasEmbedding,
      },

      expiresAt,
    };

    await VectorChunk.updateOne(
      { chunkId },
      {
        $set: doc,
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    indexed.push({
      chunkId,
      sourceType,
      textHash,
      hasEmbedding: embeddingInfo.hasEmbedding,
      charCount: chunkText.length,
    });
  }

  return {
    ok: true,
    indexed: indexed.length,
    chunks: indexed,
  };
}

export async function indexLiveTutorDocuments({
  documents = [],
  common = {},
} = {}) {
  const results = [];

  for (const doc of safeArray(documents)) {
    const result = await indexLiveTutorText({
      ...common,
      ...doc,
      metadata: {
        ...(common.metadata || {}),
        ...(doc.metadata || {}),
      },
    });

    results.push(result);
  }

  return {
    ok: true,
    indexed: results.reduce((sum, item) => sum + safeNumber(item.indexed), 0),
    results,
  };
}

async function searchAtlasVector({
  queryEmbedding,
  filter = {},
  limit = 8,
  numCandidates = 120,
} = {}) {
  if (!ENABLE_ATLAS_VECTOR_SEARCH || !Array.isArray(queryEmbedding) || !queryEmbedding.length) {
    return [];
  }

  const VectorChunk = getVectorChunkModel();

  try {
    const pipeline = [
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates,
          limit,
          filter,
        },
      },
      {
        $addFields: {
          vectorScore: { $meta: "vectorSearchScore" },
        },
      },
      {
        $project: {
          chunkId: 1,
          userId: 1,
          deviceId: 1,
          sessionKey: 1,
          sourceType: 1,
          sourceId: 1,
          sourceUrl: 1,
          sourceTitle: 1,
          platform: 1,
          videoId: 1,
          timestampSeconds: 1,
          conceptTags: 1,
          weakConcepts: 1,
          text: 1,
          metadata: 1,
          quality: 1,
          createdAt: 1,
          updatedAt: 1,
          vectorScore: 1,
        },
      },
    ];

    return VectorChunk.aggregate(pipeline);
  } catch {
    return [];
  }
}

function buildMongoFilter({
  userId = "guest",
  sessionKey = "",
  sourceUrl = "",
  videoId = "",
  platform = "",
  conceptTags = [],
  includeGlobal = true,
} = {}) {
  const or = [];

  if (sessionKey) or.push({ sessionKey });
  if (sourceUrl) or.push({ sourceUrl });
  if (videoId) or.push({ videoId });
  if (userId) or.push({ userId });
  if (includeGlobal) or.push({ userId: "global" });

  const filter = {};
  if (or.length) filter.$or = or;

  if (platform) filter.platform = { $in: [platform, "unknown", ""] };

  const tags = normalizeTags(conceptTags);
  if (tags.length) {
    filter.$or = [
      ...(filter.$or || []),
      { conceptTags: { $in: tags } },
      { weakConcepts: { $in: tags } },
    ];
  }

  return filter;
}

export async function searchLiveTutorVectorStore({
  query = "",
  userId = "guest",
  sessionKey = "",
  sourceUrl = "",
  videoId = "",
  platform = "",
  conceptTags = [],
  limit = 8,
  includeGlobal = true,
} = {}) {
  const VectorChunk = getVectorChunkModel();

  const cleanedQuery = trimText(query, 3500);
  const finalLimit = Math.max(1, Math.min(30, safeNumber(limit, 8)));

  if (!cleanedQuery) {
    return {
      ok: true,
      count: 0,
      documents: [],
      chunks: [],
      mode: "empty_query",
    };
  }

  const queryEmbedding = ENABLE_EMBEDDINGS
    ? (await embedChunkText(cleanedQuery)).embedding
    : undefined;

  const filter = buildMongoFilter({
    userId,
    sessionKey,
    sourceUrl,
    videoId,
    platform,
    conceptTags,
    includeGlobal,
  });

  const atlasHits = await searchAtlasVector({
    queryEmbedding,
    filter,
    limit: finalLimit,
    numCandidates: Math.max(80, finalLimit * 16),
  });

  if (atlasHits.length) {
    const chunks = atlasHits.map((chunk) => ({
      ...chunk,
      score: safeNumber(chunk.vectorScore),
      lexicalScore: lexicalScore(cleanedQuery, chunk.text),
      vectorScore: safeNumber(chunk.vectorScore),
      retrievalMode: "atlas_vector",
    }));

    return {
      ok: true,
      count: chunks.length,
      chunks,
      documents: chunks.map((chunk) => toLangChainDocument(chunk, chunk.score)),
      mode: "atlas_vector",
    };
  }

  const pool = await VectorChunk.find(filter)
    .sort({ updatedAt: -1 })
    .limit(Math.max(80, finalLimit * 18))
    .lean();

  const scored = pool
    .map((chunk) => {
      const lex = lexicalScore(cleanedQuery, chunk.text);
      const vec =
        queryEmbedding && Array.isArray(chunk.embedding)
          ? cosineSimilarity(queryEmbedding, chunk.embedding)
          : 0;

      const sameSession = sessionKey && chunk.sessionKey === sessionKey ? 0.18 : 0;
      const sameVideo = videoId && chunk.videoId === videoId ? 0.12 : 0;
      const sameUrl = sourceUrl && chunk.sourceUrl === sourceUrl ? 0.1 : 0;
      const tagBoost =
        normalizeTags(conceptTags).some(
          (tag) => safeArray(chunk.conceptTags).includes(tag) || safeArray(chunk.weakConcepts).includes(tag)
        )
          ? 0.08
          : 0;

      const score = lex * 0.55 + vec * 0.35 + sameSession + sameVideo + sameUrl + tagBoost;

      return {
        ...chunk,
        score,
        lexicalScore: lex,
        vectorScore: vec,
        retrievalMode: queryEmbedding ? "hybrid_embedding_lexical" : "lexical_only",
      };
    })
    .filter((chunk) => chunk.score > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, finalLimit);

  return {
    ok: true,
    count: scored.length,
    chunks: scored,
    documents: scored.map((chunk) => toLangChainDocument(chunk, chunk.score)),
    mode: queryEmbedding ? "hybrid_embedding_lexical" : "lexical_only",
  };
}

export async function deleteLiveTutorVectorChunks(filter = {}) {
  const VectorChunk = getVectorChunkModel();

  const safeFilter = {};

  if (filter.userId) safeFilter.userId = clean(filter.userId);
  if (filter.sessionKey) safeFilter.sessionKey = clean(filter.sessionKey);
  if (filter.sourceUrl) safeFilter.sourceUrl = clean(filter.sourceUrl);
  if (filter.videoId) safeFilter.videoId = clean(filter.videoId);
  if (filter.sourceId) safeFilter.sourceId = clean(filter.sourceId);

  if (!Object.keys(safeFilter).length) {
    return {
      ok: false,
      deletedCount: 0,
      message: "Refusing to delete without a safe filter.",
    };
  }

  const result = await VectorChunk.deleteMany(safeFilter);

  return {
    ok: true,
    deletedCount: result.deletedCount || 0,
  };
}

export function getLiveTutorVectorStoreHealth() {
  return {
    ok: true,
    service: "live-tutor-vector-store",
    collection: VECTOR_COLLECTION,
    atlasVectorSearchEnabled: ENABLE_ATLAS_VECTOR_SEARCH,
    vectorIndexName: VECTOR_INDEX_NAME,
    expectedDimensions: VECTOR_DIMENSIONS,
    embeddingsEnabled: ENABLE_EMBEDDINGS,
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    features: {
      langchainDocuments: true,
      ollamaEmbeddings: true,
      lexicalFallback: true,
      hybridSearch: true,
      atlasVectorSearchOptional: true,
      dynamicTranscriptPageBoardMemory: true,
    },
  };
}

export default {
  indexLiveTutorText,
  indexLiveTutorDocuments,
  searchLiveTutorVectorStore,
  deleteLiveTutorVectorChunks,
  getLiveTutorVectorStoreHealth,
};