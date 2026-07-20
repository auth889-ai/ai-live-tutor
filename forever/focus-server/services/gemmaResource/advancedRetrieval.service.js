// server/services/gemmaResource/advancedRetrieval.service.js

import axios from "axios";
import GemmaResourceChunk from "../../models/GemmaResourceChunk.js";

function clean(value = "") {
  return String(value || "").trim();
}

function cleanSpace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolEnv(name, fallback = false) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function getOllamaBaseUrl() {
  const raw =
    clean(process.env.GEMMA_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OFFLINE_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OLLAMA_LOCAL_URL) ||
    "http://localhost:11434";

  return raw.replace(/\/api\/generate\/?$/i, "").replace(/\/+$/, "");
}

function getEmbeddingModel() {
  return (
    clean(process.env.GEMMA_RESOURCE_EMBED_MODEL) ||
    clean(process.env.OFFLINE_RESOURCE_EMBED_MODEL) ||
    clean(process.env.OLLAMA_EMBED_MODEL) ||
    "nomic-embed-text"
  );
}

const UNIVERSAL_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "for",
  "with",
  "from",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "into",
  "about",
  "what",
  "why",
  "how",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "can",
  "could",
  "should",
  "would",
  "will",
  "may",
  "might",
  "must",
  "do",
  "does",
  "did",
  "done",
  "have",
  "has",
  "had",
  "having",
  "you",
  "your",
  "me",
  "my",
  "we",
  "our",
  "they",
  "their",
  "he",
  "she",
  "his",
  "her",
  "i",
  "please",
  "explain",
  "tell",
  "make",
  "give",
  "show",
  "easy",
  "easily",
  "simple",
  "simply",
  "understand",
  "learn",
  "study",
  "thing",
  "topic",
  "concept",
  "ami",
  "amar",
  "amake",
  "eta",
  "eita",
  "ki",
  "keno",
  "kivabe",
  "bujhi",
  "bujhini",
  "bujhte",
  "chai",
  "theke",
]);

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tokenizeUniversal(text = "") {
  const raw = cleanSpace(text).toLowerCase();

  const tokens = raw
    .split(/[^a-z0-9\u0980-\u09FF+#._-]+/i)
    .map((word) => clean(word))
    .filter((word) => {
      if (!word) return false;
      if (word.length < 2) return false;
      if (UNIVERSAL_STOP_WORDS.has(word)) return false;
      return true;
    });

  return [...new Set(tokens)];
}

function ngrams(tokens = [], n = 2, max = 40) {
  const out = [];

  for (let i = 0; i <= tokens.length - n; i += 1) {
    out.push(tokens.slice(i, i + n).join(" "));
    if (out.length >= max) break;
  }

  return out;
}

function timestampToSeconds(value = "") {
  const parts = clean(value)
    .split(":")
    .map((part) => Number(part));

  if (parts.some((part) => !Number.isFinite(part))) return 0;

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];

  return parts[0] || 0;
}

function extractTimestampIntent(question = "") {
  const raw = clean(question);

  const rangeMatch = raw.match(
    /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|to|–|theke|থেকে)\s*(\d{1,2}:\d{2}(?::\d{2})?)/i
  );

  if (rangeMatch) {
    const a = timestampToSeconds(rangeMatch[1]);
    const b = timestampToSeconds(rangeMatch[2]);

    return {
      hasTimestamp: true,
      start: Math.min(a, b),
      end: Math.max(a, b),
      raw: rangeMatch[0],
    };
  }

  const singleMatch = raw.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);

  if (singleMatch) {
    const focus = timestampToSeconds(singleMatch[1]);

    return {
      hasTimestamp: true,
      start: Math.max(0, focus - 120),
      end: focus + 240,
      raw: singleMatch[1],
    };
  }

  return {
    hasTimestamp: false,
    start: null,
    end: null,
    raw: "",
  };
}

function extractPageIntent(question = "") {
  const raw = clean(question).toLowerCase();

  const range = raw.match(/page\s*(\d+)\s*(?:-|to|–|theke|থেকে)\s*(\d+)/i);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);

    return {
      hasPage: true,
      start: Math.min(a, b),
      end: Math.max(a, b),
      raw: range[0],
    };
  }

  const single = raw.match(/page\s*(\d+)/i);
  if (single) {
    const p = Number(single[1]);

    return {
      hasPage: true,
      start: p,
      end: p,
      raw: single[0],
    };
  }

  return {
    hasPage: false,
    start: null,
    end: null,
    raw: "",
  };
}

function extractLineIntent(question = "") {
  const raw = clean(question).toLowerCase();

  const range = raw.match(/line\s*(\d+)\s*(?:-|to|–|theke|থেকে)\s*(\d+)/i);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);

    return {
      hasLine: true,
      start: Math.min(a, b),
      end: Math.max(a, b),
      raw: range[0],
    };
  }

  const single = raw.match(/line\s*(\d+)/i);
  if (single) {
    const line = Number(single[1]);

    return {
      hasLine: true,
      start: line,
      end: line,
      raw: single[0],
    };
  }

  return {
    hasLine: false,
    start: null,
    end: null,
    raw: "",
  };
}

function extractQuotedPhrases(question = "") {
  const raw = clean(question);
  const quoted = [...raw.matchAll(/"([^"]+)"/g)].map((m) => clean(m[1]));
  return [...new Set(quoted.filter(Boolean))];
}

function chunkSearchText(chunk = {}) {
  return cleanSpace(
    [
      chunk.title,
      chunk.sourceRef,
      chunk.text,
      chunk.textPreview,
      Array.isArray(chunk.keywords) ? chunk.keywords.join(" ") : "",
      Array.isArray(chunk.concepts) ? chunk.concepts.join(" ") : "",
      chunk.metadata ? JSON.stringify(chunk.metadata).slice(0, 1000) : "",
    ].join(" ")
  ).toLowerCase();
}

function computeDocumentStats(chunks = []) {
  const docTokens = new Map();
  const docFreq = new Map();

  let totalLength = 0;

  for (const chunk of chunks) {
    const tokens = tokenizeUniversal(chunkSearchText(chunk));
    const id = String(chunk._id);

    docTokens.set(id, tokens);
    totalLength += tokens.length;

    const unique = new Set(tokens);
    for (const token of unique) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  return {
    totalDocs: chunks.length || 1,
    avgLength: chunks.length ? totalLength / chunks.length : 1,
    docTokens,
    docFreq,
  };
}

function bm25Score({ chunk, queryTokens, stats }) {
  const id = String(chunk._id);
  const tokens = stats.docTokens.get(id) || [];
  const length = tokens.length || 1;

  const freq = new Map();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  const k1 = 1.35;
  const b = 0.72;

  let score = 0;

  for (const token of queryTokens) {
    const tf = freq.get(token) || 0;
    if (!tf) continue;

    const df = stats.docFreq.get(token) || 0;
    const idf = Math.log(1 + (stats.totalDocs - df + 0.5) / (df + 0.5));

    const numerator = tf * (k1 + 1);
    const denominator =
      tf + k1 * (1 - b + b * (length / Math.max(1, stats.avgLength)));

    score += idf * (numerator / denominator);
  }

  return score * 5;
}

function phraseScore(chunk, phrases = []) {
  const text = chunkSearchText(chunk);
  let score = 0;

  for (const phrase of phrases) {
    const p = clean(phrase).toLowerCase();
    if (!p) continue;

    if (text.includes(p)) score += 12;
  }

  return score;
}

function sourceFocusScore(chunk, focus) {
  let score = 0;

  if (focus.timestamp.hasTimestamp) {
    const chunkStart = Number(chunk.startSeconds);
    const chunkEnd = Number(chunk.endSeconds);

    if (Number.isFinite(chunkStart) && Number.isFinite(chunkEnd)) {
      const qStart = Number(focus.timestamp.start);
      const qEnd = Number(focus.timestamp.end);

      if (!(chunkEnd < qStart || chunkStart > qEnd)) {
        const overlap = Math.max(
          0,
          Math.min(chunkEnd, qEnd) - Math.max(chunkStart, qStart)
        );
        const chunkLen = Math.max(1, chunkEnd - chunkStart);

        score += 35 + Math.min(25, (overlap / chunkLen) * 25);
      }
    }
  }

  if (focus.page.hasPage) {
    const pageStart = Number(chunk.pageStart || chunk.pageNumber);
    const pageEnd = Number(chunk.pageEnd || chunk.pageNumber);

    if (Number.isFinite(pageStart) && Number.isFinite(pageEnd)) {
      if (!(pageEnd < focus.page.start || pageStart > focus.page.end)) {
        score += 32;
      }
    }
  }

  if (focus.line.hasLine) {
    const lineStart = Number(chunk.lineStart);
    const lineEnd = Number(chunk.lineEnd);

    if (Number.isFinite(lineStart) && Number.isFinite(lineEnd)) {
      if (!(lineEnd < focus.line.start || lineStart > focus.line.end)) {
        score += 32;
      }
    }
  }

  return score;
}

function metadataScore(chunk, queryTokens = []) {
  const keywordText = cleanSpace(
    [
      Array.isArray(chunk.keywords) ? chunk.keywords.join(" ") : "",
      Array.isArray(chunk.concepts) ? chunk.concepts.join(" ") : "",
      chunk.title || "",
      chunk.sourceRef || "",
    ].join(" ")
  ).toLowerCase();

  let score = 0;

  for (const token of queryTokens) {
    if (!token) continue;
    if (keywordText.includes(token)) score += 3.5;
  }

  return score;
}

function structureScore(chunk) {
  let score = 0;

  if (chunk.sourceRef) score += 0.5;
  if (chunk.text && chunk.text.length >= 250) score += 0.5;
  if (chunk.text && chunk.text.length >= 700) score += 0.5;

  return score;
}

function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (!a.length || !b.length || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i] || 0);
    const y = Number(b[i] || 0);

    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (!normA || !normB) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embedQuestion(text = "") {
  const response = await axios.post(
    `${getOllamaBaseUrl()}/api/embeddings`,
    {
      model: getEmbeddingModel(),
      prompt: clean(text),
    },
    {
      timeout: numberEnv("GEMMA_RESOURCE_EMBED_TIMEOUT_MS", 45000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );

  const embedding = response.data?.embedding;

  if (!Array.isArray(embedding) || !embedding.length) {
    throw new Error("Embedding model returned no vector.");
  }

  return {
    model: getEmbeddingModel(),
    embedding,
  };
}

function vectorScore(chunk, questionEmbedding = []) {
  if (!questionEmbedding.length) return 0;
  if (!Array.isArray(chunk.embedding) || !chunk.embedding.length) return 0;

  return Math.max(0, cosineSimilarity(questionEmbedding, chunk.embedding)) * 14;
}

function lexicalSimilarity(a, b) {
  const aTokens = new Set(tokenizeUniversal(chunkSearchText(a)));
  const bTokens = new Set(tokenizeUniversal(chunkSearchText(b)));

  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.sqrt(aTokens.size * bTokens.size);
}

function mmrSelect(candidates = [], limit = 8, lambda = 0.76) {
  const selected = [];
  const remaining = [...candidates];

  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];

      const relevance = Number(candidate._ragScore || 0);
      const redundancy = selected.length
        ? Math.max(...selected.map((item) => lexicalSimilarity(candidate, item)))
        : 0;

      const score = lambda * relevance - (1 - lambda) * redundancy * 10;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}

function addNeighborChunks(allChunks = [], selected = [], neighborWindow = 1) {
  const byIndex = new Map();

  for (const chunk of allChunks) {
    byIndex.set(Number(chunk.index), chunk);
  }

  const out = new Map();

  for (const chunk of selected) {
    out.set(String(chunk._id), chunk);

    const index = Number(chunk.index);

    for (let offset = -neighborWindow; offset <= neighborWindow; offset += 1) {
      const near = byIndex.get(index + offset);
      if (near) out.set(String(near._id), near);
    }
  }

  return [...out.values()].sort((a, b) => Number(a.index) - Number(b.index));
}

function inferQuestionIntent(question = "") {
  const q = clean(question).toLowerCase();

  const wantsBoard =
    /\b(board|whiteboard|diagram|draw|visual|table|map|flow)\b/i.test(q);

  const wantsDryRun =
    /\b(dry\s*run|trace|step\s*by\s*step|line\s*by\s*line|call\s*stack)\b/i.test(
      q
    );

  const wantsQuiz = /\b(quiz|test me|mcq|practice|question)\b/i.test(q);

  const wantsSimple =
    /\b(simple|easy|beginner|slowly|confused|confusing|don't understand|dont understand|bujhini|bujhi na)\b/i.test(
      q
    );

  const wantsSummary = /\b(summary|summarize|short note|revision)\b/i.test(q);

  return {
    wantsBoard,
    wantsDryRun,
    wantsQuiz,
    wantsSimple,
    wantsSummary,
  };
}

export async function retrieveRelevantChunksAdvanced({
  resourceId,
  question,
  resource = null,
  requestedMode = "",
  requestedLanguage = "",
  limit = 8,
  candidateLimit = 40,
  includeNeighbors = true,
} = {}) {
  const timestampIntent = extractTimestampIntent(question);
  const pageIntent = extractPageIntent(question);
  const lineIntent = extractLineIntent(question);
  const quotedPhrases = extractQuotedPhrases(question);
  const baseTokens = tokenizeUniversal(question);
  const bigrams = ngrams(baseTokens, 2, 30);
  const trigrams = ngrams(baseTokens, 3, 20);
  const allQueryTokens = [...new Set([...baseTokens])];

  const phrases = [...new Set([...quotedPhrases, ...bigrams, ...trigrams])];

  const focus = {
    timestamp: timestampIntent,
    page: pageIntent,
    line: lineIntent,
  };

  const maxChunksToLoad = numberEnv("GEMMA_RESOURCE_RETRIEVAL_MAX_CHUNKS", 1200);
  const useEmbeddings = boolEnv("GEMMA_RESOURCE_USE_EMBEDDINGS", false);

  const docs = await GemmaResourceChunk.find({ resourceId })
    .sort({ index: 1 })
    .limit(maxChunksToLoad)
    .lean();

  if (!docs.length) {
    return {
      chunks: [],
      candidates: [],
      analysis: {
        planner: "universal-no-fixed-domain",
        question,
        requestedMode,
        requestedLanguage,
        resourceType: resource?.sourceType || "",
        intent: inferQuestionIntent(question),
      },
      diagnostics: {
        totalChunks: 0,
        selectedChunks: 0,
        candidateChunks: 0,
        retrievalMode: "empty",
        usedEmbeddings: false,
        embeddingError: "",
      },
    };
  }

  const stats = computeDocumentStats(docs);

  let questionEmbedding = [];
  let embeddingError = "";
  let embeddingModel = "";

  if (useEmbeddings) {
    try {
      const embedded = await embedQuestion(question);
      questionEmbedding = embedded.embedding;
      embeddingModel = embedded.model;
    } catch (error) {
      embeddingError = error.message || String(error);
    }
  }

  const scored = docs.map((chunk) => {
    const bm25 = bm25Score({
      chunk,
      queryTokens: allQueryTokens,
      stats,
    });

    const phrase = phraseScore(chunk, phrases);
    const source = sourceFocusScore(chunk, focus);
    const meta = metadataScore(chunk, allQueryTokens);
    const vector = vectorScore(chunk, questionEmbedding);
    const structure = structureScore(chunk);

    const finalScore = bm25 + phrase + source + meta + vector + structure;

    return {
      ...chunk,
      _bm25Score: Number(bm25.toFixed(3)),
      _phraseScore: Number(phrase.toFixed(3)),
      _sourceScore: Number(source.toFixed(3)),
      _metadataScore: Number(meta.toFixed(3)),
      _vectorScore: Number(vector.toFixed(3)),
      _structureScore: Number(structure.toFixed(3)),
      _ragScore: Number(finalScore.toFixed(3)),
    };
  });

  const ranked = scored.sort((a, b) => {
    if (b._ragScore !== a._ragScore) return b._ragScore - a._ragScore;
    return Number(a.index) - Number(b.index);
  });

  const positive = ranked.filter((chunk) => chunk._ragScore > 0);

  const candidates = (positive.length ? positive : ranked).slice(
    0,
    Math.max(candidateLimit, limit)
  );

  const selected = mmrSelect(candidates, Math.max(limit, 8), 0.76);

  const finalChunks = includeNeighbors
    ? addNeighborChunks(scored, selected, 1).slice(0, Math.max(limit + 4, 10))
    : selected;

  return {
    chunks: finalChunks,
    candidates,
    analysis: {
      planner: "universal-no-fixed-domain",
      question,
      requestedMode,
      requestedLanguage,
      resourceType: resource?.sourceType || "",
      intent: inferQuestionIntent(question),
      query: {
        tokens: baseTokens,
        phrases,
        timestampIntent,
        pageIntent,
        lineIntent,
      },
    },
    diagnostics: {
      totalChunks: docs.length,
      selectedChunks: finalChunks.length,
      candidateChunks: candidates.length,
      retrievalMode:
        useEmbeddings && questionEmbedding.length
          ? "universal-bm25-phrase-source-mmr-stored-vector"
          : "universal-bm25-phrase-source-mmr",
      usedEmbeddings: Boolean(useEmbeddings && questionEmbedding.length),
      embeddingModel,
      embeddingError,
      queryTokens: baseTokens,
      phrases,
      focus,
    },
  };
}