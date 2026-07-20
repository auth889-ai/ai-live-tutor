// server/services/gemmaResource/chunker.service.js

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

const DEFAULT_CHUNK_CHARS = numberEnv("GEMMA_RESOURCE_CHUNK_CHARS", 4200);
const DEFAULT_CHUNK_OVERLAP = numberEnv("GEMMA_RESOURCE_CHUNK_OVERLAP", 450);
const DEFAULT_MAX_CHUNKS = numberEnv("GEMMA_RESOURCE_MAX_CHUNKS", 180);

export function estimateTokens(text = "") {
  return Math.ceil(String(text || "").length / 4);
}

export function secondsToTimestamp(value = 0) {
  const total = Math.max(0, Number(value || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return `${m}:${String(s).padStart(2, "0")}`;
}

export function timestampToSeconds(value = "") {
  const raw = clean(value);
  if (!raw) return 0;

  const parts = raw.split(":").map((part) => Number(part));

  if (parts.some((part) => !Number.isFinite(part))) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts[0] || 0;
}

function makePreview(text = "", max = 280) {
  const value = cleanSpace(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max).trim()}...`;
}

function extractKeywords(text = "", max = 30) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "what",
    "when",
    "where",
    "which",
    "their",
    "there",
    "then",
    "than",
    "have",
    "has",
    "had",
    "will",
    "would",
    "could",
    "should",
    "into",
    "about",
    "your",
    "you",
    "are",
    "was",
    "were",
    "can",
    "also",
    "because",
  ]);

  const words = cleanSpace(text)
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/i)
    .filter((word) => word.length >= 3 && !stop.has(word));

  const counts = new Map();

  for (const word of words) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, max);
}

function makeChunkId(index) {
  return `chunk_${index + 1}`;
}

function buildBaseChunk({
  index,
  sourceType,
  text,
  title = "",
  timestampStart = "",
  timestampEnd = "",
  startSeconds = null,
  endSeconds = null,
  pageNumber = null,
  pageStart = null,
  pageEnd = null,
  lineStart = null,
  lineEnd = null,
  metadata = {},
}) {
  const cleanText = clean(text);

  let sourceRef = `Chunk ${index + 1}`;

  if (timestampStart || timestampEnd) {
    sourceRef =
      timestampStart && timestampEnd
        ? `${timestampStart}–${timestampEnd}`
        : timestampStart || timestampEnd;
  } else if (pageNumber) {
    sourceRef = `Page ${pageNumber}`;
  } else if (pageStart && pageEnd && pageStart !== pageEnd) {
    sourceRef = `Pages ${pageStart}–${pageEnd}`;
  } else if (pageStart) {
    sourceRef = `Page ${pageStart}`;
  } else if (lineStart && lineEnd) {
    sourceRef = `Lines ${lineStart}–${lineEnd}`;
  }

  return {
    chunkId: makeChunkId(index),
    index,
    sourceType,
    title,
    text: cleanText,
    textPreview: makePreview(cleanText),
    textChars: cleanText.length,
    tokenCountEstimate: estimateTokens(cleanText),
    timestampStart,
    timestampEnd,
    startSeconds,
    endSeconds,
    pageNumber,
    pageStart,
    pageEnd,
    lineStart,
    lineEnd,
    keywords: extractKeywords(cleanText),
    concepts: [],
    sourceRef,
    metadata,
  };
}

async function splitWithLangChain(text = "", options = {}) {
  try {
    const mod = await import("@langchain/textsplitters");
    const RecursiveCharacterTextSplitter = mod.RecursiveCharacterTextSplitter;

    if (!RecursiveCharacterTextSplitter) {
      throw new Error("RecursiveCharacterTextSplitter not available.");
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: options.chunkSize || DEFAULT_CHUNK_CHARS,
      chunkOverlap: options.chunkOverlap || DEFAULT_CHUNK_OVERLAP,
      separators: [
        "\n\n## ",
        "\n\n# ",
        "\n\n",
        "\n",
        ". ",
        "? ",
        "! ",
        " ",
        "",
      ],
    });

    const docs = await splitter.createDocuments([String(text || "")]);

    return docs.map((doc) => doc.pageContent).filter((part) => clean(part));
  } catch {
    return fallbackSplitText(text, options);
  }
}

function fallbackSplitText(text = "", options = {}) {
  const source = clean(text);
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_CHARS;
  const overlap = Math.min(options.chunkOverlap || DEFAULT_CHUNK_OVERLAP, chunkSize - 1);
  const maxChunks = options.maxChunks || DEFAULT_MAX_CHUNKS;

  if (!source) return [];

  const chunks = [];
  let cursor = 0;

  while (cursor < source.length && chunks.length < maxChunks) {
    let end = Math.min(cursor + chunkSize, source.length);
    let slice = source.slice(cursor, end);

    if (end < source.length) {
      const breakpoints = [
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf(" "),
      ].filter((point) => point > chunkSize * 0.55);

      if (breakpoints.length) {
        const best = Math.max(...breakpoints);
        end = cursor + best + 1;
        slice = source.slice(cursor, end);
      }
    }

    const cleaned = clean(slice);
    if (cleaned) chunks.push(cleaned);

    if (end >= source.length) break;

    cursor = Math.max(0, end - overlap);
  }

  return chunks;
}

export async function chunkPlainText({
  text = "",
  sourceType = "notes",
  title = "",
  chunkSize = DEFAULT_CHUNK_CHARS,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
  maxChunks = DEFAULT_MAX_CHUNKS,
  metadata = {},
} = {}) {
  const parts = await splitWithLangChain(text, {
    chunkSize,
    chunkOverlap,
    maxChunks,
  });

  return parts.slice(0, maxChunks).map((part, index) =>
    buildBaseChunk({
      index,
      sourceType,
      title,
      text: part,
      metadata,
    })
  );
}

export async function chunkWebpage({
  text = "",
  title = "",
  url = "",
  domain = "",
  metadata = {},
} = {}) {
  return chunkPlainText({
    text,
    sourceType: "webpage",
    title,
    metadata: {
      ...metadata,
      url,
      domain,
    },
  });
}

export async function chunkNotes({
  text = "",
  title = "",
  metadata = {},
} = {}) {
  return chunkPlainText({
    text,
    sourceType: "notes",
    title,
    metadata,
  });
}

export async function chunkCode({
  text = "",
  title = "",
  metadata = {},
} = {}) {
  const lines = String(text || "").split("\n");

  const maxLinesPerChunk = numberEnv("GEMMA_RESOURCE_CODE_CHUNK_LINES", 80);
  const overlapLines = numberEnv("GEMMA_RESOURCE_CODE_CHUNK_OVERLAP_LINES", 10);
  const maxChunks = DEFAULT_MAX_CHUNKS;

  const chunks = [];
  let start = 0;

  while (start < lines.length && chunks.length < maxChunks) {
    const end = Math.min(lines.length, start + maxLinesPerChunk);
    const part = lines.slice(start, end).join("\n");

    if (clean(part)) {
      chunks.push(
        buildBaseChunk({
          index: chunks.length,
          sourceType: "code",
          title,
          text: part,
          lineStart: start + 1,
          lineEnd: end,
          metadata: {
            ...metadata,
            language: metadata.language || "",
          },
        })
      );
    }

    if (end >= lines.length) break;

    start = Math.max(0, end - overlapLines);
  }

  return chunks;
}

export function normalizeTranscriptSegments(segments = []) {
  if (!Array.isArray(segments)) return [];

  return segments
    .map((segment, index) => {
      const startSeconds = Number(
        segment.startSeconds ??
          segment.start ??
          segment.offset ??
          segment.time ??
          segment.startTime ??
          0
      );

      const durationSeconds = Number(
        segment.durationSeconds ?? segment.duration ?? segment.dur ?? 8
      );

      const endSeconds = Number(
        segment.endSeconds ??
          segment.end ??
          startSeconds + (Number.isFinite(durationSeconds) ? durationSeconds : 8)
      );

      const text = cleanSpace(
        segment.text || segment.caption || segment.content || segment.line || ""
      );

      return {
        index,
        startSeconds: Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : 0,
        endSeconds: Number.isFinite(endSeconds)
          ? Math.max(startSeconds + 1, endSeconds)
          : startSeconds + 8,
        timestampStart: secondsToTimestamp(startSeconds),
        timestampEnd: secondsToTimestamp(endSeconds),
        text,
      };
    })
    .filter((segment) => segment.text);
}

export function chunkTranscriptSegments({
  segments = [],
  title = "",
  metadata = {},
  chunkSize = DEFAULT_CHUNK_CHARS,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
  maxChunks = DEFAULT_MAX_CHUNKS,
} = {}) {
  const normalized = normalizeTranscriptSegments(segments);

  if (!normalized.length) return [];

  const chunks = [];
  let current = [];
  let currentChars = 0;

  function pushCurrent() {
    if (!current.length || chunks.length >= maxChunks) return;

    const text = current
      .map((item) => `[${item.timestampStart}] ${item.text}`)
      .join("\n");

    const first = current[0];
    const last = current[current.length - 1];

    chunks.push(
      buildBaseChunk({
        index: chunks.length,
        sourceType: "youtube",
        title,
        text,
        timestampStart: first.timestampStart,
        timestampEnd: last.timestampEnd,
        startSeconds: first.startSeconds,
        endSeconds: last.endSeconds,
        metadata: {
          ...metadata,
          segmentStartIndex: first.index,
          segmentEndIndex: last.index,
        },
      })
    );
  }

  for (const segment of normalized) {
    current.push(segment);
    currentChars += segment.text.length + 16;

    if (currentChars >= chunkSize) {
      pushCurrent();

      const overlap = [];
      let overlapChars = 0;

      for (let i = current.length - 1; i >= 0; i -= 1) {
        overlap.unshift(current[i]);
        overlapChars += current[i].text.length + 16;

        if (overlapChars >= chunkOverlap) break;
      }

      current = overlap;
      currentChars = overlapChars;
    }

    if (chunks.length >= maxChunks) break;
  }

  if (current.length && chunks.length < maxChunks) {
    pushCurrent();
  }

  return chunks;
}

export async function chunkTranscriptText({
  text = "",
  title = "",
  metadata = {},
} = {}) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const segments = lines
    .map((line) => {
      const match = line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)$/);

      if (!match) return null;

      const startSeconds = timestampToSeconds(match[1]);

      return {
        startSeconds,
        endSeconds: startSeconds + 10,
        text: match[2],
      };
    })
    .filter(Boolean);

  if (segments.length >= 3) {
    return chunkTranscriptSegments({
      segments,
      title,
      metadata,
    });
  }

  return chunkPlainText({
    text,
    sourceType: "youtube",
    title,
    metadata,
  });
}

export async function chunkPdfPages({
  pages = [],
  text = "",
  title = "",
  metadata = {},
} = {}) {
  const normalizedPages = Array.isArray(pages)
    ? pages
        .map((page, index) => ({
          pageNumber: Number(page.pageNumber || page.page || index + 1),
          text: clean(page.text || page.content || ""),
        }))
        .filter((page) => page.text)
    : [];

  if (!normalizedPages.length) {
    return chunkPlainText({
      text,
      sourceType: "pdf",
      title,
      metadata,
    });
  }

  const chunks = [];
  const maxChunks = DEFAULT_MAX_CHUNKS;

  for (const page of normalizedPages) {
    if (chunks.length >= maxChunks) break;

    if (page.text.length <= DEFAULT_CHUNK_CHARS) {
      chunks.push(
        buildBaseChunk({
          index: chunks.length,
          sourceType: "pdf",
          title,
          text: page.text,
          pageNumber: page.pageNumber,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          metadata,
        })
      );

      continue;
    }

    const parts = await splitWithLangChain(page.text, {
      chunkSize: DEFAULT_CHUNK_CHARS,
      chunkOverlap: DEFAULT_CHUNK_OVERLAP,
      maxChunks,
    });

    for (const part of parts) {
      if (chunks.length >= maxChunks) break;

      chunks.push(
        buildBaseChunk({
          index: chunks.length,
          sourceType: "pdf",
          title,
          text: part,
          pageNumber: page.pageNumber,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          metadata,
        })
      );
    }
  }

  return chunks;
}

export async function chunkExtractedResource({
  sourceType = "notes",
  title = "",
  text = "",
  transcriptSegments = [],
  pages = [],
  url = "",
  domain = "",
  metadata = {},
} = {}) {
  if (sourceType === "youtube") {
    if (Array.isArray(transcriptSegments) && transcriptSegments.length) {
      return chunkTranscriptSegments({
        segments: transcriptSegments,
        title,
        metadata: {
          ...metadata,
          url,
          domain,
        },
      });
    }

    return chunkTranscriptText({
      text,
      title,
      metadata: {
        ...metadata,
        url,
        domain,
      },
    });
  }

  if (sourceType === "pdf") {
    return chunkPdfPages({
      pages,
      text,
      title,
      metadata,
    });
  }

  if (sourceType === "webpage") {
    return chunkWebpage({
      text,
      title,
      url,
      domain,
      metadata,
    });
  }

  if (sourceType === "code") {
    return chunkCode({
      text,
      title,
      metadata,
    });
  }

  return chunkNotes({
    text,
    title,
    metadata,
  });
}

export function summarizeChunksForPrompt(chunks = [], maxChars = 55000) {
  const list = Array.isArray(chunks) ? chunks : [];

  let output = "";

  for (const chunk of list) {
    const block = [
      `CHUNK_ID: ${chunk.chunkId}`,
      `SOURCE_REF: ${chunk.sourceRef || `Chunk ${chunk.index + 1}`}`,
      chunk.text,
    ].join("\n");

    if ((output + "\n\n---\n\n" + block).length > maxChars) break;

    output += output ? `\n\n---\n\n${block}` : block;
  }

  return output;
}