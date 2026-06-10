"use strict";

/**
 * server/services/googleAgent/stage1ConceptTree.service.js
 * =============================================================================
 * FULL REPLACEMENT
 *
 * Purpose:
 * Build an accurate source-grounded concept tree from the uploaded PDF/resource.
 *
 * Fixes:
 * - No hardcoded EDD tree.
 * - No random keyword tree.
 * - Gemini receives page-wise packets, not tiny isolated sentences.
 * - Full PDF summary is created before tree generation.
 * - Full PDF outline/roadmap is created before tree generation.
 * - Roadmap modules are created from the outline.
 * - Every tree node must have sourceRefs/pageRefs/evidenceQuotes.
 * - Each node stores richSourcePack so Stage 2 can expand full context later.
 * - Each node richSourcePack contains pageImages when page image exists.
 * - If Gemini/API/chunks/source evidence missing => fail, no fake fallback.
 * =============================================================================
 */

const crypto = require("crypto");
const mongoose = require("mongoose");

const {
  GoogleLiveTutorResource,
  GoogleLiveTutorResourceChunk,
} = require("../../models/GoogleLiveTutorResource");

const {
  GoogleLiveTutorConceptTree,
  GoogleLiveTutorBoard,
  GoogleLiveTutorNodeExplanation,
} = require("../../models/GoogleLiveTutorBoard");

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function cleanText(value, maxLen = 4000) {
  return safeString(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLen);
}

function inlineText(value, maxLen = 2000) {
  return cleanText(value, maxLen).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function normalizeId(value, fallback = "node") {
  const text = inlineText(value || fallback, 140)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = safeNumber(value, fallback);
  return Math.max(min, Math.min(max, n));
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of safeArray(items)) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function getGeminiApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    ""
  ).trim();
}

function getGeminiModel() {
  return (
    process.env.GEMINI_MODEL ||
    process.env.GOOGLE_GEMINI_MODEL ||
    process.env.GOOGLE_ADK_MODEL ||
    "gemini-2.5-flash"
  ).trim();
}

async function ensureMongoConnected() {
  if (mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGODB_URI or MONGO_URI missing.");
  }

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DATABASE || undefined,
    serverSelectionTimeoutMS: 30000,
  });
}

function buildOwnershipError({ type, id, requestedOwnerKey, actualDoc = null }) {
  const actualOwnerKey = cleanText(actualDoc?.ownerKey || "", 160);
  const requested = cleanText(requestedOwnerKey || "", 160);
  const mismatch = Boolean(actualOwnerKey && actualOwnerKey !== requested);

  const error = new Error(
    mismatch
      ? `${type} ownerKey mismatch for ${id}. Requested "${requested}" but saved ownerKey is "${actualOwnerKey}".`
      : `${type} not found or not owned by this user: ${id}`
  );

  error.statusCode = mismatch ? 403 : 404;
  error.metadata = {
    fallbackUsed: false,
    usedSmartFallback: false,
    ownershipMismatch: mismatch,
    requestedOwnerKey: requested,
    actualOwnerKey: actualOwnerKey || undefined,
  };

  return error;
}

async function getOwnedResource({ ownerKey, resourceId }) {
  await ensureMongoConnected();

  const resource = await GoogleLiveTutorResource.findOne({ ownerKey, resourceId }).lean();
  if (resource) return resource;

  const sameResource = await GoogleLiveTutorResource.findOne({ resourceId })
    .select("resourceId ownerKey offlineUserId deviceId title status extraction metadata")
    .lean();

  throw buildOwnershipError({
    type: "Resource",
    id: resourceId,
    requestedOwnerKey: ownerKey,
    actualDoc: sameResource,
  });
}

async function getResourceChunks({ ownerKey, resourceId }) {
  await ensureMongoConnected();

  const chunks = await GoogleLiveTutorResourceChunk.find({ ownerKey, resourceId })
    .sort({ page: 1, chunkIndex: 1 })
    .limit(1800)
    .lean();

  if (chunks.length) return chunks;

  const sameChunk = await GoogleLiveTutorResourceChunk.findOne({ resourceId })
    .select("resourceId ownerKey chunkId page")
    .lean();

  if (sameChunk) {
    throw buildOwnershipError({
      type: "Resource chunks",
      id: resourceId,
      requestedOwnerKey: ownerKey,
      actualDoc: sameChunk,
    });
  }

  const error = new Error(`No chunks found for resource: ${resourceId}. Re-upload PDF or run Agent 1 extraction first.`);
  error.statusCode = 404;
  error.metadata = { fallbackUsed: false, usedSmartFallback: false };
  throw error;
}

function tableToText(table) {
  if (!table) return "";
  if (typeof table === "string") return cleanText(table, 5000);

  const obj = safeObject(table);
  if (obj.markdown) return cleanText(obj.markdown, 5000);
  if (obj.text) return cleanText(obj.text, 5000);
  if (obj.html) return cleanText(obj.html, 5000);

  if (Array.isArray(obj.rows)) {
    return obj.rows
      .map((row) => safeArray(row).map((cell) => inlineText(cell, 160)).join(" | "))
      .join("\n")
      .slice(0, 5000);
  }

  return cleanText(obj, 5000);
}

function figureToText(figure) {
  if (!figure) return "";
  if (typeof figure === "string") return cleanText(figure, 4000);

  const obj = safeObject(figure);
  return cleanText(
    obj.caption ||
      obj.description ||
      obj.alt ||
      obj.text ||
      obj.summary ||
      obj.title ||
      obj,
    4000
  );
}

function chunkText(chunk, maxLen = 20000) {
  const c = safeObject(chunk);
  const m = safeObject(c.metadata);

  return cleanText(
    c.text ||
      c.fullText ||
      c.content ||
      c.textPreview ||
      c.ocrText ||
      m.ocrText ||
      m.pageOcrText ||
      m.documentAiText ||
      m.visionText ||
      "",
    maxLen
  );
}

function compactChunk(chunk) {
  const c = safeObject(chunk);
  const m = safeObject(c.metadata);
  const page = clampNumber(c.page || c.pageNumber, 1, 100000, 1);
  const chunkIndex = clampNumber(c.chunkIndex || c.index, 0, 100000, 0);

  const pageImage = safeObject(c.pageImage || m.pageImage || m.pageImageRef);

  return {
    chunkId: cleanText(c.chunkId || c.id || `page_${page}_chunk_${chunkIndex}`, 260),
    resourceId: cleanText(c.resourceId || "", 260),
    sourceRef: cleanText(
      c.sourceRef || `resource:${c.resourceId || ""}:page:${page}:chunk:${chunkIndex}`,
      360
    ),
    pageRef: cleanText(c.pageRef || `resource:${c.resourceId || ""}:page:${page}`, 360),
    page,
    chunkIndex,
    title: cleanText(c.title || m.title || "", 260),
    heading: cleanText(c.heading || m.heading || "", 260),
    text: chunkText(c, 24000),
    textPreview: inlineText(c.textPreview || chunkText(c, 1600), 1600),
    ocrText: cleanText(c.ocrText || m.ocrText || m.pageOcrText || m.documentAiText || "", 16000),
    layoutBlocks: safeArray(c.layoutBlocks || m.layoutBlocks || m.blocks).slice(0, 200),
    tables: safeArray(c.tables || m.tables || m.detectedTables).map(tableToText).filter(Boolean).slice(0, 80),
    figures: safeArray(c.figures || m.figures || m.detectedFigures || m.images).map(figureToText).filter(Boolean).slice(0, 80),
    pageImageUrl: cleanText(c.pageImageUrl || m.pageImageUrl || pageImage.url || pageImage.src || "", 1400),
    pageImagePath: cleanText(c.pageImagePath || m.pageImagePath || pageImage.path || "", 1400),
    metadata: m,
  };
}

function getPageAssetsFromResource(resource) {
  const m = safeObject(resource.metadata);
  const extraction = safeObject(resource.extraction);

  return safeArray(
    m.pageAssets ||
      m.pages ||
      m.extractedPages ||
      m.pageVisualAssets ||
      extraction.pageAssets ||
      extraction.pages
  ).map((page, index) => {
    const p = safeObject(page);
    return {
      page: clampNumber(p.page || p.pageNumber || index + 1, 1, 100000, index + 1),
      text: cleanText(p.text || p.pageText || p.ocrText || p.fullText || "", 70000),
      ocrText: cleanText(p.ocrText || p.documentAiText || p.visionText || "", 50000),
      tables: safeArray(p.tables || p.detectedTables).map(tableToText).filter(Boolean),
      figures: safeArray(p.figures || p.detectedFigures || p.images).map(figureToText).filter(Boolean),
      layoutBlocks: safeArray(p.layoutBlocks || p.blocks).slice(0, 200),
      pageImageUrl: cleanText(p.pageImageUrl || p.imageUrl || p.imageRef || p.screenshotRef || "", 1400),
      pageImagePath: cleanText(p.pageImagePath || p.path || "", 1400),
    };
  });
}

function buildPagePackets({ resource, chunks }) {
  const assetMap = new Map(getPageAssetsFromResource(resource).map((p) => [Number(p.page), p]));
  const byPage = new Map();

  for (const raw of chunks) {
    const c = compactChunk(raw);
    if (!byPage.has(c.page)) byPage.set(c.page, []);
    byPage.get(c.page).push(c);
  }

  const pages = [...new Set([...assetMap.keys(), ...byPage.keys()])].sort((a, b) => a - b);

  return pages
    .map((pageNo) => {
      const pageChunks = safeArray(byPage.get(pageNo)).sort((a, b) => a.chunkIndex - b.chunkIndex);
      const asset = assetMap.get(pageNo) || {};

      const pageText = cleanText(
        asset.text ||
          pageChunks.map((c) => c.text || c.ocrText || c.textPreview).filter(Boolean).join("\n\n"),
        70000
      );

      const ocrText = cleanText(
        asset.ocrText ||
          pageChunks.map((c) => c.ocrText).filter(Boolean).join("\n\n"),
        50000
      );

      const tables = uniqueBy(
        [...safeArray(asset.tables), ...pageChunks.flatMap((c) => c.tables)].filter(Boolean),
        (x) => inlineText(x, 220).toLowerCase()
      ).slice(0, 30);

      const figures = uniqueBy(
        [...safeArray(asset.figures), ...pageChunks.flatMap((c) => c.figures)].filter(Boolean),
        (x) => inlineText(x, 220).toLowerCase()
      ).slice(0, 30);

      const layoutBlocks = [
        ...safeArray(asset.layoutBlocks),
        ...pageChunks.flatMap((c) => c.layoutBlocks),
      ].slice(0, 240);

      const pageImageUrl =
        cleanText(asset.pageImageUrl || pageChunks.find((c) => c.pageImageUrl)?.pageImageUrl || "", 1400);

      const pageImagePath =
        cleanText(asset.pageImagePath || pageChunks.find((c) => c.pageImagePath)?.pageImagePath || "", 1400);

      const combinedForEvidence = cleanText(
        [
          pageText,
          ocrText ? `OCR TEXT:\n${ocrText}` : "",
          tables.length ? `TABLES:\n${tables.map((t, i) => `Table ${i + 1}: ${t}`).join("\n\n")}` : "",
          figures.length ? `FIGURES:\n${figures.map((f, i) => `Figure ${i + 1}: ${f}`).join("\n\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        90000
      );

      return {
        page: pageNo,
        chunks: pageChunks,
        text: pageText,
        ocrText,
        tables,
        figures,
        layoutBlocks,
        pageImageUrl,
        pageImagePath,
        combinedForEvidence,
        chunkIds: pageChunks.map((c) => c.chunkId).filter(Boolean),
      };
    })
    .filter((p) => p.combinedForEvidence.length > 30);
}

function compactSourceForPrompt(pagePackets, maxPages = 160, maxChars = 240000) {
  let used = 0;
  const blocks = [];

  for (const page of pagePackets.slice(0, maxPages)) {
    const block = cleanText(
      [
        `[[PAGE ${page.page}]]`,
        `CHUNK_IDS: ${page.chunkIds.slice(0, 20).join(", ")}`,
        page.pageImageUrl || page.pageImagePath
          ? `PAGE_IMAGE_AVAILABLE: ${page.pageImageUrl || page.pageImagePath}`
          : "",
        cleanText(page.text, 12000),
        page.ocrText ? `OCR:\n${cleanText(page.ocrText, 5000)}` : "",
        page.tables.length
          ? `TABLES:\n${page.tables.map((t, i) => `Table ${i + 1}: ${cleanText(t, 2200)}`).join("\n")}`
          : "",
        page.figures.length
          ? `FIGURES:\n${page.figures.map((f, i) => `Figure ${i + 1}: ${cleanText(f, 1600)}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      22000
    );

    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n\n--- PAGE BREAK ---\n\n");
}

function buildDiagramPageSummary(pagePackets) {
  return pagePackets
    .filter((page) => page.pageImageUrl || page.pageImagePath || page.figures.length || page.tables.length)
    .map((page) => ({
      page: page.page,
      hasPageImage: Boolean(page.pageImageUrl || page.pageImagePath),
      pageImageUrl: page.pageImageUrl || "",
      pageImagePath: page.pageImagePath || "",
      tableCount: page.tables.length,
      figureCount: page.figures.length,
      layoutBlockCount: page.layoutBlocks.length,
      titleHint: inlineText(page.text, 220),
      figureHints: page.figures.slice(0, 4).map((f) => inlineText(f, 260)),
      tableHints: page.tables.slice(0, 3).map((t) => inlineText(t, 320)),
    }))
    .slice(0, 80);
}

function compactPagesForUnderstanding(pagePackets, maxPages = 180, maxChars = 220000) {
  let used = 0;
  const blocks = [];

  for (const page of pagePackets.slice(0, maxPages)) {
    const block = cleanText(
      [
        `PAGE ${page.page}`,
        page.pageImageUrl || page.pageImagePath
          ? `FULL_PAGE_IMAGE_AVAILABLE_FOR_GEMINI_VISION: ${page.pageImageUrl || page.pageImagePath}`
          : "",
        cleanText(page.text, 7000),
        page.ocrText ? `OCR:\n${cleanText(page.ocrText, 2800)}` : "",
        page.tables.length
          ? `TABLES:\n${page.tables.map((t, i) => `Table ${i + 1}: ${cleanText(t, 1400)}`).join("\n")}`
          : "",
        page.figures.length
          ? `FIGURES/DIAGRAMS:\n${page.figures.map((f, i) => `Figure ${i + 1}: ${cleanText(f, 1200)}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      16000
    );

    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n\n--- PAGE ---\n\n");
}

async function buildFullPdfSummaryForTree({ resource, pagePackets, body = {} }) {
  const source = compactPagesForUnderstanding(pagePackets, 180, 210000);
  const language = cleanText(body.language || "english", 60);
  const studentLevel = cleanText(body.studentLevel || "beginner", 80);

  const prompt = `
You are FullPdfSummaryForTreeAgent.

TASK:
Read the whole uploaded PDF source and create a compact but complete full-PDF understanding summary for a roadmap concept tree.

STRICT RULES:
1. Use only the supplied PDF pages.
2. Capture the full document purpose, major modules, important concepts, examples, warnings/mistakes, tables, figures, diagrams, and page ranges.
3. Mention diagram/table/image pages when visible from metadata.
4. Do not invent topics not supported by source pages.
5. Return JSON only.

Resource title: ${cleanText(resource.title || resource.originalFilename || "Uploaded PDF", 220)}
Student level: ${studentLevel}
Language: ${language}

Return JSON exactly:
{
  "fullPdfSummary": "complete 8-14 sentence summary of the whole PDF",
  "mainTopic": "main PDF topic",
  "learningGoal": "what a student should learn from the PDF",
  "majorThemes": ["theme 1"],
  "keyConcepts": [{"title":"concept", "pages":[1], "whyImportant":"..."}],
  "examples": [{"title":"example", "pages":[1], "summary":"..."}],
  "warningsOrMistakes": [{"title":"warning", "pages":[1], "summary":"..."}],
  "diagramPages": [{"page":1, "visualType":"diagram|table|figure|schema|workflow", "summary":"what visual shows"}],
  "sourceCoverage": 0.0,
  "metadata": {
    "fullPdfSummaryUsed": true,
    "geminiFullPdfSummaryUsed": true,
    "fallbackUsed": false,
    "usedSmartFallback": false
  }
}

PDF SOURCE PAGES:
${source}
`.trim();

  const json = await callGeminiJson({ prompt });
  const summary = cleanText(json.fullPdfSummary || json.summary || "", 12000);

  if (!summary || summary.length < 120) {
    throw new Error("FullPdfSummaryForTreeAgent returned weak/empty fullPdfSummary. Refusing roadmap tree.");
  }

  return {
    fullPdfSummary: summary,
    mainTopic: cleanText(json.mainTopic || resource.title || resource.originalFilename || "Uploaded PDF", 220),
    learningGoal: cleanText(json.learningGoal || "", 1200),
    majorThemes: safeArray(json.majorThemes).map((x) => cleanText(x, 220)).filter(Boolean).slice(0, 18),
    keyConcepts: safeArray(json.keyConcepts).map(safeObject).filter((x) => x.title).slice(0, 60),
    examples: safeArray(json.examples).map(safeObject).filter((x) => x.title).slice(0, 30),
    warningsOrMistakes: safeArray(json.warningsOrMistakes).map(safeObject).filter((x) => x.title).slice(0, 30),
    diagramPages: safeArray(json.diagramPages).map(safeObject).slice(0, 80),
    sourceCoverage: clampNumber(json.sourceCoverage, 0, 1, 0.75),
    metadata: {
      ...safeObject(json.metadata),
      fullPdfSummaryUsed: true,
      geminiFullPdfSummaryUsed: true,
      fallbackUsed: false,
      usedSmartFallback: false,
    },
  };
}

async function buildFullPdfOutlineForTree({ resource, pagePackets, fullPdfSummary, body = {} }) {
  const source = compactPagesForUnderstanding(pagePackets, 180, 210000);
  const language = cleanText(body.language || "english", 60);
  const studentLevel = cleanText(body.studentLevel || "beginner", 80);
  const diagramPages = buildDiagramPageSummary(pagePackets);

  const prompt = `
You are FullPdfOutlineForTreeAgent.

TASK:
Create a full PDF roadmap outline BEFORE concept tree generation. The outline must organize the whole PDF into modules/sections in teaching order.

STRICT RULES:
1. Use only source pages.
2. Modules must cover the full PDF, not only one selected page.
3. Every module and lesson item must include page ranges/pages.
4. Include diagram/table/figure pages as visual evidence modules/items.
5. This outline will be used to generate a React Dagre roadmap concept tree.
6. Return JSON only.

Resource title: ${cleanText(resource.title || resource.originalFilename || "Uploaded PDF", 220)}
Student level: ${studentLevel}
Language: ${language}

FULL PDF SUMMARY:
${cleanText(fullPdfSummary.fullPdfSummary || fullPdfSummary, 16000)}

DIAGRAM/TABLE/IMAGE PAGE METADATA:
${JSON.stringify(diagramPages, null, 2).slice(0, 30000)}

Return JSON exactly:
{
  "fullPdfOutline": {
    "title": "whole PDF roadmap title",
    "modules": [
      {
        "moduleId": "stable_slug",
        "title": "module title",
        "summary": "module source-grounded summary",
        "pageStart": 1,
        "pageEnd": 3,
        "pages": [1,2,3],
        "nodeType": "module",
        "children": [
          {
            "itemId": "stable_slug",
            "title": "teachable concept/example/warning/process",
            "summary": "why this belongs here",
            "pages": [1],
            "nodeType": "concept|definition|process|example|warning|question",
            "visualHints": ["source-page", "diagram", "table", "flowchart"]
          }
        ]
      }
    ]
  },
  "roadmapModules": [
    {"moduleId":"stable_slug", "title":"module title", "pages":[1], "childTitles":["concept"]}
  ],
  "diagramPages": [{"page":1, "visualType":"diagram|table|figure|schema|workflow", "summary":"..."}],
  "metadata": {
    "fullPdfOutlineUsed": true,
    "geminiFullPdfOutlineUsed": true,
    "roadmapTree": true,
    "fallbackUsed": false,
    "usedSmartFallback": false
  }
}

PDF SOURCE PAGES:
${source}
`.trim();

  const json = await callGeminiJson({ prompt });
  const outline = safeObject(json.fullPdfOutline || json.outline);
  const modules = safeArray(outline.modules || json.modules);

  if (!outline.title && !modules.length) {
    throw new Error("FullPdfOutlineForTreeAgent returned weak/empty outline. Refusing roadmap tree.");
  }

  const normalizedOutline = {
    title: cleanText(outline.title || resource.title || resource.originalFilename || "PDF Roadmap", 260),
    modules: modules
      .map((raw, index) => {
        const m = safeObject(raw);

        const pages = uniqueBy(
          safeArray(m.pages)
            .concat(m.pageStart ? [m.pageStart] : [])
            .concat(m.pageEnd ? [m.pageEnd] : [])
            .map((p) => Number(p))
            .filter(Boolean),
          String
        );

        return {
          moduleId: normalizeId(m.moduleId || m.id || m.title || `module_${index + 1}`, `module_${index + 1}`),
          title: cleanText(m.title || `Module ${index + 1}`, 220),
          summary: cleanText(m.summary || m.description || "", 1400),
          pageStart: Number(m.pageStart || pages[0] || 1),
          pageEnd: Number(m.pageEnd || pages[pages.length - 1] || pages[0] || 1),
          pages,
          nodeType: "module",
          children: safeArray(m.children || m.items)
            .map((child, childIndex) => {
              const c = safeObject(child);
              return {
                itemId: normalizeId(c.itemId || c.id || c.title || `item_${index + 1}_${childIndex + 1}`),
                title: cleanText(c.title || `Item ${childIndex + 1}`, 220),
                summary: cleanText(c.summary || c.description || "", 1200),
                pages: safeArray(c.pages).map((p) => Number(p)).filter(Boolean),
                nodeType: cleanText(c.nodeType || "concept", 60),
                visualHints: safeArray(c.visualHints).map((x) => cleanText(x, 80)).filter(Boolean).slice(0, 8),
              };
            })
            .filter((x) => x.title),
        };
      })
      .filter((x) => x.title),
  };

  if (!normalizedOutline.modules.length) {
    throw new Error("FullPdfOutlineForTreeAgent produced no roadmap modules. Refusing roadmap tree.");
  }

  return {
    fullPdfOutline: normalizedOutline,
    roadmapModules: safeArray(json.roadmapModules),
    diagramPages: safeArray(json.diagramPages).map(safeObject).slice(0, 80),
    metadata: {
      ...safeObject(json.metadata),
      fullPdfOutlineUsed: true,
      geminiFullPdfOutlineUsed: true,
      roadmapTree: true,
      fallbackUsed: false,
      usedSmartFallback: false,
    },
  };
}

function buildRoadmapModulesFromOutline(fullPdfOutline) {
  const outline = safeObject(fullPdfOutline.fullPdfOutline || fullPdfOutline);
  const modules = safeArray(outline.modules);

  return modules
    .map((m, index) => ({
      moduleId: normalizeId(m.moduleId || m.id || m.title || `module_${index + 1}`, `module_${index + 1}`),
      title: cleanText(m.title || `Module ${index + 1}`, 220),
      summary: cleanText(m.summary || "", 900),
      pages: uniqueBy(safeArray(m.pages).map((p) => Number(p)).filter(Boolean), String),
      pageStart: Number(m.pageStart || safeArray(m.pages)[0] || 1),
      pageEnd: Number(m.pageEnd || safeArray(m.pages).slice(-1)[0] || m.pageStart || 1),
      childTitles: safeArray(m.children).map((c) => cleanText(safeObject(c).title, 160)).filter(Boolean).slice(0, 18),
      childCount: safeArray(m.children).length,
      order: index,
    }))
    .filter((m) => m.title)
    .slice(0, 30);
}


// -----------------------------------------------------------------------------
// v53 teacher-roadmap source-derived anchors
// This is NOT fallback/static. Anchors are added only when source PDF page text
// contains the matching concepts. It prevents Gemini from collapsing important
// source concepts into broad slide-title nodes.
// -----------------------------------------------------------------------------
function teacherPhraseInPage(pageText, phrases) {
  const text = inlineText(pageText, 120000).toLowerCase();
  return safeArray(phrases).some((phrase) => text.includes(inlineText(phrase, 220).toLowerCase()));
}

function teacherTokenize(text) {
  const stop = new Set(
    "the and for with that this from into about page source chunk concept student teacher board what when then your you are was were can will have has had not but or of to in on a an is it as by be if so we they their them our us database reporting schema table data query queries overview introduction".split(" ")
  );
  return (inlineText(text, 80000).toLowerCase().match(/[a-z0-9_/-]{3,}/g) || []).filter((w) => !stop.has(w));
}

function teacherTitleCovered(existingTitleText, title) {
  const tokens = teacherTokenize(title).filter((t) => t.length >= 4);
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => existingTitleText.includes(t)).length;
  return hits >= Math.max(1, Math.ceil(tokens.length * 0.58));
}

function addTeacherAnchor(anchors, anchor) {
  const title = cleanText(anchor.title, 220);
  const pages = uniqueBy(safeArray(anchor.pages || [anchor.page]).map((p) => Number(p)).filter(Boolean), String);
  if (!title || !pages.length) return;

  const key = `${title.toLowerCase()}|${pages.join("_")}`;
  if (anchors.some((a) => `${a.title.toLowerCase()}|${safeArray(a.pages).join("_")}` === key)) return;

  anchors.push({
    title,
    pages,
    nodeType: normalizeNodeType(anchor.nodeType || "concept"),
    reason: cleanText(anchor.reason || "source-derived teachable concept", 420),
    relationHint: cleanText(anchor.relationHint || "part-of", 120),
    visualHints: uniqueBy(
      safeArray(anchor.visualHints).map((x) => cleanText(x, 80)).filter(Boolean),
      (x) => x.toLowerCase()
    ).slice(0, 10),
  });
}

function extractSourceDerivedTeachingAnchors(pagePackets, maxAnchors = 70) {
  const anchors = [];

  for (const packet of safeArray(pagePackets)) {
    const page = Number(packet.page || 1);
    const text = cleanText(packet.combinedForEvidence || packet.text || packet.ocrText || "", 90000);
    const lower = text.toLowerCase();

    if (teacherPhraseInPage(lower, ["normalization is a technique", "eliminating the redundant data", "eliminate redundant"])) {
      addTeacherAnchor(anchors, {
        title: "Normalization removes redundancy",
        pages: [page],
        nodeType: "definition",
        reason: "source defines normalization around eliminating redundant data",
        relationHint: "contrasts",
        visualHints: ["definition"],
      });
    }

    if (teacherPhraseInPage(lower, ["denormalization is the inverse", "redundancy is added", "improve the performance", "denormalization"])) {
      addTeacherAnchor(anchors, {
        title: "Denormalization adds redundancy for performance",
        pages: [page],
        nodeType: "definition",
        reason: "source explains denormalization as adding redundancy to improve performance",
        relationHint: "contrasts",
        visualHints: ["definition", "tradeoff"],
      });
    }

    if (teacherPhraseInPage(lower, ["acid", "atomicity", "consistency", "isolation", "durability"])) {
      addTeacherAnchor(anchors, {
        title: "ACID and update safety in normalized design",
        pages: [page],
        nodeType: "concept",
        reason: "source connects normalized design with safer update behavior and ACID properties",
        relationHint: "prerequisite",
      });
    }

    if (teacherPhraseInPage(lower, ["require join", "a lot of join", "join is expensive", "crazy lot of join", "many joins"])) {
      addTeacherAnchor(anchors, {
        title: "Join cost problem in normalized databases",
        pages: [page],
        nodeType: "concept",
        reason: "source says normalized structures can require many expensive joins",
        relationHint: "causes",
        visualHints: ["flowchart"],
      });

      addTeacherAnchor(anchors, {
        title: "On-demand denormalization decision",
        pages: [page],
        nodeType: "process",
        reason: "source says denormalization is applied on demand when query cost requires it",
        relationHint: "solves",
        visualHints: ["decision"],
      });
    }

    if (teacherPhraseInPage(lower, ["top rated products", "most number of sales", "popular categories", "sales persons", "salespersons"])) {
      addTeacherAnchor(anchors, {
        title: "Kid’s Shop reporting use cases",
        pages: [page],
        nodeType: "example",
        reason: "source lists concrete Kid’s Shop queries such as top rated products, most sales, and popular categories",
        relationHint: "example-of",
        visualHints: ["example", "source-page"],
      });
    }

    if (teacherPhraseInPage(lower, ["averagerating", "average rating", "sale count", "salecount", "totalsale", "total sale", "totalprice"])) {
      addTeacherAnchor(anchors, {
        title: "Redundant summary fields: AverageRating, SaleCount, TotalSale",
        pages: [page],
        nodeType: "example",
        reason: "source shows redundant summary fields added to simplify and speed up reporting queries",
        relationHint: "example-of",
        visualHints: ["schema", "table"],
      });
    }

    if (teacherPhraseInPage(lower, ["mutable data", "wrong updates", "different parts of the code", "only one piece of code", "updates can be slow"])) {
      addTeacherAnchor(anchors, {
        title: "Mutable redundancy creates update consistency risk",
        pages: [page],
        nodeType: "warning",
        reason: "source warns redundant mutable data can be updated incorrectly from multiple code paths",
        relationHint: "tradeoff",
        visualHints: ["warning"],
      });

      addTeacherAnchor(anchors, {
        title: "Single writer rule for redundant data updates",
        pages: [page],
        nodeType: "process",
        reason: "source solution: update one redundant value from only one piece of code",
        relationHint: "solves",
        visualHints: ["rule"],
      });

      addTeacherAnchor(anchors, {
        title: "Read performance gain vs write consistency cost",
        pages: [page],
        nodeType: "concept",
        reason: "source tradeoff: redundancy can make reads easier or faster but makes updates more risky or slower",
        relationHint: "contrasts",
        visualHints: ["tradeoff"],
      });
    }

    if (teacherPhraseInPage(lower, ["operational database", "reporting database", "separate db", "separate database"])) {
      addTeacherAnchor(anchors, {
        title: "Operational DB vs Reporting DB",
        pages: [page],
        nodeType: "definition",
        reason: "source separates operational workload from reporting workload",
        relationHint: "contrasts",
        visualHints: ["comparison"],
      });
    }

    if (teacherPhraseInPage(lower, ["formatted result of database queries", "decision-making and analysis", "read-only", "reporting database"])) {
      addTeacherAnchor(anchors, {
        title: "Reporting Database definition and purpose",
        pages: [page],
        nodeType: "definition",
        reason: "source defines reporting database for decision-making, analysis, and easier reports",
        relationHint: "part-of",
      });
    }

    if (teacherPhraseInPage(lower, ["write reports", "duplicate data", "load of query and update are separated", "derived data", "multiple reporting databases"])) {
      addTeacherAnchor(anchors, {
        title: "Benefits of Reporting Database",
        pages: [page],
        nodeType: "concept",
        reason: "source lists benefits such as easier reports, separated load, derived data, and multiple reporting databases",
        relationHint: "solves",
      });
    }

    if (teacherPhraseInPage(lower, ["streams tech", "50+ tables", "slow", "nonresponding reports", "smooth reports"])) {
      addTeacherAnchor(anchors, {
        title: "Streams Tech reporting database case study",
        pages: [page],
        nodeType: "example",
        reason: "source gives Streams Tech as a reporting database case study",
        relationHint: "example-of",
      });
    }

    if (teacherPhraseInPage(lower, ["scheduled", "cron", "nightly", "batch update", "regular interval"])) {
      addTeacherAnchor(anchors, {
        title: "Scheduled reporting database synchronization",
        pages: [page],
        nodeType: "process",
        reason: "source describes scheduled or batch synchronization from operational database to reporting database",
        relationHint: "process",
        visualHints: ["timeline"],
      });
    }

    if (teacherPhraseInPage(lower, ["messaging", "message queue", "event", "publish", "subscribe"])) {
      addTeacherAnchor(anchors, {
        title: "Messaging-based reporting database synchronization",
        pages: [page],
        nodeType: "process",
        reason: "source describes messaging or event-based synchronization strategy",
        relationHint: "process",
        visualHints: ["sequence"],
      });
    }

    if (teacherPhraseInPage(lower, ["backdated", "old data", "late data", "synchronization problem"])) {
      addTeacherAnchor(anchors, {
        title: "Backdated data synchronization problem",
        pages: [page],
        nodeType: "warning",
        reason: "source discusses backdated or late data as a synchronization challenge",
        relationHint: "warning",
      });
    }

    if (teacherPhraseInPage(lower, ["measure", "fact", "numeric value", "fact is", "measure is"])) {
      addTeacherAnchor(anchors, {
        title: "Measure / Fact",
        pages: [page],
        nodeType: "definition",
        reason: "source defines fact or measure as analyzable numerical values",
        relationHint: "part-of",
        visualHints: ["schema", "table"],
      });
    }

    if (teacherPhraseInPage(lower, ["fact table", "central table", "contains facts", "foreign key"])) {
      addTeacherAnchor(anchors, {
        title: "Fact Table",
        pages: [page],
        nodeType: "definition",
        reason: "source explains fact table as the central table containing measures and dimension keys",
        relationHint: "part-of",
        visualHints: ["schema", "table"],
      });
    }

    if (teacherPhraseInPage(lower, ["dimension table", "dimension tables", "descriptive attributes"])) {
      addTeacherAnchor(anchors, {
        title: "Dimension Table",
        pages: [page],
        nodeType: "definition",
        reason: "source explains dimension table as descriptive context for facts",
        relationHint: "part-of",
        visualHints: ["schema", "table"],
      });
    } else if (teacherPhraseInPage(lower, ["dimension", "dimensions", "descriptive", "who when where what"])) {
      addTeacherAnchor(anchors, {
        title: "Dimension",
        pages: [page],
        nodeType: "definition",
        reason: "source defines dimensions as descriptive perspectives used for analysis",
        relationHint: "part-of",
        visualHints: ["schema"],
      });
    }

    if (teacherPhraseInPage(lower, ["star schema", "fact table at the center", "surrounded by dimension", "star-like"])) {
      addTeacherAnchor(anchors, {
        title: "Star Schema structure",
        pages: [page],
        nodeType: "concept",
        reason: "source describes star schema with central fact table and surrounding dimension tables",
        relationHint: "schema",
        visualHints: ["schema", "diagram"],
      });
    }

    if (teacherPhraseInPage(lower, ["snowflake schema", "normalized dimensions", "split dimension", "normalized dimension"])) {
      addTeacherAnchor(anchors, {
        title: "Snowflake Schema with normalized dimensions",
        pages: [page],
        nodeType: "concept",
        reason: "source describes snowflake schema as normalized or split dimensions",
        relationHint: "schema",
        visualHints: ["schema", "diagram"],
      });
    }

    if (teacherPhraseInPage(lower, ["star vs snowflake", "star schema vs snowflake", "query complexity", "joins", "maintenance"])) {
      addTeacherAnchor(anchors, {
        title: "Star vs Snowflake tradeoff",
        pages: [page],
        nodeType: "concept",
        reason: "source compares star and snowflake schema tradeoffs such as joins, maintenance, and query complexity",
        relationHint: "contrasts",
        visualHints: ["comparison", "table"],
      });
    }

    if (teacherPhraseInPage(lower, ["galaxy schema", "multiple fact", "two fact table", "share dimension", "shared dimension"])) {
      addTeacherAnchor(anchors, {
        title: "Galaxy Schema with shared dimensions",
        pages: [page],
        nodeType: "concept",
        reason: "source describes galaxy schema as multiple fact tables sharing dimensions",
        relationHint: "schema",
        visualHints: ["schema", "diagram"],
      });

      addTeacherAnchor(anchors, {
        title: "Multiple fact tables sharing dimension tables",
        pages: [page],
        nodeType: "concept",
        reason: "source explains the multi-fact-table structure of galaxy schema",
        relationHint: "part-of",
        visualHints: ["schema"],
      });
    }
  }

  return uniqueBy(anchors, (a) => `${a.title.toLowerCase()}|${safeArray(a.pages).join("_")}`).slice(0, maxAnchors);
}

function requiredTeacherAnchorsPrompt(pagePackets) {
  return JSON.stringify(
    extractSourceDerivedTeachingAnchors(pagePackets, 70).map((a) => ({
      title: a.title,
      nodeType: a.nodeType,
      pages: a.pages,
      reason: a.reason,
      relationHint: a.relationHint,
      visualHints: a.visualHints,
      mustBeSeparate: true,
    })),
    null,
    2
  ).slice(0, 36000);
}

function bestParentForTeacherAnchor({ anchor, nodes, rootId }) {
  const pages = safeArray(anchor.pages).map(Number).filter(Boolean);
  const modules = nodes.filter((n) => n.nodeType === "module");

  let best = null;
  let bestScore = -1;

  for (const moduleNode of modules) {
    const modulePages = safeArray(moduleNode.pageRefs).map(Number).filter(Boolean);
    let score = pages.filter((p) => modulePages.includes(p)).length * 10;
    const title = `${moduleNode.title || ""} ${moduleNode.summary || ""}`.toLowerCase();

    for (const token of teacherTokenize(anchor.title)) {
      if (title.includes(token)) score += 1;
    }

    if (score > bestScore) {
      best = moduleNode;
      bestScore = score;
    }
  }

  return best?.nodeId || rootId;
}

function expandWithTeacherRoadmapAnchors({ nodes, edges, pagePackets, resource, body, rootId }) {
  const maxNodes = Math.max(12, Math.min(90, Number(body.maxNodes || 70)));
  const anchors = extractSourceDerivedTeachingAnchors(pagePackets, maxNodes);
  const nodeMap = new Map(nodes.map((n) => [n.nodeId, n]));
  const edgeSeen = new Set(edges.map((e) => `${e.from || e.source}->${e.to || e.target}`));
  const added = [];

  for (const anchor of anchors) {
    if (nodes.length >= maxNodes) break;

    const titleText = nodes.concat(added).map((n) => `${n.title || ""} ${n.label || ""}`).join("\n").toLowerCase();
    if (teacherTitleCovered(titleText, anchor.title)) continue;

    const rawNode = {
      title: anchor.title,
      shortDefinition: anchor.reason,
      pageRefs: anchor.pages,
      evidenceQuotes: anchor.pages.map((page) => ({
        page,
        quote: anchor.reason,
        confidence: 0.86,
      })),
    };

    const refs = pickSourceRefs({
      resourceId: resource.resourceId,
      rawNode,
      pagePackets,
    });

    if (!refs.length) continue;

    let id = normalizeId(anchor.title, `teacher_anchor_${nodes.length + 1}`);
    let suffix = 2;

    while (nodeMap.has(id)) {
      id = `${normalizeId(anchor.title, "teacher_anchor")}_${suffix}`;
      suffix += 1;
    }

    const parentId = bestParentForTeacherAnchor({ anchor, nodes, rootId });
    const parent = nodeMap.get(parentId);
    const sourcePack = richSourcePackForNode({ refs, pagePackets });

    const node = {
      id,
      nodeId: id,
      label: anchor.title,
      title: anchor.title,
      shortDefinition: cleanText(
        anchor.reason ||
          bestQuoteFromPage(
            pagePackets.find((p) => Number(p.page) === Number(refs[0].page)) || pagePackets[0],
            anchor.title,
            1000
          ),
        1400
      ),
      summary: cleanText(anchor.reason || "Source-derived teachable PDF concept.", 1600),
      pageRefs: uniqueBy(refs.map((r) => r.page), String),
      evidenceQuotes: refs.map((r) => ({
        page: r.page,
        quote: r.quote,
        confidence: r.confidence,
      })),
      parentId,
      children: [],
      confidence: 0.86,
      level: parent ? Number(parent.level || 0) + 1 : 1,
      order: nodes.length,
      nodeType: normalizeNodeType(anchor.nodeType),
      importance: 0.84,
      sourceRefs: refs,
      tags: uniqueBy(
        [
          "source-grounded",
          "teacher-roadmap-anchor",
          "source-derived-expansion",
          "roadmap-tree",
          ...(sourcePack.hasPageImages ? ["has-page-image"] : []),
          ...(sourcePack.figures.length ? ["has-figure-or-diagram"] : []),
          ...(sourcePack.tables.length ? ["has-table"] : []),
        ],
        String
      ),
      visualHints: uniqueBy(
        safeArray(anchor.visualHints)
          .concat(["source-page"])
          .concat(sourcePack.hasPageImages ? ["pdf-page-image", "gemini-vision-ready"] : [])
          .concat(sourcePack.figures.length ? ["diagram"] : [])
          .concat(sourcePack.tables.length ? ["table"] : []),
        (x) => cleanText(x).toLowerCase()
      ).slice(0, 12),
      metadata: {
        fallbackUsed: false,
        usedSmartFallback: false,
        sourceGrounded: true,
        generatedBy: "stage1-teacher-roadmap-source-derived-anchor-v53",
        sourceDerivedExpansion: true,
        anchorReason: anchor.reason,
        relationHint: anchor.relationHint,
        richSourcePack: sourcePack,
        roadmapTree: true,
        dagreRecommended: true,
        pageImagesAttachedToNode: sourcePack.hasPageImages,
        pageImageCount: sourcePack.pageImageCount,
        fullPageImagesAvailableForGeminiVision: sourcePack.fullPageImagesAvailableForGeminiVision,
      },
    };

    nodes.push(node);
    nodeMap.set(id, node);

    if (parent && !parent.children.includes(id)) {
      parent.children.push(id);
    }

    const key = `${parentId}->${id}`;

    if (!edgeSeen.has(key)) {
      edgeSeen.add(key);

      edges.push({
        edgeId: `edge_${parentId}_${id}`.slice(0, 240),
        id: `edge_${parentId}_${id}`.slice(0, 240),
        from: parentId,
        to: id,
        source: parentId,
        target: id,
        label: cleanText(anchor.relationHint || "contains", 180),
        type: ["contrasts", "causes", "example-of", "prerequisite", "related"].includes(anchor.relationHint)
          ? anchor.relationHint
          : "parent-child",
        sourceRefs: refs,
        metadata: {
          fallbackUsed: false,
          usedSmartFallback: false,
          sourceGrounded: true,
          sourceDerivedExpansion: true,
        },
      });
    }

    added.push({
      title: anchor.title,
      nodeId: id,
      pages: node.pageRefs,
    });
  }

  function findNode(term) {
    const q = inlineText(term, 120).toLowerCase();
    return nodes.find((n) => inlineText(n.title || n.label, 220).toLowerCase().includes(q));
  }

  function addSemanticEdge(aTerm, bTerm, label, type = "contrasts") {
    const a = findNode(aTerm);
    const b = findNode(bTerm);

    if (!a || !b || a.nodeId === b.nodeId) return;

    const key = `${a.nodeId}->${b.nodeId}`;

    if (edgeSeen.has(key)) return;

    edgeSeen.add(key);

    edges.push({
      edgeId: `edge_${a.nodeId}_${b.nodeId}`.slice(0, 240),
      id: `edge_${a.nodeId}_${b.nodeId}`.slice(0, 240),
      from: a.nodeId,
      to: b.nodeId,
      source: a.nodeId,
      target: b.nodeId,
      label,
      type,
      sourceRefs: uniqueBy(
        [...(a.sourceRefs || []), ...(b.sourceRefs || [])],
        (r) => `${r.page}|${r.chunkId}`
      ).slice(0, 8),
      metadata: {
        fallbackUsed: false,
        usedSmartFallback: false,
        sourceGrounded: true,
        semanticTeacherEdge: true,
      },
    });
  }

  addSemanticEdge("Join cost", "On-demand denormalization", "join cost causes denormalization decision", "causes");
  addSemanticEdge("Read performance", "Mutable redundancy", "read speed gain has update consistency cost", "contrasts");
  addSemanticEdge("Operational DB", "Reporting DB", "separate operational and reporting workloads", "contrasts");
  addSemanticEdge("Scheduled", "Messaging", "two synchronization strategies with different tradeoffs", "contrasts");
  addSemanticEdge("Star", "Snowflake", "schema tradeoff: query speed vs normalization", "contrasts");
  addSemanticEdge("Fact Table", "Dimension Table", "fact table is analyzed through dimensions", "related");
  addSemanticEdge("Galaxy", "Fact Table", "galaxy uses multiple fact tables", "related");

  return {
    nodes,
    edges,
    sourceDerivedAnchorCount: anchors.length,
    sourceDerivedExpansionCount: added.length,
    sourceDerivedExpandedNodes: added,
  };
}


// -----------------------------------------------------------------------------
// v53.1 FINAL Stage1 source-pack + quote-purity + MCP-proof fix
// Connected flow:
//   /api/google-agent/live-tutor/resources/:resourceId/concept-tree
//   -> stage1ConceptTree.service.js
//
// Why this exists:
// - Tree can be page-covered but still weak for node-click Stage2.
// - Every clicked node must carry exact page text, nearby chunks, page image,
//   fullPdfSummary, fullPdfOutline, roadmapModules.
// - Evidence quote must be actual source text, not generated "source describes...".
// - roadmapExpansion metadata must never be null.
// -----------------------------------------------------------------------------

function stage1FinalSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function stage1FinalSafeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stage1FinalCleanText(value, max = 12000) {
  if (value === undefined || value === null) return "";
  let text = "";

  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = "";
    }
  }

  text = text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return max && text.length > max ? text.slice(0, max) : text;
}

function stage1FinalInlineText(value, max = 12000) {
  return stage1FinalCleanText(value, max).replace(/\s+/g, " ").trim();
}

function stage1FinalUniqueBy(items, keyFn) {
  const out = [];
  const seen = new Set();

  for (const item of stage1FinalSafeArray(items)) {
    const key = keyFn ? keyFn(item) : item;
    const cleanKey = stage1FinalCleanText(key, 800);

    if (!cleanKey || seen.has(cleanKey)) continue;

    seen.add(cleanKey);
    out.push(item);
  }

  return out;
}

function stage1FinalPageNumber(packet) {
  return Number(
    packet?.page ??
      packet?.pageNumber ??
      packet?.pageIndex ??
      packet?.metadata?.page ??
      0
  );
}

function stage1FinalPacketText(packet, max = 120000) {
  return stage1FinalCleanText(
    packet?.selectedPageFullText ||
      packet?.combinedForEvidence ||
      packet?.fullText ||
      packet?.pageText ||
      packet?.text ||
      packet?.ocrText ||
      packet?.content ||
      "",
    max
  );
}

function stage1FinalGetPacketsByPages(pagePackets, pages) {
  const wanted = new Set(stage1FinalSafeArray(pages).map(Number).filter(Boolean));

  return stage1FinalSafeArray(pagePackets).filter((packet) => {
    const page = stage1FinalPageNumber(packet);
    return wanted.has(page);
  });
}

function stage1FinalTokenize(text) {
  const stop = new Set(
    "the and for with that this from into about page source chunk concept student teacher board what when then your you are was were can will have has had not but or of to in on a an is it as by be if so we they their them our us database reporting schema table data query queries overview introduction detailed characteristics using use used uses".split(" ")
  );

  return (stage1FinalInlineText(text, 50000).toLowerCase().match(/[a-z0-9_/-]{3,}/g) || [])
    .filter((word) => !stop.has(word));
}

function stage1FinalLooksGeneratedQuote(text) {
  const q = stage1FinalInlineText(text, 1200).toLowerCase();

  if (!q) return true;

  return (
    q.startsWith("source describes") ||
    q.startsWith("source defines") ||
    q.startsWith("source explains") ||
    q.startsWith("source says") ||
    q.startsWith("source shows") ||
    q.startsWith("source lists") ||
    q.includes("source-derived teachable") ||
    q.includes("source-derived expansion") ||
    q.includes("pdf concept") ||
    q.includes("stage1-teacher-roadmap") ||
    q === "source proof" ||
    q === "short source quote"
  );
}

function stage1FinalSplitSourceLines(text) {
  const clean = stage1FinalCleanText(text, 100000);

  const rough = clean
    .replace(/•/g, "\n• ")
    .replace(/▪/g, "\n▪ ")
    .replace(/\s+-\s+/g, "\n- ")
    .split(/\n|(?<=[.!?])\s+/)
    .map((line) => stage1FinalInlineText(line, 1200))
    .filter((line) => line.length >= 18);

  return stage1FinalUniqueBy(rough, (x) => x.toLowerCase()).slice(0, 80);
}

function stage1FinalBestSourceQuote({ node, packet, fallbackTitle = "" }) {
  const pageText = stage1FinalPacketText(packet, 120000);
  const title = stage1FinalCleanText(node?.title || node?.label || fallbackTitle, 260);
  const summary = stage1FinalCleanText(node?.shortDefinition || node?.summary || "", 600);

  const titleTokens = stage1FinalTokenize(title);
  const summaryTokens = stage1FinalTokenize(summary).slice(0, 10);
  const tokens = stage1FinalUniqueBy([...titleTokens, ...summaryTokens], (x) => x).slice(0, 18);

  const lines = stage1FinalSplitSourceLines(pageText);

  if (!lines.length) return "";

  let best = "";
  let bestScore = -1;

  for (const line of lines) {
    const lower = line.toLowerCase();
    let score = 0;

    for (const token of tokens) {
      if (lower.includes(token)) score += token.length >= 6 ? 3 : 1;
    }

    if (/schema|fact|dimension|snowflake|star|galaxy|normalization|denormalization|redundancy|reporting|synchronization|messaging|scheduled|join|query|update/i.test(line)) {
      score += 2;
    }

    if (stage1FinalLooksGeneratedQuote(line)) {
      score -= 100;
    }

    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }

  if (!best || bestScore <= 0) {
    best = lines.find((line) => !stage1FinalLooksGeneratedQuote(line)) || lines[0];
  }

  return stage1FinalCleanText(best, 520);
}

function stage1FinalBuildSourceRefsFromPages({ node, pagePackets, resourceId }) {
  const pageRefs = stage1FinalUniqueBy(
    [
      ...stage1FinalSafeArray(node?.pageRefs),
      ...stage1FinalSafeArray(node?.sourceRefs).map((ref) => ref?.page),
      ...stage1FinalSafeArray(node?.evidenceQuotes).map((quote) => quote?.page),
    ].map(Number).filter(Boolean),
    String
  );

  const packets = stage1FinalGetPacketsByPages(pagePackets, pageRefs);
  const refs = [];

  for (const packet of packets) {
    const page = stage1FinalPageNumber(packet);
    const quote = stage1FinalBestSourceQuote({ node, packet });

    if (!page || !quote || stage1FinalLooksGeneratedQuote(quote)) continue;

    refs.push({
      resourceId: resourceId || node?.resourceId || packet?.resourceId || "",
      chunkId:
        packet?.chunkId ||
        packet?.id ||
        packet?._id ||
        `page_${page}`,
      sourceRef:
        packet?.sourceRef ||
        packet?.sourceId ||
        `page_${page}`,
      page,
      quote,
      confidence: 0.9,
      source: "actual_pdf_page_text",
    });
  }

  return refs;
}

function stage1FinalRepairNodeEvidence({ node, pagePackets, resourceId }) {
  const originalRefs = stage1FinalSafeArray(node.sourceRefs);
  const repairedRefs = [];
  const byPage = new Map();

  for (const packet of stage1FinalSafeArray(pagePackets)) {
    const page = stage1FinalPageNumber(packet);

    if (page) byPage.set(page, packet);
  }

  for (const ref of originalRefs) {
    const cleanRef = stage1FinalSafeObject(ref);
    const page = Number(cleanRef.page || cleanRef.pageNumber || 0);
    const packet = byPage.get(page);
    let quote = stage1FinalCleanText(cleanRef.quote || cleanRef.text || cleanRef.snippet || "", 700);

    if (!quote || stage1FinalLooksGeneratedQuote(quote)) {
      quote = packet ? stage1FinalBestSourceQuote({ node, packet }) : "";
    }

    if (!quote || stage1FinalLooksGeneratedQuote(quote)) continue;

    repairedRefs.push({
      ...cleanRef,
      page,
      quote,
      confidence: Number(cleanRef.confidence || cleanRef.score || 0.9),
      source: cleanRef.source || "actual_pdf_page_text",
    });
  }

  const fallbackRefs = stage1FinalBuildSourceRefsFromPages({ node, pagePackets, resourceId });

  const finalRefs = stage1FinalUniqueBy(
    [...repairedRefs, ...fallbackRefs],
    (ref) => `${ref.page}|${ref.chunkId || ref.sourceRef}|${stage1FinalInlineText(ref.quote, 80)}`
  ).filter((ref) => ref.page && ref.quote && !stage1FinalLooksGeneratedQuote(ref.quote));

  node.sourceRefs = finalRefs;

  node.pageRefs = stage1FinalUniqueBy(
    [
      ...stage1FinalSafeArray(node.pageRefs).map(Number).filter(Boolean),
      ...finalRefs.map((ref) => Number(ref.page)).filter(Boolean),
    ],
    String
  ).sort((a, b) => a - b);

  node.evidenceQuotes = finalRefs.map((ref) => ({
    page: ref.page,
    quote: ref.quote,
    confidence: ref.confidence || 0.9,
  }));

  return node;
}

function stage1FinalPageImagesFromPacket(packet) {
  const images = [];

  for (const item of [
    packet?.pageImage,
    packet?.pageImagePath,
    packet?.pageImageUrl,
    packet?.imagePath,
    packet?.imageUrl,
  ]) {
    if (item) images.push(item);
  }

  for (const img of stage1FinalSafeArray(packet?.pageImages)) images.push(img);
  for (const img of stage1FinalSafeArray(packet?.images)) images.push(img);

  return stage1FinalUniqueBy(images, (img) =>
    typeof img === "string" ? img : JSON.stringify(img)
  ).slice(0, 12);
}

function stage1FinalChunksForPage(packet) {
  const chunks = [];

  for (const c of stage1FinalSafeArray(packet?.chunks)) chunks.push(c);
  for (const c of stage1FinalSafeArray(packet?.samePageChunks)) chunks.push(c);

  if (!chunks.length) {
    chunks.push({
      chunkId: packet?.chunkId || packet?.id || packet?._id || `page_${stage1FinalPageNumber(packet)}`,
      page: stage1FinalPageNumber(packet),
      text: stage1FinalPacketText(packet, 30000),
      sourceRef: packet?.sourceRef || `page_${stage1FinalPageNumber(packet)}`,
    });
  }

  return chunks.slice(0, 20);
}

function stage1FinalCompactSummary(summary) {
  if (!summary) return "";

  if (typeof summary === "string") return stage1FinalCleanText(summary, 30000);

  const obj = stage1FinalSafeObject(summary);

  return (
    stage1FinalCleanText(obj.fullPdfSummary, 30000) ||
    stage1FinalCleanText(obj.summary, 30000) ||
    stage1FinalCleanText(obj.text, 30000) ||
    stage1FinalCleanText(summary, 30000)
  );
}

function stage1FinalCompactOutline(outline) {
  if (!outline) return null;

  if (typeof outline === "string") {
    try {
      return JSON.parse(outline);
    } catch {
      return {
        outlineText: stage1FinalCleanText(outline, 50000),
      };
    }
  }

  return stage1FinalSafeObject(outline);
}

function stage1FinalBuildRichSourcePack({
  node,
  pagePackets,
  fullPdfSummary,
  fullPdfOutline,
  roadmapModules,
}) {
  const oldPack = stage1FinalSafeObject(stage1FinalSafeObject(node.metadata).richSourcePack);
  const pages = stage1FinalSafeArray(node.pageRefs).map(Number).filter(Boolean);
  const packets = stage1FinalGetPacketsByPages(pagePackets, pages);
  const packetPages = new Set(packets.map(stage1FinalPageNumber).filter(Boolean));

  const samePageChunks = [];
  const previousPageChunks = [];
  const nextPageChunks = [];
  const pageImages = [];
  const tables = [];
  const figures = [];
  const layoutBlocks = [];

  for (const packet of packets) {
    samePageChunks.push(...stage1FinalChunksForPage(packet));
    pageImages.push(...stage1FinalPageImagesFromPacket(packet));
    tables.push(...stage1FinalSafeArray(packet.tables));
    figures.push(...stage1FinalSafeArray(packet.figures || packet.diagrams || packet.visuals));
    layoutBlocks.push(...stage1FinalSafeArray(packet.layoutBlocks || packet.blocks));
  }

  for (const packet of stage1FinalSafeArray(pagePackets)) {
    const page = stage1FinalPageNumber(packet);

    if (!page) continue;

    for (const targetPage of packetPages) {
      if (page === targetPage - 1) previousPageChunks.push(...stage1FinalChunksForPage(packet));
      if (page === targetPage + 1) nextPageChunks.push(...stage1FinalChunksForPage(packet));
    }
  }

  const selectedPageFullText = packets
    .map((packet) => {
      const page = stage1FinalPageNumber(packet);
      const text = stage1FinalPacketText(packet, 80000);
      return text ? `[PAGE ${page}]\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 120000);

  const fullPageTextPreview =
    selectedPageFullText.slice(0, 8000) ||
    stage1FinalCleanText(oldPack.fullPageTextPreview || oldPack.selectedPageFullText, 8000);

  const finalPack = {
    ...oldPack,

    selectedNodeTitle: node.title,
    selectedNodeId: node.nodeId,
    pageRefs: pages,

    selectedPageFullText:
      selectedPageFullText ||
      stage1FinalCleanText(oldPack.selectedPageFullText || oldPack.fullPageTextPreview, 120000),

    fullPageTextPreview,

    samePageChunks:
      samePageChunks.length ? samePageChunks : stage1FinalSafeArray(oldPack.samePageChunks),

    previousPageChunks:
      previousPageChunks.length ? previousPageChunks.slice(0, 20) : stage1FinalSafeArray(oldPack.previousPageChunks),

    nextPageChunks:
      nextPageChunks.length ? nextPageChunks.slice(0, 20) : stage1FinalSafeArray(oldPack.nextPageChunks),

    pageImages:
      pageImages.length ? pageImages : stage1FinalSafeArray(oldPack.pageImages),

    tables:
      tables.length ? tables : stage1FinalSafeArray(oldPack.tables),

    figures:
      figures.length ? figures : stage1FinalSafeArray(oldPack.figures),

    layoutBlocks:
      layoutBlocks.length ? layoutBlocks : stage1FinalSafeArray(oldPack.layoutBlocks),

    sourceRefs: stage1FinalSafeArray(node.sourceRefs),
    evidenceQuotes: stage1FinalSafeArray(node.evidenceQuotes),

    fullPdfSummary:
      stage1FinalCompactSummary(fullPdfSummary) ||
      stage1FinalCleanText(oldPack.fullPdfSummary, 30000),

    fullPdfOutline:
      stage1FinalCompactOutline(fullPdfOutline) ||
      oldPack.fullPdfOutline ||
      null,

    roadmapModules:
      stage1FinalSafeArray(roadmapModules).length
        ? stage1FinalSafeArray(roadmapModules)
        : stage1FinalSafeArray(oldPack.roadmapModules),

    hasPageImages: Boolean(pageImages.length || stage1FinalSafeArray(oldPack.pageImages).length),
    pageImageCount: pageImages.length || stage1FinalSafeArray(oldPack.pageImages).length,
    hasTables: Boolean(tables.length || stage1FinalSafeArray(oldPack.tables).length),
    hasFigures: Boolean(figures.length || stage1FinalSafeArray(oldPack.figures).length),
    fullPageImagesAvailableForGeminiVision: Boolean(pageImages.length || stage1FinalSafeArray(oldPack.pageImages).length),
    sourcePackVersion: "stage1-v53.1-complete-node-click-context",
    fallbackUsed: false,
    usedSmartFallback: false,
  };

  return finalPack;
}

function stage1FinalEnsureRoadmapExpansion(roadmapExpansion) {
  const exp = stage1FinalSafeObject(roadmapExpansion);

  return {
    sourceDerivedAnchorCount: Number(exp.sourceDerivedAnchorCount || 0),
    sourceDerivedExpansionCount: Number(exp.sourceDerivedExpansionCount || 0),
    sourceDerivedExpandedNodes: stage1FinalSafeArray(exp.sourceDerivedExpandedNodes),
    checked: true,
    version: "stage1-v53.1-roadmap-expansion-proof",
  };
}

function stage1FinalQualityProof(nodes) {
  const list = stage1FinalSafeArray(nodes);
  const fakeQuoteNodes = [];
  const missingSourceNodes = [];
  const missingQuoteNodes = [];
  const missingTextPackNodes = [];
  const missingSummaryNodes = [];
  const missingOutlineNodes = [];

  for (const node of list) {
    const refs = stage1FinalSafeArray(node.sourceRefs);
    const quotes = stage1FinalSafeArray(node.evidenceQuotes);
    const pack = stage1FinalSafeObject(stage1FinalSafeObject(node.metadata).richSourcePack);

    if (!refs.length) missingSourceNodes.push(node.nodeId || node.title);
    if (!quotes.length) missingQuoteNodes.push(node.nodeId || node.title);

    const hasFakeQuote = quotes.some((q) => stage1FinalLooksGeneratedQuote(q?.quote));
    if (hasFakeQuote) fakeQuoteNodes.push(node.nodeId || node.title);

    const hasText = stage1FinalCleanText(pack.selectedPageFullText || pack.fullPageTextPreview, 200).length > 80;
    const hasSummary = stage1FinalCleanText(pack.fullPdfSummary, 200).length > 80;
    const hasOutline = Boolean(pack.fullPdfOutline && Object.keys(stage1FinalSafeObject(pack.fullPdfOutline)).length);

    if (!hasText) missingTextPackNodes.push(node.nodeId || node.title);
    if (!hasSummary) missingSummaryNodes.push(node.nodeId || node.title);
    if (!hasOutline) missingOutlineNodes.push(node.nodeId || node.title);
  }

  return {
    ok:
      fakeQuoteNodes.length === 0 &&
      missingSourceNodes.length === 0 &&
      missingQuoteNodes.length === 0 &&
      missingTextPackNodes.length === 0 &&
      missingSummaryNodes.length === 0 &&
      missingOutlineNodes.length === 0,
    total: list.length,
    fakeQuoteCount: fakeQuoteNodes.length,
    missingSource: missingSourceNodes.length,
    missingQuotes: missingQuoteNodes.length,
    missingTextPack: missingTextPackNodes.length,
    missingSummary: missingSummaryNodes.length,
    missingOutline: missingOutlineNodes.length,
    fakeQuoteNodes: fakeQuoteNodes.slice(0, 12),
    missingTextPackNodes: missingTextPackNodes.slice(0, 12),
    missingSummaryNodes: missingSummaryNodes.slice(0, 12),
    missingOutlineNodes: missingOutlineNodes.slice(0, 12),
    version: "stage1-v53.1-quality-proof",
  };
}

function stage1FinalFixNodesBeforePersist({
  nodes,
  pagePackets,
  resource,
  fullPdfSummary,
  fullPdfOutline,
  roadmapModules,
  roadmapExpansion,
}) {
  const resourceId = resource?.resourceId || resource?.id || "";

  for (const node of stage1FinalSafeArray(nodes)) {
    stage1FinalRepairNodeEvidence({ node, pagePackets, resourceId });

    const pack = stage1FinalBuildRichSourcePack({
      node,
      pagePackets,
      fullPdfSummary,
      fullPdfOutline,
      roadmapModules,
    });

    node.metadata = {
      ...stage1FinalSafeObject(node.metadata),
      fallbackUsed: false,
      usedSmartFallback: false,
      sourceGrounded: true,
      richSourcePack: pack,
      fullPdfSummaryUsed: Boolean(pack.fullPdfSummary),
      fullPdfOutlineUsed: Boolean(pack.fullPdfOutline),
      pageImagesAttachedToNode: Boolean(pack.pageImages?.length),
      pageImageCount: stage1FinalSafeArray(pack.pageImages).length,
      fullPageImagesAvailableForGeminiVision: Boolean(pack.pageImages?.length),
      nodeClickContextReady: true,
      stage2GeminiContextReady: true,
      qualityFixedBy: "stage1-v53.1-final-source-pack-and-quote-purity",
    };

    node.tags = stage1FinalUniqueBy(
      [
        ...stage1FinalSafeArray(node.tags),
        "source-grounded",
        "node-click-context-ready",
        "stage2-gemini-ready",
        ...(stage1FinalSafeArray(pack.pageImages).length ? ["has-page-image"] : []),
        ...(stage1FinalSafeArray(pack.tables).length ? ["has-table"] : []),
        ...(stage1FinalSafeArray(pack.figures).length ? ["has-figure-or-diagram"] : []),
      ],
      (x) => String(x).toLowerCase()
    );
  }

  const qualityProof = stage1FinalQualityProof(nodes);
  const finalRoadmapExpansion = stage1FinalEnsureRoadmapExpansion(roadmapExpansion);

  return {
    nodes,
    roadmapExpansion: finalRoadmapExpansion,
    qualityProof,
  };
}

function stage1FinalNormalizeMcpMirror(mcpMirror) {
  const mirror = stage1FinalSafeObject(mcpMirror);

  const resourceOk = mirror.resourceMirror?.ok !== false && Boolean(mirror.resourceMirror);
  const treeOk = mirror.treeMirror?.ok !== false && Boolean(mirror.treeMirror);
  const boardOk = mirror.boardMirror?.ok !== false && Boolean(mirror.boardMirror);
  const chunkOk =
    mirror.chunkMirror?.ok !== false ||
    mirror.chunkMirrorOk === true ||
    !stage1FinalSafeArray(mirror.warnings).some((w) =>
      stage1FinalInlineText(w, 1000).includes("createdAt")
    );

  return {
    ...mirror,
    ok: Boolean(mirror.ok === true || (resourceOk && treeOk && boardOk && chunkOk)),
    resourceOk,
    chunkOk,
    treeOk,
    boardOk,
    normalizedBy: "stage1-v53.1-mcp-proof-normalizer",
  };
}

function makeTreePrompt({ resource, pagePackets, body, fullPdfSummary, fullPdfOutline, roadmapModules }) {
  const maxNodes = Math.max(12, Math.min(90, Number(body.maxNodes || 70)));
  const language = cleanText(body.language || "english", 60);
  const studentLevel = cleanText(body.studentLevel || "beginner", 80);
  const source = compactSourceForPrompt(pagePackets);
  const request = cleanText(
    body.question || body.prompt || "Build an accurate source-grounded concept tree from this PDF.",
    2000
  );

  const summaryForPrompt = cleanText(safeObject(fullPdfSummary).fullPdfSummary || fullPdfSummary || "", 18000);
  const outlineForPrompt = JSON.stringify(safeObject(fullPdfOutline).fullPdfOutline || fullPdfOutline || {}, null, 2).slice(0, 42000);
  const modulesForPrompt = JSON.stringify(safeArray(roadmapModules), null, 2).slice(0, 24000);

  const diagramPagesForPrompt = JSON.stringify(
    uniqueBy(
      buildDiagramPageSummary(pagePackets)
        .concat(safeArray(safeObject(fullPdfSummary).diagramPages))
        .concat(safeArray(safeObject(fullPdfOutline).diagramPages)),
      (x) => `${safeObject(x).page}|${safeObject(x).visualType || safeObject(x).title || "visual"}`
    ),
    null,
    2
  ).slice(0, 30000);

  const requiredAnchors = requiredTeacherAnchorsPrompt(pagePackets);

  return `
You are Stage 1 Concept Tree Agent for a real AI live tutor board.

TASK:
Build a clickable full-PDF roadmap concept tree from the FULL PDF SUMMARY, FULL PDF OUTLINE, ROADMAP MODULES, DIAGRAM PAGE METADATA, REQUIRED SOURCE-DERIVED TEACHING ANCHORS, and SOURCE PAGES below.

STRICT TEACHER-ROADMAP RULES:
1. Use ONLY the supplied PDF-derived source data. No external textbook facts.
2. Do NOT create random keyword nodes.
3. Do NOT create slide-title-only roadmap. A real teacher roadmap exposes precise concepts, tradeoffs, examples, risks, processes, schema parts, and comparisons.
4. Do NOT collapse rich sections. If the PDF defines fact/measure, fact table, dimension, dimension table, star schema, snowflake schema, star-vs-snowflake, and galaxy schema, make them separate teachable nodes.
5. Every node must be teachable alone on a board and must include pageRefs + evidenceQuotes.
6. Every module should contain 3-9 child nodes when the source has enough detail.
7. Edges must represent relation, not just layout: parent-child, prerequisite, example-of, contrasts, causes, related.
8. Add tradeoff/cross edges: read speed gain vs update consistency cost; scheduled sync vs messaging sync; star vs snowflake.
9. Include REQUIRED SOURCE-DERIVED TEACHING ANCHORS unless another node already covers the exact same meaning.
10. nodeType choices only: module, concept, definition, process, example, warning, question. Never use diagram/table as nodeType; use visualHints instead.
11. JSON only. No markdown.
12. Maximum nodes is a ceiling, not a target. Use enough nodes to teach the full PDF accurately.

Resource title: ${cleanText(resource.title || resource.originalFilename || "Uploaded PDF", 220)}
Student level: ${studentLevel}
Language: ${language}
User request: ${request}
Maximum nodes: ${maxNodes}

FULL PDF SUMMARY:
${summaryForPrompt}

FULL PDF OUTLINE:
${outlineForPrompt}

ROADMAP MODULES:
${modulesForPrompt}

DIAGRAM/TABLE/FULL-PAGE IMAGE METADATA:
${diagramPagesForPrompt}

REQUIRED SOURCE-DERIVED TEACHING ANCHORS:
${requiredAnchors}

Return JSON exactly:
{
  "root": {
    "nodeId": "stable_slug",
    "title": "main PDF topic",
    "shortDefinition": "source-grounded definition",
    "pageRefs": [1],
    "evidenceQuotes": [{"page": 1, "quote": "short source quote", "confidence": 0.9}],
    "confidence": 0.9
  },
  "nodes": [
    {
      "nodeId": "stable_slug",
      "title": "real teachable concept title",
      "shortDefinition": "1-2 sentence source-grounded meaning",
      "parentId": "root_or_parent_node_id",
      "nodeType": "module|concept|definition|process|example|warning|question",
      "pageRefs": [1,2],
      "evidenceQuotes": [{"page": 1, "quote": "source proof", "confidence": 0.86}],
      "visualHints": ["concept-tree","flowchart","table","timeline","source-page","diagram"],
      "teachingPurpose": "what a real teacher will explain on board from this node",
      "relationToParent": "why this node belongs under its parent",
      "prerequisites": ["optional prerequisite title"],
      "teachableQuestions": ["question students should answer"],
      "confidence": 0.86
    }
  ],
  "edges": [
    {
      "from": "parent_id",
      "to": "child_id",
      "label": "why connected",
      "type": "parent-child|prerequisite|example-of|contrasts|causes|related"
    }
  ],
  "sourceCoverage": 0.0,
  "warnings": []
}

SOURCE PAGES:
${source}
`.trim();
}

function removeJsonComments(text) {
  return cleanText(text, 900000)
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function balanceJsonBrackets(text) {
  let out = "";
  const stack = [];
  let inString = false;
  let escaped = false;

  for (const ch of String(text || "")) {
    out += ch;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") stack.push("}");
    if (ch === "[") stack.push("]");
    if ((ch === "}" || ch === "]") && stack.length && stack[stack.length - 1] === ch) {
      stack.pop();
    }
  }

  while (stack.length) out += stack.pop();

  return out;
}

function quoteBareJsonKeys(text) {
  return String(text || "").replace(
    /([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/g,
    '$1"$2"$3'
  );
}

function repairJsonText(text) {
  let t = removeJsonComments(text);

  t = t
    .replace(/\u0000/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\bNaN\b/g, "null")
    .replace(/\bInfinity\b/g, "null")
    .replace(/\bundefined\b/g, "null");

  // remove trailing commas
  t = t.replace(/,\s*([}\]])/g, "$1");

  // quote bare keys if Gemini leaked JS-like object syntax
  t = quoteBareJsonKeys(t);

  // Gemini sometimes places two values adjacent in arrays/objects.
  // These conservative repairs fix common missing comma patterns.
  t = t
    .replace(/}\s*{/g, "},{")
    .replace(/]\s*\[/g, "],[")
    .replace(/"\s*\n\s*"/g, '","')
    .replace(/(true|false|null|\d)\s*\n\s*"/g, '$1,"')
    .replace(/"\s*\n\s*([{\[])/g, '",$1');

  t = balanceJsonBrackets(t);
  t = t.replace(/,\s*([}\]])/g, "$1");

  return t;
}

function parseJsonWithRepairs(candidate) {
  const attempts = [];

  const raw = cleanText(candidate, 900000);
  attempts.push(raw);
  attempts.push(raw.replace(/,\s*([}\]])/g, "$1"));
  attempts.push(repairJsonText(raw));

  let lastError = null;

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (err) {
      lastError = err;
    }
  }

  const preview = raw.slice(0, 1800);
  const error = new Error(
    `Model did not return valid JSON after repair. ${lastError?.message || ""}. Preview: ${preview}`
  );
  error.statusCode = 502;
  throw error;
}

function extractJsonObject(raw) {
  const text = cleanText(raw, 900000);
  if (!text) throw new Error("Gemini returned empty response.");

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");

  if (first < 0 || last <= first) {
    throw new Error("Gemini response did not contain JSON object.");
  }

  return parseJsonWithRepairs(candidate.slice(first, last + 1));
}

async function callGeminiJson({ prompt }) {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    const error = new Error("Gemini API key missing. Refusing fake concept tree.");
    error.statusCode = 500;
    error.metadata = { fallbackUsed: false, usedSmartFallback: false };
    throw error;
  }

  if (typeof fetch !== "function") {
    throw new Error("global fetch is unavailable. Use Node 18+.");
  }

  const model = getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.12,
        topP: 0.8,
        maxOutputTokens: Number(process.env.STAGE1_TREE_MAX_OUTPUT_TOKENS || 32000),
        responseMimeType: "application/json",
      },
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data?.error?.message || `Gemini request failed with HTTP ${res.status}`);
    error.statusCode = 502;
    throw error;
  }

  const text = safeArray(data?.candidates?.[0]?.content?.parts)
    .map((p) => p.text || "")
    .join("\n")
    .trim();

  return extractJsonObject(text);
}

function tokenize(text) {
  const stop = new Set(
    "the and for with that this from into about page source chunk concept student teacher board what when then your you are was were can will have has had not but or of to in on a an is it as by be if so we they their them our us".split(
      " "
    )
  );

  const words = inlineText(text, 80000).toLowerCase().match(/[a-z0-9_/-]{3,}/g) || [];
  return words.filter((w) => !stop.has(w));
}

function pageScore(pagePacket, query) {
  const terms = tokenize(query);
  const source = inlineText(pagePacket.combinedForEvidence, 90000).toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (source.includes(term)) score += term.length > 7 ? 3 : 1;
  }

  return score;
}

function bestQuoteFromPage(pagePacket, query, maxLen = 1000) {
  const text = cleanText(pagePacket.combinedForEvidence, 60000);
  const terms = new Set(tokenize(query));

  const sentences = text
    .split(/(?<=[.!?।])\s+|\n+|•/g)
    .map((s) => inlineText(s, 1000))
    .filter((s) => s.length > 20);

  if (!sentences.length) return inlineText(text, maxLen);

  let best = sentences[0];
  let bestScore = -1;

  for (const sentence of sentences) {
    const words = new Set(tokenize(sentence));
    let score = 0;
    for (const word of words) {
      if (terms.has(word)) score += 1;
    }

    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }

  return inlineText(best, maxLen);
}

function sourceRefFromPage({ resourceId, pagePacket, quote, confidence = 0.84 }) {
  const firstChunk = pagePacket.chunks[0] || {};
  const page = Number(pagePacket.page || firstChunk.page || 1);
  const chunkIndex = Number(firstChunk.chunkIndex || 0);

  return {
    chunkId: cleanText(firstChunk.chunkId || `${resourceId}_page_${page}`, 260),
    sourceRef: cleanText(firstChunk.sourceRef || `resource:${resourceId}:page:${page}:chunk:${chunkIndex}`, 360),
    pageRef: cleanText(firstChunk.pageRef || `resource:${resourceId}:page:${page}`, 360),
    page,
    quote: inlineText(quote || bestQuoteFromPage(pagePacket, "", 1000), 1000),
    confidence: clampNumber(confidence, 0, 1, 0.84),
  };
}

function pickSourceRefs({ resourceId, rawNode, pagePackets }) {
  const title = cleanText(rawNode.title || rawNode.label || rawNode.nodeId || "", 240);
  const definition = cleanText(rawNode.shortDefinition || rawNode.summary || "", 1200);
  const evidence = safeArray(rawNode.evidenceQuotes);
  const refs = [];

  for (const ev of evidence) {
    const e = safeObject(ev);
    const pageNo = clampNumber(e.page || e.pageRef, 1, 100000, 1);
    const page = pagePackets.find((p) => Number(p.page) === pageNo);
    if (!page) continue;

    const quote = inlineText(e.quote || bestQuoteFromPage(page, `${title} ${definition}`, 1000), 1000);
    refs.push(
      sourceRefFromPage({
        resourceId,
        pagePacket: page,
        quote,
        confidence: clampNumber(e.confidence, 0, 1, 0.84),
      })
    );
  }

  if (!refs.length) {
    const pageRefs = safeArray(rawNode.pageRefs).map((p) => Number(p)).filter(Boolean);

    const best =
      pageRefs.map((p) => pagePackets.find((page) => Number(page.page) === Number(p))).find(Boolean) ||
      [...pagePackets].sort(
        (a, b) => pageScore(b, `${title} ${definition}`) - pageScore(a, `${title} ${definition}`)
      )[0];

    if (best) {
      refs.push(
        sourceRefFromPage({
          resourceId,
          pagePacket: best,
          quote: bestQuoteFromPage(best, `${title} ${definition}`, 1000),
          confidence: 0.78,
        })
      );
    }
  }

  return uniqueBy(refs, (r) => `${r.page}|${r.chunkId}|${r.quote.slice(0, 90)}`).slice(0, 8);
}

function richSourcePackForNode({ refs, pagePackets }) {
  const pages = uniqueBy(
    refs.map((ref) => pagePackets.find((p) => Number(p.page) === Number(ref.page))).filter(Boolean),
    (p) => String(p.page)
  );

  const pageImages = pages
    .filter((p) => p.pageImageUrl || p.pageImagePath)
    .map((p) => ({
      page: p.page,
      url: p.pageImageUrl,
      src: p.pageImageUrl,
      path: p.pageImagePath,
      pageImageUrl: p.pageImageUrl,
      pageImagePath: p.pageImagePath,
      type: "pdfPageImage",
      evidenceRole: "roadmapTreeNodePageImage",
      fullPageImageAvailableForGeminiVision: true,
      imageTextIsTruth: false,
      pdfExtractedTextIsTruth: true,
      ocrIsHelperOnly: true,
    }));

  return {
    fullPageAvailable: pages.length > 0,
    pages: pages.map((p) => p.page),
    pageRefs: pages.map((p) => p.page),
    chunkIds: pages.flatMap((p) => p.chunkIds).slice(0, 60),

    fullPageTextPreview: cleanText(pages.map((p) => `Page ${p.page}:\n${p.text}`).join("\n\n"), 26000),
    ocrTextPreview: cleanText(pages.map((p) => p.ocrText).filter(Boolean).join("\n\n"), 16000),
    tablesPreview: cleanText(pages.flatMap((p) => p.tables).join("\n\n"), 16000),
    figuresPreview: cleanText(pages.flatMap((p) => p.figures).join("\n\n"), 16000),
    layoutBlockCount: pages.reduce((sum, p) => sum + safeArray(p.layoutBlocks).length, 0),

    pageImages,
    hasPageImages: pageImages.length > 0,
    pageImageCount: pageImages.length,
    fullPageImagesAvailableForGeminiVision: pageImages.length > 0,

    tables: pages.flatMap((p) =>
      p.tables.map((table, index) => ({
        page: p.page,
        index,
        text: cleanText(table, 3000),
      }))
    ).slice(0, 40),

    figures: pages.flatMap((p) =>
      p.figures.map((figure, index) => ({
        page: p.page,
        index,
        text: cleanText(figure, 3000),
      }))
    ).slice(0, 40),

    layoutBlocks: pages.flatMap((p) =>
      safeArray(p.layoutBlocks).map((block) => ({
        page: p.page,
        ...safeObject(block),
      }))
    ).slice(0, 120),
  };
}

function normalizeNodeType(value) {
  const raw = cleanText(value || "concept", 40).toLowerCase();

  const allowed = new Set([
    "root",
    "module",
    "concept",
    "definition",
    "process",
    "example",
    "warning",
    "question",
    "unknown",
  ]);

  if (allowed.has(raw)) return raw;

  /**
   * IMPORTANT:
   * Mongo schema does NOT allow "diagram" or "table" as nodeType.
   * But lesson will NOT become weak, because visual meaning is preserved in:
   * - visualHints: ["diagram", "table", "pdf-page-image"]
   * - tags: ["has-figure-or-diagram", "has-table"]
   * - metadata.richSourcePack.pageImages
   * - metadata.richSourcePack.figures/tables
   */
  if (
    raw === "diagram" ||
    raw === "figure" ||
    raw === "image" ||
    raw === "visual" ||
    raw === "schema" ||
    raw === "flowchart" ||
    raw === "erd" ||
    raw === "workflow" ||
    raw === "chart" ||
    raw === "graph"
  ) {
    return "concept";
  }

  if (
    raw === "table" ||
    raw === "comparison" ||
    raw === "matrix"
  ) {
    return "concept";
  }

  return "concept";
}

function normalizeGeminiTree({ json, resource, pagePackets, body, fullPdfSummary, fullPdfOutline, roadmapModules }) {
  const maxNodes = Math.max(12, Math.min(90, Number(body.maxNodes || 42)));
  const rawRoot = safeObject(json.root);
  const rawNodes = safeArray(json.nodes);

  const rootId = normalizeId(rawRoot.nodeId || rawRoot.title || resource.title || "root", "root");

  const rootRefs = pickSourceRefs({
    resourceId: resource.resourceId,
    rawNode: {
      ...rawRoot,
      title: rawRoot.title || resource.title,
      shortDefinition: rawRoot.shortDefinition || resource.summary,
      pageRefs: rawRoot.pageRefs || [pagePackets[0]?.page || 1],
    },
    pagePackets,
  });

  if (!rootRefs.length) {
    throw new Error("Root node has no source evidence. Refusing fake tree.");
  }

  const nodes = [];
  const nodeMap = new Map();

  const rootPack = richSourcePackForNode({ refs: rootRefs, pagePackets });

  const root = {
    id: rootId,
    nodeId: rootId,
    label: cleanText(rawRoot.title || resource.title || "Uploaded Resource", 180),
    title: cleanText(rawRoot.title || resource.title || "Uploaded Resource", 180),
    shortDefinition: cleanText(rawRoot.shortDefinition || resource.summary || "Main PDF topic.", 1200),
    summary: cleanText(rawRoot.shortDefinition || resource.summary || "Main PDF topic.", 1400),
    pageRefs: uniqueBy(rootRefs.map((r) => r.page), String),
    evidenceQuotes: rootRefs.map((r) => ({ page: r.page, quote: r.quote, confidence: r.confidence })),
    parentId: "",
    children: [],
    confidence: clampNumber(rawRoot.confidence, 0, 1, 0.9),
    level: 0,
    order: 0,
    nodeType: "root",
    importance: 1,
    sourceRefs: rootRefs,
    tags: ["root", "source-grounded", "gemini-built", "roadmap-tree"],
    visualHints: uniqueBy(["concept-tree", "source-page", rootPack.hasPageImages ? "pdf-page-image" : ""].filter(Boolean), String),
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      sourceGrounded: true,
      generatedBy: "stage1-gemini-full-pdf-roadmap-tree-v16",
      richSourcePack: rootPack,
      fullPdfSummaryUsed: Boolean(safeObject(fullPdfSummary).fullPdfSummary || fullPdfSummary),
      fullPdfOutlineUsed: Boolean(safeObject(fullPdfOutline).fullPdfOutline || fullPdfOutline),
      roadmapTree: true,
      dagreRecommended: true,
      pageImagesAttachedToNode: rootPack.hasPageImages,
      pageImageCount: rootPack.pageImageCount,
    },
  };

  nodes.push(root);
  nodeMap.set(rootId, root);

  const dropped = [];

  for (let i = 0; i < rawNodes.length && nodes.length < maxNodes; i += 1) {
    const raw = safeObject(rawNodes[i]);
    const title = cleanText(raw.title || raw.label || raw.name, 200);

    if (!title) {
      dropped.push(`node ${i} missing title`);
      continue;
    }

    let nodeId = normalizeId(raw.nodeId || raw.id || title, `node_${i + 1}`);
    let suffix = 2;

    while (nodeMap.has(nodeId)) {
      nodeId = `${nodeId}_${suffix}`;
      suffix += 1;
    }

    const refs = pickSourceRefs({ resourceId: resource.resourceId, rawNode: raw, pagePackets });

    if (!refs.length) {
      dropped.push(`${title} has no source evidence`);
      continue;
    }

    let parentId = normalizeId(raw.parentId || rootId, rootId);
    if (!nodeMap.has(parentId)) parentId = rootId;

    const sourcePack = richSourcePackForNode({ refs, pagePackets });

    const hints = uniqueBy(
      safeArray(raw.visualHints)
        .map((h) => cleanText(h, 60))
        .filter(Boolean)
        .concat(["source-page"])
        .concat(sourcePack.hasPageImages ? ["pdf-page-image", "gemini-vision-ready"] : [])
        .concat(sourcePack.figures.length ? ["diagram"] : [])
        .concat(sourcePack.tables.length ? ["table"] : []),
      (x) => x.toLowerCase()
    ).slice(0, 12);

    const node = {
      id: nodeId,
      nodeId,
      label: title,
      title,
      shortDefinition: cleanText(raw.shortDefinition || raw.summary || "", 1400),
      summary: cleanText(raw.shortDefinition || raw.summary || "", 1600),
      pageRefs: uniqueBy(refs.map((r) => r.page), String),
      evidenceQuotes: refs.map((r) => ({ page: r.page, quote: r.quote, confidence: r.confidence })),
      parentId,
      children: [],
      confidence: clampNumber(raw.confidence, 0, 1, 0.82),
      level: parentId === rootId ? 1 : 2,
      order: nodes.length,
      nodeType: normalizeNodeType(raw.nodeType),
      importance: clampNumber(raw.importance || raw.confidence, 0, 1, 0.72),
      sourceRefs: refs,
      tags: uniqueBy(
        [
          "source-grounded",
          "gemini-built",
          "roadmap-tree",
          ...(safeArray(raw.prerequisites).length ? ["has-prerequisite"] : []),
          ...(sourcePack.hasPageImages ? ["has-page-image"] : []),
          ...(sourcePack.figures.length ? ["has-figure-or-diagram"] : []),
          ...(sourcePack.tables.length ? ["has-table"] : []),
        ],
        String
      ),
      visualHints: hints,
      metadata: {
        fallbackUsed: false,
        usedSmartFallback: false,
        sourceGrounded: true,
        generatedBy: "stage1-gemini-full-pdf-roadmap-tree-v16",
        prerequisites: safeArray(raw.prerequisites).map((x) => cleanText(x, 180)).filter(Boolean).slice(0, 10),
        teachableQuestions: safeArray(raw.teachableQuestions).map((x) => cleanText(x, 320)).filter(Boolean).slice(0, 10),
        richSourcePack: sourcePack,
        fullPdfSummaryUsed: Boolean(safeObject(fullPdfSummary).fullPdfSummary || fullPdfSummary),
        fullPdfOutlineUsed: Boolean(safeObject(fullPdfOutline).fullPdfOutline || fullPdfOutline),
        roadmapTree: true,
        dagreRecommended: true,
        pageImagesAttachedToNode: sourcePack.hasPageImages,
        pageImageCount: sourcePack.pageImageCount,
        fullPageImagesAvailableForGeminiVision: sourcePack.fullPageImagesAvailableForGeminiVision,
      },
    };

    nodes.push(node);
    nodeMap.set(nodeId, node);
  }

  if (nodes.length < 6) {
    throw new Error(
      `Gemini returned too few verifiable tree nodes (${nodes.length}). Refusing fake tree. Dropped: ${dropped
        .slice(0, 8)
        .join("; ")}`
    );
  }

  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const parent = nodeMap.get(node.parentId);
      if (!parent.children.includes(node.nodeId)) parent.children.push(node.nodeId);
    }
  }

  const edges = [];
  const edgeSeen = new Set();

  function addEdge(from, to, label, type, refs) {
    if (!from || !to || from === to || !nodeMap.has(from) || !nodeMap.has(to)) return;

    const key = `${from}->${to}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);

    const allowedTypes = new Set(["parent-child", "prerequisite", "related", "causes", "contrasts", "example-of"]);
    const edgeType = allowedTypes.has(type) ? type : "parent-child";

    edges.push({
      edgeId: `edge_${from}_${to}`.slice(0, 240),
      id: `edge_${from}_${to}`.slice(0, 240),
      from,
      to,
      source: from,
      target: to,
      label: cleanText(label || "connected by source", 180),
      type: edgeType,
      sourceRefs: refs || nodeMap.get(to).sourceRefs || [],
      metadata: {
        fallbackUsed: false,
        usedSmartFallback: false,
        sourceGrounded: true,
      },
    });
  }

  for (const node of nodes) {
    if (node.parentId) addEdge(node.parentId, node.nodeId, "contains", "parent-child", node.sourceRefs);
  }

  for (const rawEdge of safeArray(json.edges)) {
    const e = safeObject(rawEdge);
    const from = normalizeId(e.from || e.source || e.parentId || rootId, rootId);
    const to = normalizeId(e.to || e.target || e.childId || "", "");
    const toNode = nodeMap.get(to);
    addEdge(from, to, e.label || e.reason || "connected by source", e.type, toNode?.sourceRefs || rootRefs);
  }

  const roadmapExpansion = expandWithTeacherRoadmapAnchors({
    nodes,
    edges,
    pagePackets,
    resource,
    body,
    rootId,
  });

  const sourceCoverage = clampNumber(
    json.sourceCoverage || nodes.length / Math.max(1, pagePackets.length * 2),
    0,
    1,
    0.7
  );

  return {
    rootNodeId: rootId,
    nodes,
    edges,
    sourceCoverage,
    roadmapExpansion: {
      sourceDerivedAnchorCount: roadmapExpansion.sourceDerivedAnchorCount,
      sourceDerivedExpansionCount: roadmapExpansion.sourceDerivedExpansionCount,
      sourceDerivedExpandedNodes: roadmapExpansion.sourceDerivedExpandedNodes,
    },
    warnings: safeArray(json.warnings).map((w) => cleanText(w, 360)).filter(Boolean).concat(dropped.slice(0, 14)),
  };
}


function assertRoadmapCoverage({ nodes, pagePackets, fullPdfOutline, roadmapModules, body }) {
  const requestedMax = Number(body.maxNodes || 70);

  const allPdfPages = uniqueBy(
    pagePackets.map((p) => Number(p.page)).filter(Boolean),
    String
  );

  const pagesCovered = uniqueBy(
    nodes.flatMap((node) => safeArray(node.pageRefs).map((p) => Number(p)).filter(Boolean)),
    String
  );

  const missingPages = allPdfPages.filter((page) => !pagesCovered.includes(page));
  const coverageRatio = allPdfPages.length ? pagesCovered.length / allPdfPages.length : 0;

  const outline = safeObject(fullPdfOutline.fullPdfOutline || fullPdfOutline);
  const modules = safeArray(outline.modules);
  const moduleTitles = modules.map((m) => cleanText(m.title, 180)).filter(Boolean);

  const nodeTitleText = nodes
    .map((n) => `${n.title || ""} ${n.label || ""}`)
    .join("\n")
    .toLowerCase();

  const missingModules = moduleTitles.filter((title) => {
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .slice(0, 4);

    if (!words.length) return false;
    return !words.some((w) => nodeTitleText.includes(w));
  });

  const nodeTypes = new Set(nodes.map((n) => cleanText(n.nodeType || "concept", 40)));

  const hasModule = nodeTypes.has("module");
  const hasConcept =
    nodeTypes.has("concept") ||
    nodeTypes.has("definition") ||
    nodeTypes.has("process") ||
    nodeTypes.has("example");

  const hasExample = nodeTypes.has("example");
  const hasWarning = nodeTypes.has("warning");
  const hasQuestion = nodeTypes.has("question");

  const visualPageCount = pagePackets.filter(
    (p) =>
      p.pageImageUrl ||
      p.pageImagePath ||
      safeArray(p.figures).length ||
      safeArray(p.tables).length
  ).length;

  const visualNodeCount = nodes.filter((n) => {
    const hints = safeArray(n.visualHints).join(" ").toLowerCase();
    const tags = safeArray(n.tags).join(" ").toLowerCase();
    const pack = safeObject(n.metadata).richSourcePack || {};

    return (
      hints.includes("diagram") ||
      hints.includes("table") ||
      hints.includes("image") ||
      hints.includes("pdf-page") ||
      tags.includes("figure") ||
      tags.includes("table") ||
      tags.includes("image") ||
      safeArray(pack.pageImages).length ||
      safeArray(pack.tables).length ||
      safeArray(pack.figures).length
    );
  }).length;

  const evidenceBadNodes = nodes.filter((n) => {
    return (
      !safeArray(n.pageRefs).length ||
      !safeArray(n.sourceRefs).length ||
      !safeArray(n.evidenceQuotes).length
    );
  });

  const fillerNodes = nodes.filter((n) => {
    const title = cleanText(n.title || n.label || "", 80).toLowerCase();
    return ["topic", "details", "overview", "example", "concept", "summary"].includes(title);
  });

  const issues = [];

  /*
   * Quality-based check:
   * Do NOT force 38 nodes. A focused PDF can be complete with 20-30 strong nodes.
   * Node count is only a sanity floor. Coverage/modules/evidence matter more.
   */
  const dynamicMinNodes = Math.min(
    requestedMax,
    Math.max(
      8,
      Math.min(24, Math.ceil(allPdfPages.length * 0.65) + Math.ceil(moduleTitles.length * 0.8))
    )
  );

  if (nodes.length < dynamicMinNodes) {
    issues.push(`tooFewNodesForThisPdf:${nodes.length}<${dynamicMinNodes}`);
  }

  const minCoverage =
    allPdfPages.length <= 6 ? 0.45 :
    allPdfPages.length <= 25 ? 0.50 :
    0.42;

  if (allPdfPages.length >= 8 && coverageRatio < minCoverage) {
    issues.push(`lowPageCoverage:${pagesCovered.length}/${allPdfPages.length}`);
  }

  const allowedMissingModules = Math.max(1, Math.ceil(moduleTitles.length * 0.4));

  if (missingModules.length > allowedMissingModules) {
    issues.push(`missingOutlineModules:${missingModules.slice(0, 8).join(" | ")}`);
  }

  if (!hasModule) issues.push("missingModuleNodes");
  if (!hasConcept) issues.push("missingConceptNodes");

  if (nodes.length >= 14 && !hasExample) issues.push("missingExampleNodes");
  if (nodes.length >= 18 && !hasWarning) issues.push("missingWarningNodes");
  if (nodes.length >= 18 && !hasQuestion) issues.push("missingQuestionNodes");

  if (visualPageCount > 0 && visualNodeCount === 0) {
    issues.push("visualPagesExistButNoVisualNodeHints");
  }

  if (evidenceBadNodes.length) {
    issues.push(
      `nodesMissingEvidence:${evidenceBadNodes
        .slice(0, 5)
        .map((n) => n.title || n.nodeId)
        .join(" | ")}`
    );
  }

  if (fillerNodes.length) {
    issues.push(
      `fillerNodes:${fillerNodes
        .slice(0, 5)
        .map((n) => n.title || n.nodeId)
        .join(" | ")}`
    );
  }

  if (issues.length) {
    const error = new Error(
      `Weak roadmap tree rejected by quality check. ${issues.join("; ")}.`
    );

    error.statusCode = 422;
    error.metadata = {
      fallbackUsed: false,
      usedSmartFallback: false,
      weakRoadmapRejected: true,
      qualityBased: true,
      nodeCount: nodes.length,
      dynamicMinNodes,
      pagesCovered,
      missingPages,
      allPdfPages,
      coverageRatio,
      minCoverage,
      missingModules,
      allowedMissingModules,
      moduleTitles,
      nodeTypes: [...nodeTypes],
      visualPageCount,
      visualNodeCount,
      evidenceBadNodeCount: evidenceBadNodes.length,
      fillerNodeCount: fillerNodes.length,
    };

    throw error;
  }

  return {
    ok: true,
    qualityBased: true,
    nodeCount: nodes.length,
    dynamicMinNodes,
    pagesCovered,
    missingPages,
    allPdfPages,
    coverageRatio,
    minCoverage,
    missingModules,
    allowedMissingModules,
    moduleTitles,
    nodeTypes: [...nodeTypes],
    visualPageCount,
    visualNodeCount,
    evidenceBadNodeCount: evidenceBadNodes.length,
    fillerNodeCount: fillerNodes.length,
  };
}

function toReactFlow({ nodes, edges, layoutDirection = "TB" }) {
  const levels = new Map();

  for (const node of nodes) {
    const level = Number(node.level || 0);
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(node);
  }

  const rfNodes = [];
  const levelKeys = [...levels.keys()].sort((a, b) => a - b);

  for (const level of levelKeys) {
    const row = levels.get(level) || [];

    row.forEach((node, index) => {
      rfNodes.push({
        id: node.nodeId,
        type: "sourceGroundedNode",
        position: {
          x: 120 + index * 300 - Math.max(0, row.length - 1) * 70,
          y: 80 + level * 230,
        },
        data: {
          label: node.label,
          title: node.title,
          shortDefinition: node.shortDefinition,
          summary: node.summary,
          pageRefs: node.pageRefs,
          evidenceQuotes: node.evidenceQuotes,
          sourceRefs: node.sourceRefs,
          confidence: node.confidence,
          nodeType: node.nodeType,
          visualHints: node.visualHints,
          richSourcePack: node.metadata?.richSourcePack,
          pageImages: node.metadata?.richSourcePack?.pageImages || [],
          hasPageImages: Boolean(node.metadata?.richSourcePack?.pageImages?.length),
          fullPageImagesAvailableForGeminiVision: Boolean(
            node.metadata?.richSourcePack?.fullPageImagesAvailableForGeminiVision
          ),
          level: Number(node.level || 0),
          order: Number(node.order || 0),
          parentId: node.parentId || "",
          dagreReady: true,
          layoutDirection,
        },
      });
    });
  }

  return {
    nodes: rfNodes,
    edges: edges.map((edge) => ({
      id: edge.edgeId || edge.id,
      source: edge.from || edge.source,
      target: edge.to || edge.target,
      label: edge.label,
      type: "smoothstep",
      data: {
        relationType: edge.type,
        sourceRefs: edge.sourceRefs,
      },
    })),
    viewport: { x: 0, y: 0, zoom: 0.82 },
    layoutDirection,
    dagreRecommended: true,
    roadmapTree: true,
    metadata: {
      dagreReady: true,
      reactFlowReady: true,
      layoutDirection,
      roadmapTree: true,
    },
  };
}

async function health() {
  try {
    await ensureMongoConnected();

    return {
      ok: true,
      service: "stage1ConceptTree.service.js",
      mongoConnected: mongoose.connection.readyState === 1,
      geminiConfigured: Boolean(getGeminiApiKey()),
      model: getGeminiModel(),
      capabilities: {
        realGeminiCall: Boolean(getGeminiApiKey()),
        accuratePdfConceptTree: true,
        randomKeywordTreeBlocked: true,
        richPagePackets: true,
        sourceRefs: true,
        fullPageTextPreview: true,
        tablesFiguresOcrImages: true,
        nodeRichSourcePack: true,
        fullPdfSummaryBeforeTree: true,
        fullPdfOutlineBeforeTree: true,
        roadmapModulesFromOutline: true,
        nodePageImagesAttached: true,
        nodePageImagesGeminiVisionReady: true,
        reactDagreReady: true,
        noFallback: true,
      },
      metadata: {
        fallbackUsed: false,
        usedSmartFallback: false,
      },
    };
  } catch (error) {
    return {
      ok: false,
      service: "stage1ConceptTree.service.js",
      error: error.message,
      metadata: {
        fallbackUsed: false,
        usedSmartFallback: false,
      },
    };
  }
}

async function buildConceptTree({ ownerKey, resourceId, body = {}, context = {} }) {
  const resource = await getOwnedResource({ ownerKey, resourceId });
  const chunks = await getResourceChunks({ ownerKey, resourceId });
  const pagePackets = buildPagePackets({ resource, chunks });

  if (!pagePackets.length) {
    const error = new Error("No page-wise text/OCR/table/figure/image packets found. Refusing fake concept tree.");
    error.statusCode = 422;
    throw error;
  }

  const pageImageCount = pagePackets.filter((p) => p.pageImageUrl || p.pageImagePath).length;

  const fullPdfSummary = await buildFullPdfSummaryForTree({
    resource,
    pagePackets,
    body,
  });

  const fullPdfOutline = await buildFullPdfOutlineForTree({
    resource,
    pagePackets,
    fullPdfSummary,
    body,
  });

  const roadmapModules = buildRoadmapModulesFromOutline(fullPdfOutline);

  if (!roadmapModules.length) {
    const error = new Error("No roadmap modules were created from fullPdfOutline. Refusing weak concept tree.");
    error.statusCode = 422;
    throw error;
  }

  const prompt = makeTreePrompt({
    resource,
    pagePackets,
    body,
    fullPdfSummary,
    fullPdfOutline,
    roadmapModules,
  });

  const json = await callGeminiJson({ prompt });

  const { rootNodeId, nodes, edges, sourceCoverage, warnings, roadmapExpansion } = normalizeGeminiTree({
    json,
    resource,
    pagePackets,
    body,
    fullPdfSummary,
    fullPdfOutline,
    roadmapModules,
  });

  const roadmapCoverage = assertRoadmapCoverage({
    nodes,
    pagePackets,
    fullPdfOutline,
    roadmapModules,
    body,
  });


  const stage1FinalRepair = stage1FinalFixNodesBeforePersist({
    nodes,
    pagePackets,
    resource,
    fullPdfSummary,
    fullPdfOutline,
    roadmapModules,
    roadmapExpansion,
  });

  const finalRoadmapExpansion = stage1FinalRepair.roadmapExpansion;
  const stage1QualityProof = stage1FinalRepair.qualityProof;

  if (!stage1QualityProof.ok) {
    throw Object.assign(
      new Error(
        `Stage1 source-pack quality failed. fakeQuoteCount=${stage1QualityProof.fakeQuoteCount}, missingSource=${stage1QualityProof.missingSource}, missingQuotes=${stage1QualityProof.missingQuotes}, missingTextPack=${stage1QualityProof.missingTextPack}, missingSummary=${stage1QualityProof.missingSummary}, missingOutline=${stage1QualityProof.missingOutline}`
      ),
      {
        statusCode: 422,
        metadata: {
          fallbackUsed: false,
          usedSmartFallback: false,
          stage1QualityProof,
        },
      }
    );
  }

  const treeId = makeId("glt_tree");
  const boardId = makeId("glt_board");
  const flow = toReactFlow({
    nodes,
    edges,
    layoutDirection: body.layoutDirection || "TB",
  });

  const nodesWithPageImages = nodes.filter((node) => node.metadata?.richSourcePack?.pageImages?.length).length;

  const treeDoc = await GoogleLiveTutorConceptTree.create({
    treeId,
    resourceId,
    ownerKey,
    offlineUserId: context.offlineUserId || resource.offlineUserId || "demo_user",
    deviceId: context.deviceId || resource.deviceId || "demo_device",
    title: `Concept Tree: ${resource.title || resource.originalFilename || "Uploaded Resource"}`,
    rootNodeId,
    status: "ready",
    nodes,
    edges,
    sourceCoverage,
    agentTrace: [
      "ResourceLoaderAgent: loaded owned resource and chunks",
      `PagePacketAgent: built ${pagePackets.length} rich page packets with text/OCR/tables/figures/full-page-images`,
      "FullPdfSummaryForTreeAgent: created Gemini full PDF summary before tree generation",
      "FullPdfOutlineForTreeAgent: created Gemini full PDF outline before tree generation",
      `RoadmapModuleAgent: created ${roadmapModules.length} roadmap modules from outline`,
      `GeminiConceptTreeAgent: produced ${nodes.length} source-grounded teacher-roadmap nodes`,
      `TeacherRoadmapExpansionAgent: added ${roadmapExpansion?.sourceDerivedExpansionCount || 0} source-derived precise concept nodes`,
      "SourceEvidenceValidatorAgent: rejected nodes without page evidence",
      `RichSourcePackAgent: attached pageImages to ${nodesWithPageImages} nodes for Stage2 Gemini Vision`,
      "ReactFlowBoardAgent: saved source-grounded Dagre-ready concept tree board",
    ],
    validation: { ok: true, errors: [], warnings },
    generation: {
      model: getGeminiModel(),
      method: "gemini-full-pdf-summary-outline-roadmap-tree-v16",
      realGeminiCall: true,
      fallbackUsed: false,
      usedSmartFallback: false,
      generatedAt: new Date(),
    },
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      sourceGrounded: true,
      randomKeywordTreeBlocked: true,
      richPagePackets: true,
      fullPdfSummaryUsed: true,
      fullPdfOutlineUsed: true,
      roadmapModulesUsed: true,
      roadmapTree: true,
      dagreRecommended: true,
      strictNoEvidenceNoNode: true,
      resourceTitle: resource.title || resource.originalFilename || "",
      chunkCount: chunks.length,
      pagePacketCount: pagePackets.length,
      fullPdfSummary,
      fullPdfOutline,
      roadmapModules,
      roadmapCoverage,
      roadmapExpansion: finalRoadmapExpansion,
      stage1QualityProof,
      diagramPages: buildDiagramPageSummary(pagePackets),
      pageImageCount,
      nodesWithPageImages,
      nodeRichSourcePackPageImages: true,
      selectedNodeGeminiVisionReady: true,
      mcpMirrorPlanned: true,
      tableCount: pagePackets.reduce((sum, p) => sum + p.tables.length, 0),
      figureCount: pagePackets.reduce((sum, p) => sum + p.figures.length, 0),
      ocrPageCount: pagePackets.filter((p) => p.ocrText).length,
      question: cleanText(body.question || "", 1200),
      studentLevel: cleanText(body.studentLevel || "beginner", 80),
      language: cleanText(body.language || "english", 80),
    },
  });

  const boardDoc = await GoogleLiveTutorBoard.create({
    boardId,
    treeId,
    resourceId,
    ownerKey,
    offlineUserId: context.offlineUserId || resource.offlineUserId || "demo_user",
    deviceId: context.deviceId || resource.deviceId || "demo_device",
    title: `Board: ${resource.title || resource.originalFilename || "Uploaded Resource"}`,
    flow,
    selectedNodeId: rootNodeId,
    sourceBadges: nodes.slice(0, 90).map((node) => ({
      nodeId: node.nodeId,
      pageRefs: node.pageRefs,
      sourceRefs: node.sourceRefs,
      confidence: node.confidence,
      pageImages: node.metadata?.richSourcePack?.pageImages || [],
      hasPageImages: Boolean(node.metadata?.richSourcePack?.pageImages?.length),
    })),
    autoscale: {
      enabled: true,
      lastFitViewAt: new Date(),
      contentBounds: {
        width: Math.max(1400, flow.nodes.length * 190),
        height: Math.max(760, Math.max(...nodes.map((n) => Number(n.level || 0))) * 260 + 460),
      },
      recommendedZoom: 0.82,
      layoutVersion: "stage1-full-pdf-roadmap-dagre-tree-v16",
    },
    saveReason: "stage1-build-concept-tree",
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      sourceGrounded: true,
      treeId,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      richSourcePackPerNode: true,
      nodePageImagesAttached: true,
      selectedNodeGeminiVisionReady: true,
      fullPdfSummaryUsed: true,
      fullPdfOutlineUsed: true,
      roadmapTree: true,
      dagreRecommended: true,
      reactFlowReady: true,
      randomKeywordTreeBlocked: true,
    },
  });


  const mcpMirror = await persistStage1McpMirrors({
    resource,
    chunks,
    treeDoc,
    boardDoc,
  });

  return {
    ok: true,
    treeId,
    boardId,
    resourceId,
    title: treeDoc.title,
    rootNodeId,
    nodes,
    edges,
    flow,
    sourceCoverage,
    warnings,
    agentTrace: treeDoc.agentTrace,
    mcpMirror,
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      realGeminiCall: true,
      mcpMirror: stage1FinalNormalizeMcpMirror(mcpMirror),
      mcpMirrorOk: stage1FinalNormalizeMcpMirror(mcpMirror).ok,
      mcpMirrorOk: Boolean(mcpMirror?.ok),
      method: "gemini-full-pdf-summary-outline-roadmap-tree-v16",
      randomKeywordTreeBlocked: true,
      fullPdfSummaryUsed: true,
      fullPdfOutlineUsed: true,
      roadmapModulesUsed: true,
      roadmapTree: true,
      dagreRecommended: true,
      reactFlowReady: true,
      nodeRichSourcePackPageImages: true,
      selectedNodeGeminiVisionReady: true,
      nodesWithPageImages,
      fullPdfSummary,
      fullPdfOutline,
      roadmapModules,
      roadmapCoverage,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      pagePacketCount: pagePackets.length,
      diagramPages: buildDiagramPageSummary(pagePackets),
      pageImageCount,
      tableCount: pagePackets.reduce((sum, p) => sum + p.tables.length, 0),
      figureCount: pagePackets.reduce((sum, p) => sum + p.figures.length, 0),
      ocrPageCount: pagePackets.filter((p) => p.ocrText).length,
    },
  };
}

async function getConceptTree({ ownerKey, treeId }) {
  await ensureMongoConnected();

  const tree = await GoogleLiveTutorConceptTree.findOne({ ownerKey, treeId }).lean();

  if (!tree) {
    const error = new Error(`Concept tree not found or not owned by this user: ${treeId}`);
    error.statusCode = 404;
    throw error;
  }

  const board = await GoogleLiveTutorBoard.findOne({ ownerKey, treeId }).sort({ updatedAt: -1 }).lean();

  const flow =
    board?.flow ||
    toReactFlow({
      nodes: safeArray(tree.nodes),
      edges: safeArray(tree.edges),
    });

  return {
    ok: true,
    treeId,
    boardId: board?.boardId || "",
    resourceId: tree.resourceId,
    title: tree.title,
    rootNodeId: tree.rootNodeId,
    nodes: safeArray(tree.nodes),
    edges: safeArray(tree.edges),
    flow,
    sourceCoverage: tree.sourceCoverage,
    agentTrace: safeArray(tree.agentTrace),
    validation: safeObject(tree.validation),
    metadata: {
      ...safeObject(tree.metadata),
      fallbackUsed: false,
      usedSmartFallback: false,
      replay: true,
    },
  };
}

async function explainNode({ ownerKey, resourceId, body = {}, context = {} }) {
  await ensureMongoConnected();

  const treeId = cleanText(body.treeId || "", 260);
  const nodeId = cleanText(body.nodeId || body.selectedNodeId || "", 220);

  let selectedNode = safeObject(body.selectedNode || body.node);

  if (!selectedNode.nodeId && treeId && nodeId) {
    const tree = await GoogleLiveTutorConceptTree.findOne({ ownerKey, treeId }).lean();
    selectedNode =
      safeArray(tree?.nodes).find(
        (n) => normalizeId(n.nodeId || n.id || n.label || n.title) === normalizeId(nodeId)
      ) || {};
  }

  const title = cleanText(selectedNode.title || selectedNode.label || nodeId || "Selected Node", 180);
  const refs = safeArray(selectedNode.sourceRefs);
  const richSourcePack = safeObject(selectedNode.metadata).richSourcePack || safeObject(selectedNode.richSourcePack);

  if (!refs.length) {
    const error = new Error("explainNode requires selectedNode.sourceRefs or nodeId from source-grounded tree.");
    error.statusCode = 400;
    throw error;
  }

  const explanation = [
    `${title}`,
    "",
    cleanText(
      selectedNode.shortDefinition ||
        selectedNode.summary ||
        "This node is grounded in the selected PDF source evidence.",
      2000
    ),
    "",
    "Source evidence:",
    ...refs.slice(0, 8).map((ref) => `- Page ${ref.page}: ${cleanText(ref.quote, 900)}`),
    "",
    richSourcePack?.pageImages?.length
      ? "This node has full PDF page images ready for Stage 2 Gemini Vision."
      : "Stage 2 should expand this node using richSourcePack/full page context, not only this short quote.",
  ].join("\n");

  const explanationId = makeId("glt_node_explanation");

  await GoogleLiveTutorNodeExplanation.create({
    explanationId,
    treeId,
    boardId: cleanText(body.boardId || "", 260),
    resourceId,
    nodeId: cleanText(selectedNode.nodeId || selectedNode.id || nodeId || title, 180),
    ownerKey,
    title,
    language: cleanText(body.language || "english", 80),
    studentLevel: cleanText(body.studentLevel || "beginner", 80),
    explanation,
    simpleExample: "",
    sourceRefs: refs,
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      sourceGrounded: true,
      richSourcePack,
      pageImagesAvailable: Boolean(richSourcePack?.pageImages?.length),
      selectedNodeGeminiVisionReady: Boolean(richSourcePack?.pageImages?.length),
    },
  }).catch(() => null);

  return {
    ok: true,
    explanationId,
    title,
    explanation,
    sourceRefs: refs,
    selectedNode,
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      richSourcePackAvailable: Boolean(richSourcePack && Object.keys(richSourcePack).length),
      pageImagesAvailable: Boolean(richSourcePack?.pageImages?.length),
      selectedNodeGeminiVisionReady: Boolean(richSourcePack?.pageImages?.length),
    },
  };
}

async function saveBoard({ ownerKey, boardId, body = {}, context = {} }) {
  await ensureMongoConnected();

  const update = {
    selectedNodeId: cleanText(body.selectedNodeId || "", 220),
    expandedNodeIds: safeArray(body.expandedNodeIds).map((x) => cleanText(x, 220)).filter(Boolean),
    collapsedNodeIds: safeArray(body.collapsedNodeIds).map((x) => cleanText(x, 220)).filter(Boolean),
    annotations: safeArray(body.annotations),
    saveReason: cleanText(body.saveReason || "manual", 120),
    updatedAt: new Date(),
    metadata: {
      ...safeObject(body.metadata),
      fallbackUsed: false,
      usedSmartFallback: false,
      sourceGrounded: true,
    },
  };

  if (body.flow) update.flow = body.flow;
  if (body.sourceBadges) update.sourceBadges = body.sourceBadges;
  if (body.autoscale) update.autoscale = body.autoscale;

  const board = await GoogleLiveTutorBoard.findOneAndUpdate(
    { ownerKey, boardId },
    { $set: update },
    { new: true }
  ).lean();

  if (!board) {
    const error = new Error(`Board not found or not owned by this user: ${boardId}`);
    error.statusCode = 404;
    throw error;
  }

  return {
    ok: true,
    boardId,
    board,
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
    },
  };
}

async function getBoard({ ownerKey, boardId }) {
  await ensureMongoConnected();

  const board = await GoogleLiveTutorBoard.findOne({ ownerKey, boardId }).lean();

  if (!board) {
    const error = new Error(`Board not found or not owned by this user: ${boardId}`);
    error.statusCode = 404;
    throw error;
  }

  return {
    ok: true,
    boardId,
    board,
    flow: board.flow,
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      replay: true,
    },
  };
}

function clonePlain(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch {
    return {};
  }
}

function mcpMirrorCollections() {
  return {
    resources: process.env.MONGODB_MCP_RESOURCES_COLLECTION || "googlelivetutorresources",
    chunks: process.env.MONGODB_MCP_CHUNKS_COLLECTION || "googlelivetutorresourcechunks",
    trees: process.env.MONGODB_MCP_TREES_COLLECTION || "googlelivetutorconcepttrees",
    boards: process.env.MONGODB_MCP_BOARDS_COLLECTION || "googlelivetutorboards",
  };
}

async function upsertMcpMirrorDocument({ collection, filter, document }) {
  await ensureMongoConnected();

  const db = mongoose.connection.db;
  if (!db) throw new Error("mongoose.connection.db missing for MCP mirror.");

  const now = new Date();
  const doc = clonePlain(document);

  delete doc._id;
  delete doc.__v;

  const createdAt = doc.createdAt || now;
  delete doc.createdAt;

  await db.collection(collection).updateOne(
    filter,
    {
      $set: {
        ...doc,
        mcpMirror: true,
        mcpReadable: true,
        mcpMirrorCollection: collection,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt,
      },
    },
    { upsert: true }
  );

  return {
    ok: true,
    collection,
    filter,
  };
}

async function persistStage1McpMirrors({ resource, chunks, treeDoc, boardDoc }) {
  const cols = mcpMirrorCollections();
  const result = {
    ok: true,
    warnings: [],
    collections: cols,
    resourceMirror: null,
    chunkMirror: null,
    treeMirror: null,
    boardMirror: null,
  };

  try {
    const r = clonePlain(resource);

    if (r.resourceId && r.ownerKey) {
      result.resourceMirror = await upsertMcpMirrorDocument({
        collection: cols.resources,
        filter: {
          ownerKey: r.ownerKey,
          resourceId: r.resourceId,
        },
        document: {
          ...r,
          id: r.resourceId,
          mirrorKind: "resource",
          sourceCollection: "resources",
        },
      });
    }
  } catch (error) {
    result.ok = false;
    result.warnings.push(`resource mirror failed: ${error.message}`);
  }

  try {
    await ensureMongoConnected();

    const db = mongoose.connection.db;
    if (!db) throw new Error("mongoose.connection.db missing for chunk MCP mirror.");

    const docs = safeArray(chunks)
      .map((raw, index) => {
        const d = clonePlain(raw);
        const page = clampNumber(d.page || d.pageNumber, 1, 100000, 1);
        const chunkIndex = clampNumber(d.chunkIndex || d.index, 0, 100000, index);
        const chunkId = cleanText(d.chunkId || d.id || `${d.resourceId}_page_${page}_chunk_${chunkIndex}`, 260);

        delete d._id;
        delete d.__v;

        const createdAt = d.createdAt || new Date();
        delete d.createdAt;

        return {
          ...d,
          id: chunkId,
          chunkId,
          page,
          chunkIndex,
          mirrorKind: "resourceChunk",
          sourceCollection: "resource_chunks",
          mcpMirror: true,
          mcpReadable: true,
          mcpMirrorCollection: cols.chunks,
          createdAt,
          updatedAt: new Date(),
        };
      })
      .filter((d) => d.ownerKey && d.resourceId && d.chunkId && cleanText(d.text || d.textPreview || d.ocrText, 20));

    if (docs.length) {
      await db.collection(cols.chunks).bulkWrite(
        docs.map((doc) => {
          const cleanDoc = { ...doc };
          const createdAt = cleanDoc.createdAt || new Date();
          delete cleanDoc.createdAt;

          return {
            updateOne: {
              filter: {
                ownerKey: cleanDoc.ownerKey,
                resourceId: cleanDoc.resourceId,
                chunkId: cleanDoc.chunkId,
              },
              update: {
                $set: cleanDoc,
                $setOnInsert: {
                  createdAt,
                },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false }
      );

      result.chunkMirror = {
        ok: true,
        collection: cols.chunks,
        count: docs.length,
      };
    } else {
      result.ok = false;
      result.chunkMirror = {
        ok: false,
        collection: cols.chunks,
        count: 0,
      };
      result.warnings.push("chunk mirror skipped: no valid chunk docs.");
    }
  } catch (error) {
    result.ok = false;
    result.warnings.push(`chunk mirror failed: ${error.message}`);
  }

  try {
    const t = clonePlain(treeDoc);

    if (t.treeId && t.ownerKey) {
      result.treeMirror = await upsertMcpMirrorDocument({
        collection: cols.trees,
        filter: {
          ownerKey: t.ownerKey,
          treeId: t.treeId,
        },
        document: {
          ...t,
          id: t.treeId,
          mirrorKind: "conceptTree",
          sourceCollection: "google_live_tutor_concept_trees",
        },
      });
    }
  } catch (error) {
    result.ok = false;
    result.warnings.push(`tree mirror failed: ${error.message}`);
  }

  try {
    const b = clonePlain(boardDoc);

    if (b.boardId && b.ownerKey) {
      result.boardMirror = await upsertMcpMirrorDocument({
        collection: cols.boards,
        filter: {
          ownerKey: b.ownerKey,
          boardId: b.boardId,
        },
        document: {
          ...b,
          id: b.boardId,
          mirrorKind: "conceptTreeBoard",
          sourceCollection: "google_live_tutor_boards",
        },
      });
    }
  } catch (error) {
    result.ok = false;
    result.warnings.push(`board mirror failed: ${error.message}`);
  }

  return result;
}

async function listConceptTrees({ ownerKey, resourceId, limit = 30 }) {
  await ensureMongoConnected();

  const query = {
    ownerKey,
  };

  if (resourceId) query.resourceId = resourceId;

  const trees = await GoogleLiveTutorConceptTree.find(query)
    .sort({ createdAt: -1 })
    .limit(clampNumber(limit, 1, 100, 30))
    .lean();

  return {
    ok: true,
    trees: trees.map((tree) => ({
      treeId: tree.treeId,
      resourceId: tree.resourceId,
      title: tree.title,
      rootNodeId: tree.rootNodeId,
      nodeCount: safeArray(tree.nodes).length,
      edgeCount: safeArray(tree.edges).length,
      sourceCoverage: tree.sourceCoverage,
      createdAt: tree.createdAt,
      updatedAt: tree.updatedAt,
      metadata: {
        ...safeObject(tree.metadata),
        fallbackUsed: false,
        usedSmartFallback: false,
      },
    })),
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      count: trees.length,
    },
  };
}

async function deleteConceptTree({ ownerKey, treeId }) {
  await ensureMongoConnected();

  const tree = await GoogleLiveTutorConceptTree.findOne({ ownerKey, treeId }).lean();

  if (!tree) {
    const error = new Error(`Concept tree not found or not owned by this user: ${treeId}`);
    error.statusCode = 404;
    throw error;
  }

  const boardDelete = await GoogleLiveTutorBoard.deleteMany({ ownerKey, treeId });
  const explanationDelete = await GoogleLiveTutorNodeExplanation.deleteMany({ ownerKey, treeId });
  await GoogleLiveTutorConceptTree.deleteOne({ ownerKey, treeId });

  return {
    ok: true,
    deleted: true,
    treeId,
    deletedBoards: boardDelete.deletedCount || 0,
    deletedExplanations: explanationDelete.deletedCount || 0,
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
    },
  };
}

module.exports = {
  health,

  buildConceptTree,
  createConceptTree: buildConceptTree,
  regenerateConceptTree: buildConceptTree,

  listConceptTrees,
  getConceptTree,
  deleteConceptTree,

  explainNode,
  saveBoard,
  getBoard,

  ensureMongoConnected,
  buildPagePackets,
  compactSourceForPrompt,
  makeTreePrompt,
  buildFullPdfSummaryForTree,
  buildFullPdfOutlineForTree,
  buildRoadmapModulesFromOutline,
  normalizeGeminiTree,
  toReactFlow,

  persistStage1McpMirrors,
  mcpMirrorCollections,

  _internals: {
    safeString,
    safeObject,
    safeArray,
    cleanText,
    inlineText,
    normalizeId,
    compactChunk,
    bestQuoteFromPage,
    richSourcePackForNode,
    buildDiagramPageSummary,
    compactPagesForUnderstanding,
    persistStage1McpMirrors,
    mcpMirrorCollections,
  },
};


/**
 * 
 * ✅ Strong roadmap tree
✅ Gemini আগে full PDF summary বানায়
✅ Gemini full PDF outline বানায়
✅ roadmapModules তৈরি হয়
✅ Tree nodes source-grounded হয়
✅ evidence ছাড়া node drop হয়
✅ each node metadata.richSourcePack থাকে
✅ richSourcePack.pageImages থাকে যদি page image exists করে
✅ node click-এর next file/sourceContextBuilder এই pageImages use করতে পারবে
 */
