"use strict";

/**
 * server/services/googleAgent/agent1Resource.service.js
 * =============================================================================
 * FULL Agent 1 Resource Service
 *
 * This file preserves Version 14 upload logic and connects it to the fixed
 * exact full-page PDF image renderer.
 *
 * It does:
 * ✅ PDF upload
 * ✅ Text/transcript upload
 * ✅ URL transcript/text fetch
 * ✅ pdf-parse extraction
 * ✅ Gemini PDF inline fallback extraction
 * ✅ Google Document AI OCR extraction
 * ✅ Document AI layout blocks/entities/tables extraction
 * ✅ clean PDF full-page image render/save through pdfPageImageRenderer.service.js
 * ✅ MongoDB resources + resource_chunks save/read
 * ✅ chunk metadata contains:
 *    - ocrText
 *    - layoutBlocks
 *    - tables
 *    - figures
 *    - entities
 *    - pageImageUrl
 *    - pageImagePath
 *    - hasPageImage
 *    - pageImageRenderMethod
 * ✅ resource metadata contains:
 *    - pageImagesGenerated
 *    - pageImageRenderMethod
 *    - pageImageCount
 *    - cleanPdfPageImageRendererUsed
 *
 * Important:
 * - This file does not crop diagrams.
 * - It saves exact full-page image per PDF page.
 * - Later Stage2/SelectedPageVisionAgent chooses selected node page image.
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

let pdfParseModule = null;

try {
  pdfParseModule = require("pdf-parse");
} catch {
  pdfParseModule = null;
}

const {
  GoogleLiveTutorResource,
  GoogleLiveTutorResourceChunk,
} = require("../../models/GoogleLiveTutorResource");

const cleanPdfPageImageRenderer = require("./pdfPageImageRenderer.service");

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
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

function envTrue(names, fallback = false) {
  for (const name of safeArray(names)) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== null && raw !== "") {
      return ["1", "true", "yes", "y", "on"].includes(String(raw).trim().toLowerCase());
    }
  }
  return fallback;
}

function cleanText(value, max = 200000) {
  let text = safeString(value);

  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\u0000/g, " ");
  text = text.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");

  text = text.replace(/\[\s*(sourceRef|pageRef|chunkId|resourceId|ref)\s*=\s*[^\]]+\]/gi, " ");
  text = text.replace(/resource:glt_[^\s\]]+/gi, " ");
  text = text.replace(/glt_resource_[^\s\]]+/gi, " ");
  text = text.replace(/glt_chunk_[^\s\]]+/gi, " ");

  text = text.replace(/([A-Za-z])-\s*\n\s*([a-z])/g, "$1$2");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ ]{2,}/g, " ");

  return text.trim().slice(0, max);
}

function normalizeTitle(value, fallback = "Agent 1 Resource") {
  return cleanText(value || fallback, 180) || fallback;
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function estimateTokens(text) {
  return Math.ceil(safeString(text).length / 4);
}

function sha256(bufferOrText) {
  return crypto.createHash("sha256").update(bufferOrText).digest("hex");
}

function qualityScore(text) {
  const cleaned = cleanText(text);
  const chars = cleaned.length;
  const words = cleaned.match(/[A-Za-z0-9][A-Za-z0-9_'-]*/g) || [];
  const alphaNum = cleaned.match(/[A-Za-z0-9]/g) || [];
  const weird = cleaned.match(/[�□■●◆◇▯◌]/g) || [];
  const lines = cleaned.split(/\n+/).filter(Boolean);

  const alphaNumRatio = chars ? alphaNum.length / chars : 0;
  const weirdRatio = chars ? weird.length / chars : 1;
  const avgLineLength = lines.length ? chars / lines.length : chars;

  let score = 1;
  if (chars < 120) score -= 0.35;
  if (words.length < 20) score -= 0.28;
  if (alphaNumRatio < 0.35) score -= 0.25;
  if (weirdRatio > 0.01) score -= 0.2;
  if (avgLineLength < 10 && lines.length > 8) score -= 0.15;

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));

  return {
    score,
    charCount: chars,
    wordCount: words.length,
    alphaNumRatio: Number(alphaNumRatio.toFixed(3)),
    weirdRatio: Number(weirdRatio.toFixed(4)),
    avgLineLength: Number(avgLineLength.toFixed(1)),
    needsOcr: score < 0.58,
  };
}

async function ensureMongoConnected() {
  if (mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("MONGODB_URI or MONGO_URI missing.");

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DATABASE || undefined,
    serverSelectionTimeoutMS: 30000,
  });
}

async function parsePdf(buffer) {
  if (!pdfParseModule) {
    throw new Error("pdf-parse is not installed. Run: npm install pdf-parse@1.1.1");
  }

  if (typeof pdfParseModule === "function") return pdfParseModule(buffer);
  if (typeof pdfParseModule.default === "function") return pdfParseModule.default(buffer);
  if (typeof pdfParseModule.pdfParse === "function") return pdfParseModule.pdfParse(buffer);

  throw new Error("Unsupported pdf-parse export. Install pdf-parse@1.1.1 if needed.");
}

function splitPagesFromText(text, pageCount = 1) {
  const raw = safeString(text);
  const formPages = raw.split("\f").map((x) => cleanText(x)).filter(Boolean);

  if (formPages.length > 1) {
    return formPages.map((pageText, index) => ({
      page: index + 1,
      text: pageText,
      ocrText: "",
      exactPageBreak: true,
      extractionMethod: "pdf-parse-formfeed",
      quality: qualityScore(pageText),
      layoutBlocks: [],
      tables: [],
      figures: [],
      entities: [],
      pageImageUrl: "",
      pageImagePath: "",
    }));
  }

  const cleaned = cleanText(raw);
  if (!cleaned) return [];

  const count = Math.max(1, Number(pageCount || 1));

  if (count <= 1) {
    return [
      {
        page: 1,
        text: cleaned,
        ocrText: "",
        exactPageBreak: false,
        extractionMethod: "single-text",
        quality: qualityScore(cleaned),
        layoutBlocks: [],
        tables: [],
        figures: [],
        entities: [],
        pageImageUrl: "",
        pageImagePath: "",
      },
    ];
  }

  const target = Math.ceil(cleaned.length / count);
  const pages = [];

  for (let i = 0; i < count; i += 1) {
    const slice = cleaned.slice(i * target, Math.min((i + 1) * target, cleaned.length)).trim();
    if (!slice) continue;

    pages.push({
      page: i + 1,
      text: slice,
      ocrText: "",
      exactPageBreak: false,
      extractionMethod: "estimated-page-split",
      quality: qualityScore(slice),
      layoutBlocks: [],
      tables: [],
      figures: [],
      entities: [],
      pageImageUrl: "",
      pageImagePath: "",
    });
  }

  return pages;
}

function extractJsonObject(rawText) {
  const text = safeString(rawText).trim();
  if (!text) throw new Error("Empty Gemini response.");

  const attempts = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));

  for (const candidate of attempts) {
    try {
      return JSON.parse(
        candidate
          .replace(/^```json/i, "")
          .replace(/```/g, "")
          .replace(/,\s*}/g, "}")
          .replace(/,\s*]/g, "]")
          .trim()
      );
    } catch {
      // try next
    }
  }

  throw new Error(`Gemini did not return valid JSON. Preview: ${text.slice(0, 1200)}`);
}

function getGeminiApiKey() {
  return (
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  );
}

function getGeminiModel() {
  return process.env.GOOGLE_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

function normalizeGeminiPages(json, fallbackPageCount = 1) {
  const pagesRaw = safeArray(json.pages || json.pageTexts || json.extractedPages);
  const pages = [];

  for (let index = 0; index < pagesRaw.length; index += 1) {
    const item = safeObject(pagesRaw[index]);
    const pageNumber = Number(item.page || item.pageNumber || index + 1);
    const text = cleanText(item.text || item.pageText || item.content || "");

    if (!text) continue;

    pages.push({
      page: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : index + 1,
      text,
      ocrText: "",
      exactPageBreak: true,
      extractionMethod: "gemini-pdf-inline",
      quality: qualityScore(text),
      layoutBlocks: [],
      figures: safeArray(item.figures).map((figure, figIndex) => ({
        id: figure.id || `gemini_fig_p${pageNumber}_${figIndex + 1}`,
        page: pageNumber,
        caption: cleanText(figure.caption || figure.description || figure.text || "", 800),
        kind: figure.kind || "figure_or_diagram_description",
        source: "gemini-pdf-inline",
      })),
      tables: safeArray(item.tables).map((table, tableIndex) => ({
        id: table.id || `gemini_table_p${pageNumber}_${tableIndex + 1}`,
        page: pageNumber,
        caption: cleanText(table.caption || table.description || "", 800),
        columns: safeArray(table.columns),
        rows: safeArray(table.rows),
        source: "gemini-pdf-inline",
      })),
      entities: [],
      pageImageUrl: "",
      pageImagePath: "",
    });
  }

  if (pages.length) return pages;

  const text = cleanText(json.text || json.fullText || json.content || "");
  if (!text) return [];

  return splitPagesFromText(text, fallbackPageCount).map((page) => ({
    ...page,
    extractionMethod: "gemini-pdf-inline-flat",
  }));
}

async function extractPdfWithGeminiInline({ buffer, title, pageCount }) {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return {
      ok: false,
      method: "gemini-pdf-inline",
      error: "Missing Gemini API key.",
      pages: [],
    };
  }

  const model = getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = `
You are a PDF extraction agent for an AI tutor.

Extract this PDF as clean page-by-page teaching text.

Return JSON only:
{
  "ok": true,
  "pageCount": 17,
  "pages": [
    {
      "page": 1,
      "text": "clean text from page 1",
      "figures": [{"caption":"visible figure/diagram/chart description"}],
      "tables": [{"caption":"table description","columns":["..."],"rows":[["..."]]}]
    }
  ],
  "summary": "short PDF summary"
}

Rules:
- Keep page order.
- Preserve headings, bullets, table meaning, diagram captions.
- If a page has a diagram/figure/chart, describe it in figures.
- If a page has a table, capture table meaning in tables.
- Do not invent pages.
- Do not include markdown fences.
- PDF title: ${title}
Expected page count if known: ${pageCount || "unknown"}
`.trim();

  const controller = new AbortController();
  const timeoutMs = Number(process.env.AGENT1_GEMINI_PDF_TIMEOUT_MS || process.env.GOOGLE_LIVE_TUTOR_TIMEOUT_MS || 300000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: buffer.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.05,
          topP: 0.8,
          maxOutputTokens: 12000,
          responseMimeType: "application/json",
        },
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ok: false,
        method: "gemini-pdf-inline",
        error: body.error?.message || `Gemini HTTP ${response.status}`,
        pages: [],
      };
    }

    const text =
      body.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("\n")
        .trim() || "";

    const json = extractJsonObject(text);
    const pages = normalizeGeminiPages(json, pageCount);

    return {
      ok: pages.length > 0,
      method: "gemini-pdf-inline",
      error: pages.length ? "" : "Gemini returned no page text.",
      pages,
      rawSummary: json.summary || "",
      rawPageCount: json.pageCount,
    };
  } catch (error) {
    return {
      ok: false,
      method: "gemini-pdf-inline",
      error:
        error?.name === "AbortError"
          ? `Gemini PDF extraction timed out after ${timeoutMs}ms.`
          : error.message,
      pages: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function textFromDocumentAiAnchor(fullText, textAnchor) {
  const segments = safeArray(textAnchor?.textSegments);
  const parts = [];

  for (const segment of segments) {
    const start = Number(segment.startIndex || 0);
    const end = Number(segment.endIndex || 0);
    if (end > start) parts.push(fullText.slice(start, end));
  }

  return cleanText(parts.join(" "), 4000);
}

function normalizedBoundingPoly(layout) {
  const vertices = safeArray(layout?.boundingPoly?.normalizedVertices);
  if (!vertices.length) return null;

  return vertices.map((v) => ({
    x: Number(v.x || 0),
    y: Number(v.y || 0),
  }));
}

function docAiLayoutBlock({ item, fullText, page, type, index }) {
  const layout = safeObject(item.layout);
  const text = textFromDocumentAiAnchor(fullText, layout.textAnchor);

  return {
    id: `docai_${type}_p${page}_${index + 1}`,
    type,
    page,
    text: cleanText(text, 1200),
    confidence: Number(item.detectedLanguages?.[0]?.confidence || item.confidence || 0),
    boundingPoly: normalizedBoundingPoly(layout),
    orientation: layout.orientation || "",
  };
}

function docAiTableToJson({ table, fullText, page, index }) {
  const t = safeObject(table);

  function cellText(cell) {
    return textFromDocumentAiAnchor(fullText, safeObject(cell).layout?.textAnchor);
  }

  const headerRows = safeArray(t.headerRows).map((row) =>
    safeArray(row.cells).map((cell) => cellText(cell))
  );

  const bodyRows = safeArray(t.bodyRows).map((row) =>
    safeArray(row.cells).map((cell) => cellText(cell))
  );

  const columns = headerRows[0] || [];
  const rows = bodyRows;

  return {
    id: `docai_table_p${page}_${index + 1}`,
    page,
    caption: `Detected table on page ${page}`,
    columns,
    rows,
    headerRows,
    bodyRows,
    boundingPoly: normalizedBoundingPoly(t.layout),
    source: "document-ai",
  };
}

function docAiEntityToJson(entity, index) {
  const e = safeObject(entity);
  return {
    id: e.id || `docai_entity_${index + 1}`,
    type: e.type || e.normalizedValue?.text || "entity",
    mentionText: cleanText(e.mentionText || "", 600),
    confidence: Number(e.confidence || 0),
    pageAnchor: e.pageAnchor || null,
    normalizedValue: e.normalizedValue || null,
    source: "document-ai",
  };
}

async function extractPdfWithDocumentAi({ buffer }) {
  const enabled = envTrue(["LIVE_TUTOR_ENABLE_DOCUMENT_AI_OCR", "PDF_OCR_ENABLED"], false);

  if (!enabled) {
    return {
      ok: false,
      method: "document-ai",
      skipped: true,
      error: "Document AI OCR disabled by env.",
      pages: [],
      entities: [],
    };
  }

  const processorName = process.env.DOCUMENT_AI_PROCESSOR_NAME || "";
  if (!processorName) {
    return {
      ok: false,
      method: "document-ai",
      skipped: true,
      error: "DOCUMENT_AI_PROCESSOR_NAME missing.",
      pages: [],
      entities: [],
    };
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      ok: false,
      method: "document-ai",
      skipped: true,
      error: "GOOGLE_APPLICATION_CREDENTIALS missing. Document AI cannot run locally.",
      pages: [],
      entities: [],
    };
  }

  try {
    const documentai = await import("@google-cloud/documentai").catch(() => null);

    if (!documentai) {
      return {
        ok: false,
        method: "document-ai",
        skipped: true,
        error: "Package @google-cloud/documentai not installed. Run: npm install @google-cloud/documentai",
        pages: [],
        entities: [],
      };
    }

    const client = new documentai.v1.DocumentProcessorServiceClient();

    const [result] = await client.processDocument({
      name: processorName,
      rawDocument: {
        content: buffer.toString("base64"),
        mimeType: "application/pdf",
      },
    });

    const document = result.document || {};
    const fullText = document.text || "";
    const globalEntities = safeArray(document.entities).map(docAiEntityToJson);

    const pages = safeArray(document.pages)
      .map((pageObj, index) => {
        const pageNo = index + 1;
        const pageText =
          textFromDocumentAiAnchor(fullText, pageObj.layout?.textAnchor) ||
          safeArray(pageObj.blocks)
            .map((block) => textFromDocumentAiAnchor(fullText, block.layout?.textAnchor))
            .join("\n");

        const layoutBlocks = [
          ...safeArray(pageObj.blocks).map((item, i) =>
            docAiLayoutBlock({ item, fullText, page: pageNo, type: "block", index: i })
          ),
          ...safeArray(pageObj.paragraphs).slice(0, 80).map((item, i) =>
            docAiLayoutBlock({ item, fullText, page: pageNo, type: "paragraph", index: i })
          ),
          ...safeArray(pageObj.formFields).slice(0, 40).map((item, i) =>
            docAiLayoutBlock({ item, fullText, page: pageNo, type: "formField", index: i })
          ),
        ].filter((b) => b.text || b.boundingPoly);

        const tables = safeArray(pageObj.tables).map((table, tableIndex) =>
          docAiTableToJson({ table, fullText, page: pageNo, index: tableIndex })
        );

        const visualElements = safeArray(pageObj.visualElements).map((item, i) =>
          docAiLayoutBlock({ item, fullText, page: pageNo, type: "visualElement", index: i })
        );

        const figures = visualElements.map((item, i) => ({
          id: `docai_figure_p${pageNo}_${i + 1}`,
          page: pageNo,
          caption: item.text || `Detected visual element on page ${pageNo}`,
          kind: "document_ai_visual_element",
          boundingPoly: item.boundingPoly,
          source: "document-ai",
        }));

        const text = cleanText(pageText || "", 50000);

        return {
          page: pageNo,
          text,
          ocrText: text,
          exactPageBreak: true,
          extractionMethod: "document-ai",
          quality: qualityScore(text),
          layoutBlocks,
          tables,
          figures,
          entities: globalEntities,
          pageImageUrl: "",
          pageImagePath: "",
        };
      })
      .filter((page) => page.text || page.layoutBlocks.length || page.tables.length || page.figures.length);

    return {
      ok: pages.length > 0,
      method: "document-ai",
      error: pages.length ? "" : "Document AI returned no page text/layout.",
      pages,
      entities: globalEntities,
      rawTextLength: fullText.length,
    };
  } catch (error) {
    return {
      ok: false,
      method: "document-ai",
      error: error.message,
      pages: [],
      entities: [],
    };
  }
}

function mergePageCandidates({ pdfParsePages, documentAiPages, geminiPages, pageImages }) {
  const pageMap = new Map();

  function addPages(pages, priority) {
    for (const raw of safeArray(pages)) {
      const pageNo = Number(raw.page || 1);
      const current = pageMap.get(pageNo);
      const candidateQuality = raw.quality || qualityScore(raw.text || raw.ocrText);

      const candidate = {
        ...raw,
        page: pageNo,
        text: cleanText(raw.text || raw.ocrText || "", 100000),
        ocrText: cleanText(raw.ocrText || "", 100000),
        quality: candidateQuality,
        layoutBlocks: safeArray(raw.layoutBlocks),
        tables: safeArray(raw.tables),
        figures: safeArray(raw.figures),
        entities: safeArray(raw.entities),
        pageImageUrl: raw.pageImageUrl || "",
        pageImagePath: raw.pageImagePath || "",
        priority,
      };

      if (!candidate.text && !candidate.ocrText && !candidate.layoutBlocks.length && !candidate.tables.length) continue;

      if (!current) {
        pageMap.set(pageNo, candidate);
        continue;
      }

      const currentQuality = current.quality || qualityScore(current.text || current.ocrText);

      const candidateHasVisual = candidate.layoutBlocks.length || candidate.tables.length || candidate.figures.length;
      const currentHasVisual = current.layoutBlocks.length || current.tables.length || current.figures.length;

      if (
        candidateQuality.score > currentQuality.score + 0.08 ||
        candidate.text.length > current.text.length * 1.25 ||
        (candidateHasVisual && !currentHasVisual) ||
        (priority > current.priority && currentQuality.needsOcr)
      ) {
        pageMap.set(pageNo, {
          ...candidate,
          pageImageUrl: current.pageImageUrl || candidate.pageImageUrl,
          pageImagePath: current.pageImagePath || candidate.pageImagePath,
        });
      } else {
        pageMap.set(pageNo, {
          ...current,
          ocrText: current.ocrText || candidate.ocrText,
          layoutBlocks: current.layoutBlocks?.length ? current.layoutBlocks : candidate.layoutBlocks,
          tables: current.tables?.length ? current.tables : candidate.tables,
          figures: current.figures?.length ? current.figures : candidate.figures,
          entities: current.entities?.length ? current.entities : candidate.entities,
        });
      }
    }
  }

  addPages(pdfParsePages, 1);
  addPages(documentAiPages, 3);
  addPages(geminiPages, 2);

  const imagesByPage = new Map();
  for (const image of safeArray(pageImages)) {
    imagesByPage.set(Number(image.page), image);
  }

  return [...pageMap.values()]
    .sort((a, b) => Number(a.page || 0) - Number(b.page || 0))
    .map((page) => {
      const image = imagesByPage.get(Number(page.page)) || {};
      return {
        page: page.page,
        text: cleanText(page.text || page.ocrText, 100000),
        ocrText: cleanText(page.ocrText || page.text, 100000),
        exactPageBreak: page.exactPageBreak,
        extractionMethod: page.extractionMethod,
        quality: page.quality || qualityScore(page.text || page.ocrText),
        layoutBlocks: safeArray(page.layoutBlocks),
        tables: safeArray(page.tables),
        figures: safeArray(page.figures),
        entities: safeArray(page.entities),
        pageImageUrl: image.url || page.pageImageUrl || "",
        pageImagePath: image.path || page.pageImagePath || "",
      };
    });
}

async function renderPdfPageImages({ buffer, resourceId, pageCount }) {
  return cleanPdfPageImageRenderer.renderPdfPageImages({
    buffer,
    resourceId,
    pageCount,
  });
}

function chunkPage(page, maxChars = 3200, overlap = 280) {
  const text = cleanText(page.text || page.ocrText);
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      const sentence = text.lastIndexOf(".", end);
      const newline = text.lastIndexOf("\n", end);
      const cut = Math.max(sentence, newline);
      if (cut > start + Math.floor(maxChars * 0.55)) end = cut + 1;
    }

    const chunkText = text.slice(start, end).trim();

    if (chunkText) {
      chunks.push({
        page: page.page,
        text: chunkText,
        ocrText: cleanText(page.ocrText || page.text, 50000),
        charStart: start,
        charEnd: end,
        pageQuality: page.quality,
        extractionMethod: page.extractionMethod,
        layoutBlocks: safeArray(page.layoutBlocks),
        tables: safeArray(page.tables),
        figures: safeArray(page.figures),
        entities: safeArray(page.entities),
        pageImageUrl: page.pageImageUrl || "",
        pageImagePath: page.pageImagePath || "",
      });
    }

    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

async function fetchTranscriptUrl(url) {
  const rawUrl = safeString(url);

  if (!/^https?:\/\//i.test(rawUrl)) {
    throw new Error("Transcript URL must start with http:// or https://");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "LiveTutorAgent1/1.0" },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`URL fetch failed HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    return cleanText(
      text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    );
  } finally {
    clearTimeout(timer);
  }
}

async function extractFromPdfFile({ file, body, resourceId }) {
  const diagnostics = {
    sourceType: "pdf",
    extractionAttempts: [],
    selectedMethod: "",
    usedGeminiPdfFallback: false,
    usedDocumentAi: false,
    pageImagesGenerated: false,
    pageImageRenderMethod: "none",
    pageImageCount: 0,
    pageImageError: "",
    cleanPdfPageImageRendererUsed: false,
    pageImageAttempts: [],
    badPages: [],
    warnings: [],
  };

  let pdfParsePages = [];
  let parsedPageCount = Number(body.pageCount || 1);
  let pdfParseText = "";

  try {
    const parsed = await parsePdf(file.buffer);
    pdfParseText = cleanText(parsed.text || "");
    parsedPageCount = Number(parsed.numpages || parsed.numrender || body.pageCount || 1);
    pdfParsePages = splitPagesFromText(pdfParseText, parsedPageCount);

    diagnostics.extractionAttempts.push({
      method: "pdf-parse",
      ok: pdfParsePages.length > 0,
      pageCount: pdfParsePages.length,
      charCount: pdfParseText.length,
    });
  } catch (error) {
    diagnostics.extractionAttempts.push({
      method: "pdf-parse",
      ok: false,
      error: error.message,
    });
  }

  const pageImages = await renderPdfPageImages({
    buffer: file.buffer,
    resourceId,
    pageCount: parsedPageCount,
  });

  diagnostics.cleanPdfPageImageRendererUsed = true;
  diagnostics.pageImageRenderMethod = pageImages.selectedMethod || pageImages.method || "none";
  diagnostics.pageImageCount = pageImages.images?.length || 0;
  diagnostics.pageImageAttempts = safeArray(pageImages.attempts).map((attempt) => ({
    method: attempt.method || attempt.selectedMethod || "unknown",
    ok: Boolean(attempt.ok),
    skipped: Boolean(attempt.skipped),
    error: cleanText(attempt.error || "", 1200),
    imageCount: safeArray(attempt.images).length,
  }));

  diagnostics.extractionAttempts.push({
    method: "clean-pdf-page-images",
    ok: pageImages.ok,
    skipped: pageImages.skipped,
    selectedMethod: diagnostics.pageImageRenderMethod,
    error: pageImages.error,
    imageCount: diagnostics.pageImageCount,
    attempts: diagnostics.pageImageAttempts,
  });

  if (pageImages.ok) diagnostics.pageImagesGenerated = true;
  else diagnostics.pageImageError = pageImages.error || "";

  const avgQuality = pdfParsePages.length
    ? pdfParsePages.reduce((sum, page) => sum + Number(page.quality?.score || 0), 0) / pdfParsePages.length
    : 0;

  const badPages = pdfParsePages.filter((page) => page.quality?.needsOcr).map((page) => page.page);

  const shouldUseOcr =
    !pdfParsePages.length ||
    avgQuality < 0.7 ||
    badPages.length > Math.max(1, Math.floor(pdfParsePages.length * 0.25)) ||
    envTrue(["AGENT1_FORCE_DOCUMENT_AI_OCR"], false) ||
    envTrue(["AGENT1_FORCE_GEMINI_PDF_EXTRACTION"], false);

  let documentAiPages = [];
  let geminiPages = [];

  if (shouldUseOcr && envTrue(["LIVE_TUTOR_ENABLE_DOCUMENT_AI_OCR", "PDF_OCR_ENABLED"], false)) {
    const docAi = await extractPdfWithDocumentAi({ buffer: file.buffer });

    diagnostics.extractionAttempts.push({
      method: "document-ai",
      ok: docAi.ok,
      skipped: docAi.skipped,
      error: docAi.error,
      pageCount: docAi.pages?.length || 0,
      entityCount: docAi.entities?.length || 0,
    });

    if (docAi.ok) {
      diagnostics.usedDocumentAi = true;
      documentAiPages = docAi.pages;
    }
  }

  if (shouldUseOcr || envTrue(["AGENT1_ALWAYS_USE_GEMINI_PDF_EXTRACTION"], true)) {
    const gemini = await extractPdfWithGeminiInline({
      buffer: file.buffer,
      title: body.title || file.originalname,
      pageCount: parsedPageCount,
    });

    diagnostics.extractionAttempts.push({
      method: "gemini-pdf-inline",
      ok: gemini.ok,
      error: gemini.error,
      pageCount: gemini.pages?.length || 0,
    });

    if (gemini.ok) {
      diagnostics.usedGeminiPdfFallback = true;
      geminiPages = gemini.pages;
    }
  }

  const pages = mergePageCandidates({
    pdfParsePages,
    documentAiPages,
    geminiPages,
    pageImages: pageImages.images,
  });

  if (!pages.length) {
    throw new Error(
      `No useful PDF text extracted. Attempts: ${JSON.stringify(diagnostics.extractionAttempts)}`
    );
  }

  diagnostics.selectedMethod = [
    "pdf-parse",
    diagnostics.usedDocumentAi ? "document-ai" : "",
    diagnostics.usedGeminiPdfFallback ? "gemini-pdf-inline" : "",
    diagnostics.pageImagesGenerated ? `page-images:${diagnostics.pageImageRenderMethod || "unknown"}` : "",
  ]
    .filter(Boolean)
    .join("+");

  diagnostics.badPages = pages.filter((page) => page.quality?.needsOcr).map((page) => page.page);
  diagnostics.averageQuality = Number(
    (
      pages.reduce((sum, page) => sum + Number(page.quality?.score || 0), 0) / pages.length
    ).toFixed(3)
  );

  const fullText = pages.map((page) => page.text || page.ocrText).join("\n\n");

  return {
    pages,
    fullText,
    pageCount: pages.length,
    method: diagnostics.selectedMethod,
    diagnostics,
  };
}

async function createResource({ file, body = {}, context = {} }) {
  await ensureMongoConnected();

  const ctx = {
    ownerKey: context.ownerKey || body.ownerKey || context.offlineUserId || "demo_user",
    offlineUserId: context.offlineUserId || body.offlineUserId || "demo_user",
    deviceId: context.deviceId || body.deviceId || "demo_device",
  };

  const resourceId = makeId("glt_resource");

  let sourceType = "text";
  let title = normalizeTitle(body.title || body.resourceTitle || "Agent 1 Resource");
  let originalFilename = "";
  let mimeType = "text/plain";
  let sizeBytes = 0;
  let sourceUrl = cleanText(body.url || body.transcriptUrl || "");
  let method = "manual-text";
  let fullText = "";
  let pages = [];
  let diagnostics = {
    sourceType,
    extractionAttempts: [],
    selectedMethod: method,
    warnings: [],
  };

  if (file) {
    originalFilename = file.originalname || "";
    title = normalizeTitle(body.title || originalFilename || title);
    mimeType = file.mimetype || "";
    sizeBytes = file.size || file.buffer?.length || 0;

    if (/pdf/i.test(mimeType) || /\.pdf$/i.test(originalFilename)) {
      sourceType = "pdf";

      const extracted = await extractFromPdfFile({
        file,
        body,
        resourceId,
      });

      pages = extracted.pages;
      fullText = extracted.fullText;
      method = extracted.method;
      diagnostics = extracted.diagnostics;
    } else {
      sourceType = "text";
      method = "plain-text-file";
      fullText = cleanText(file.buffer.toString("utf8"));
      pages = splitPagesFromText(
        fullText,
        Number(body.pageCount || Math.max(1, Math.ceil(fullText.length / 3500)))
      );
      diagnostics.extractionAttempts.push({
        method,
        ok: pages.length > 0,
        pageCount: pages.length,
        charCount: fullText.length,
      });
    }
  } else if (sourceUrl) {
    sourceType = "transcript";
    method = "url-transcript";
    title = normalizeTitle(body.title || sourceUrl);
    fullText = await fetchTranscriptUrl(sourceUrl);
    pages = splitPagesFromText(
      fullText,
      Number(body.pageCount || Math.max(1, Math.ceil(fullText.length / 3500)))
    );
    diagnostics.extractionAttempts.push({
      method,
      ok: pages.length > 0,
      pageCount: pages.length,
      charCount: fullText.length,
    });
  } else {
    sourceType = cleanText(body.sourceType || "text") || "text";
    method = "manual-text";
    fullText = cleanText(body.text || body.transcript || body.content || "");
    pages = splitPagesFromText(
      fullText,
      Number(body.pageCount || Math.max(1, Math.ceil(fullText.length / 3500)))
    );
    diagnostics.extractionAttempts.push({
      method,
      ok: pages.length > 0,
      pageCount: pages.length,
      charCount: fullText.length,
    });
  }

  fullText = cleanText(fullText || pages.map((page) => page.text || page.ocrText).join("\n\n"));

  if (!fullText || fullText.length < 20 || !pages.length) {
    throw new Error("No useful text extracted. Upload a text PDF or enable Gemini/Document AI extraction.");
  }

  const fileHash = file?.buffer ? sha256(file.buffer) : sha256(fullText);

  const pageAssets = pages.map((page) => ({
    id: `page_${page.page}`,
    page: page.page,
    kind: "page_visual_text_asset",
    extractionMethod: page.extractionMethod,
    textQuality: page.quality,
    hasText: Boolean(page.text),
    hasOcrText: Boolean(page.ocrText),
    hasImage: Boolean(page.pageImageUrl || page.pageImagePath),
    hasPageImage: Boolean(page.pageImageUrl || page.pageImagePath),
    pageImageUrl: page.pageImageUrl || "",
    pageImagePath: page.pageImagePath || "",
    pageImageRenderMethod: diagnostics.pageImageRenderMethod || "none",
    layoutBlockCount: safeArray(page.layoutBlocks).length,
    tableCount: safeArray(page.tables).length,
    figureCount: safeArray(page.figures).length,
    entityCount: safeArray(page.entities).length,
    hasFigures: safeArray(page.figures).length > 0,
    hasTables: safeArray(page.tables).length > 0,
    hasDiagramCandidate:
      safeArray(page.figures).length > 0 ||
      safeArray(page.tables).length > 0 ||
      safeArray(page.layoutBlocks).some((block) =>
        /visual|figure|diagram|table|chart|schema|workflow/i.test(
          `${safeString(block.type)} ${safeString(block.text)} ${safeString(block.caption)}`
        )
      ),
    figures: safeArray(page.figures),
    tables: safeArray(page.tables),
  }));

  const resource = await GoogleLiveTutorResource.create({
    resourceId,
    ownerKey: ctx.ownerKey,
    offlineUserId: ctx.offlineUserId,
    deviceId: ctx.deviceId,
    title,
    originalFilename,
    sourceType,
    mimeType,
    sizeBytes,
    sourceUrl,
    status: "extracting",
    extraction: {
      method,
      ok: true,
      pageCount: pages.length,
      charCount: fullText.length,
      chunkCount: 0,
      hasText: true,
      hasOcrText: pages.some((page) => Boolean(page.ocrText)),
      hasPageImages: pages.some((page) => Boolean(page.pageImageUrl)),
      hasLayoutBlocks: pages.some((page) => safeArray(page.layoutBlocks).length > 0),
      hasTables: pages.some((page) => safeArray(page.tables).length > 0),
      hasFigures: pages.some((page) => safeArray(page.figures).length > 0),
      error: "",
      warnings: safeArray(diagnostics.warnings),
    },
    summary: fullText.slice(0, 1600),
    metadata: {
      agent1Ready: true,
      fileHash,
      diagnostics,
      pageAssets,
      diagramPages: pageAssets
        .filter((page) => page.hasDiagramCandidate)
        .map((page) => page.page),
      figures: pageAssets.flatMap((page) => page.figures || []),
      tables: pageAssets.flatMap((page) => page.tables || []),
      extractionQuality: {
        pageCount: pages.length,
        averageScore: Number(
          (
            pages.reduce((sum, page) => sum + Number(page.quality?.score || 0), 0) / pages.length
          ).toFixed(3)
        ),
        badPages: pages.filter((page) => page.quality?.needsOcr).map((page) => page.page),
      },
      sourceRefGarbageRemovedFromVisibleText: true,
      fullPdfTextAvailableToAgent1: true,
      geminiPdfFallbackAvailable: Boolean(getGeminiApiKey()),
      documentAiConfigured: Boolean(process.env.DOCUMENT_AI_PROCESSOR_NAME),
      documentAiCredentialsPresent: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      documentAiUsed: Boolean(diagnostics.usedDocumentAi),
      pageImagesGenerated: Boolean(diagnostics.pageImagesGenerated),
      pageImageRenderMethod: diagnostics.pageImageRenderMethod || (diagnostics.pageImagesGenerated ? "unknown" : "none"),
      pageImageCount: Number(diagnostics.pageImageCount || pages.filter((page) => Boolean(page.pageImageUrl || page.pageImagePath)).length),
      cleanPdfPageImageRendererUsed: Boolean(diagnostics.cleanPdfPageImageRendererUsed),
      pageImageAttempts: safeArray(diagnostics.pageImageAttempts),
      fullPageImagesSavedForGeminiVision: pages.some((page) => Boolean(page.pageImageUrl || page.pageImagePath)),
    },
  });

  const chunkDocs = [];

  for (const page of pages) {
    const chunks = chunkPage(
      page,
      Number(body.chunkMaxChars || 3200),
      Number(body.chunkOverlap || 280)
    );

    chunks.forEach((chunk, index) => {
      const chunkId = makeId("glt_chunk");
      const sourceRef = `resource:${resourceId}:page:${chunk.page}:chunk:${index + 1}`;

      const hasDiagramCandidate =
        safeArray(chunk.figures).length > 0 ||
        safeArray(chunk.tables).length > 0 ||
        safeArray(chunk.layoutBlocks).some((block) =>
          /visual|figure|diagram|table|chart|schema|workflow/i.test(
            `${safeString(block.type)} ${safeString(block.text)} ${safeString(block.caption)}`
          )
        );

      chunkDocs.push({
        chunkId,
        resourceId,
        ownerKey: ctx.ownerKey,
        sourceType,
        title: `${title} — page ${chunk.page}`,
        page: chunk.page,
        chunkIndex: index,
        text: chunk.text,
        textPreview: chunk.text.slice(0, 280),
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        tokenEstimate: estimateTokens(chunk.text),
        sourceRef,
        pageRef: `resource:${resourceId}:page:${chunk.page}`,
        retrieval: {
          lastScore: 0,
          lastQuery: "",
          lastMode: "page-order",
        },
        metadata: {
          pageQuality: chunk.pageQuality,
          extractionMethod: chunk.extractionMethod,
          cleanedVisibleText: true,
          agent1Ready: true,

          ocrText: cleanText(chunk.ocrText, 50000),
          layoutBlocks: safeArray(chunk.layoutBlocks).slice(0, 120),
          tables: safeArray(chunk.tables).slice(0, 30),
          figures: safeArray(chunk.figures).slice(0, 30),
          entities: safeArray(chunk.entities).slice(0, 80),

          pageImageUrl: chunk.pageImageUrl || "",
          pageImagePath: chunk.pageImagePath || "",
          hasPageImage: Boolean(chunk.pageImageUrl || chunk.pageImagePath),
          fullPageImageAvailableForGeminiVision: Boolean(chunk.pageImageUrl || chunk.pageImagePath),
          pageImageRenderMethod: diagnostics.pageImageRenderMethod || "none",

          hasOcrText: Boolean(chunk.ocrText),
          hasLayoutBlocks: safeArray(chunk.layoutBlocks).length > 0,
          hasTables: safeArray(chunk.tables).length > 0,
          hasFigures: safeArray(chunk.figures).length > 0,
          hasDiagramCandidate,
        },
      });
    });
  }

  if (!chunkDocs.length) {
    await GoogleLiveTutorResource.deleteOne({ resourceId });
    throw new Error("Text extracted, but no chunks were created.");
  }

  await GoogleLiveTutorResourceChunk.insertMany(chunkDocs, { ordered: false });

  resource.status = "chunked";
  resource.extraction.chunkCount = chunkDocs.length;
  await resource.save();

  // Phase 0.7 — embed every chunk for Atlas $vectorSearch (hybrid RAG).
  // Phase 0.9 — full PDF summary + outline (attached to every agent payload).
  // Both run async after response: upload stays fast.
  setImmediate(() => {
    const { embedResourceChunks } = require("./chunkEmbedding.service");
    embedResourceChunks(resourceId).catch((err) =>
      console.error(`[agent1Resource] embedding failed for ${resourceId}:`, err.message)
    );
    const { generatePdfSummaryOutline } = require("./pdfSummaryOutline.service");
    generatePdfSummaryOutline(resourceId).catch((err) =>
      console.error(`[agent1Resource] summary/outline failed for ${resourceId}:`, err.message)
    );
  });

  return {
    ok: true,
    resource: resource.toObject ? resource.toObject() : resource,
    chunks: chunkDocs,
    pages,
    diagnostics,
    metadata: {
      documentAiUsed: Boolean(diagnostics.usedDocumentAi),
      pageImagesGenerated: Boolean(diagnostics.pageImagesGenerated),
      pageImageRenderMethod: diagnostics.pageImageRenderMethod || "none",
      cleanPdfPageImageRendererUsed: Boolean(diagnostics.cleanPdfPageImageRendererUsed),
      fullPageImagesSavedForGeminiVision: pages.some((page) => Boolean(page.pageImageUrl || page.pageImagePath)),
      ocrPageCount: pages.filter((page) => Boolean(page.ocrText)).length,
      pageImageCount: pages.filter((page) => Boolean(page.pageImageUrl || page.pageImagePath)).length,
      layoutPageCount: pages.filter((page) => safeArray(page.layoutBlocks).length > 0).length,
      tablePageCount: pages.filter((page) => safeArray(page.tables).length > 0).length,
      diagramPageCandidates: pageAssets
        .filter((page) => page.hasDiagramCandidate)
        .map((page) => page.page),
    },
  };
}

async function listResources({ ownerKey, limit = 50 }) {
  await ensureMongoConnected();

  return GoogleLiveTutorResource.find({ ownerKey })
    .sort({ updatedAt: -1 })
    .limit(Math.min(Number(limit), 100))
    .lean();
}

async function getResource({ ownerKey, resourceId }) {
  await ensureMongoConnected();

  return GoogleLiveTutorResource.findOne({
    ownerKey,
    resourceId,
  }).lean();
}

async function getChunks({ ownerKey, resourceId, limit = 200 }) {
  await ensureMongoConnected();

  return GoogleLiveTutorResourceChunk.find({
    ownerKey,
    resourceId,
  })
    .sort({ page: 1, chunkIndex: 1 })
    .limit(Math.min(Number(limit), 1200))
    .lean();
}

async function health() {
  const mongoConfigured = Boolean(process.env.MONGODB_URI || process.env.MONGO_URI);
  const geminiConfigured = Boolean(getGeminiApiKey());

  try {
    await ensureMongoConnected();

    return {
      ok: true,
      service: "agent1Resource.service",
      mongoConfigured,
      mongoConnected: mongoose.connection.readyState === 1,
      database: mongoose.connection.name,
      geminiConfigured,
      geminiModel: getGeminiModel(),
      documentAiConfigured: Boolean(process.env.DOCUMENT_AI_PROCESSOR_NAME),
      documentAiCredentialsPresent: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      documentAiEnabled: envTrue(["LIVE_TUTOR_ENABLE_DOCUMENT_AI_OCR", "PDF_OCR_ENABLED"], false),
      pageImagesEnabled: envTrue(["AGENT1_ENABLE_PAGE_IMAGES", "LIVE_TUTOR_ENABLE_PDF_PAGE_IMAGES"], false),
      pdfParseInstalled: Boolean(pdfParseModule),
      pageImageRenderer: "pdftocairo -> pdftoppm",
      cleanPdfPageImageRendererUsed: true,
      fullPageImagesSavedForGeminiVision: true,
    };
  } catch (error) {
    return {
      ok: false,
      service: "agent1Resource.service",
      mongoConfigured,
      mongoConnected: false,
      geminiConfigured,
      error: error.message,
      pdfParseInstalled: Boolean(pdfParseModule),
    };
  }
}

module.exports = {
  ensureMongoConnected,
  createResource,
  listResources,
  getResource,
  getChunks,
  health,
  cleanText,
  qualityScore,
  extractPdfWithGeminiInline,
  extractPdfWithDocumentAi,
  renderPdfPageImages,
};