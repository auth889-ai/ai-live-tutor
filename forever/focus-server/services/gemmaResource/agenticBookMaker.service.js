// server/services/gemmaResource/agenticBookMaker.service.js

import fs from "fs/promises";
import path from "path";
import axios from "axios";
import mongoose from "mongoose";

import GemmaResource from "../../models/GemmaResource.js";
import GemmaResourceChunk from "../../models/GemmaResourceChunk.js";
import GemmaResourceBook from "../../models/GemmaResourceBook.js";

import { buildGemmaResourceEmbeddings } from "./embeddingBuilder.service.js";
import { retrieveRelevantChunksAdvanced } from "./advancedRetrieval.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function clampText(value = "", max = 4000) {
  const text = String(value || "").trim();
  return text.length <= max ? text : `${text.slice(0, max).trim()}...`;
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

function safeJsonParse(text = "") {
  const raw = String(text || "").trim();

  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const firstObj = raw.indexOf("{");
  const lastObj = raw.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) {
    try {
      return JSON.parse(raw.slice(firstObj, lastObj + 1));
    } catch {}
  }

  const firstArr = raw.indexOf("[");
  const lastArr = raw.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) {
    try {
      return JSON.parse(raw.slice(firstArr, lastArr + 1));
    } catch {}
  }

  return null;
}

async function callGemmaJson({ system = "", prompt = "", label = "agent" }) {
  const url = `${getOllamaBaseUrl()}/api/generate`;
  const timeout = numberEnv("GEMMA_RESOURCE_AI_TIMEOUT_MS", 900000);

  const finalPrompt = [
    system ? `SYSTEM:\n${system}` : "",
    `TASK:\n${prompt}`,
    "Return ONLY valid JSON. No markdown. No prose outside JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await axios.post(
    url,
    {
      model: getModel(),
      prompt: finalPrompt,
      stream: false,
      format: "json",
      options: {
        temperature: 0.2,
        num_ctx: numberEnv("OLLAMA_NUM_CTX", 8192),
        num_predict: numberEnv("GEMMA_RESOURCE_ASK_NUM_PREDICT", 3600),
      },
    },
    {
      timeout,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );

  const raw = response.data?.response || response.data?.message?.content || "";
  const parsed = safeJsonParse(raw);

  if (!parsed) {
    throw new Error(`${label} returned invalid JSON.`);
  }

  return parsed;
}

function chunkSourceRef(chunk = {}) {
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
    textPreview: clampText(chunk.textPreview || chunk.text, 260),
    ragScore: Number(chunk._ragScore || 0),
    whyUsed: "Retrieved from saved offline resource chunks.",
  };
}

function buildContext(chunks = [], maxChars = 50000) {
  let used = 0;
  const blocks = [];

  for (const chunk of chunks) {
    const ref = chunkSourceRef(chunk);
    const block = [
      `SOURCE_REF: ${ref.sourceRef}`,
      ref.page ? `PAGE: ${ref.page}` : "",
      ref.timestamp ? `TIME: ${ref.timestamp}` : "",
      ref.line ? `LINE: ${ref.line}` : "",
      chunk.title ? `TITLE: ${chunk.title}` : "",
      Array.isArray(chunk.concepts) && chunk.concepts.length
        ? `CONCEPTS: ${chunk.concepts.join(", ")}`
        : "",
      `TEXT:\n${clean(chunk.text)}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n\n---\n\n");
}

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

  return value.slice(0, 16).map((cmd, index) => {
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
      items: Array.isArray(cmd.items) ? cmd.items.slice(0, 12) : [],
      rows: Array.isArray(cmd.rows) ? cmd.rows.slice(0, 12) : [],
      nodes: Array.isArray(cmd.nodes) ? cmd.nodes.slice(0, 20) : [],
      edges: Array.isArray(cmd.edges) ? cmd.edges.slice(0, 30) : [],
      style: cmd.style && typeof cmd.style === "object" ? cmd.style : {},
    };
  });
}

function normalizePage(page = {}, index = 0, refs = []) {
  const fallbackRef = refs[index % Math.max(refs.length, 1)];

  const sourceRefs =
    Array.isArray(page.sourceRefs) && page.sourceRefs.length
      ? page.sourceRefs.map((ref) => ({
          ...(fallbackRef || {}),
          ...ref,
          sourceRef: clean(ref.sourceRef) || fallbackRef?.sourceRef || "",
          whyUsed: clean(ref.whyUsed) || "Used as source evidence for this page.",
        }))
      : fallbackRef
        ? [fallbackRef]
        : [];

  const safeBody = clean(page.body);

  return {
    pageNo: index + 1,
    spreadNo: Math.floor(index / 2) + 1,
    chapterNo: Number(page.chapterNo || Math.floor(index / 4) + 1),
    pageType: clean(page.pageType) || (index === 0 ? "cover" : "lesson"),
    title: clean(page.title) || `Page ${index + 1}`,
    subtitle: clean(page.subtitle),
    body: safeBody,
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
}

function repairBookPayload({ book, resource, refs, goal, theme, pageTarget }) {
  const rawPages = Array.isArray(book?.pages) ? book.pages : [];

  const pages = rawPages
    .slice(0, pageTarget)
    .map((page, index) => normalizePage(page, index, refs))
    .filter((page) => page.title || page.body || page.boardCommands.length);

  if (!pages.length) {
    throw new Error("Book payload has no valid pages.");
  }

  const chapters = Array.isArray(book?.chapters)
    ? book.chapters.slice(0, 12).map((chapter, index) => ({
        chapterNo: Number(chapter.chapterNo || index + 1),
        title: clean(chapter.title) || `Chapter ${index + 1}`,
        learningGoal: clean(chapter.learningGoal),
        pageStart: Number(chapter.pageStart || 1),
        pageEnd: Number(chapter.pageEnd || pages.length),
        sourceRefs: refs.slice(index, index + 3),
      }))
    : [
        {
          chapterNo: 1,
          title: clean(resource.title) || "Saved Resource",
          learningGoal: goal || clean(resource.studyGoal) || "Understand the saved resource.",
          pageStart: 1,
          pageEnd: pages.length,
          sourceRefs: refs.slice(0, 3),
        },
      ];

  return {
    title: clean(book?.title) || `AI Flipable Book: ${resource.title}`,
    subtitle:
      clean(book?.subtitle) ||
      "A dynamic visual book generated from saved offline resource chunks.",
    theme,
    goal,
    chapters,
    pages,
    sourceRefs: refs.slice(0, 80),
    summary: clean(book?.summary) || clean(resource.summary),
    concepts: normalizeStringArray(book?.concepts || resource.concepts || resource.tags || [], 40),
  };
}

function fallbackBook({ resource, chunks, refs, goal, theme, pageTarget }) {
  const selected = chunks.slice(0, pageTarget);

  const pages = selected.map((chunk, index) => {
    const text = clean(chunk.text);
    const sentences = text
      .split(/[.!?]\s+/)
      .map((x) => clean(x))
      .filter((x) => x.length > 30)
      .slice(0, 5);

    const title =
      clean(chunk.title) ||
      clean(chunk.concepts?.[0]) ||
      clean(chunk.keywords?.[0]) ||
      `Concept ${index + 1}`;

    return normalizePage(
      {
        pageType: index === 0 ? "cover" : index % 4 === 0 ? "visual" : "lesson",
        title,
        subtitle: index === 0 ? "AI Flipable Book" : "Grounded lesson page",
        body: clampText(text, 850),
        keyTakeaways: sentences.slice(0, 4),
        misconceptionFix: sentences[4] || "",
        didYouKnow: sentences[1] || "",
        example: sentences[2] || "",
        quiz: {
          question: `What is the main idea of "${title}"?`,
          answer: sentences[0] || clampText(text, 180),
          hint: "Look at the source reference on the page.",
        },
        sourceRefs: [chunkSourceRef(chunk)],
        boardCommands: [
          {
            type: "heading",
            title,
            text: title,
            x: 40,
            y: 30,
            w: 430,
            h: 60,
          },
          {
            type: "box",
            title: "Core Idea",
            text: sentences[0] || clampText(text, 180),
            x: 50,
            y: 120,
            w: 420,
            h: 130,
          },
          {
            type: "flow",
            title: "Learning Flow",
            items: sentences.slice(0, 4),
            x: 60,
            y: 280,
            w: 430,
            h: 170,
          },
          {
            type: "callout",
            title: "Source Evidence",
            text: chunk.sourceRef || `chunk-${chunk.index}`,
            x: 60,
            y: 470,
            w: 300,
            h: 70,
          },
        ],
      },
      index,
      refs
    );
  });

  return {
    title: `AI Flipable Book: ${resource.title}`,
    subtitle: "Generated from saved offline resource chunks.",
    theme,
    goal,
    chapters: [
      {
        chapterNo: 1,
        title: resource.title || "Saved Resource",
        learningGoal: goal || resource.studyGoal || "Understand the saved resource.",
        pageStart: 1,
        pageEnd: pages.length,
        sourceRefs: refs.slice(0, 3),
      },
    ],
    pages,
    sourceRefs: refs,
    summary: resource.summary || "Dynamic study book generated from saved chunks.",
    concepts: normalizeStringArray(resource.concepts || resource.tags || [], 40),
  };
}

async function ensureEmbeddings(resourceId, trace) {
  if (!boolEnv("GEMMA_RESOURCE_USE_EMBEDDINGS", true)) {
    trace.push({
      step: "embedding_check",
      ok: true,
      message: "Embeddings disabled by env.",
      model: getEmbeddingModel(),
    });
    return;
  }

  try {
    await buildGemmaResourceEmbeddings({ resourceId, force: false });
    trace.push({
      step: "embedding_check",
      ok: true,
      message: "Embedding index ready or already built.",
      model: getEmbeddingModel(),
    });
  } catch (error) {
    trace.push({
      step: "embedding_check",
      ok: false,
      message: `Embedding build skipped/failed: ${error.message}`,
      model: getEmbeddingModel(),
    });
  }
}

async function agentPlanBook({ resource, chunks, refs, context, goal, pageTarget, theme }) {
  return callGemmaJson({
    label: "Book Planner Agent",
    system:
      "You are a world-class textbook architect. Plan a student-friendly flipable book only from supplied saved resource context.",
    prompt: `
Create a book plan from this offline resource.

Resource title: ${resource.title}
Resource type: ${resource.sourceType}
Student goal: ${goal || resource.studyGoal || "Understand and revise this resource."}
Theme: ${theme}
Target pages: ${pageTarget}

Return JSON:
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
      "pageEnd": 2,
      "sourceRefs": ["SOURCE_REF"]
    }
  ],
  "pagePlan": [
    {
      "pageNo": 1,
      "chapterNo": 1,
      "pageType": "cover|toc|chapter|lesson|big_picture|visual|formula|example|dry_run|quiz|summary",
      "title": "string",
      "learningPurpose": "string",
      "sourceRefs": ["SOURCE_REF"]
    }
  ]
}

Rules:
- Use only sourceRefs from the context.
- Make pages visually varied.
- Include at least one visual/big_picture page and one quiz/summary page.
- Do not invent facts.

Available source refs:
${refs.map((r) => `- ${r.sourceRef}: ${r.textPreview}`).join("\n")}

Context:
${context}
`,
  });
}

async function agentWritePages({ plan, resource, context, refs, goal, pageTarget, theme }) {
  return callGemmaJson({
    label: "Page Writer Agent",
    system:
      "You are an elite human tutor and book writer. Write clear grounded pages from saved source chunks only.",
    prompt: `
Write final book pages using this plan.

Resource: ${resource.title}
Goal: ${goal || resource.studyGoal || ""}
Theme: ${theme}
Target pages: ${pageTarget}

Plan JSON:
${JSON.stringify(plan, null, 2)}

Return JSON:
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
      "pageEnd": 2
    }
  ],
  "pages": [
    {
      "pageNo": 1,
      "chapterNo": 1,
      "pageType": "cover|toc|chapter|lesson|big_picture|visual|formula|example|dry_run|quiz|summary",
      "title": "string",
      "subtitle": "string",
      "body": "short but rich explanation grounded in source",
      "keyTakeaways": ["string"],
      "misconceptionFix": "string",
      "didYouKnow": "string",
      "example": "string",
      "equation": "string",
      "quiz": {
        "question": "string",
        "answer": "string",
        "hint": "string"
      },
      "sourceRefs": [
        {
          "sourceRef": "must match SOURCE_REF",
          "whyUsed": "string"
        }
      ]
    }
  ]
}

Rules:
- Every page must be useful for a student.
- Every factual claim must be supported by sourceRefs.
- Keep each page readable, not too long.
- Do not include boardCommands yet.

Available source refs:
${refs.map((r) => `- ${r.sourceRef}: ${r.textPreview}`).join("\n")}

Context:
${context}
`,
  });
}

async function agentCreateBoardCommands({ bookDraft, context, refs, theme }) {
  return callGemmaJson({
    label: "Board Command Agent",
    system:
      "You are a visual learning designer. Convert book pages into drawable boardCommands for a flipbook renderer.",
    prompt: `
Add advanced visual boardCommands to every page.

Theme: ${theme}

Book draft:
${JSON.stringify(bookDraft, null, 2)}

Return JSON with SAME structure, but each page must include boardCommands.

Allowed boardCommands:
1. heading: big handwritten title
2. write: normal note text
3. box: bordered explanation card
4. sticky: sticky note
5. callout: small important note
6. formula: formula block
7. flow: sequence/steps
8. diagram: conceptual diagram
9. table: rows table
10. timeline: timeline
11. mermaid: Mermaid diagram code
12. reactFlow: nodes/edges for graph
13. quizCard: question card
14. dryRunTable: dry run rows

boardCommands shape:
{
  "id": "unique",
  "type": "box|flow|diagram|mermaid|reactFlow|table|...",
  "title": "string",
  "text": "string",
  "items": ["string"],
  "rows": [],
  "nodes": [],
  "edges": [],
  "mermaid": "graph TD; A-->B;",
  "x": 40,
  "y": 80,
  "w": 400,
  "h": 140
}

Rules:
- Use boardCommands as real visual drawing instructions, not decorative fake data.
- Prefer flow/diagram/table/mermaid/reactFlow when useful.
- Every page needs 2-5 commands.
- Keep factual content grounded.

Source refs:
${refs.map((r) => `- ${r.sourceRef}: ${r.textPreview}`).join("\n")}

Context:
${context}
`,
  });
}

async function agentRepairSchema({ book, resource, refs, goal, theme, pageTarget }) {
  try {
    return repairBookPayload({ book, resource, refs, goal, theme, pageTarget });
  } catch {
    const repaired = await callGemmaJson({
      label: "Schema Repair Agent",
      system:
        "You repair invalid JSON into the exact book schema. Never add unsupported facts.",
      prompt: `
Repair this book JSON into valid schema.

Required top-level keys:
title, subtitle, summary, concepts, chapters, pages

Each page required:
pageNo, chapterNo, pageType, title, body, keyTakeaways, sourceRefs, boardCommands

Invalid book:
${JSON.stringify(book, null, 2)}

Available refs:
${refs.map((r) => r.sourceRef).join(", ")}
`,
    });

    return repairBookPayload({ book: repaired, resource, refs, goal, theme, pageTarget });
  }
}

async function saveCache(book) {
  const dir = clean(process.env.GEMMA_RESOURCE_CACHE_DIR || "./data/gemma-resource");

  try {
    await fs.mkdir(path.resolve(dir, "books"), { recursive: true });
    await fs.writeFile(
      path.resolve(dir, "books", `${book._id}.json`),
      JSON.stringify(book.toClient(), null, 2),
      "utf8"
    );
  } catch (error) {
    console.warn("[agenticBookMaker] cache save skipped:", error.message);
  }
}

export async function createAgenticFlipBookFromResource({
  resourceId,
  deviceId,
  userId = "",
  goal = "",
  theme = "warm",
  pageTarget = 12,
  difficulty = "adaptive",
  audience = "student",
} = {}) {
  if (!isObjectId(resourceId)) {
    throw new Error("Valid resourceId is required.");
  }

  const resource = await GemmaResource.findById(resourceId).lean();

  if (!resource) {
    throw new Error("Gemma resource not found.");
  }

  const finalDeviceId = clean(deviceId) || resource.deviceId || "local-device";
  const finalPageTarget = Math.max(6, Math.min(30, Number(pageTarget || 12)));
  const trace = [];

  await ensureEmbeddings(resourceId, trace);

  const retrievalQuestion = [
    goal,
    resource.studyGoal,
    resource.title,
    "make a complete visual study book with chapters, examples, diagrams, misconceptions, quiz, summary",
    difficulty,
    audience,
  ]
    .filter(Boolean)
    .join(" ");

  const retrieved = await retrieveRelevantChunksAdvanced({
    resourceId,
    resource,
    question: retrievalQuestion,
    requestedMode: "agentic_flipbook",
    requestedLanguage: "auto",
    limit: Math.max(12, finalPageTarget + 4),
    candidateLimit: 60,
    includeNeighbors: true,
  });

  const chunks = retrieved.chunks || [];

  if (!chunks.length) {
    throw new Error("No saved chunks found. Save/build the resource first.");
  }

  const refs = chunks.map(chunkSourceRef);
  const context = buildContext(
    chunks,
    numberEnv("GEMMA_RESOURCE_MAX_CONTEXT_CHARS", 55000)
  );

  trace.push({
    step: "rag_retrieval",
    ok: true,
    message: `Retrieved ${chunks.length} chunks for book generation.`,
    model: getEmbeddingModel(),
    diagnostics: retrieved.diagnostics || {},
  });

  let bookPayload;
  let usedFallback = false;

  try {
    const plan = await agentPlanBook({
      resource,
      chunks,
      refs,
      context,
      goal,
      pageTarget: finalPageTarget,
      theme,
    });

    trace.push({
      step: "book_planner_agent",
      ok: true,
      message: "Book plan created.",
      model: getModel(),
    });

    const draft = await agentWritePages({
      plan,
      resource,
      context,
      refs,
      goal,
      pageTarget: finalPageTarget,
      theme,
    });

    trace.push({
      step: "page_writer_agent",
      ok: true,
      message: "Book pages written.",
      model: getModel(),
    });

    const visualBook = await agentCreateBoardCommands({
      bookDraft: draft,
      context,
      refs,
      theme,
    });

    trace.push({
      step: "board_command_agent",
      ok: true,
      message: "Drawable board commands generated.",
      model: getModel(),
    });

    bookPayload = await agentRepairSchema({
      book: visualBook,
      resource,
      refs,
      goal,
      theme,
      pageTarget: finalPageTarget,
    });

    trace.push({
      step: "schema_validator_repair",
      ok: true,
      message: "Book schema validated/repaired.",
      model: getModel(),
    });
  } catch (error) {
    usedFallback = true;

    trace.push({
      step: "agentic_generation",
      ok: false,
      message: error.message,
      model: getModel(),
      usedFallback: true,
    });

    const allChunks = await GemmaResourceChunk.find({ resourceId })
      .sort({ index: 1 })
      .limit(finalPageTarget)
      .lean();

    bookPayload = fallbackBook({
      resource,
      chunks: chunks.length ? chunks : allChunks,
      refs,
      goal,
      theme,
      pageTarget: finalPageTarget,
    });
  }

  const saved = await GemmaResourceBook.create({
    deviceId: finalDeviceId,
    userId,
    title: bookPayload.title,
    subtitle: bookPayload.subtitle,
    status: "ready",
    sourceResourceIds: [resource._id],
    joinedFromBookIds: [],
    theme,
    goal,
    audience,
    difficulty,
    chapters: bookPayload.chapters,
    pages: bookPayload.pages,
    sourceRefs: bookPayload.sourceRefs,
    summary: bookPayload.summary,
    concepts: bookPayload.concepts,
    generation: {
      model: getModel(),
      embeddingModel: getEmbeddingModel(),
      mode: "agentic_offline_book",
      usedFallback,
      generatedAt: new Date(),
      retrievalMode: retrieved.diagnostics?.retrievalMode || "",
    },
    agentTrace: trace,
    metadata: {
      sourceTitle: resource.title,
      sourceType: resource.sourceType,
      requestedPageTarget: finalPageTarget,
      actualPages: bookPayload.pages.length,
      retrievalDiagnostics: retrieved.diagnostics || {},
    },
  });

  await saveCache(saved);

  return saved.toClient();
}

export async function listAgenticFlipBooks({
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

export async function getAgenticFlipBook(bookId) {
  if (!isObjectId(bookId)) {
    throw new Error("Valid bookId is required.");
  }

  const book = await GemmaResourceBook.findById(bookId);

  if (!book) {
    throw new Error("Book not found.");
  }

  return book.toClient();
}

export async function joinAgenticFlipBooks({
  deviceId,
  userId = "",
  bookIds = [],
  title = "Joined Gemma Study Book",
  theme = "warm",
} = {}) {
  const ids = Array.isArray(bookIds)
    ? bookIds.filter(isObjectId).map((id) => new mongoose.Types.ObjectId(id))
    : [];

  if (ids.length < 2) {
    throw new Error("Select at least 2 books to join.");
  }

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

  await saveCache(joined);

  return joined.toClient();
}

function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function fail(res, error, status = 500) {
  console.error("[agenticBookMaker]", error);
  return res.status(status).json({
    ok: false,
    message: error?.message || "Agentic book request failed.",
  });
}

export async function handleCreateAgenticFlipBook(req, res) {
  try {
    const data = await createAgenticFlipBookFromResource({
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

export async function handleListAgenticFlipBooks(req, res) {
  try {
    const data = await listAgenticFlipBooks({
      deviceId: clean(req.params.deviceId || req.query.deviceId),
      resourceId: clean(req.query.resourceId),
      limit: req.query.limit,
    });

    return ok(res, data);
  } catch (error) {
    return fail(res, error, 400);
  }
}

export async function handleGetAgenticFlipBook(req, res) {
  try {
    const data = await getAgenticFlipBook(req.params.bookId);
    return ok(res, data);
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function handleJoinAgenticFlipBooks(req, res) {
  try {
    const data = await joinAgenticFlipBooks({
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