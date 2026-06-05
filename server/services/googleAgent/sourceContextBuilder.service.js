"use strict";

/**
 * server/services/googleAgent/sourceContextBuilder.service.js
 * =============================================================================
 * PHASE 1 COMPLETE REPLACEMENT - Accurate selected-node context first.
 *
 * What this file fixes:
 * - Gemini/ADK receives selected-node truth first, not polluted mixed evidence.
 * - selectedEvidence, samePageEvidence, nearbyEvidence, relatedEvidence,
 *   comparisonEvidence, and externalEvidence are separated and tagged.
 * - Exact selected sourceRefs/chunkIds/pages are hard-prioritized.
 * - Full selected page text, same page chunks, previous/next pages, PDF outline,
 *   PDF summary, OCR/layout/table/figure/page-image metadata are included.
 * - PDF extracted text remains the truth. OCR is helper. Page images are passed as
 *   visual/diagram/layout guidance for later Gemini vision/diagram phase.
 * - No fake fallback: if chunks are missing, the service throws.
 * =============================================================================
 */

const crypto = require("crypto");
const { GoogleLiveTutorResourceChunk } = require("../../models/GoogleLiveTutorResource");

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

function cleanText(value, maxLen = 4000) {
  return safeString(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLen);
}

function inlineText(value, maxLen = 2000) {
  return cleanText(value, maxLen).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function envNumber(names, fallback) {
  for (const name of safeArray(names)) {
    const n = Number(process.env[name]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function envTrue(names, fallback = false) {
  for (const name of safeArray(names)) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      return ["1", "true", "yes", "y", "on"].includes(String(raw).trim().toLowerCase());
    }
  }
  return fallback;
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function dedupeBy(items, keyFn) {
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

function isGarbledText(value) {
  const text = cleanText(value, 50000);
  if (!text) return false;
  const compact = text.replace(/\s+/g, "");
  if (!compact) return false;
  const bad = (compact.match(/[□�\uFFFD]/g) || []).length;
  const readable = (compact.match(/[\p{L}\p{N}]/gu) || []).length;
  return Boolean(
    (bad >= 6 && bad / compact.length >= 0.05) ||
      (compact.length >= 80 && readable / compact.length < 0.25 && bad >= 3)
  );
}

function textReliability(value) {
  const text = cleanText(value, 50000);
  const garbled = isGarbledText(text);
  return {
    hasText: Boolean(text),
    ocrReliable: Boolean(text && !garbled),
    ocrGarbled: Boolean(text && garbled),
    pdfExtractedTextIsTruth: true,
    ocrIsHelperOnly: true,
    imageTextIsTruth: false,
    pageImageUse: "visual_preview_layout_diagram_shape_only",
  };
}

function tableToText(table) {
  if (!table) return "";
  if (typeof table === "string") return cleanText(table, 10000);
  const obj = safeObject(table);
  if (obj.markdown) return cleanText(obj.markdown, 10000);
  if (obj.text) return cleanText(obj.text, 10000);
  if (obj.html) return cleanText(obj.html, 10000);
  if (Array.isArray(obj.rows)) {
    return obj.rows
      .map((row) => safeArray(row).map((cell) => inlineText(cell, 180)).join(" | "))
      .join("\n")
      .slice(0, 10000);
  }
  return cleanText(obj, 10000);
}

function figureToText(figure) {
  if (!figure) return "";
  if (typeof figure === "string") return cleanText(figure, 8000);
  const obj = safeObject(figure);
  return cleanText(obj.caption || obj.description || obj.alt || obj.text || obj.summary || obj.title || obj, 8000);
}

function collectPageImage(raw) {
  const r = safeObject(raw);
  const m = safeObject(r.metadata);
  const nested = safeObject(r.pageImage || m.pageImage || m.pageImageRef || m.image || m.pdfPageImage);

  const url = cleanText(
    r.pageImageUrl ||
      m.pageImageUrl ||
      nested.url ||
      nested.src ||
      nested.publicUrl ||
      nested.signedUrl ||
      "",
    1800
  );

  const path = cleanText(
    r.pageImagePath ||
      m.pageImagePath ||
      nested.path ||
      nested.filePath ||
      nested.localPath ||
      "",
    1800
  );

  return { url, src: url, path };
}

function compactResource(resource) {
  const r = safeObject(resource);
  return {
    resourceId: cleanText(r.resourceId || r.id || "", 260),
    title: cleanText(r.title || r.originalName || r.originalFilename || r.filename || "Uploaded Resource", 400),
    originalFilename: cleanText(r.originalFilename || r.filename || "", 400),
    sourceType: cleanText(r.sourceType || r.type || r.resourceType || "unknown", 100),
    pageCount: Number(r.extraction?.pageCount || r.pageCount || r.metadata?.pageCount || 0),
    chunkCount: Number(r.extraction?.chunkCount || r.chunkCount || 0),
    charCount: Number(r.extraction?.charCount || r.charCount || 0),
    summary: cleanText(r.summary || r.metadata?.summary || r.extraction?.summary || "", 26000),
    extraction: safeObject(r.extraction),
    metadata: safeObject(r.metadata),
  };
}

function compactChunk(chunk, maxText = 26000) {
  const c = safeObject(chunk);
  const m = safeObject(c.metadata);
  const page = Math.max(1, Number(c.page || c.pageNumber || m.page || 1));
  const chunkIndex = Math.max(0, Number(c.chunkIndex || c.index || m.chunkIndex || 0));
  const resourceId = cleanText(c.resourceId || m.resourceId || "", 260);
  const pageImage = collectPageImage(c);

  const ocrText = cleanText(
    c.ocrText || m.ocrText || m.pageOcrText || m.documentAiText || m.visionText || m.geminiVisionText || "",
    maxText
  );

  const text = cleanText(c.text || c.fullText || c.content || c.textPreview || "", maxText);
  const reliability = textReliability(ocrText);

  return {
    resourceId,
    chunkId: cleanText(c.chunkId || c.id || m.chunkId || `${resourceId || "resource"}_p${page}_c${chunkIndex}`, 260),
    sourceRef: cleanText(c.sourceRef || m.sourceRef || `resource:${resourceId}:page:${page}:chunk:${chunkIndex}`, 420),
    pageRef: cleanText(c.pageRef || m.pageRef || `resource:${resourceId}:page:${page}`, 420),
    page,
    chunkIndex,
    heading: cleanText(c.heading || m.heading || c.title || m.title || "", 320),
    title: cleanText(c.title || m.title || "", 320),
    text,
    textPreview: inlineText(c.textPreview || text || ocrText, 2600),
    ocrText,
    ...reliability,
    layoutBlocks: safeArray(c.layoutBlocks || m.layoutBlocks || m.blocks || m.documentAiLayoutBlocks || m.visionLayoutBlocks).slice(0, 260),
    tables: safeArray(c.tables || m.tables || m.detectedTables || m.documentAiTables).map(tableToText).filter(Boolean).slice(0, 120),
    figures: safeArray(c.figures || m.figures || m.detectedFigures || m.images || m.documentAiFigures).map(figureToText).filter(Boolean).slice(0, 120),
    entities: safeArray(c.entities || m.entities || m.keyTerms || m.keyConcepts).slice(0, 260),
    pageImageUrl: pageImage.url,
    pageImagePath: pageImage.path,
    hasPageImage: Boolean(pageImage.url || pageImage.path),
    metadata: m,
  };
}

function attachEvidenceRole(chunk, evidenceRole, priority, maxText = 22000) {
  const c = compactChunk(chunk, maxText);
  return {
    ...c,
    evidenceRole,
    evidencePriority: priority,
    sourceTruth: "pdf_extracted_text_chunk",
    externalOnly: evidenceRole === "externalEvidence",
    comparisonOnly: evidenceRole === "comparisonEvidence",
    imageTextIsTruth: false,
    pageImageUse: "visual_preview_layout_diagram_shape_only",
  };
}

function sourceRefFromChunk(chunk, confidence = 0.86) {
  const c = compactChunk(chunk);
  return {
    resourceId: c.resourceId,
    chunkId: c.chunkId,
    sourceRef: c.sourceRef,
    pageRef: c.pageRef,
    page: c.page,
    quote: inlineText(c.textPreview || c.text || (c.ocrReliable ? c.ocrText : ""), 1400),
    confidence,
  };
}

function normalizeSourceRefs(refs) {
  return dedupeBy(
    safeArray(refs)
      .map((ref) => {
        const r = safeObject(ref);
        return {
          resourceId: cleanText(r.resourceId || r.resource_id || "", 260),
          chunkId: cleanText(r.chunkId || r.chunk_id || r.id || "", 260),
          sourceRef: cleanText(r.sourceRef || r.source_ref || r.ref || "", 420),
          pageRef: cleanText(r.pageRef || r.page_ref || "", 420),
          page: Number(r.page || r.pageNo || r.pageNumber || 0) || 0,
          quote: inlineText(r.quote || r.text || r.snippet || r.textPreview || "", 1400),
          confidence: Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 0.78,
        };
      })
      .filter((ref) => ref.chunkId || ref.sourceRef || ref.page || ref.quote),
    (ref) => `${ref.chunkId}|${ref.sourceRef}|${ref.page}|${ref.quote.slice(0, 80)}`
  );
}

function sourceRefsFromNode(node) {
  const n = safeObject(node);
  const data = safeObject(n.data);
  return normalizeSourceRefs(n.sourceRefs || n.refs || n.sources || n.groundedRefs || data.sourceRefs || []);
}

function getRichSourcePackPages(selectedNode) {
  const n = safeObject(selectedNode);
  const data = safeObject(n.data);
  const rich = safeObject(safeObject(n.metadata).richSourcePack || data.richSourcePack);
  return safeArray(rich.pages).map((p) => Number(p)).filter(Boolean);
}

function selectedNodeTitle(selectedNode) {
  const n = safeObject(selectedNode);
  const data = safeObject(n.data);
  return inlineText(n.title || n.label || n.name || data.title || data.label || n.nodeId || n.id || "selected concept", 360);
}

function selectedNodeText(selectedNode, sourceRefs = [], question = "") {
  const n = safeObject(selectedNode);
  const data = safeObject(n.data);
  const rich = safeObject(safeObject(n.metadata).richSourcePack || data.richSourcePack);

  return [
    n.nodeId,
    n.id,
    n.label,
    n.title,
    n.name,
    n.conceptType,
    n.nodeType,
    n.shortDefinition,
    n.definition,
    n.summary,
    n.description,
    data.label,
    data.title,
    data.shortDefinition,
    question,
    rich.fullPageTextPreview,
    rich.tablesPreview,
    rich.figuresPreview,
    ...safeArray(n.children).map((x) => safeObject(x).label || safeObject(x).title || x),
    ...safeArray(n.prerequisites).map((x) => safeObject(x).label || safeObject(x).title || x),
    ...safeArray(n.visualHints),
    ...safeArray(sourceRefs).map((ref) => safeObject(ref).quote || ""),
  ]
    .map((x) => inlineText(x, 900))
    .filter(Boolean)
    .join("\n");
}

function keywordTokens(text, limit = 140) {
  const stop = new Set([
    "the", "and", "for", "with", "that", "this", "from", "source", "page", "chunk", "teacher", "student",
    "board", "concept", "what", "when", "then", "your", "into", "about", "only", "using", "will", "have",
    "has", "are", "was", "were", "can", "should", "would", "could", "you", "they", "their", "them", "our",
    "all", "any", "a", "an", "is", "it", "as", "by", "be", "if", "so", "we", "to", "in", "on", "of", "or",
    "not", "but", "there", "here", "than", "being", "while", "rather", "before", "after", "each", "own",
    "explain", "teach", "selected", "node", "details", "human", "voice", "diagram", "flowchart", "table", "quiz"
  ]);

  const seen = new Set();
  const matches = inlineText(text, 120000).toLowerCase().match(/[a-z0-9_/-]{3,}/g) || [];
  const out = [];

  for (const raw of matches) {
    const word = raw.replace(/^[-_/]+|[-_/]+$/g, "");
    if (!word || stop.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= limit) break;
  }

  return out;
}

function scoreTextOverlap(text, terms) {
  const haystack = inlineText(text, 160000).toLowerCase();
  let score = 0;
  for (const term of safeArray(terms)) {
    if (!term) continue;
    if (haystack.includes(term)) score += term.length >= 10 ? 6 : term.length >= 6 ? 3 : 1;
  }
  return score;
}

function scoreChunkForNode(chunk, selectedNode, sourceRefs = [], question = "") {
  const c = compactChunk(chunk);
  const terms = keywordTokens(selectedNodeText(selectedNode, sourceRefs, question), 140);
  const exactChunkIds = new Set(sourceRefs.map((r) => cleanText(r.chunkId, 260)).filter(Boolean));
  const exactSourceRefs = new Set(sourceRefs.map((r) => cleanText(r.sourceRef, 420)).filter(Boolean));
  const exactPages = new Set(sourceRefs.map((r) => Number(r.page)).filter(Boolean));

  let score = 0;
  if (exactChunkIds.has(c.chunkId)) score += 1000;
  if (exactSourceRefs.has(c.sourceRef)) score += 950;
  if (exactPages.has(Number(c.page))) score += 420;

  score += scoreTextOverlap(
    `${c.heading} ${c.title} ${c.text} ${c.ocrText} ${JSON.stringify(c.entities)} ${c.tables.join(" ")} ${c.figures.join(" ")}`,
    terms
  );

  if (c.tables.length) score += 8;
  if (c.figures.length) score += 8;
  if (c.ocrText && c.ocrReliable) score += 4;
  if (c.pageImageUrl || c.pageImagePath) score += 4;

  return score;
}

function pageTitleHint(pageChunks) {
  const merged = inlineText(safeArray(pageChunks).map((c) => `${c.heading} ${c.title} ${c.textPreview || c.text}`).join(" "), 3000);
  return inlineText(
    safeArray(pageChunks).find((c) => c.heading)?.heading ||
      safeArray(pageChunks).find((c) => c.title)?.title ||
      (merged.match(/^([^.!?\n:]{8,140})[:.!?\n]/) || [])[1] ||
      merged.slice(0, 90),
    240
  );
}

async function loadAllChunks({ ownerKey, resourceId, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit || envNumber(["LIVE_TUTOR_MAX_CONTEXT_CHUNKS"], 1400)), 1), 2500);
  return GoogleLiveTutorResourceChunk.find({ ownerKey, resourceId })
    .sort({ page: 1, chunkIndex: 1 })
    .limit(safeLimit)
    .lean();
}

function buildPageMap(allChunks) {
  const pageMap = new Map();
  for (const raw of safeArray(allChunks)) {
    const chunk = compactChunk(raw);
    if (!pageMap.has(chunk.page)) pageMap.set(chunk.page, []);
    pageMap.get(chunk.page).push(chunk);
  }
  for (const chunks of pageMap.values()) {
    chunks.sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex));
  }
  return pageMap;
}

function pickExactChunks(allChunks, sourceRefs, selectedNode, question = "", maxItems = 10) {
  const exactChunkIds = new Set(sourceRefs.map((r) => cleanText(r.chunkId, 260)).filter(Boolean));
  const exactSourceRefs = new Set(sourceRefs.map((r) => cleanText(r.sourceRef, 420)).filter(Boolean));
  const exactPages = new Set([
    ...sourceRefs.map((r) => Number(r.page)).filter(Boolean),
    ...getRichSourcePackPages(selectedNode),
  ]);

  const scored = safeArray(allChunks)
    .map((chunk) => {
      const c = compactChunk(chunk);
      const exact =
        exactChunkIds.has(c.chunkId) ||
        exactSourceRefs.has(c.sourceRef) ||
        exactPages.has(Number(c.page));

      return {
        raw: chunk,
        chunk: c,
        exact,
        score: scoreChunkForNode(chunk, selectedNode, sourceRefs, question),
      };
    })
    .filter((x) => x.exact || x.score >= 420)
    .sort((a, b) => b.score - a.score || a.chunk.page - b.chunk.page || a.chunk.chunkIndex - b.chunk.chunkIndex);

  return dedupeBy(scored.map((x) => attachEvidenceRole(x.raw, "selectedEvidence", x.score)), (c) => c.chunkId).slice(0, maxItems);
}

function pickSamePageChunks(allChunks, selectedEvidence, maxItems = 18) {
  const pages = new Set(safeArray(selectedEvidence).map((c) => Number(c.page)).filter(Boolean));
  return dedupeBy(
    safeArray(allChunks)
      .map((chunk) => compactChunk(chunk))
      .filter((chunk) => pages.has(Number(chunk.page)) && !safeArray(selectedEvidence).some((s) => s.chunkId === chunk.chunkId))
      .map((chunk) => attachEvidenceRole(chunk, "samePageEvidence", 700 - Number(chunk.chunkIndex || 0))),
    (c) => c.chunkId
  ).slice(0, maxItems);
}

function pickNearbyChunks(allChunks, selectedEvidence, maxItems = 18) {
  const selectedPages = new Set(safeArray(selectedEvidence).map((c) => Number(c.page)).filter(Boolean));
  const nearbyPages = new Set();
  for (const page of selectedPages) {
    if (page > 1) nearbyPages.add(page - 1);
    nearbyPages.add(page + 1);
  }

  return dedupeBy(
    safeArray(allChunks)
      .map((chunk) => compactChunk(chunk))
      .filter((chunk) => nearbyPages.has(Number(chunk.page)))
      .map((chunk) => attachEvidenceRole(chunk, "nearbyEvidence", 420 - Math.abs(Number(chunk.page) - [...selectedPages][0]))),
    (c) => c.chunkId
  ).slice(0, maxItems);
}

function detectComparisonTerms(selectedNode, sourceRefs, question = "") {
  const text = selectedNodeText(selectedNode, sourceRefs, question).toLowerCase();
  const terms = [];

  const known = [
    "star schema",
    "snowflake schema",
    "galaxy schema",
    "fact constellation",
    "migration",
    "rollback",
    "ci/cd",
    "neural network",
    "artificial neuron",
    "normalization",
    "denormalization",
  ];

  for (const item of known) {
    if (!text.includes(item)) terms.push(item);
  }

  return terms;
}

function pickComparisonChunks(allChunks, selectedNode, sourceRefs, question = "", maxItems = 10) {
  const selectedPages = new Set(sourceRefs.map((r) => Number(r.page)).filter(Boolean));
  const comparisonTerms = detectComparisonTerms(selectedNode, sourceRefs, question);
  const selectedText = selectedNodeText(selectedNode, sourceRefs, question).toLowerCase();

  const scored = safeArray(allChunks)
    .map((chunk) => {
      const c = compactChunk(chunk);
      const text = `${c.heading} ${c.title} ${c.textPreview} ${c.text}`.toLowerCase();
      let score = 0;

      for (const term of comparisonTerms) {
        if (text.includes(term)) score += 40;
      }

      if (/\b(compare|comparison|versus|vs|difference|different|similar|unlike)\b/.test(text)) score += 20;
      if (selectedPages.has(c.page)) score -= 80;
      if (selectedText.includes("star schema") && /\b(galaxy schema|snowflake schema|fact constellation)\b/.test(text)) score += 80;
      if (selectedText.includes("galaxy schema") && /\b(star schema|snowflake schema)\b/.test(text)) score += 80;
      if (selectedText.includes("snowflake schema") && /\b(star schema|galaxy schema|fact constellation)\b/.test(text)) score += 80;

      return { raw: chunk, chunk: c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.page - b.chunk.page);

  return dedupeBy(scored.map((x) => attachEvidenceRole(x.raw, "comparisonEvidence", x.score)), (c) => c.chunkId).slice(0, maxItems);
}

function pickRelatedChunks(allChunks, selectedNode, sourceRefs, question = "", usedChunkIds = new Set(), maxItems = 24) {
  const scored = safeArray(allChunks)
    .map((chunk) => {
      const c = compactChunk(chunk);
      return {
        raw: chunk,
        chunk: c,
        score: scoreChunkForNode(chunk, selectedNode, sourceRefs, question),
      };
    })
    .filter((x) => !usedChunkIds.has(x.chunk.chunkId))
    .sort((a, b) => b.score - a.score || a.chunk.page - b.chunk.page || a.chunk.chunkIndex - b.chunk.chunkIndex);

  return dedupeBy(scored.map((x) => attachEvidenceRole(x.raw, "relatedEvidence", x.score)), (c) => c.chunkId).slice(0, maxItems);
}

function mergeTeachingChunks({ selectedEvidence, samePageEvidence, nearbyEvidence, relatedEvidence, comparisonEvidence, maxItems }) {
  return dedupeBy(
    [
      ...safeArray(selectedEvidence),
      ...safeArray(samePageEvidence),
      ...safeArray(nearbyEvidence),
      ...safeArray(relatedEvidence),
      ...safeArray(comparisonEvidence),
    ],
    (c) => c.chunkId
  ).slice(0, maxItems);
}

function buildPageContexts({
  pageMap,
  selectedEvidence,
  samePageEvidence,
  nearbyEvidence,
  relatedEvidence,
  comparisonEvidence,
  maxPages = 16,
  maxTextPerPage = 36000,
}) {
  const relationByPage = new Map();

  for (const c of selectedEvidence) relationByPage.set(Number(c.page), "selected_or_same_page");
  for (const c of samePageEvidence) if (!relationByPage.has(Number(c.page))) relationByPage.set(Number(c.page), "selected_or_same_page");
  for (const c of nearbyEvidence) if (!relationByPage.has(Number(c.page))) relationByPage.set(Number(c.page), "nearby_page");
  for (const c of relatedEvidence) if (!relationByPage.has(Number(c.page))) relationByPage.set(Number(c.page), "related_page");
  for (const c of comparisonEvidence) if (!relationByPage.has(Number(c.page))) relationByPage.set(Number(c.page), "comparison_page");

  const order = {
    selected_or_same_page: 0,
    nearby_page: 1,
    related_page: 2,
    comparison_page: 3,
  };

  const pages = [...relationByPage.entries()]
    .sort((a, b) => order[a[1]] - order[b[1]] || a[0] - b[0])
    .slice(0, maxPages);

  return pages.map(([page, relation]) => {
    const chunks = safeArray(pageMap.get(page));
    const fullText = cleanText(chunks.map((c) => c.text).filter(Boolean).join("\n\n"), maxTextPerPage);
    const ocrText = cleanText(chunks.map((c) => c.ocrText).filter(Boolean).join("\n\n"), maxTextPerPage);
    const reliability = textReliability(ocrText);
    const firstImage = chunks.find((c) => c.pageImageUrl || c.pageImagePath);

    return {
      page,
      relation,
      pageTitle: pageTitleHint(chunks),
      fullText,
      ocrText,
      ...reliability,
      chunks: chunks.slice(0, 20),
      tables: chunks.flatMap((c) => c.tables || []).slice(0, 80),
      figures: chunks.flatMap((c) => c.figures || []).slice(0, 80),
      layoutBlocks: chunks.flatMap((c) => c.layoutBlocks || []).slice(0, 200),
      entities: chunks.flatMap((c) => c.entities || []).slice(0, 200),
      pageImageUrl: firstImage?.pageImageUrl || "",
      pageImagePath: firstImage?.pageImagePath || "",
      hasPageImage: Boolean(firstImage?.pageImageUrl || firstImage?.pageImagePath),
      sourceRefs: chunks.map((c) => sourceRefFromChunk(c, relation === "selected_or_same_page" ? 0.95 : 0.78)),
      visualUseRule:
        relation === "selected_or_same_page"
          ? "Gemini may inspect this selected page image as diagram/layout guide; PDF extracted text remains truth."
          : "Support only; do not override selected evidence.",
    };
  });
}

function buildFullPdfSummary(allChunks, resource, maxChars = 30000) {
  const chunks = safeArray(allChunks).map((c) => compactChunk(c, 5000));
  const pageCount = Math.max(...chunks.map((c) => Number(c.page) || 0), Number(resource?.pageCount || resource?.extraction?.pageCount || 0), 0);
  const byPage = buildPageMap(chunks);
  const pageSummaries = [...byPage.entries()].slice(0, 80).map(([page, pageChunks]) => ({
    page,
    title: pageTitleHint(pageChunks),
    preview: inlineText(pageChunks.map((c) => c.textPreview || c.text).join(" "), 1200),
    hasTables: pageChunks.some((c) => safeArray(c.tables).length),
    hasFigures: pageChunks.some((c) => safeArray(c.figures).length || c.hasPageImage),
  }));

  const summaryText = cleanText(
    [
      `Resource: ${compactResource(resource).title}`,
      `Pages known: ${pageCount}`,
      ...pageSummaries.map((p) => `Page ${p.page}: ${p.title}. ${p.preview}`),
    ].join("\n"),
    maxChars
  );

  return {
    ok: true,
    summary: summaryText,
    pageCount,
    pageSummaries,
    rule: "Full PDF summary is overview only; selectedEvidence remains primary truth.",
  };
}

function buildPdfOutlineFromChunks(allChunks, resource, maxItems = 80) {
  const pageMap = buildPageMap(allChunks);
  const outline = [...pageMap.entries()]
    .slice(0, maxItems)
    .map(([page, chunks]) => ({
      page,
      title: pageTitleHint(chunks),
      preview: inlineText(chunks.map((c) => c.textPreview || c.text).join(" "), 900),
      hasImage: chunks.some((c) => c.hasPageImage),
      hasTable: chunks.some((c) => safeArray(c.tables).length),
      hasFigure: chunks.some((c) => safeArray(c.figures).length),
    }));

  return {
    ok: true,
    resourceTitle: compactResource(resource).title,
    outline,
    outlineText: cleanText(outline.map((o) => `Pg. ${o.page}: ${o.title} — ${o.preview}`).join("\n"), 22000),
    rule: "Outline is navigation/background only, not replacement for selected evidence.",
  };
}

function buildVisualContext({
  resource,
  selectedEvidence,
  samePageEvidence,
  nearbyEvidence,
  relatedEvidence,
  comparisonEvidence,
  pageContexts,
  sourceRefs,
}) {
  const selectedAndSupport = dedupeBy(
    [...safeArray(selectedEvidence), ...safeArray(samePageEvidence), ...safeArray(nearbyEvidence)],
    (c) => c.chunkId
  );

  const pageImages = dedupeBy(
    selectedAndSupport
      .filter((c) => c.pageImageUrl || c.pageImagePath)
      .map((c) => ({
        page: c.page,
        chunkId: c.chunkId,
        pageImageUrl: c.pageImageUrl,
        pageImagePath: c.pageImagePath,
        sourceRef: c.sourceRef,
        evidenceRole: c.evidenceRole,
        useRule:
          "Use this image only to inspect diagram/layout/figure shape. PDF extracted text and selectedEvidence remain the truth.",
      })),
    (x) => `${x.page}|${x.pageImageUrl}|${x.pageImagePath}`
  );

  const ocrBlocks = selectedAndSupport
    .filter((c) => c.ocrText)
    .map((c) => ({
      page: c.page,
      chunkId: c.chunkId,
      ocrText: cleanText(c.ocrText, 12000),
      ocrReliable: c.ocrReliable,
      ocrGarbled: c.ocrGarbled,
      evidenceRole: c.evidenceRole,
      rule: c.ocrGarbled ? "Ignore garbled OCR text; use page image only visually." : "OCR helper only; PDF text is truth.",
    }))
    .slice(0, 80);

  const tables = selectedAndSupport.flatMap((c) =>
    safeArray(c.tables).map((table, i) => ({
      page: c.page,
      chunkId: c.chunkId,
      index: i,
      table,
      evidenceRole: c.evidenceRole,
    }))
  );

  const figures = selectedAndSupport.flatMap((c) =>
    safeArray(c.figures).map((figure, i) => ({
      page: c.page,
      chunkId: c.chunkId,
      index: i,
      figure,
      evidenceRole: c.evidenceRole,
    }))
  );

  const layoutBlocks = selectedAndSupport.flatMap((c) =>
    safeArray(c.layoutBlocks).map((block, i) => ({
      page: c.page,
      chunkId: c.chunkId,
      index: i,
      block,
      evidenceRole: c.evidenceRole,
    }))
  );

  const entities = dedupeBy(
    selectedAndSupport.flatMap((c) => safeArray(c.entities).map((entity) => ({ page: c.page, entity }))),
    (x) => inlineText(x.entity, 140)
  ).slice(0, 260);

  return {
    ok: true,
    resource: compactResource(resource),
    pageImages,
    ocrBlocks,
    tables,
    figures,
    layoutBlocks,
    entities,
    sourceRefs,
    pageContexts,
    selectedPages: dedupeBy(selectedEvidence.map((c) => c.page), String),
    comparisonOnlyPages: dedupeBy(comparisonEvidence.map((c) => c.page), String),
    rules: {
      selectedEvidenceIsMainTruth: true,
      samePageEvidenceSupportsSelectedNode: true,
      nearbyEvidenceSupportsOnly: true,
      comparisonEvidenceOnlyForComparison: true,
      externalEvidenceSupplementaryOnly: true,
      pdfExtractedTextIsTruth: true,
      ocrIsHelperOnly: true,
      imageTextIsTruth: false,
      pageImageUse: "visual_preview_layout_diagram_shape_only",
      geminiVisionCanInspectSelectedPageImages: pageImages.length > 0,
    },
    metadata: {
      pageImageCount: pageImages.length,
      ocrBlockCount: ocrBlocks.length,
      reliableOcrBlockCount: ocrBlocks.filter((x) => x.ocrReliable).length,
      unreliableOcrBlockCount: ocrBlocks.filter((x) => !x.ocrReliable).length,
      garbledOcrDetected: ocrBlocks.some((x) => x.ocrGarbled),
      tableCount: tables.length,
      figureCount: figures.length,
      layoutBlockCount: layoutBlocks.length,
      pageImagesIncluded: pageImages.length > 0,
      ocrIncluded: ocrBlocks.length > 0,
      tablesIncluded: tables.length > 0,
      figuresIncluded: figures.length > 0,
      layoutIncluded: layoutBlocks.length > 0,
    },
  };
}

function detectDiagramIntent({ selectedNode, selectedEvidence, samePageEvidence, visualContext }) {
  const text = inlineText(
    [
      selectedNodeTitle(selectedNode),
      selectedNodeText(selectedNode, [], ""),
      ...safeArray(selectedEvidence).map((c) => `${c.heading} ${c.title} ${c.textPreview} ${c.text}`),
      ...safeArray(samePageEvidence).map((c) => `${c.heading} ${c.title} ${c.textPreview}`),
      JSON.stringify(safeObject(visualContext).entities || []),
    ].join("\n"),
    80000
  ).toLowerCase();

  const out = [];
  const add = (type, reason, score) => out.push({ type, reason, score });

  if (/\b(star schema|snowflake schema|galaxy schema|fact table|dimension table|warehouse|data mart)\b/.test(text)) {
    add("schemaDiagram", "Database schema/warehouse terms detected.", 0.96);
    add("comparisonTable", "Schema concepts benefit from comparison.", 0.78);
  }

  if (/\b(migration|rollback|deploy|ci\/cd|pipeline|workflow|step|process)\b/.test(text)) {
    add("workflow", "Process/workflow terms detected.", 0.94);
    add("timeline", "Evolution/deployment terms detected.", 0.72);
  }

  if (/\b(neuron|neural network|mlp|activation|weight|bias|layer|input layer|hidden layer|output layer)\b/.test(text)) {
    add("neuralNetworkDiagram", "Neural network visual terms detected.", 0.98);
    add("formulaFlow", "Neuron/activation explanation needs formula flow.", 0.82);
  }

  if (/\b(sequence|interaction|actor|client|server|request|response)\b/.test(text)) {
    add("sequenceDiagram", "Interaction terms detected.", 0.82);
  }

  if (/\b(tree|hierarchy|parent|child|root|leaf)\b/.test(text)) {
    add("tree", "Hierarchy terms detected.", 0.78);
  }

  if (/\b(table|row|column|attribute|field|key|measure|compare|comparison)\b/.test(text)) {
    add("table", "Table/attribute terms detected.", 0.76);
  }

  if (!out.length) {
    add("conceptMap", "Default source-grounded concept map.", 0.65);
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

function buildText2DiagramPlan({ selectedNode, sourceRefs, exactChunks, samePageChunks, relatedChunks, visualContext }) {
  const intents = detectDiagramIntent({
    selectedNode,
    selectedEvidence: exactChunks,
    samePageEvidence: samePageChunks,
    visualContext,
  });

  const primary = intents[0];

  return {
    ok: true,
    text2DiagramPlanUsed: true,
    diagramIntent: {
      primary: primary.type,
      candidates: intents,
    },
    requestedVisuals: intents.map((x) => x.type),
    sourceGrounding: {
      selectedSourceRefs: sourceRefs,
      selectedPages: dedupeBy(safeArray(exactChunks).map((c) => c.page), String),
      pageImageAvailable: safeArray(visualContext.pageImages).length > 0,
    },
    rules: [
      "Do not invent diagram facts.",
      "Use selectedEvidence first.",
      "Use samePageEvidence for support.",
      "Use comparisonEvidence only in comparison block.",
      "Use page image as visual/layout reference only.",
      "Never show raw JSON on board.",
    ],
  };
}

function detectPrerequisites({ selectedNode, chunks, fullPdfSummary }) {
  const text = inlineText(
    [
      selectedNodeTitle(selectedNode),
      selectedNodeText(selectedNode, [], ""),
      ...safeArray(chunks).map((c) => `${c.heading} ${c.title} ${c.textPreview}`),
      safeObject(fullPdfSummary).summary,
    ].join("\n"),
    60000
  ).toLowerCase();

  const required = [];
  const push = (concept, why) => {
    if (!required.some((x) => x.concept === concept)) required.push({ concept, why });
  };

  if (/\bstar schema|snowflake schema|galaxy schema|fact table|dimension table\b/.test(text)) {
    push("fact table", "Needed to understand warehouse schema structure.");
    push("dimension table", "Needed to understand descriptive lookup tables.");
    push("primary/foreign key", "Needed to understand joins between fact and dimension tables.");
  }

  if (/\bmigration|rollback|schema evolution|database change\b/.test(text)) {
    push("database schema", "Needed to understand what changes.");
    push("version control", "Needed to understand repeatable scripts and audit trail.");
    push("rollback", "Needed to understand safe recovery.");
  }

  if (/\bneuron|neural network|activation|weight|bias\b/.test(text)) {
    push("weighted sum", "Needed to understand artificial neuron computation.");
    push("activation function", "Needed to understand output transformation.");
    push("layers", "Needed to understand MLP structure.");
  }

  return {
    ok: true,
    required: required.slice(0, 8),
    rule: "Prerequisites are explanation helpers only; selected evidence remains truth.",
  };
}

function buildTeacherPromptPack({
  selectedNode,
  sourceRefs,
  selectedEvidence,
  samePageEvidence,
  nearbyEvidence,
  relatedEvidence,
  comparisonEvidence,
  pageContexts,
  fullPdfOutline,
  fullPdfSummary,
  visualContext,
  text2DiagramPlan,
  prerequisites,
  externalResources,
}) {
  return {
    ok: true,
    selectedNodeTitle: selectedNodeTitle(selectedNode),
    instruction:
      "Teach the selected node like a human teacher, but ground every main claim in selectedEvidence first. Do not mix comparison/external evidence into the main truth.",
    strictEvidenceOrder: [
      "selectedEvidence",
      "samePageEvidence",
      "nearbyEvidence",
      "relatedEvidence",
      "comparisonEvidence",
      "externalEvidence",
    ],
    selectedEvidence,
    samePageEvidence,
    nearbyEvidence,
    relatedEvidence,
    comparisonEvidence,
    externalEvidence: safeArray(externalResources?.externalEvidence),
    sourceRefs,
    pageContexts,
    selectedPageFullText: pageContexts
      .filter((p) => p.relation === "selected_or_same_page")
      .map((p) => ({
        page: p.page,
        fullText: p.fullText,
        ocrText: p.ocrText,
        ocrReliable: p.ocrReliable,
        pageImageUrl: p.pageImageUrl,
        pageImagePath: p.pageImagePath,
        tables: p.tables,
        figures: p.figures,
        layoutBlocks: p.layoutBlocks,
      })),
    fullPdfOutline,
    fullPdfSummary,
    visualContext,
    text2DiagramPlan,
    prerequisites,
    rules: {
      noFakeFallback: true,
      selectedEvidenceIsTruth: true,
      comparisonEvidenceOnlyWhenComparing: true,
      externalEvidenceNeverMainTruth: true,
      pdfExtractedTextIsTruth: true,
      ocrHelperOnly: true,
      pageImageForGeminiVisionAndDiagramLayout: true,
      noRawJsonOnBoard: true,
    },
  };
}

function buildExternalQueries({ selectedNode, resource, prerequisites }) {
  const title = selectedNodeTitle(selectedNode);
  const resTitle = compactResource(resource).title;
  const prereq = safeArray(prerequisites?.required).map((x) => x.concept).join(" ");
  return dedupeBy(
    [
      `${title} explanation`,
      `${title} ${resTitle}`,
      `${title} tutorial source`,
      `${title} ${prereq}`,
    ].map((x) => inlineText(x, 180)).filter(Boolean),
    String
  ).slice(0, 4);
}

function externalSearchEnabled() {
  return envTrue(["LIVE_TUTOR_ENABLE_EXTERNAL_RESOURCES", "GOOGLE_LIVE_TUTOR_EXTERNAL_RESOURCES"], false);
}

async function fetchExternalResources({ selectedNode, resource, prerequisites, enabled, maxItems = 4 }) {
  const queries = buildExternalQueries({ selectedNode, resource, prerequisites });

  if (!enabled) {
    return {
      ok: true,
      externalResources: [],
      externalEvidence: [],
      queries,
      metadata: {
        enabled: false,
        externalOnly: true,
        fallbackUsed: false,
      },
      rule: "External resources disabled. PDF selectedEvidence remains truth.",
    };
  }

  return {
    ok: true,
    externalResources: [],
    externalEvidence: [],
    queries,
    metadata: {
      enabled: true,
      externalOnly: true,
      fallbackUsed: false,
      note: "External fetch adapter not configured in Phase 1; keeping source-grounded PDF truth.",
    },
    rule: "External resources are supplementary only and never main truth.",
  };
}

function contextBudgets(body = {}) {
  return {
    maxContextChunks: boundedInt(body.maxContextChunks, envNumber(["LIVE_TUTOR_MAX_CONTEXT_CHUNKS"], 1400), 100, 2500),
    maxSelectedEvidence: boundedInt(body.maxSelectedEvidence, 12, 1, 40),
    maxSamePageEvidence: boundedInt(body.maxSamePageEvidence, 20, 0, 80),
    maxNearbyEvidence: boundedInt(body.maxNearbyEvidence, 20, 0, 80),
    maxRelatedEvidence: boundedInt(body.maxRelatedEvidence, 28, 0, 100),
    maxComparisonEvidence: boundedInt(body.maxComparisonEvidence, 12, 0, 80),
    maxTeachingChunks: boundedInt(body.maxTeachingChunks, 80, 12, 180),
    maxPages: boundedInt(body.maxPages, 18, 3, 60),
    maxTextPerPage: boundedInt(body.maxTextPerPage, 38000, 6000, 80000),
    maxOutlineItems: boundedInt(body.maxOutlineItems, 90, 20, 220),
    maxFullPdfSummaryChars: boundedInt(body.maxFullPdfSummaryChars, 32000, 6000, 80000),
    maxExternalResources: boundedInt(body.maxExternalResources, 4, 0, 12),
  };
}

async function timedContextJob(name, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    return { name, ok: true, value, ms: Date.now() - started };
  } catch (error) {
    return { name, ok: false, value: null, error: error?.message || String(error), ms: Date.now() - started };
  }
}

function ownerKeyFromRequest({ body, resource }) {
  return (
    cleanText(body?.ownerKey, 260) ||
    cleanText(body?.offlineUserId, 260) ||
    cleanText(body?.deviceId, 260) ||
    cleanText(resource?.ownerKey, 260) ||
    cleanText(resource?.offlineUserId, 260) ||
    cleanText(resource?.deviceId, 260)
  );
}

async function buildSelectedNodeSourceContext({
  resource,
  selectedNode,
  body = {},
  question = "",
  existingChunks = null,
}) {
  const totalStartedAt = Date.now();
  const budgets = contextBudgets(body);
  const compact = compactResource(resource);

  const resourceId = cleanText(body.resourceId || compact.resourceId || resource?._id || resource?.id, 260);
  const ownerKey = ownerKeyFromRequest({ body, resource });

  if (!resourceId) {
    throw new Error("sourceContextBuilder: resourceId is required.");
  }

  let allChunks = safeArray(existingChunks).length
    ? safeArray(existingChunks)
    : await loadAllChunks({ ownerKey, resourceId, limit: budgets.maxContextChunks });

  allChunks = safeArray(allChunks).map((chunk) => {
    const c = safeObject(chunk);
    if (!c.resourceId) c.resourceId = resourceId;
    return c;
  });

  if (!allChunks.length) {
    throw new Error(`sourceContextBuilder: no chunks found for resourceId=${resourceId}. Refusing fake context.`);
  }

  let sourceRefs = sourceRefsFromNode(selectedNode);
  const pageMap = buildPageMap(allChunks);

  let selectedEvidence = pickExactChunks(allChunks, sourceRefs, selectedNode, question, budgets.maxSelectedEvidence);

  if (!selectedEvidence.length) {
    const richPages = getRichSourcePackPages(selectedNode);
    if (richPages.length) {
      selectedEvidence = safeArray(allChunks)
        .map((c) => compactChunk(c))
        .filter((c) => richPages.includes(Number(c.page)))
        .slice(0, budgets.maxSelectedEvidence)
        .map((c, i) => attachEvidenceRole(c, "selectedEvidence", 800 - i));
    }
  }

  if (!selectedEvidence.length) {
    const scored = safeArray(allChunks)
      .map((chunk) => ({
        raw: chunk,
        score: scoreChunkForNode(chunk, selectedNode, sourceRefs, question),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(4, budgets.maxSelectedEvidence));

    selectedEvidence = scored.map((x) => attachEvidenceRole(x.raw, "selectedEvidence", x.score));
  }

  if (!selectedEvidence.length) {
    throw new Error("sourceContextBuilder: selectedEvidence could not be built. Refusing fake board context.");
  }

  if (!sourceRefs.length) {
    sourceRefs = selectedEvidence.map((chunk) => sourceRefFromChunk(chunk, 0.9));
  }

  const samePageEvidence = pickSamePageChunks(allChunks, selectedEvidence, budgets.maxSamePageEvidence);
  const nearbyEvidence = pickNearbyChunks(allChunks, selectedEvidence, budgets.maxNearbyEvidence);
  const comparisonEvidence = pickComparisonChunks(allChunks, selectedNode, sourceRefs, question, budgets.maxComparisonEvidence);

  const usedChunkIds = new Set(
    [...selectedEvidence, ...samePageEvidence, ...nearbyEvidence, ...comparisonEvidence].map((c) => c.chunkId)
  );

  const relatedEvidence = pickRelatedChunks(
    allChunks,
    selectedNode,
    sourceRefs,
    question,
    usedChunkIds,
    budgets.maxRelatedEvidence
  );

  const teachingChunks = mergeTeachingChunks({
    selectedEvidence,
    samePageEvidence,
    nearbyEvidence,
    relatedEvidence,
    comparisonEvidence,
    maxItems: budgets.maxTeachingChunks,
  });

  const pageContexts = buildPageContexts({
    pageMap,
    selectedEvidence,
    samePageEvidence,
    nearbyEvidence,
    relatedEvidence,
    comparisonEvidence,
    maxPages: budgets.maxPages,
    maxTextPerPage: budgets.maxTextPerPage,
  });

  const [outlineJob, summaryJob, visualJob, prerequisitesJob] = await Promise.all([
    timedContextJob("fullPdfOutline", async () => buildPdfOutlineFromChunks(allChunks, resource, budgets.maxOutlineItems)),
    timedContextJob("fullPdfSummary", async () => buildFullPdfSummary(allChunks, resource, budgets.maxFullPdfSummaryChars)),
    timedContextJob("visualContext", async () =>
      buildVisualContext({
        resource,
        selectedEvidence,
        samePageEvidence,
        nearbyEvidence,
        relatedEvidence,
        comparisonEvidence,
        pageContexts,
        sourceRefs,
      })
    ),
    timedContextJob("prerequisites", async () =>
      detectPrerequisites({ selectedNode, chunks: teachingChunks, fullPdfSummary: null })
    ),
  ]);

  const fullPdfOutline = outlineJob.value || buildPdfOutlineFromChunks(allChunks, resource, budgets.maxOutlineItems);
  const fullPdfSummary = summaryJob.value || buildFullPdfSummary(allChunks, resource, budgets.maxFullPdfSummaryChars);
  const visualContext =
    visualJob.value ||
    buildVisualContext({
      resource,
      selectedEvidence,
      samePageEvidence,
      nearbyEvidence,
      relatedEvidence,
      comparisonEvidence,
      pageContexts,
      sourceRefs,
    });

  let prerequisites = prerequisitesJob.value || detectPrerequisites({ selectedNode, chunks: teachingChunks, fullPdfSummary });
  if (!safeArray(prerequisites.required).length) {
    prerequisites = detectPrerequisites({ selectedNode, chunks: teachingChunks, fullPdfSummary });
  }

  const text2DiagramPlan = buildText2DiagramPlan({
    selectedNode,
    sourceRefs,
    exactChunks: selectedEvidence,
    samePageChunks: samePageEvidence,
    relatedChunks: relatedEvidence,
    visualContext,
    prerequisites,
  });

  const externalJob = await timedContextJob("externalResources", async () =>
    fetchExternalResources({
      selectedNode,
      resource,
      prerequisites,
      enabled: body.enableExternalResources !== undefined ? Boolean(body.enableExternalResources) : externalSearchEnabled(),
      maxItems: budgets.maxExternalResources,
    })
  );

  const externalResources =
    externalJob.value || {
      ok: true,
      externalResources: [],
      externalEvidence: [],
      queries: [],
      metadata: {
        enabled: false,
        error: externalJob.error,
        fallbackUsed: false,
        externalOnly: true,
      },
      rule: "External resources unavailable; PDF source evidence remains truth.",
    };

  const teacherPromptPack = buildTeacherPromptPack({
    selectedNode,
    sourceRefs,
    selectedEvidence,
    samePageEvidence,
    nearbyEvidence,
    relatedEvidence,
    comparisonEvidence,
    pageContexts,
    fullPdfOutline,
    fullPdfSummary,
    visualContext,
    text2DiagramPlan,
    prerequisites,
    externalResources,
  });

  const visualRules = {
    pdfExtractedTextIsTruth: true,
    selectedEvidenceIsMainTruth: true,
    samePageEvidenceSupportsSelectedNode: true,
    nearbyEvidenceSupportsOnly: true,
    relatedEvidenceBackgroundOnly: true,
    comparisonEvidenceOnlyForComparison: true,
    externalEvidenceSupplementaryOnly: true,
    pageImageIsVisualGuideOnly: true,
    imageTextIsTruth: false,
    ocrIsHelperOnly: true,
    ignoreGarbledOcrText: true,
    useImageForLayoutAndDiagramShapeOnly: true,
    geminiVisionCanInspectSelectedPageImages: safeArray(visualContext.pageImages).length > 0,
    redrawCleanDiagramsFromSourceTextAndVisualLayout: true,
    noRawJsonOnBoard: true,
  };

  const selectedPageFullText = pageContexts
    .filter((p) => p.relation === "selected_or_same_page")
    .map((p) => ({
      page: p.page,
      pageTitle: p.pageTitle,
      fullText: p.fullText,
      ocrText: p.ocrText,
      ocrReliable: p.ocrReliable,
      ocrGarbled: p.ocrGarbled,
      pdfExtractedTextIsTruth: true,
      ocrIsHelperOnly: true,
      imageTextIsTruth: false,
      pageImageUse: "visual_preview_layout_diagram_shape_only",
      tables: p.tables,
      figures: p.figures,
      layoutBlocks: p.layoutBlocks,
      pageImageUrl: p.pageImageUrl,
      pageImagePath: p.pageImagePath,
      sourceRefs: p.sourceRefs,
    }))
    .slice(0, 10);

  return {
    ok: true,
    fullPdfKnown: true,
    deliveryMode: "phase1-selected-node-accurate-context-v12-fixed",
    rule:
      "Selected evidence is the primary truth. Same/nearby pages support it. Related evidence is background. Comparison evidence is comparison only. External evidence is supplementary only. PDF extracted text is truth; OCR/page image is helper/visual guide.",
    resource: compactResource(resource),
    selectedNodeSnapshot: safeObject(selectedNode),
    selectedNodeTitle: selectedNodeTitle(selectedNode),
    sourceRefs,
    chunks: teachingChunks,
    exactChunks: selectedEvidence,
    selectedEvidence,
    samePageChunks: samePageEvidence,
    samePageEvidence,
    nearbyChunks: nearbyEvidence,
    nearbyEvidence,
    relatedChunks: relatedEvidence,
    relatedEvidence,
    comparisonEvidence,
    externalEvidence: safeArray(externalResources.externalEvidence),
    neighborChunks: dedupeBy([...samePageEvidence, ...nearbyEvidence, ...relatedEvidence], (chunk) => chunk.chunkId || `${chunk.page}:${chunk.chunkIndex}`),
    pageContexts,
    selectedPageFullText,
    fullPdfSummary,
    pdfSummary: fullPdfSummary,
    fullPdfOutline,
    pdfOutline: fullPdfOutline,
    outline: fullPdfOutline,
    fullPdfOutlineText: fullPdfOutline.outlineText,
    visualContext,
    pageImages: visualContext.pageImages,
    ocrBlocks: visualContext.ocrBlocks,
    layoutBlocks: visualContext.layoutBlocks,
    layoutTables: visualContext.tables,
    tables: visualContext.tables,
    figures: visualContext.figures,
    entities: visualContext.entities,
    visualRules,
    prerequisites,
    prerequisiteConcepts: safeArray(prerequisites.required),
    text2DiagramPlan,
    diagramIntent: text2DiagramPlan.diagramIntent,
    requestedVisuals: text2DiagramPlan.requestedVisuals,
    externalResources,
    externalResourcePack: externalResources,
    teacherPromptPack,
    googleTtsTeacherVoicePlan: {
      ok: true,
      engine: "google-tts-ready-script",
      voiceStyle: "human teacher explaining exact selected source evidence on board",
      requirements: [
        "explain selected source quote slowly",
        "point to source-backed blocks",
        "keep comparison separate",
        "use page image as visual guide if present",
        "sync with boardCommands/subtitles",
      ],
    },
    allChunkCount: allChunks.length,
    metadata: {
      service: "sourceContextBuilder.service.js",
      contextBuilderVersion: "phase1-selected-node-accurate-context-v12-fixed",
      fullPdfKnown: true,
      allChunkCount: allChunks.length,
      sourceRefCount: sourceRefs.length,
      exactChunkCount: selectedEvidence.length,
      selectedEvidenceCount: selectedEvidence.length,
      samePageChunkCount: samePageEvidence.length,
      samePageEvidenceCount: samePageEvidence.length,
      nearbyChunkCount: nearbyEvidence.length,
      nearbyEvidenceCount: nearbyEvidence.length,
      relatedChunkCount: relatedEvidence.length,
      relatedEvidenceCount: relatedEvidence.length,
      comparisonEvidenceCount: comparisonEvidence.length,
      teachingChunkCount: teachingChunks.length,
      pageContextCount: pageContexts.length,
      selectedFullPageCount: selectedPageFullText.length,
      outlineItemCount: safeArray(fullPdfOutline.outline).length,
      fullPdfSummaryChars: cleanText(fullPdfSummary.summary, 999999).length,
      prerequisiteCount: safeArray(prerequisites.required).length,
      ocrIncluded: Boolean(visualContext.metadata.ocrIncluded),
      pageImagesIncluded: Boolean(visualContext.metadata.pageImagesIncluded),
      layoutIncluded: Boolean(visualContext.metadata.layoutIncluded),
      tablesIncluded: Boolean(visualContext.metadata.tablesIncluded),
      figuresIncluded: Boolean(visualContext.metadata.figuresIncluded),
      pageImageCount: Number(visualContext.metadata.pageImageCount || 0),
      ocrBlockCount: Number(visualContext.metadata.ocrBlockCount || 0),
      reliableOcrBlockCount: Number(visualContext.metadata.reliableOcrBlockCount || 0),
      unreliableOcrBlockCount: Number(visualContext.metadata.unreliableOcrBlockCount || 0),
      garbledOcrDetected: Boolean(visualContext.metadata.garbledOcrDetected),
      pdfExtractedTextIsTruth: true,
      ocrIsHelperOnly: true,
      imageTextIsTruth: false,
      pageImageUse: "visual_preview_layout_diagram_shape_only",
      geminiVisionPageImagesAvailable: Boolean(safeArray(visualContext.pageImages).length),
      tableCount: Number(visualContext.metadata.tableCount || 0),
      figureCount: Number(visualContext.metadata.figureCount || 0),
      externalResourcesEnabled: Boolean(externalResources.metadata.enabled),
      externalResourceCount: safeArray(externalResources.externalResources).length,
      externalEvidenceSeparated: true,
      selectedEvidenceSeparated: true,
      samePageEvidenceSeparated: true,
      nearbyEvidenceSeparated: true,
      relatedEvidenceSeparated: true,
      comparisonEvidenceSeparated: true,
      comparisonOnlyPages: dedupeBy(comparisonEvidence.map((c) => c.page), (x) => String(x)),
      selectedPages: dedupeBy(selectedEvidence.map((c) => c.page), (x) => String(x)),
      text2DiagramPlanUsed: true,
      text2DiagramPrimary: text2DiagramPlan.diagramIntent.primary,
      text2DiagramRequested: text2DiagramPlan.requestedVisuals,
      contextBudgets: budgets,
      contextTimingMs: {
        total: Date.now() - totalStartedAt,
        fullPdfOutline: outlineJob.ms,
        fullPdfSummary: summaryJob.ms,
        visualContext: visualJob.ms,
        prerequisites: prerequisitesJob.ms,
        externalResources: externalJob.ms,
      },
      contextJobErrors: [outlineJob, summaryJob, visualJob, prerequisitesJob, externalJob]
        .filter((job) => !job.ok)
        .map((job) => ({ name: job.name, error: job.error })),
      parallelContextBuilt: true,
      visualRules,
      fallbackUsed: false,
      usedSmartFallback: false,
      generatedAt: new Date().toISOString(),
    },
  };
}


/**
 * Compatibility wrapper:
 * v17 real builder = buildSelectedNodeSourceContext()
 * tests/controllers expected = buildSourceContext()
 */
async function buildSourceContext(input = {}) {
  const body = safeObject(input.body || input || {});
  const context = safeObject(input.context);

  const ownerKey = cleanText(
    input.ownerKey ||
      body.ownerKey ||
      context.ownerKey ||
      context.offlineUserId ||
      body.offlineUserId ||
      "demo_user",
    260
  );

  const resourceId = cleanText(
    input.resourceId ||
      body.resourceId ||
      input.resource?.resourceId ||
      input.resource?.id ||
      "",
    260
  );

  const selectedNode = safeObject(input.selectedNode || body.selectedNode || body.node);

  const resource = {
    ...safeObject(input.resource),
    resourceId,
    ownerKey,
  };

  const result = await buildSelectedNodeSourceContext({
    resource,
    selectedNode,
    body: {
      ...body,
      ownerKey,
      resourceId,
    },
    context: {
      ...context,
      ownerKey,
      resourceId,
    },
    question: cleanText(input.question || body.question || "", 2000),
    existingChunks: input.existingChunks || null,
  });

  const richSourcePack = safeObject(
    safeObject(selectedNode.metadata).richSourcePack ||
      safeObject(selectedNode.data).richSourcePack ||
      selectedNode.richSourcePack
  );

  const richPageImages = safeArray(
    richSourcePack.pageImages ||
      richSourcePack.images ||
      richSourcePack.pdfPageImages
  );

  const pageImages = safeArray(
    result.pageImages ||
      result.visualContext?.pageImages ||
      result.contextForGemini?.pageImages
  );

  const pageContexts = safeArray(result.pageContexts);
  const selectedEvidence = safeArray(result.selectedEvidence);

  const selectedPageFullTextIncluded = Boolean(
    result.selectedPageFullText ||
      pageContexts.some((pctx) => cleanText(pctx.fullText || pctx.text || "", 100).length) ||
      selectedEvidence.some((ev) => cleanText(ev.text || "", 100).length)
  );

  const fullPdfSummaryIncluded = Boolean(
    result.fullPdfSummary ||
      result.pdfSummary ||
      result.metadata?.fullPdfSummaryIncluded ||
      result.metadata?.fullPdfSummaryChars > 0
  );

  const fullPdfOutlineIncluded = Boolean(
    result.fullPdfOutline ||
      result.pdfOutline ||
      result.outline ||
      result.metadata?.fullPdfOutlineIncluded ||
      result.metadata?.pdfOutlineIncluded
  );

  const metadata = {
    ...safeObject(result.metadata),

    pageImagesIncluded: pageImages.length > 0,
    richSourcePackPageImageCount: richPageImages.length,
    selectedNodeFullPageImagesAvailable: richPageImages.length > 0,
    geminiVisionPageImagesAvailable: pageImages.length > 0,

    selectedPageFullTextIncluded,
    fullPdfSummaryIncluded,
    fullPdfOutlineIncluded,

    tablesIncluded: Boolean(
      result.metadata?.tablesIncluded ||
        safeArray(result.tables).length ||
        safeArray(result.visualContext?.tables).length
    ),
    figuresIncluded: Boolean(
      result.metadata?.figuresIncluded ||
        safeArray(result.figures).length ||
        safeArray(result.visualContext?.figures).length
    ),
    layoutBlocksIncluded: Boolean(
      result.metadata?.layoutBlocksIncluded ||
        safeArray(result.layoutBlocks).length ||
        safeArray(result.visualContext?.layoutBlocks).length
    ),

    fallbackUsed: false,
    usedSmartFallback: false,

    compatibilityWrapperUsed: true,
    compatibilityWrapper: "buildSourceContext -> buildSelectedNodeSourceContext",
    selectedNodeRichSourcePackRead: Boolean(Object.keys(richSourcePack).length),
    selectedNodePageImagesFromTree: richPageImages.length,
  };

  return {
    ...result,
    selectedNode: result.selectedNode || result.selectedNodeSnapshot || selectedNode,
    selectedNodeId: selectedNode.nodeId || selectedNode.id || result.selectedNodeId || "",
    selectedNodeTitle:
      selectedNode.title ||
      selectedNode.label ||
      result.selectedNodeTitle ||
      selectedNodeId(selectedNode),
    pageImages,
    metadata,
  };
}

async function buildSelectedNodeContext(input = {}) {
  return buildSourceContext(input);
}

async function buildContextForStage2(input = {}) {
  return buildSourceContext(input);
}

async function buildNodeSourceContext(input = {}) {
  return buildSourceContext(input);
}


module.exports = {
  buildSourceContext,
  buildSelectedNodeContext,
  buildContextForStage2,
  buildNodeSourceContext,

  // Keep old v17 API name safely as alias if needed by Stage2.
  buildSelectedNodeSourceContext,
  buildRichSourceContext: buildSelectedNodeSourceContext,

  _internals: {
    safeString,
    safeObject,
    safeArray,
    cleanText,
    inlineText,
    envTrue,
    envNumber,
    boundedInt,
    dedupeBy,

    buildSourceContext,
    buildSelectedNodeContext,
    buildContextForStage2,
    buildNodeSourceContext,
    buildSelectedNodeSourceContext,
  },
};

