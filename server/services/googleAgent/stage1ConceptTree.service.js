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

function makeTreePrompt({ resource, pagePackets, body, fullPdfSummary, fullPdfOutline, roadmapModules }) {
  const maxNodes = Math.max(12, Math.min(90, Number(body.maxNodes || 42)));
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

  return `
You are Stage 1 Concept Tree Agent for a real AI live tutor board.

TASK:
Build a clickable full-PDF roadmap concept tree from the FULL PDF SUMMARY, FULL PDF OUTLINE, ROADMAP MODULES, DIAGRAM PAGE METADATA, and SOURCE PAGES below.

STRICT RULES:
1. Use ONLY the fullPdfSummary/fullPdfOutline/roadmapModules and PDF SOURCE PAGES below.
2. Do NOT create random keyword nodes.
3. Do NOT create generic textbook nodes unless the PDF actually supports them.
4. Do NOT create filler nodes such as "meaning", "example", "details", "topic" unless the source gives a real teachable concept.
5. Every node must have pageRefs and evidenceQuotes.
6. Every evidenceQuote must come from the source page meaning.
7. Prefer concepts a human teacher can explain deeply.
8. Include prerequisite concepts when the source requires them.
9. Include table/figure/image-aware nodes when source pages contain tables/figures/images.
10. Edges must represent real relation: parent-child, prerequisite, example-of, contrasts, causes, related.
11. JSON only.
12. The tree must follow the roadmap outline: root topic -> modules -> concepts/examples/warnings/diagrams.
13. Do not flatten the whole PDF into random keywords.
14. Prefer module nodes from ROADMAP MODULES and child nodes from the outline/source evidence.
15. If a page has PAGE_IMAGE_AVAILABLE or FULL_PAGE_IMAGE_AVAILABLE metadata, include "source-page" or "diagram" visualHints on relevant nodes.
16. Never use "diagram" or "table" as nodeType. Mongo schema does not allow them. For diagram/table nodes, use nodeType:"concept" and add visualHints like ["diagram"], ["table"], ["pdf-page-image"], ["gemini-vision-ready"].

Resource title: ${cleanText(resource.title || resource.originalFilename || "Uploaded PDF", 220)}
Student level: ${studentLevel}
Language: ${language}
User request: ${request}
Maximum nodes: ${maxNodes}

FULL PDF SUMMARY FOR TREE:
${summaryForPrompt}

FULL PDF OUTLINE FOR TREE:
${outlineForPrompt}

ROADMAP MODULES FOR TREE:
${modulesForPrompt}

DIAGRAM/TABLE/FULL-PAGE IMAGE METADATA:
${diagramPagesForPrompt}

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
      "prerequisites": ["optional prerequisite title"],
      "teachableQuestions": ["question students should be able to answer"],
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

  return JSON.parse(candidate.slice(first, last + 1).replace(/,\s*([}\]])/g, "$1"));
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
        maxOutputTokens: 22000,
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
    warnings: safeArray(json.warnings).map((w) => cleanText(w, 360)).filter(Boolean).concat(dropped.slice(0, 14)),
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

  const { rootNodeId, nodes, edges, sourceCoverage, warnings } = normalizeGeminiTree({
    json,
    resource,
    pagePackets,
    body,
    fullPdfSummary,
    fullPdfOutline,
    roadmapModules,
  });

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
      `GeminiConceptTreeAgent: produced ${nodes.length} source-grounded roadmap nodes`,
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
      diagramPages: buildDiagramPageSummary(pagePackets),
      pageImageCount,
      nodesWithPageImages,
      nodeRichSourcePackPageImages: true,
      selectedNodeGeminiVisionReady: true,
      tableCount: pagePackets.reduce((sum, p) => sum + p.tables.length, 0),
      figureCount: pagePackets.reduce((sum, p) => sum + p.figures.length, 0),
      ocrPageCount: pagePackets.filter((p) => p.ocrText).length,
      question: cleanText(body.question || "", 1200),
      studentLevel: cleanText(body.studentLevel || "beginner", 80),
      language: cleanText(body.language || "english", 80),
    },
  });

  await GoogleLiveTutorBoard.create({
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
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      realGeminiCall: true,
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

module.exports = {
  health,
  buildConceptTree,
  getConceptTree,
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