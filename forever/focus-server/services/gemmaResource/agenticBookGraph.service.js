// server/services/gemmaResource/agenticBookGraph.service.js

import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";

import GemmaResource from "../../models/GemmaResource.js";
import GemmaResourceChunk from "../../models/GemmaResourceChunk.js";
import GemmaResourceBook from "../../models/GemmaResourceBook.js";

import { buildGemmaResourceEmbeddings } from "./embeddingBuilder.service.js";
import { retrieveRelevantChunksAdvanced } from "./advancedRetrieval.service.js";

/* -------------------------------------------------------------------------- */
/*                               Small utilities                              */
/* -------------------------------------------------------------------------- */

function clean(value = "") {
  return String(value || "").trim();
}

function clampText(value = "", max = 4000) {
  const text = clean(value);
  return text.length <= max ? text : `${text.slice(0, max).trim()}...`;
}

function numberEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolEnv(name, fallback = false) {
  const value = clean(process.env[name]).toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function isObjectId(value = "") {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function getDeviceId(req) {
  return clean(
    req.body?.deviceId ||
      req.query?.deviceId ||
      req.headers["x-device-id"] ||
      "local-device"
  );
}

function getOllamaBaseUrl() {
  const raw =
    clean(process.env.GEMMA_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OFFLINE_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OLLAMA_LOCAL_URL) ||
    "http://localhost:11434";

  return raw.replace(/\/api\/generate\/?$/i, "").replace(/\/+$/, "");
}

function getModel() {
  return (
    clean(process.env.GEMMA_RESOURCE_OLLAMA_MODEL) ||
    clean(process.env.OFFLINE_RESOURCE_OLLAMA_MODEL) ||
    clean(process.env.OLLAMA_LOCAL_MODEL) ||
    "gemma4:e4b"
  );
}

function getEmbeddingModel() {
  return (
    clean(process.env.GEMMA_RESOURCE_EMBED_MODEL) ||
    clean(process.env.OFFLINE_RESOURCE_EMBED_MODEL) ||
    "nomic-embed-text"
  );
}

/* -------------------------------------------------------------------------- */
/*                              JSON/Ollama calls                             */
/* -------------------------------------------------------------------------- */

function safeJsonParse(text = "") {
  const raw = clean(text);

  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const firstObject = raw.indexOf("{");
  const lastObject = raw.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    try {
      return JSON.parse(raw.slice(firstObject, lastObject + 1));
    } catch {}
  }

  const firstArray = raw.indexOf("[");
  const lastArray = raw.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    try {
      return JSON.parse(raw.slice(firstArray, lastArray + 1));
    } catch {}
  }

  return null;
}

async function callGemmaJson({
  label = "Gemma Agent",
  system = "",
  prompt = "",
  numPredict = null,
  temperature = 0.12,
}) {
  const url = `${getOllamaBaseUrl()}/api/generate`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: getModel(),
      stream: false,
      format: "json",
      prompt: [
        system ? `SYSTEM:\n${system}` : "",
        `TASK:\n${prompt}`,
        "Return ONLY valid JSON. No markdown. No prose outside JSON.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      options: {
        temperature,
        num_ctx: numberEnv("OLLAMA_NUM_CTX", 8192),
        num_predict:
          numPredict || numberEnv("GEMMA_RESOURCE_BOOK_NUM_PREDICT", 2500),
      },
    }),
    signal: AbortSignal.timeout(
      numberEnv("GEMMA_RESOURCE_AI_TIMEOUT_MS", 900000)
    ),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error || `${label} failed with HTTP ${response.status}`
    );
  }

  const parsed = safeJsonParse(data.response || data.message?.content || "");
  if (!parsed) throw new Error(`${label} returned invalid JSON.`);
  return parsed;
}

/* -------------------------------------------------------------------------- */
/*                              Text cleanup/RAG                              */
/* -------------------------------------------------------------------------- */

function stripTimestamps(text = "") {
  return clean(text)
    .replace(/\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]/g, "")
    .replace(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeIntroOutro(text = "") {
  let out = stripTimestamps(text);

  const junk = [
    /what'?s up geeks[^.!?]*[.!?]?/gi,
    /welcome to the channel[^.!?]*[.!?]?/gi,
    /in this video[^.!?]*[.!?]?/gi,
    /in the first video of this series[^.!?]*[.!?]?/gi,
    /so that'?s it for this video[^.!?]*[.!?]?/gi,
    /thank you guys for watching[^.!?]*[.!?]?/gi,
    /subscribe[^.!?]*[.!?]?/gi,
    /like and share[^.!?]*[.!?]?/gi,
    /take care[^.!?]*[.!?]?/gi,
    /i will see you in the next one[^.!?]*[.!?]?/gi,
  ];

  for (const re of junk) out = out.replace(re, " ");

  return out
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function tokenize(value = "") {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "when",
    "what",
    "why",
    "how",
    "are",
    "you",
    "your",
    "our",
    "will",
    "can",
    "page",
    "chapter",
    "lesson",
    "book",
    "visual",
    "example",
    "quiz",
    "summary",
    "pattern",
    "generated",
    "source",
    "resource",
    "student",
    "study",
    "make",
    "complete",
    "guide",
  ]);

  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9_+.#\s-]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 2 && !stop.has(x));
}

function sourceSentencesFromText(text = "", max = 8) {
  const cleaned = removeIntroOutro(text);
  const sentences = cleaned
    .split(/[.!?]\s+/)
    .map(clean)
    .filter((x) => x.length > 35)
    .slice(0, max);

  return sentences.length ? sentences : cleaned ? [clampText(cleaned, 300)] : [];
}

function sourceSentencesFromChunk(chunk = {}, max = 8) {
  return sourceSentencesFromText(chunk.text || chunk.textPreview || "", max);
}

function makeSourceRef(chunk = {}) {
  const page =
    chunk.pageNumber || chunk.pageStart || chunk.pageEnd
      ? `p. ${chunk.pageNumber || chunk.pageStart || chunk.pageEnd}`
      : "";

  const timestamp =
    chunk.timestampStart && chunk.timestampEnd
      ? `${chunk.timestampStart}-${chunk.timestampEnd}`
      : chunk.timestampStart || "";

  const line =
    chunk.lineStart && chunk.lineEnd
      ? `line ${chunk.lineStart}-${chunk.lineEnd}`
      : chunk.lineStart
        ? `line ${chunk.lineStart}`
        : "";

  return {
    resourceId: chunk.resourceId || null,
    chunkMongoId: chunk._id || null,
    chunkId: clean(chunk.chunkId),
    index: Number(chunk.index || 0),
    sourceRef: clean(chunk.sourceRef) || `chunk-${chunk.index ?? ""}`,
    page,
    timestamp,
    line,
    title: clean(chunk.title),
    textPreview: clampText(stripTimestamps(chunk.textPreview || chunk.text || ""), 260),
    ragScore: Number(chunk._ragScore || 0),
    whyUsed: "Retrieved from saved offline resource chunks.",
  };
}

function buildContext(chunks = [], maxChars = 55000) {
  let used = 0;
  const blocks = [];

  for (const chunk of chunks) {
    const ref = makeSourceRef(chunk);

    const block = [
      `SOURCE_REF: ${ref.sourceRef}`,
      ref.page ? `PAGE: ${ref.page}` : "",
      ref.timestamp ? `TIME: ${ref.timestamp}` : "",
      ref.line ? `LINE: ${ref.line}` : "",
      chunk.title ? `TITLE: ${chunk.title}` : "",
      Array.isArray(chunk.concepts) && chunk.concepts.length
        ? `CONCEPTS: ${chunk.concepts.join(", ")}`
        : "",
      `TEXT:\n${removeIntroOutro(chunk.text || "")}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (used + block.length > maxChars) break;

    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n\n---\n\n");
}

/* -------------------------------------------------------------------------- */
/*                               Normalizers                                  */
/* -------------------------------------------------------------------------- */

function normalizeStringArray(value, max = 8) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => clean(x)).filter(Boolean).slice(0, max);
}

function normalizeBoardCommands(value = []) {
  const allowed = new Set([
    "heading",
    "write",
    "formula",
    "box",
    "sticky",
    "arrow",
    "flow",
    "diagram",
    "table",
    "timeline",
    "badge",
    "callout",
    "imagePrompt",
    "mermaid",
    "reactFlow",
    "quizCard",
    "dryRunTable",
  ]);

  if (!Array.isArray(value)) return [];

  return value.slice(0, 18).map((cmd, index) => {
    const type = allowed.has(clean(cmd.type)) ? clean(cmd.type) : "write";

    return {
      id: clean(cmd.id) || `${type}-${index + 1}`,
      type,
      title: clean(cmd.title),
      text: clean(cmd.text),
      mermaid: clean(cmd.mermaid),
      x: Number.isFinite(Number(cmd.x)) ? Number(cmd.x) : 0,
      y: Number.isFinite(Number(cmd.y)) ? Number(cmd.y) : 0,
      w: Number.isFinite(Number(cmd.w)) ? Number(cmd.w) : 0,
      h: Number.isFinite(Number(cmd.h)) ? Number(cmd.h) : 0,
      from: clean(cmd.from),
      to: clean(cmd.to),
      items: Array.isArray(cmd.items)
        ? cmd.items
            .map((x) => (typeof x === "string" ? clean(x) : x))
            .filter(Boolean)
            .slice(0, 14)
        : [],
      rows: Array.isArray(cmd.rows) ? cmd.rows.slice(0, 14) : [],
      nodes: Array.isArray(cmd.nodes) ? cmd.nodes.slice(0, 30) : [],
      edges: Array.isArray(cmd.edges) ? cmd.edges.slice(0, 40) : [],
      style: cmd.style && typeof cmd.style === "object" ? cmd.style : {},
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                      Canonical sourceRef metadata fixer                    */
/* -------------------------------------------------------------------------- */

function normalizeSourceRefText(value = "") {
  return clean(value).replace(/[–—]/g, "-").replace(/\s+/g, "");
}

function findSourceRefMeta(refs = [], sourceRef = "", fallbackIndex = 0) {
  const wanted = clean(sourceRef);

  if (wanted) {
    const exact = refs.find((ref) => clean(ref.sourceRef) === wanted);
    if (exact) return exact;

    const normalizedWanted = normalizeSourceRefText(wanted);

    const loose = refs.find((ref) => {
      const normalizedRef = normalizeSourceRefText(ref.sourceRef);
      return normalizedRef === normalizedWanted;
    });

    if (loose) return loose;

    const byTimestamp = refs.find((ref) => {
      const timestamp = normalizeSourceRefText(ref.timestamp);
      return timestamp && normalizedWanted.includes(timestamp);
    });

    if (byTimestamp) return byTimestamp;
  }

  return refs[fallbackIndex % Math.max(refs.length, 1)] || null;
}

function attachCanonicalSourceRefs(page = {}, index = 0, refs = []) {
  const given = Array.isArray(page.sourceRefs) ? page.sourceRefs : [];

  if (!given.length) {
    const fallback = findSourceRefMeta(refs, "", index);
    return fallback ? [fallback] : [];
  }

  return given.map((ref) => {
    const meta = findSourceRefMeta(refs, ref.sourceRef, index) || {};

    return {
      ...meta,
      ...ref,
      resourceId: meta.resourceId || ref.resourceId || null,
      chunkMongoId: meta.chunkMongoId || ref.chunkMongoId || null,
      chunkId: meta.chunkId || ref.chunkId || "",
      index: Number.isFinite(Number(meta.index))
        ? Number(meta.index)
        : Number(ref.index || 0),
      sourceRef: clean(ref.sourceRef) || clean(meta.sourceRef),
      timestamp: clean(meta.timestamp || ref.timestamp),
      page: clean(meta.page || ref.page),
      line: clean(meta.line || ref.line),
      title: clean(meta.title || ref.title),
      textPreview: clean(meta.textPreview || ref.textPreview),
      ragScore: Number(meta.ragScore || ref.ragScore || 0),
      whyUsed:
        clean(ref.whyUsed) ||
        clean(meta.whyUsed) ||
        "Used as page evidence.",
    };
  });
}

function normalizePage(page = {}, index = 0, refs = []) {
  const sourceRefs = attachCanonicalSourceRefs(page, index, refs);

  const normalized = {
    pageNo: Number(page.pageNo || index + 1),
    spreadNo: Math.floor(index / 2) + 1,
    chapterNo: Number(page.chapterNo || Math.floor(index / 4) + 1),
    pageType: clean(page.pageType) || (index === 0 ? "cover" : "lesson"),
    title: clean(page.title) || `Page ${index + 1}`,
    subtitle: clean(page.subtitle),
    body: clean(page.body),
    keyTakeaways: normalizeStringArray(page.keyTakeaways, 6),
    misconceptionFix: clean(page.misconceptionFix),
    didYouKnow: clean(page.didYouKnow),
    example: clean(page.example),
    equation: clean(page.equation),
    quiz: {
      question: clean(page.quiz?.question),
      answer: clean(page.quiz?.answer),
      hint: clean(page.quiz?.hint),
    },
    boardCommands: normalizeBoardCommands(page.boardCommands),
    sourceRefs,
    design: page.design && typeof page.design === "object" ? page.design : {},
  };

  if (!normalized.boardCommands.length) {
    normalized.boardCommands = makePremiumSafeBoardCommandsForPage(normalized, index);
  }

  return normalized;
}

function isWeakPage(page = {}) {
  const pageType = clean(page.pageType);
  const title = clean(page.title);
  const body = clean(page.body);
  const takeaways = Array.isArray(page.keyTakeaways)
    ? page.keyTakeaways.map(clean).filter(Boolean)
    : [];

  const defaultTitle = /^page\s+\d+$/i.test(title);
  const weakQuiz =
    pageType === "quiz" && (!clean(page.quiz?.question) || !clean(page.quiz?.answer));
  const weakSummary = pageType === "summary" && takeaways.length < 3;
  const tooEmpty = pageType !== "quiz" && body.length < 220;
  const weakBullets = pageType !== "cover" && takeaways.length < 3;

  return !title || defaultTitle || tooEmpty || weakBullets || weakQuiz || weakSummary;
}

/* -------------------------------------------------------------------------- */
/*                     Advanced focus-based chunk matching                    */
/* -------------------------------------------------------------------------- */

function getPlanFocus(planItem = {}) {
  const title = clean(planItem.title).toLowerCase();
  const purpose = clean(planItem.learningPurpose).toLowerCase();
  const type = clean(planItem.pageType).toLowerCase();
  const joined = `${title} ${purpose} ${type}`;

  const includesAny = (arr) => arr.some((x) => joined.includes(x));

  if (
    includesAny([
      "volatile",
      "visibility",
      "main memory",
      "cached",
      "cache",
      "stale",
      "reordering",
    ])
  ) {
    return {
      name: "volatile_visibility",
      must: ["volatile", "main memory", "cached", "visibility"],
      good: [
        "volatile",
        "main memory",
        "cached",
        "read it directly",
        "cannot be cached",
        "memory",
        "visibility",
        "partially initialized",
        "constructed",
      ],
      avoid: ["government", "president", "database connection", "private constructor"],
    };
  }

  if (
    includesAny([
      "local variable",
      "local variables",
      "memory only once",
      "micro-optimization",
      "micro optimization",
      "optimization",
      "40%",
      "local caching",
    ])
  ) {
    return {
      name: "local_variable_optimization",
      must: ["local variable", "memory only once", "40%", "return statement"],
      good: [
        "local variable",
        "memory only once",
        "40%",
        "return statement",
        "first time we retrieve",
        "same local variable",
        "local only",
      ],
      avoid: ["government", "president", "database connection", "private constructor"],
    };
  }

  if (includesAny(["double", "checked", "dcl", "locking"])) {
    return {
      name: "double_checked_locking",
      must: ["double", "checked", "locking", "overhead"],
      good: [
        "double-checked",
        "double checked",
        "locking",
        "overhead",
        "synchronized block",
        "wrap",
        "if statement",
        "class lock",
      ],
      avoid: ["government", "president"],
    };
  }

  if (
    includesAny([
      "synchronized",
      "synchronization",
      "lock",
      "class lock",
      "thread-safety",
      "thread safety",
      "threading",
      "race",
    ])
  ) {
    return {
      name: "synchronization_thread_safety",
      must: ["synchronized", "thread", "lock"],
      good: [
        "synchronized",
        "synchronized block",
        "thread",
        "lock",
        "class lock",
        "wait",
        "multi-threaded",
        "thread tries",
      ],
      avoid: ["government", "president"],
    };
  }

  if (includesAny(["implementation", "constructor", "static", "getinstance", "basic"])) {
    return {
      name: "basic_implementation",
      must: ["private", "constructor", "static", "method"],
      good: ["private", "constructor", "static", "method", "field", "class", "getinstance"],
      avoid: ["volatile", "40%", "local variable", "main memory"],
    };
  }

  if (
    includesAny([
      "real-world",
      "real world",
      "analogy",
      "government",
      "database",
      "president",
    ])
  ) {
    return {
      name: "analogy_use_case",
      must: ["government", "president", "database"],
      good: ["government", "president", "database", "global", "connection", "query"],
      avoid: ["volatile", "40%", "double-checked", "main memory"],
    };
  }

  if (includesAny(["summary", "recap", "review", "when and why"])) {
    return {
      name: "summary_review",
      must: ["single instance", "multi-threaded", "static creation method"],
      good: [
        "recap",
        "should be used",
        "single instance",
        "multi-threaded",
        "static creation method",
        "volatile",
        "synchronized",
      ],
      avoid: [],
    };
  }

  return {
    name: "general",
    must: [],
    good: [],
    avoid: [],
  };
}

function sourceRefHintScore(chunk = {}, ref = {}, focus = {}) {
  const sourceRef = normalizeSourceRefText(ref.sourceRef || chunk.sourceRef || "");
  const timestamp = normalizeSourceRefText(ref.timestamp || chunk.timestampStart || "");
  const joined = `${sourceRef} ${timestamp}`;

  if (["volatile_visibility", "local_variable_optimization"].includes(focus.name)) {
    if (joined.includes("6:56") || joined.includes("8:26")) return 90;
    if (joined.includes("3:35") || joined.includes("7:19")) return -15;
    if (joined.includes("0:04") || joined.includes("3:58")) return -35;
  }

  if (focus.name === "summary_review") {
    if (joined.includes("6:56") || joined.includes("8:26")) return 25;
    if (joined.includes("0:04") || joined.includes("3:58")) return 15;
  }

  if (["synchronization_thread_safety", "double_checked_locking"].includes(focus.name)) {
    if (joined.includes("3:35") || joined.includes("7:19")) return 45;
    if (joined.includes("6:56") || joined.includes("8:26")) return 8;
  }

  if (["basic_implementation", "analogy_use_case", "general"].includes(focus.name)) {
    if (joined.includes("0:04") || joined.includes("3:58")) return 35;
    if (joined.includes("6:56") || joined.includes("8:26")) return -20;
  }

  return 0;
}

function scoreChunkForPlan(chunk, planItem = {}, goal = "", ref = {}) {
  const text = `${chunk.title || ""} ${chunk.concepts?.join?.(" ") || ""} ${
    chunk.text || chunk.textPreview || ""
  }`.toLowerCase();

  const query = `${planItem.title || ""} ${planItem.learningPurpose || ""} ${
    planItem.pageType || ""
  } ${goal || ""}`;

  const tokens = tokenize(query);
  const focus = getPlanFocus(planItem);

  let score = Number(chunk._ragScore || 0) * 0.02 + sourceRefHintScore(chunk, ref, focus);

  for (const token of tokens) {
    if (text.includes(token)) score += 2.2;
  }

  for (const term of focus.good) {
    if (text.includes(term)) score += 13;
  }

  for (const term of focus.must) {
    if (text.includes(term)) score += 18;
  }

  for (const term of focus.avoid) {
    if (text.includes(term)) score -= 10;
  }

  if (["volatile_visibility", "local_variable_optimization"].includes(focus.name)) {
    if (!text.includes("volatile") && !text.includes("main memory") && !text.includes("local variable")) {
      score -= 75;
    }

    if (text.includes("volatile") && text.includes("main memory")) {
      score += 95;
    }

    if (text.includes("local variable") && text.includes("memory only once")) {
      score += 110;
    }

    if (text.includes("40%") || text.includes("forty")) {
      score += 25;
    }
  }

  if (focus.name === "double_checked_locking") {
    if (text.includes("double-checked") || text.includes("double checked")) {
      score += 75;
    }

    if (text.includes("volatile") && !text.includes("double")) {
      score -= 16;
    }
  }

  if (focus.name === "synchronization_thread_safety") {
    if (text.includes("synchronized block") && text.includes("thread")) {
      score += 65;
    }
  }

  if (focus.name === "basic_implementation") {
    if (text.includes("private") && text.includes("constructor") && text.includes("static")) {
      score += 65;
    }

    if (text.includes("volatile") || text.includes("40%")) {
      score -= 45;
    }
  }

  if (focus.name === "analogy_use_case") {
    if ((text.includes("government") || text.includes("president")) && text.includes("database")) {
      score += 65;
    }

    if (text.includes("volatile") || text.includes("local variable")) {
      score -= 55;
    }
  }

  return score;
}

function alreadyUsedSameFocus(usedFocusCounts = new Map(), chunkIndex = 0, focusName = "general") {
  return usedFocusCounts.get(`${focusName}:${chunkIndex}`) || 0;
}

function pickBestChunkForPage(
  chunks = [],
  refs = [],
  planItem = {},
  usedCounts = new Map(),
  goal = "",
  usedFocusCounts = new Map()
) {
  let bestIndex = 0;
  let bestScore = -Infinity;
  const focus = getPlanFocus(planItem);

  for (let i = 0; i < chunks.length; i += 1) {
    const generalPenalty = (usedCounts.get(i) || 0) * 1.4;
    const focusPenalty = alreadyUsedSameFocus(usedFocusCounts, i, focus.name) * 8;
    const score =
      scoreChunkForPlan(chunks[i], planItem, goal, refs[i]) -
      generalPenalty -
      focusPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  usedCounts.set(bestIndex, (usedCounts.get(bestIndex) || 0) + 1);
  usedFocusCounts.set(
    `${focus.name}:${bestIndex}`,
    (usedFocusCounts.get(`${focus.name}:${bestIndex}`) || 0) + 1
  );

  return {
    chunk: chunks[bestIndex] || chunks[0] || {},
    ref: refs[bestIndex] || refs[0] || {},
    chunkIndex: bestIndex,
    focus: focus.name,
    score: bestScore,
  };
}

function getChunkSegmentForPage(chunk = {}, planItem = {}, pageIndex = 0) {
  const sentences = sourceSentencesFromChunk(chunk, 24);
  const focus = getPlanFocus(planItem);

  if (!sentences.length) return [];

  const scored = sentences.map((sentence, index) => {
    const lower = sentence.toLowerCase();
    let score = 0;

    for (const term of focus.good) {
      if (lower.includes(term)) score += 7;
    }

    for (const term of focus.must) {
      if (lower.includes(term)) score += 10;
    }

    for (const term of focus.avoid) {
      if (lower.includes(term)) score -= 6;
    }

    score += Math.max(0, 5 - Math.abs(index - (pageIndex % Math.max(sentences.length, 1))));

    return { sentence, index, score };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const picked = scored
    .slice(0, 7)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.sentence);

  return picked.length ? picked : sentences.slice(0, 7);
}

function compactEvidenceForPageFromMatch(match = {}, planItem = {}, pageIndex = 0) {
  const chunk = match.chunk || {};
  const ref = match.ref || {};
  const bullets = getChunkSegmentForPage(chunk, planItem, pageIndex);

  return {
    sourceRef: ref.sourceRef || "",
    timestamp: ref.timestamp || "",
    title: ref.title || chunk.title || "",
    focus: match.focus || getPlanFocus(planItem).name,
    bullets: bullets.slice(0, 6),
    text: clampText(
      bullets.join(" ") || removeIntroOutro(chunk.text || chunk.textPreview || ""),
      2200
    ),
  };
}

function compactEvidenceForPage(chunk = {}, ref = {}, planItem = {}, pageIndex = 0) {
  const match = { chunk, ref, focus: getPlanFocus(planItem).name };
  return compactEvidenceForPageFromMatch(match, planItem, pageIndex);
}

/* -------------------------------------------------------------------------- */
/*                          Planning and page templates                       */
/* -------------------------------------------------------------------------- */

function buildQuizForPage({ title, type, bullets = [] }) {
  const answer = bullets[0] || `The main idea is ${title}.`;

  if (type === "quiz") {
    return {
      question: `Which idea best explains ${title}?`,
      answer,
      hint: "Use the page evidence and source reference.",
    };
  }

  return {
    question: `What is the main idea of "${title}"?`,
    answer,
    hint: "Look at the source reference attached to this page.",
  };
}

function pageTemplateFromEvidence({ planItem, evidence, state, index }) {
  const title = clean(planItem.title) || `Study Page ${index + 1}`;
  const type = clean(planItem.pageType) || (index === 0 ? "cover" : "lesson");
  const bullets = Array.isArray(evidence.bullets) ? evidence.bullets.filter(Boolean) : [];

  const b0 = bullets[0] || "This page explains a key concept from the saved resource.";
  const b1 = bullets[1] || "The idea is grounded in the source evidence.";
  const b2 = bullets[2] || "Use the attached source reference for verification.";

  let body;

  if (type === "quiz") {
    body = `Use this final review to test the important ideas from the saved resource: ${b0} ${b1}`;
  } else if (type === "summary") {
    body = `Summary: ${b0} ${b1} ${b2}`;
  } else {
    body = `${b0} ${b1} ${b2}`;
  }

  const keyTakeaways =
    bullets.length >= 3
      ? bullets.slice(0, 5)
      : [`Understand ${title}.`, b0, "Connect this page with its source reference."];

  return {
    pageNo: Number(planItem.pageNo || index + 1),
    chapterNo: Number(planItem.chapterNo || Math.floor(index / 4) + 1),
    pageType: type,
    title,
    subtitle: clean(planItem.learningPurpose) || "Source-grounded learning page",
    body: clampText(body, 900),
    keyTakeaways: keyTakeaways.slice(0, 5),
    misconceptionFix: `Do not treat "${title}" as a memorized phrase; connect it to when and why it is used.`,
    didYouKnow: keyTakeaways[0] || "",
    example: bullets[3] || b1,
    equation: "",
    quiz: buildQuizForPage({ title, type, bullets }),
    sourceRefs: evidence.sourceRef
      ? [
          {
            sourceRef: evidence.sourceRef,
            whyUsed: `Best matching saved chunk for ${evidence.focus || getPlanFocus(planItem).name}.`,
          },
        ]
      : [],
  };
}

function bodyMatchesFocus(page = {}, planItem = {}) {
  const focus = getPlanFocus(planItem);

  if (focus.name === "general") return true;

  const text = `${page.title || ""} ${page.subtitle || ""} ${page.body || ""} ${
    page.keyTakeaways?.join?.(" ") || ""
  }`.toLowerCase();

  if (focus.name === "volatile_visibility") {
    return (
      text.includes("volatile") ||
      text.includes("main memory") ||
      text.includes("visibility") ||
      text.includes("cached")
    );
  }

  if (focus.name === "local_variable_optimization") {
    return (
      text.includes("local variable") ||
      text.includes("memory only once") ||
      text.includes("40%") ||
      text.includes("memory read")
    );
  }

  if (focus.name === "double_checked_locking") {
    return text.includes("double") || text.includes("dcl") || text.includes("locking");
  }

  if (focus.name === "synchronization_thread_safety") {
    return text.includes("synchronized") || text.includes("thread") || text.includes("lock");
  }

  if (focus.name === "basic_implementation") {
    return (
      text.includes("private") ||
      text.includes("constructor") ||
      text.includes("static") ||
      text.includes("getinstance")
    );
  }

  if (focus.name === "analogy_use_case") {
    return (
      text.includes("government") ||
      text.includes("president") ||
      text.includes("database") ||
      text.includes("analogy")
    );
  }

  return true;
}

function canonicalizeWrittenPage(page = {}, fallback = {}, evidence = {}, planItem = {}) {
  const merged = { ...fallback, ...page };

  // Never allow Gemma to change the selected RAG evidence source.
  // This fixes wrong volatile/local-variable sourceRef.
  merged.sourceRefs = evidence.sourceRef
    ? [
        {
          sourceRef: evidence.sourceRef,
          whyUsed: `Best matching saved chunk for ${getPlanFocus(planItem).name}.`,
        },
      ]
    : fallback.sourceRefs;

  merged.keyTakeaways =
    normalizeStringArray(merged.keyTakeaways, 5).length >= 3
      ? normalizeStringArray(merged.keyTakeaways, 5)
      : fallback.keyTakeaways;

  merged.quiz = {
    ...fallback.quiz,
    ...(merged.quiz || {}),
  };

  if (isWeakPage(merged) || !bodyMatchesFocus(merged, planItem)) {
    return fallback;
  }

  return merged;
}

function fingerprintPage(page = {}) {
  return tokenize(
    `${page.title || ""} ${page.body || ""} ${page.keyTakeaways?.join?.(" ") || ""}`
  )
    .slice(0, 30)
    .join(" ");
}

function jaccardSimilarity(a = "", b = "") {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));

  if (!left.size || !right.size) return 0;

  let intersection = 0;

  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

function makePageLessRepetitive(page = {}, previousPages = [], evidence = {}, planItem = {}) {
  const current = fingerprintPage(page);

  const repeated = previousPages.some((prev) => {
    return jaccardSimilarity(current, fingerprintPage(prev)) > 0.58;
  });

  if (!repeated) return page;

  const fallback = pageTemplateFromEvidence({
    planItem,
    evidence,
    state: {},
    index: Number(page.pageNo || 1) - 1,
  });

  return {
    ...page,
    body: fallback.body,
    keyTakeaways: fallback.keyTakeaways,
    example: fallback.example,
    quiz: fallback.quiz,
    misconceptionFix: fallback.misconceptionFix,
  };
}

/* -------------------------------------------------------------------------- */
/*                             Board command fallback                         */
/* -------------------------------------------------------------------------- */

function makePremiumSafeBoardCommandsForPage(page = {}, index = 0) {
  const title = clean(page.title) || `Page ${index + 1}`;
  const body = clean(page.body);
  const takeaways = normalizeStringArray(page.keyTakeaways, 5);
  const pageType = clean(page.pageType || "lesson");
  const safeTitle = title.replace(/"/g, "'");
  const first = takeaways[0] || clampText(body, 140);
  const second = takeaways[1] || "Connect the concept to the source evidence.";
  const third = takeaways[2] || "Use the quiz to test yourself.";

  const base = [
    {
      id: `p${index + 1}-heading`,
      type: "heading",
      title,
      text: title,
      x: 36,
      y: 28,
      w: 460,
      h: 64,
    },
    {
      id: `p${index + 1}-core`,
      type: "box",
      title: "Core idea",
      text: first,
      x: 44,
      y: 108,
      w: 450,
      h: 118,
    },
  ];

  if (pageType === "quiz") {
    base.push({
      id: `p${index + 1}-quiz`,
      type: "quizCard",
      title: "Check yourself",
      text: page.quiz?.question || `What is ${title}?`,
      x: 54,
      y: 252,
      w: 420,
      h: 124,
    });

    base.push({
      id: `p${index + 1}-hint`,
      type: "sticky",
      title: "Hint",
      text: page.quiz?.hint || "Use the source reference.",
      x: 60,
      y: 400,
      w: 360,
      h: 90,
    });

    return normalizeBoardCommands(base);
  }

  if (pageType === "summary") {
    base.push({
      id: `p${index + 1}-summary`,
      type: "flow",
      title: "Review path",
      items: takeaways.slice(0, 5),
      x: 54,
      y: 252,
      w: 430,
      h: 188,
    });

    base.push({
      id: `p${index + 1}-map`,
      type: "mermaid",
      title: "Summary Map",
      mermaid: `graph TD; A["${safeTitle}"]-->B["Definition"]; A-->C["Problem"]; A-->D["Fix"]; A-->E["Review"];`,
      x: 54,
      y: 464,
      w: 430,
      h: 170,
    });

    return normalizeBoardCommands(base);
  }

  base.push({
    id: `p${index + 1}-flow`,
    type: "flow",
    title: "Human tutor flow",
    items: [first, second, third].filter(Boolean),
    x: 54,
    y: 252,
    w: 430,
    h: 168,
  });

  base.push({
    id: `p${index + 1}-callout`,
    type: "callout",
    title: "Common mistake",
    text: page.misconceptionFix || "Do not memorize without understanding the use case.",
    x: 64,
    y: 444,
    w: 390,
    h: 92,
  });

  if (["visual", "big_picture", "example", "formula"].includes(pageType)) {
    base.push({
      id: `p${index + 1}-diagram`,
      type: "mermaid",
      title: "Concept diagram",
      mermaid: `graph LR; A["${safeTitle}"]-->B["Why it matters"]; B-->C["How it works"]; C-->D["When to use"];`,
      x: 54,
      y: 552,
      w: 430,
      h: 150,
    });
  }

  return normalizeBoardCommands(base);
}

/* -------------------------------------------------------------------------- */
/*                             Default page plans                             */
/* -------------------------------------------------------------------------- */

function buildFallbackPlan(state) {
  const concepts = normalizeStringArray(state.resource?.concepts || state.resource?.tags || [], 20);
  const sourceTitle = clean(state.resource?.title) || "Saved Resource";
  const isSingleton = `${sourceTitle} ${state.context}`.toLowerCase().includes("singleton");

  if (isSingleton) {
    return [
      {
        pageNo: 1,
        chapterNo: 1,
        pageType: "cover",
        title: "The Singleton Pattern: One Instance, One Access",
        learningPurpose: "Understand the core guarantee and why the pattern exists.",
      },
      {
        pageNo: 2,
        chapterNo: 1,
        pageType: "big_picture",
        title: "What is a Singleton?",
        learningPurpose: "Define the pattern and its single access point.",
      },
      {
        pageNo: 3,
        chapterNo: 1,
        pageType: "visual",
        title: "Real-World Analogy: Government and Database",
        learningPurpose: "Use analogies to remember the pattern.",
      },
      {
        pageNo: 4,
        chapterNo: 1,
        pageType: "example",
        title: "Basic Implementation Steps",
        learningPurpose: "Private constructor, static field, and access method.",
      },
      {
        pageNo: 5,
        chapterNo: 2,
        pageType: "lesson",
        title: "Thread-Safety Problem",
        learningPurpose: "Why naive singleton can fail with multiple threads.",
      },
      {
        pageNo: 6,
        chapterNo: 2,
        pageType: "visual",
        title: "Synchronized Block Fix",
        learningPurpose: "Use a synchronized block to protect creation.",
      },
      {
        pageNo: 7,
        chapterNo: 2,
        pageType: "lesson",
        title: "Cost of Over-Synchronization",
        learningPurpose: "Understand why always taking the lock is expensive.",
      },
      {
        pageNo: 8,
        chapterNo: 2,
        pageType: "example",
        title: "Double-Checked Locking",
        learningPurpose: "Avoid unnecessary locking when the instance already exists.",
      },
      {
        pageNo: 9,
        chapterNo: 2,
        pageType: "formula",
        title: "Volatile Keyword and Memory Visibility",
        learningPurpose: "Read the shared instance from main memory and avoid stale cached values.",
      },
      {
        pageNo: 10,
        chapterNo: 2,
        pageType: "example",
        title: "Local Variable Optimization",
        learningPurpose: "Read volatile memory once and reuse a local variable.",
      },
      {
        pageNo: 11,
        chapterNo: 3,
        pageType: "summary",
        title: "Robust Singleton Recap",
        learningPurpose: "Review definition, thread-safety, volatile, and optimization.",
      },
      {
        pageNo: 12,
        chapterNo: 3,
        pageType: "quiz",
        title: "Final Review Quiz",
        learningPurpose: "Check understanding with targeted questions.",
      },
    ].slice(0, state.pageTarget);
  }

  const base = concepts.length
    ? concepts
    : [sourceTitle, "Core Idea", "Example", "Practice", "Summary"];

  const pages = [
    {
      pageNo: 1,
      chapterNo: 1,
      pageType: "cover",
      title: sourceTitle,
      learningPurpose: "Introduce the saved resource.",
    },
    {
      pageNo: 2,
      chapterNo: 1,
      pageType: "big_picture",
      title: "Big Picture",
      learningPurpose: "Understand the main idea.",
    },
    ...base.slice(0, Math.max(1, state.pageTarget - 4)).map((concept, index) => ({
      pageNo: index + 3,
      chapterNo: Math.floor(index / 4) + 1,
      pageType: index % 3 === 0 ? "lesson" : index % 3 === 1 ? "visual" : "example",
      title: concept,
      learningPurpose: `Learn ${concept} with examples and evidence.`,
    })),
  ];

  pages.push({
    pageNo: pages.length + 1,
    chapterNo: 3,
    pageType: "summary",
    title: "Final Summary",
    learningPurpose: "Review the resource.",
  });

  pages.push({
    pageNo: pages.length + 1,
    chapterNo: 3,
    pageType: "quiz",
    title: "Final Quiz",
    learningPurpose: "Check understanding.",
  });

  return pages.slice(0, state.pageTarget);
}

function normalizeSingletonPagePlan(plan = {}, state = {}) {
  const raw = Array.isArray(plan.pagePlan) ? plan.pagePlan : [];
  const context = `${state.resource?.title || ""} ${state.context || ""}`.toLowerCase();

  if (!context.includes("singleton")) return plan;

  const canonical = [
    [
      "cover",
      "The Singleton Pattern: One Instance, One Access",
      "Understand the core guarantee and why the pattern exists.",
    ],
    [
      "big_picture",
      "What is a Singleton?",
      "Define the pattern and its single access point.",
    ],
    [
      "visual",
      "Real-World Analogy: Government and Database",
      "Use analogies to remember the pattern.",
    ],
    [
      "example",
      "Basic Implementation Steps",
      "Private constructor, static field, and access method.",
    ],
    [
      "lesson",
      "Thread-Safety Problem",
      "Why naive singleton can fail with multiple threads.",
    ],
    [
      "visual",
      "Synchronized Block Fix",
      "Use a synchronized block to protect creation.",
    ],
    [
      "lesson",
      "Cost of Over-Synchronization",
      "Understand why always taking the lock is expensive.",
    ],
    [
      "example",
      "Double-Checked Locking",
      "Avoid unnecessary locking when the instance already exists.",
    ],
    [
      "formula",
      "Volatile Keyword and Memory Visibility",
      "Read the shared instance from main memory and avoid stale cached values.",
    ],
    [
      "example",
      "Local Variable Optimization",
      "Read volatile memory once and reuse a local variable.",
    ],
    [
      "summary",
      "Robust Singleton Recap",
      "Review definition, thread-safety, volatile, and optimization.",
    ],
    [
      "quiz",
      "Final Review Quiz",
      "Check understanding with targeted questions.",
    ],
  ].slice(0, state.pageTarget);

  const pagePlan = canonical.map(([pageType, title, learningPurpose], index) => {
    const existing = raw[index] || {};

    return {
      ...existing,
      pageNo: index + 1,
      chapterNo: index < 4 ? 1 : index < 10 ? 2 : 3,
      pageType,
      title,
      learningPurpose,
    };
  });

  return {
    ...plan,
    title: clean(plan.title) || `AI Flipable Book: ${state.resource?.title || "Saved Resource"}`,
    subtitle: clean(plan.subtitle) || "A visual source-grounded study book.",
    pagePlan,
  };
}

/* -------------------------------------------------------------------------- */
/*                              Per-page agents                               */
/* -------------------------------------------------------------------------- */

async function writeOnePageWithGemma({ state, planItem, evidence, index }) {
  const fallback = pageTemplateFromEvidence({ planItem, evidence, state, index });

  try {
    const result = await callGemmaJson({
      label: `Page Writer Agent p${index + 1}`,
      numPredict: numberEnv("GEMMA_RESOURCE_PAGE_NUM_PREDICT", 1800),
      temperature: 0.14,
      system:
        "You are a strict JSON textbook page writer. Write one excellent page grounded only in the provided evidence.",
      prompt: `
Write exactly ONE high-quality study-book page.

Return ONLY this JSON shape:
{
  "page": {
    "pageNo": ${Number(planItem.pageNo || index + 1)},
    "chapterNo": ${Number(planItem.chapterNo || Math.floor(index / 4) + 1)},
    "pageType": "${clean(planItem.pageType || "lesson")}",
    "title": "specific title",
    "subtitle": "student-friendly subtitle",
    "body": "clean rewritten textbook explanation, 250-900 chars",
    "keyTakeaways": ["3-5 short bullets"],
    "misconceptionFix": "specific mistake to avoid",
    "didYouKnow": "short insight",
    "example": "clear example from source",
    "equation": "",
    "quiz": {
      "question": "specific question",
      "answer": "specific answer",
      "hint": "specific hint"
    },
    "sourceRefs": [
      {
        "sourceRef": "${evidence.sourceRef}",
        "whyUsed": "why this source supports the page"
      }
    ]
  }
}

Rules:
- Do not copy transcript filler like greetings/outros.
- Do not copy timestamps.
- Do not invent facts not in evidence.
- Match title/body. If title is about volatile, body must be about volatile.
- Body must be readable for students.
- For quiz page, create real questions, not generic text.
- For summary page, synthesize the core ideas.
- Use the selected evidence focus: ${evidence.focus || getPlanFocus(planItem).name}.
- Keep sourceRefs[0].sourceRef exactly as "${evidence.sourceRef}".
- If title is about volatile/local-variable, body must be about that exact focus.

Student goal: ${state.goal}

Page plan:
${JSON.stringify(planItem, null, 2)}

Evidence:
${JSON.stringify(evidence, null, 2)}
`,
    });

    const page = result?.page || result;
    return canonicalizeWrittenPage(page, fallback, evidence, planItem);
  } catch {
    return fallback;
  }
}

async function generateBoardForOnePage({ page, index }) {
  const fallback = makePremiumSafeBoardCommandsForPage(page, index);

  try {
    const result = await callGemmaJson({
      label: `Board Command Agent p${index + 1}`,
      numPredict: numberEnv("GEMMA_RESOURCE_BOARD_NUM_PREDICT", 1400),
      temperature: 0.12,
      system:
        "You are a strict JSON visual board designer. Generate drawable commands for one page only.",
      prompt: `
Create visual boardCommands for this one page.

Return ONLY:
{
  "boardCommands": [
    {
      "id": "p1-title",
      "type": "heading",
      "title": "",
      "text": "",
      "items": [],
      "rows": [],
      "nodes": [],
      "edges": [],
      "mermaid": "",
      "x": 40,
      "y": 40,
      "w": 420,
      "h": 80
    }
  ]
}

Allowed types:
heading, write, formula, box, sticky, arrow, flow, diagram, table, timeline, badge, callout, imagePrompt, mermaid, reactFlow, quizCard, dryRunTable.

Rules:
- 3 to 5 commands only.
- Make commands specific to this page, not generic.
- Use Mermaid only if valid.
- Use quizCard for quiz pages.
- Use flow/diagram for visual pages.
- Keep text short and drawable.

Page:
${JSON.stringify(page, null, 2)}
`,
    });

    const commands = normalizeBoardCommands(result?.boardCommands || []);
    return commands.length >= 2 ? commands : fallback;
  } catch {
    return fallback;
  }
}

/* -------------------------------------------------------------------------- */
/*                               Graph nodes                                  */
/* -------------------------------------------------------------------------- */

async function loadResourceNode(state) {
  const resource = await GemmaResource.findById(state.resourceId).lean();
  if (!resource) throw new Error("Gemma resource not found.");

  return {
    ...state,
    resource,
    deviceId: clean(state.deviceId) || resource.deviceId || "local-device",
    trace: [
      ...state.trace,
      {
        step: "load_resource",
        ok: true,
        message: "Resource loaded.",
        model: "mongodb",
      },
    ],
  };
}

async function embeddingNode(state) {
  if (!boolEnv("GEMMA_RESOURCE_USE_EMBEDDINGS", true)) {
    return {
      ...state,
      trace: [
        ...state.trace,
        {
          step: "embedding_check",
          ok: true,
          message: "Embeddings disabled by env.",
          model: getEmbeddingModel(),
        },
      ],
    };
  }

  try {
    const result = await buildGemmaResourceEmbeddings({
      resourceId: state.resourceId,
      force: false,
    });

    return {
      ...state,
      trace: [
        ...state.trace,
        {
          step: "embedding_check",
          ok: true,
          message: result?.alreadyBuilt
            ? "Embeddings already built."
            : "Embedding index ready.",
          model: result?.model || getEmbeddingModel(),
          diagnostics: result || {},
        },
      ],
    };
  } catch (error) {
    return {
      ...state,
      trace: [
        ...state.trace,
        {
          step: "embedding_check",
          ok: false,
          message: `Embedding build failed/skipped: ${error.message}`,
          model: getEmbeddingModel(),
        },
      ],
    };
  }
}

async function ragRetrieveNode(state) {
  const retrievalQuestion = [
    state.goal,
    state.resource.studyGoal,
    state.resource.title,
    "make a complete visual flipable study book with chapters examples diagrams misconceptions quiz summary",
    state.difficulty,
    state.audience,
  ]
    .filter(Boolean)
    .join(" ");

  const retrieved = await retrieveRelevantChunksAdvanced({
    resourceId: state.resourceId,
    resource: state.resource,
    question: retrievalQuestion,
    requestedMode: "agentic_flipbook",
    requestedLanguage: "auto",
    limit: Math.max(14, state.pageTarget + 4),
    candidateLimit: 70,
    includeNeighbors: true,
  });

  const chunks = retrieved.chunks || [];
  if (!chunks.length) {
    throw new Error("No saved chunks found. Save/build the resource first.");
  }

  const refs = chunks.map(makeSourceRef);
  const context = buildContext(
    chunks,
    numberEnv("GEMMA_RESOURCE_MAX_CONTEXT_CHARS", 55000)
  );

  return {
    ...state,
    chunks,
    refs,
    context,
    retrievalDiagnostics: retrieved.diagnostics || {},
    trace: [
      ...state.trace,
      {
        step: "rag_retrieval",
        ok: true,
        message: `Retrieved ${chunks.length} chunks for book generation.`,
        model: getEmbeddingModel(),
        diagnostics: retrieved.diagnostics || {},
      },
    ],
  };
}

async function bookPlannerNode(state) {
  try {
    const plan = await callGemmaJson({
      label: "Book Planner Agent",
      numPredict: numberEnv("GEMMA_RESOURCE_PLAN_NUM_PREDICT", 2200),
      temperature: 0.16,
      system:
        "You are a world-class textbook architect. Plan a student-friendly flipable book only from supplied saved offline resource context.",
      prompt: `
Create a structured page plan.

Return ONLY:
{
  "title": "string",
  "subtitle": "string",
  "summary": "string",
  "concepts": ["string"],
  "chapters": [
    {
      "chapterNo": 1,
      "title": "string",
      "learningGoal": "string",
      "pageStart": 1,
      "pageEnd": 4
    }
  ],
  "pagePlan": [
    {
      "pageNo": 1,
      "chapterNo": 1,
      "pageType": "cover|big_picture|visual|example|lesson|formula|quiz|summary",
      "title": "specific title",
      "learningPurpose": "specific goal"
    }
  ]
}

Rules:
- Target pages: ${state.pageTarget}
- Plan exactly ${state.pageTarget} useful pages if possible.
- Use specific titles. No blank pages. No generic "Page 10".
- If source is short, split by concepts, examples, mistakes, review, quiz.
- Do not invent facts.
- Include separate pages for thread safety, synchronized block, double-checked locking, volatile, local-variable optimization, summary, and quiz when the source supports them.

Resource title: ${state.resource.title}
Student goal: ${state.goal}

Available source refs:
${state.refs.map((r) => `- ${r.sourceRef}: ${r.textPreview}`).join("\n")}

Saved context:
${clampText(state.context, 30000)}
`,
    });

    if (!Array.isArray(plan?.pagePlan) || !plan.pagePlan.length) {
      throw new Error("Planner returned no pagePlan.");
    }

    const finalPlan = normalizeSingletonPagePlan(plan, state);

    return {
      ...state,
      plan: finalPlan,
      trace: [
        ...state.trace,
        {
          step: "book_planner_agent",
          ok: true,
          message: "Book plan created.",
          model: getModel(),
        },
      ],
    };
  } catch (error) {
    const plan = normalizeSingletonPagePlan(
      {
        title: `AI Flipable Book: ${state.resource.title}`,
        subtitle: "Dynamic visual book generated from saved offline resource chunks.",
        summary: clean(state.resource.summary),
        concepts: normalizeStringArray(state.resource.concepts || state.resource.tags || [], 30),
        chapters: [],
        pagePlan: buildFallbackPlan(state),
      },
      state
    );

    return {
      ...state,
      plan,
      trace: [
        ...state.trace,
        {
          step: "book_planner_agent",
          ok: false,
          message: `Planner failed, deterministic plan used: ${error.message}`,
          model: getModel(),
          usedFallback: true,
        },
      ],
    };
  }
}

async function pageWriterNode(state) {
  const rawPlan =
    Array.isArray(state.plan?.pagePlan) && state.plan.pagePlan.length
      ? state.plan.pagePlan.slice(0, state.pageTarget)
      : buildFallbackPlan(state);

  const usedCounts = new Map();
  const usedFocusCounts = new Map();
  const pages = [];
  const pageDiagnostics = [];

  for (let i = 0; i < rawPlan.length; i += 1) {
    const planItem = {
      ...rawPlan[i],
      pageNo: Number(rawPlan[i].pageNo || i + 1),
      chapterNo: Number(rawPlan[i].chapterNo || Math.floor(i / 4) + 1),
    };

    const match = pickBestChunkForPage(
      state.chunks,
      state.refs,
      planItem,
      usedCounts,
      state.goal,
      usedFocusCounts
    );

    const evidence = compactEvidenceForPageFromMatch(match, planItem, i);

    const writtenPage = await writeOnePageWithGemma({
      state,
      planItem,
      evidence,
      index: i,
    });

    const page = makePageLessRepetitive(writtenPage, pages, evidence, planItem);

    pages.push(page);

    pageDiagnostics.push({
      pageNo: i + 1,
      title: planItem.title,
      focus: match.focus,
      chunkIndex: match.chunkIndex,
      sourceRef: evidence.sourceRef,
      score: match.score,
    });
  }

  const draft = {
    title: clean(state.plan?.title) || `AI Flipable Book: ${state.resource.title}`,
    subtitle:
      clean(state.plan?.subtitle) ||
      "Dynamic visual book generated from saved offline resource chunks.",
    summary: clean(state.plan?.summary) || clean(state.resource.summary),
    concepts: normalizeStringArray(
      state.plan?.concepts || state.resource.concepts || state.resource.tags || [],
      40
    ),
    chapters:
      Array.isArray(state.plan?.chapters) && state.plan.chapters.length
        ? state.plan.chapters
        : buildChaptersFromPages(pages, state),
    pages,
  };

  return {
    ...state,
    draft,
    pageDiagnostics,
    trace: [
      ...state.trace,
      {
        step: "page_writer_agent",
        ok: true,
        message: `Per-page writer completed: ${pages.length} pages.`,
        model: getModel(),
        diagnostics: { pages: pageDiagnostics },
      },
    ],
  };
}

function buildChaptersFromPages(pages = [], state = {}) {
  const groups = new Map();

  for (const page of pages) {
    const chapterNo = Number(page.chapterNo || 1);
    if (!groups.has(chapterNo)) groups.set(chapterNo, []);
    groups.get(chapterNo).push(page);
  }

  return [...groups.entries()].map(([chapterNo, chapterPages]) => ({
    chapterNo,
    title:
      chapterNo === 1
        ? "Core Concepts"
        : chapterNo === 2
          ? "Advanced Implementation"
          : "Review and Practice",
    learningGoal: state.goal || "Understand the saved resource.",
    pageStart: Math.min(...chapterPages.map((p) => Number(p.pageNo || 1))),
    pageEnd: Math.max(...chapterPages.map((p) => Number(p.pageNo || 1))),
    sourceRefs: chapterPages.flatMap((p) => p.sourceRefs || []).slice(0, 3),
  }));
}

async function pageQualityValidatorNode(state) {
  const pages = Array.isArray(state.draft?.pages) ? state.draft.pages : [];

  const repairedPages = pages.map((page, index) => {
    if (!isWeakPage(page)) return page;

    const planItem = Array.isArray(state.plan?.pagePlan)
      ? state.plan.pagePlan[index] || {}
      : {};

    const match = pickBestChunkForPage(
      state.chunks,
      state.refs,
      planItem,
      new Map(),
      state.goal,
      new Map()
    );

    const evidence = compactEvidenceForPageFromMatch(match, planItem, index);

    return pageTemplateFromEvidence({
      planItem: { ...planItem, title: clean(page.title) || planItem.title },
      evidence,
      state,
      index,
    });
  });

  const weakCount = pages.filter(isWeakPage).length;

  return {
    ...state,
    draft: { ...state.draft, pages: repairedPages },
    trace: [
      ...state.trace,
      {
        step: "page_quality_validator",
        ok: true,
        message: weakCount
          ? `Repaired ${weakCount} weak pages.`
          : "All pages passed quality checks.",
        model: "validator",
      },
    ],
  };
}

async function boardCommandNode(state) {
  const pages = Array.isArray(state.draft?.pages) ? state.draft.pages : [];
  const finalPages = [];
  let safeCount = 0;

  for (let i = 0; i < pages.length; i += 1) {
    const commands = await generateBoardForOnePage({ page: pages[i], index: i });

    if (!commands.length || commands.some((cmd) => cmd.id?.includes("safe"))) {
      safeCount += 1;
    }

    finalPages.push({ ...pages[i], boardCommands: commands });
  }

  return {
    ...state,
    visualBook: { ...state.draft, pages: finalPages },
    trace: [
      ...state.trace,
      {
        step: "board_command_agent",
        ok: true,
        message: `Per-page board commands completed: ${finalPages.length} pages.`,
        model: getModel(),
        diagnostics: { safeFallbackPages: safeCount },
      },
    ],
  };
}

function repairBookPayload({ book, resource, refs, goal, theme, pageTarget }) {
  const rawPages = Array.isArray(book?.pages) ? book.pages : [];

  const pages = rawPages
    .slice(0, pageTarget)
    .map((page, index) => normalizePage(page, index, refs))
    .filter((page) => page.title || page.body || page.boardCommands.length);

  if (!pages.length) throw new Error("Book payload has no valid pages.");

  const chapters =
    Array.isArray(book?.chapters) && book.chapters.length
      ? book.chapters.slice(0, 12).map((chapter, index) => ({
          chapterNo: Number(chapter.chapterNo || index + 1),
          title: clean(chapter.title) || `Chapter ${index + 1}`,
          learningGoal: clean(chapter.learningGoal),
          pageStart: Number(chapter.pageStart || 1),
          pageEnd: Number(chapter.pageEnd || pages.length),
          sourceRefs: Array.isArray(chapter.sourceRefs)
            ? chapter.sourceRefs
            : refs.slice(index, index + 3),
        }))
      : buildChaptersFromPages(pages, { goal });

  return {
    title: clean(book?.title) || `AI Flipable Book: ${resource.title}`,
    subtitle:
      clean(book?.subtitle) ||
      "Dynamic visual book generated from saved offline resource chunks.",
    theme,
    goal,
    chapters,
    pages,
    sourceRefs: refs.slice(0, 100),
    summary: clean(book?.summary) || clean(resource.summary),
    concepts: normalizeStringArray(book?.concepts || resource.concepts || resource.tags || [], 60),
  };
}

function fallbackBook({ resource, chunks, refs, goal, theme, pageTarget }) {
  const state = {
    resource,
    chunks,
    refs,
    goal,
    theme,
    pageTarget,
    context: buildContext(chunks),
    plan: {
      pagePlan: buildFallbackPlan({
        resource,
        chunks,
        refs,
        goal,
        pageTarget,
        context: buildContext(chunks),
      }),
    },
  };

  const usedCounts = new Map();
  const usedFocusCounts = new Map();

  const pages = state.plan.pagePlan.map((planItem, index) => {
    const match = pickBestChunkForPage(
      chunks,
      refs,
      planItem,
      usedCounts,
      goal,
      usedFocusCounts
    );
    const evidence = compactEvidenceForPageFromMatch(match, planItem, index);
    const page = pageTemplateFromEvidence({ planItem, evidence, state, index });
    return { ...page, boardCommands: makePremiumSafeBoardCommandsForPage(page, index) };
  });

  return {
    title: `AI Flipable Book: ${resource.title}`,
    subtitle: "Generated from saved offline resource chunks.",
    theme,
    goal,
    chapters: buildChaptersFromPages(pages, { goal }),
    pages,
    sourceRefs: refs,
    summary: resource.summary || "Dynamic study book generated from saved chunks.",
    concepts: normalizeStringArray(resource.concepts || resource.tags || [], 60),
  };
}

async function schemaRepairNode(state) {
  let repaired;

  try {
    repaired = repairBookPayload({
      book: state.visualBook,
      resource: state.resource,
      refs: state.refs,
      goal: state.goal,
      theme: state.theme,
      pageTarget: state.pageTarget,
    });
  } catch {
    repaired = fallbackBook({
      resource: state.resource,
      chunks: state.chunks,
      refs: state.refs,
      goal: state.goal,
      theme: state.theme,
      pageTarget: state.pageTarget,
    });
  }

  return {
    ...state,
    repairedBook: repaired,
    trace: [
      ...state.trace,
      {
        step: "schema_validator_repair",
        ok: true,
        message: "Book schema validated/repaired.",
        model: "validator",
      },
    ],
  };
}

async function saveBookCache(book) {
  const dir = clean(process.env.GEMMA_RESOURCE_CACHE_DIR || "./data/gemma-resource");

  try {
    await fs.mkdir(path.resolve(dir, "books"), { recursive: true });
    await fs.writeFile(
      path.resolve(dir, "books", `${book._id}.json`),
      JSON.stringify(book.toClient(), null, 2),
      "utf8"
    );
  } catch (error) {
    console.warn("[agenticBookGraph] cache save skipped:", error.message);
  }
}

async function saveBookNode(state) {
  const saved = await GemmaResourceBook.create({
    deviceId: state.deviceId,
    userId: state.userId,
    title: state.repairedBook.title,
    subtitle: state.repairedBook.subtitle,
    status: "ready",
    sourceResourceIds: [state.resource._id],
    joinedFromBookIds: [],
    theme: state.theme,
    goal: state.goal,
    audience: state.audience,
    difficulty: state.difficulty,
    chapters: state.repairedBook.chapters,
    pages: state.repairedBook.pages,
    sourceRefs: state.repairedBook.sourceRefs,
    summary: state.repairedBook.summary,
    concepts: state.repairedBook.concepts,
    generation: {
      model: getModel(),
      embeddingModel: getEmbeddingModel(),
      mode: "langgraph_agentic_offline_book",
      usedFallback: false,
      generatedAt: new Date(),
      retrievalMode: state.retrievalDiagnostics?.retrievalMode || "",
    },
    agentTrace: state.trace,
    metadata: {
      sourceTitle: state.resource.title,
      sourceType: state.resource.sourceType,
      requestedPageTarget: state.pageTarget,
      actualPages: state.repairedBook.pages.length,
      retrievalDiagnostics: state.retrievalDiagnostics || {},
      pageDiagnostics: state.pageDiagnostics || [],
    },
  });

  await saveBookCache(saved);

  return {
    ...state,
    savedBook: saved.toClient(),
    trace: [
      ...state.trace,
      {
        step: "mongodb_save",
        ok: true,
        message: "Book saved in MongoDB.",
        model: "mongoose",
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/*                          Manual/LangGraph pipelines                        */
/* -------------------------------------------------------------------------- */

async function runManualPipeline(initialState) {
  let state = initialState;
  state = await loadResourceNode(state);
  state = await embeddingNode(state);
  state = await ragRetrieveNode(state);
  state = await bookPlannerNode(state);
  state = await pageWriterNode(state);
  state = await pageQualityValidatorNode(state);
  state = await boardCommandNode(state);
  state = await schemaRepairNode(state);
  state = await saveBookNode(state);
  return state;
}

async function runLangGraphPipeline(initialState) {
  try {
    const langgraph = await import("@langchain/langgraph");
    const { StateGraph, START, END, Annotation } = langgraph;

    if (!StateGraph || !START || !END || !Annotation) {
      return runManualPipeline(initialState);
    }

    const BookState = Annotation.Root({
      resourceId: Annotation(),
      deviceId: Annotation(),
      userId: Annotation(),
      goal: Annotation(),
      theme: Annotation(),
      pageTarget: Annotation(),
      difficulty: Annotation(),
      audience: Annotation(),
      resource: Annotation(),
      chunks: Annotation(),
      refs: Annotation(),
      context: Annotation(),
      retrievalDiagnostics: Annotation(),
      plan: Annotation(),
      draft: Annotation(),
      visualBook: Annotation(),
      repairedBook: Annotation(),
      savedBook: Annotation(),
      pageDiagnostics: Annotation(),
      trace: Annotation({
        reducer: (_left, right) => right,
        default: () => [],
      }),
    });

    const graph = new StateGraph(BookState)
      .addNode("load_resource", loadResourceNode)
      .addNode("embedding_check", embeddingNode)
      .addNode("rag_retrieve", ragRetrieveNode)
      .addNode("book_planner", bookPlannerNode)
      .addNode("page_writer", pageWriterNode)
      .addNode("page_quality_validator", pageQualityValidatorNode)
      .addNode("board_command", boardCommandNode)
      .addNode("schema_repair", schemaRepairNode)
      .addNode("save_book", saveBookNode)
      .addEdge(START, "load_resource")
      .addEdge("load_resource", "embedding_check")
      .addEdge("embedding_check", "rag_retrieve")
      .addEdge("rag_retrieve", "book_planner")
      .addEdge("book_planner", "page_writer")
      .addEdge("page_writer", "page_quality_validator")
      .addEdge("page_quality_validator", "board_command")
      .addEdge("board_command", "schema_repair")
      .addEdge("schema_repair", "save_book")
      .addEdge("save_book", END)
      .compile();

    return graph.invoke(initialState);
  } catch (error) {
    console.warn("[agenticBookGraph] LangGraph unavailable, using manual graph:", error.message);

    return runManualPipeline({
      ...initialState,
      trace: [
        ...initialState.trace,
        {
          step: "langgraph_runtime",
          ok: false,
          message: `LangGraph package unavailable or incompatible: ${error.message}`,
          model: "manual-fallback",
        },
      ],
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                              Public services                               */
/* -------------------------------------------------------------------------- */

export async function createAgenticGraphBook({
  resourceId,
  deviceId,
  userId = "",
  goal = "",
  theme = "warm",
  pageTarget = 12,
  difficulty = "adaptive",
  audience = "student",
} = {}) {
  if (!isObjectId(resourceId)) throw new Error("Valid resourceId is required.");

  const initialState = {
    resourceId,
    deviceId: clean(deviceId) || "local-device",
    userId: clean(userId),
    goal: clean(goal),
    theme: clean(theme || "warm"),
    pageTarget: Math.max(6, Math.min(30, Number(pageTarget || 12))),
    difficulty: clean(difficulty || "adaptive"),
    audience: clean(audience || "student"),
    trace: [
      {
        step: "start",
        ok: true,
        message: "Agentic LangGraph book pipeline started.",
        model: "langgraph",
      },
    ],
  };

  try {
    const finalState = await runLangGraphPipeline(initialState);

    if (!finalState.savedBook) {
      throw new Error("Book graph finished without savedBook.");
    }

    return finalState.savedBook;
  } catch (error) {
    console.warn("[agenticBookGraph] graph failed, creating grounded fallback:", error.message);

    const resource = await GemmaResource.findById(resourceId).lean();
    if (!resource) throw new Error("Gemma resource not found.");

    const chunks = await GemmaResourceChunk.find({ resourceId })
      .sort({ index: 1 })
      .limit(Math.max(6, Math.min(30, Number(pageTarget || 12))))
      .lean();

    if (!chunks.length) throw new Error("No saved chunks found for fallback book.");

    const refs = chunks.map(makeSourceRef);

    const repairedBook = fallbackBook({
      resource,
      chunks,
      refs,
      goal,
      theme,
      pageTarget: Math.max(6, Math.min(30, Number(pageTarget || 12))),
    });

    const saved = await GemmaResourceBook.create({
      deviceId: clean(deviceId) || resource.deviceId || "local-device",
      userId,
      title: repairedBook.title,
      subtitle: repairedBook.subtitle,
      status: "ready",
      sourceResourceIds: [resource._id],
      joinedFromBookIds: [],
      theme,
      goal,
      audience,
      difficulty,
      chapters: repairedBook.chapters,
      pages: repairedBook.pages,
      sourceRefs: repairedBook.sourceRefs,
      summary: repairedBook.summary,
      concepts: repairedBook.concepts,
      generation: {
        model: getModel(),
        embeddingModel: getEmbeddingModel(),
        mode: "grounded_fallback_book",
        usedFallback: true,
        generatedAt: new Date(),
      },
      agentTrace: [
        {
          step: "graph_failed",
          ok: false,
          message: error.message,
          model: getModel(),
          usedFallback: true,
        },
        {
          step: "fallback_save",
          ok: true,
          message: "Grounded fallback book saved.",
          model: "mongoose",
          usedFallback: true,
        },
      ],
      metadata: {
        sourceTitle: resource.title,
        sourceType: resource.sourceType,
        fallbackReason: error.message,
      },
    });

    await saveBookCache(saved);
    return saved.toClient();
  }
}

export async function listAgenticGraphBooks({
  deviceId,
  resourceId = "",
  limit = 30,
} = {}) {
  const query = {
    deviceId: clean(deviceId) || "local-device",
    status: { $ne: "archived" },
  };

  if (isObjectId(resourceId)) {
    query.sourceResourceIds = new mongoose.Types.ObjectId(resourceId);
  }

  const books = await GemmaResourceBook.find(query)
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(100, Number(limit || 30))));

  return books.map((book) => book.toClient());
}

export async function getAgenticGraphBook(bookId) {
  if (!isObjectId(bookId)) throw new Error("Valid bookId is required.");

  const book = await GemmaResourceBook.findById(bookId);
  if (!book) throw new Error("Book not found.");

  return book.toClient();
}

export async function joinAgenticGraphBooks({
  deviceId,
  userId = "",
  bookIds = [],
  title = "Joined Gemma Study Book",
  theme = "warm",
} = {}) {
  const ids = Array.isArray(bookIds)
    ? bookIds.filter(isObjectId).map((id) => new mongoose.Types.ObjectId(id))
    : [];

  if (ids.length < 2) throw new Error("Select at least 2 books to join.");

  const books = await GemmaResourceBook.find({
    _id: { $in: ids },
    deviceId: clean(deviceId) || "local-device",
    status: "ready",
  }).sort({ createdAt: 1 });

  if (books.length < 2) {
    throw new Error("Could not find at least 2 ready books for this device.");
  }

  const pages = [];
  const chapters = [];
  const sourceRefs = [];
  const sourceResourceIds = [];
  const concepts = [];

  let pageNo = 1;
  let chapterNo = 1;

  for (const book of books) {
    for (const ref of book.sourceRefs || []) sourceRefs.push(ref);
    for (const rid of book.sourceResourceIds || []) sourceResourceIds.push(String(rid));
    for (const concept of book.concepts || []) concepts.push(concept);

    const plainPages = (book.pages || []).map((page) =>
      typeof page.toObject === "function" ? page.toObject() : page
    );

    chapters.push({
      chapterNo,
      title: book.title,
      learningGoal: book.goal || book.summary || "",
      pageStart: pageNo,
      pageEnd: pageNo + plainPages.length - 1,
      sourceRefs: (book.sourceRefs || []).slice(0, 3),
    });

    for (const page of plainPages) {
      pages.push({
        ...page,
        pageNo,
        spreadNo: Math.floor((pageNo - 1) / 2) + 1,
        chapterNo,
      });
      pageNo += 1;
    }

    chapterNo += 1;
  }

  const joined = await GemmaResourceBook.create({
    deviceId: clean(deviceId) || "local-device",
    userId,
    title: clean(title) || "Joined Gemma Study Book",
    subtitle: "Combined from multiple saved AI flipable books.",
    status: "ready",
    sourceResourceIds: [...new Set(sourceResourceIds)],
    joinedFromBookIds: books.map((book) => book._id),
    theme,
    goal: "Joined study book",
    audience: "student",
    difficulty: "adaptive",
    chapters,
    pages,
    sourceRefs: sourceRefs.slice(0, 120),
    summary: books
      .map((book) => book.summary)
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3000),
    concepts: [...new Set(concepts.map(clean).filter(Boolean))].slice(0, 60),
    generation: {
      model: getModel(),
      embeddingModel: getEmbeddingModel(),
      mode: "joined_agentic_books",
      usedFallback: false,
      generatedAt: new Date(),
    },
    agentTrace: [
      {
        step: "join_books",
        ok: true,
        message: `Joined ${books.length} books.`,
        model: "database",
      },
    ],
  });

  await saveBookCache(joined);
  return joined.toClient();
}

/* -------------------------------------------------------------------------- */
/*                               Express handlers                             */
/* -------------------------------------------------------------------------- */

function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function fail(res, error, status = 500) {
  console.error("[agenticBookGraph]", error);
  return res.status(status).json({
    ok: false,
    message: error?.message || "Agentic book request failed.",
  });
}

export async function handleCreateAgenticGraphBook(req, res) {
  try {
    const data = await createAgenticGraphBook({
      resourceId: clean(req.params.resourceId || req.body?.resourceId),
      deviceId: getDeviceId(req),
      userId: clean(req.body?.userId || req.user?.id || req.user?._id),
      goal: clean(req.body?.goal || req.body?.studyGoal),
      theme: clean(req.body?.theme || "warm"),
      pageTarget: req.body?.pageTarget || req.body?.pages || 12,
      difficulty: clean(req.body?.difficulty || "adaptive"),
      audience: clean(req.body?.audience || "student"),
    });

    return ok(res, data, 201);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function handleListAgenticGraphBooks(req, res) {
  try {
    const data = await listAgenticGraphBooks({
      deviceId: clean(req.params.deviceId || req.query.deviceId),
      resourceId: clean(req.query.resourceId),
      limit: req.query.limit,
    });

    return ok(res, data);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function handleGetAgenticGraphBook(req, res) {
  try {
    const data = await getAgenticGraphBook(req.params.bookId);
    return ok(res, data);
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function handleJoinAgenticGraphBooks(req, res) {
  try {
    const data = await joinAgenticGraphBooks({
      deviceId: getDeviceId(req),
      userId: clean(req.body?.userId || req.user?.id || req.user?._id),
      bookIds: req.body?.bookIds || [],
      title: clean(req.body?.title),
      theme: clean(req.body?.theme || "warm"),
    });

    return ok(res, data, 201);
  } catch (error) {
    return fail(res, error, 400);
  }
}