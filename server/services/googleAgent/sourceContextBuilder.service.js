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


// chunkToEvidence — converts a raw chunk into a structured evidence object.
// Called by selectExactChunks, selectSamePageChunks, selectNearbyChunks, selectRelatedChunks.
function chunkToEvidence(chunk, evidenceType, priority) {
  const c = compactChunk(chunk, 6000);
  return {
    chunkId:      c.chunkId,
    sourceRef:    c.sourceRef,
    pageRef:      c.pageRef,
    page:         c.page,
    chunkIndex:   c.chunkIndex,
    resourceId:   c.resourceId,
    heading:      c.heading,
    text:         c.text,
    textPreview:  c.textPreview,
    ocrText:      c.ocrText,
    pageImageUrl: c.pageImageUrl,
    pageImagePath: c.pageImagePath,
    hasPageImage: c.hasPageImage,
    tables:       c.tables,
    figures:      c.figures,
    evidenceType: evidenceType || "evidence",
    priority:     typeof priority === "number" ? priority : 50,
    confidence:   0.85,
    metadata:     c.metadata,
  };
}

async function readChunksFromCollection({ collectionName, ownerKey, resourceId, limit }) {
  const collection = GoogleLiveTutorResourceChunk.collection?.conn?.db?.collection(collectionName);
  if (!collection) return [];

  return collection
    .find({ ownerKey, resourceId })
    .sort({ page: 1, chunkIndex: 1, createdAt: 1 })
    .limit(limit)
    .toArray();
}

function normalizeChunkDoc(doc, index = 0) {
  const raw = safeObject(doc);
  const m = safeObject(raw.metadata);

  const page = Math.max(1, Number(raw.page || raw.pageNumber || m.page || 1));
  const chunkIndex = Math.max(0, Number(raw.chunkIndex || raw.index || m.chunkIndex || index));
  const resourceId = cleanText(raw.resourceId || m.resourceId || "", 260);
  const chunkId = cleanText(
    raw.chunkId || raw.id || raw._id || m.chunkId || `${resourceId || "resource"}_p${page}_c${chunkIndex}`,
    260
  );

  const text = cleanText(
    raw.text || raw.fullText || raw.content || raw.textPreview || m.text || m.content || "",
    120000
  );

  return {
    ...raw,
    resourceId,
    chunkId,
    id: chunkId,
    page,
    pageNumber: page,
    chunkIndex,
    sourceRef: cleanText(raw.sourceRef || m.sourceRef || `resource:${resourceId}:page:${page}:chunk:${chunkIndex}`, 420),
    pageRef: cleanText(raw.pageRef || m.pageRef || `resource:${resourceId}:page:${page}`, 420),
    text,
    textPreview: cleanText(raw.textPreview || text, 4000),
    metadata: m,
  };
}

async function loadResourceChunks({ ownerKey, resourceId, limit = 1600 }) {
  const safeOwnerKey = cleanText(ownerKey, 260);
  const safeResourceId = cleanText(resourceId, 260);
  const safeLimit = boundedInt(limit, 1600, 10, 5000);

  if (!safeOwnerKey) {
    const error = new Error("ownerKey is required to load resource chunks.");
    error.statusCode = 400;
    throw error;
  }

  if (!safeResourceId) {
    const error = new Error("resourceId is required to load resource chunks.");
    error.statusCode = 400;
    throw error;
  }

  const chunks = [];
  const warnings = [];

  try {
    chunks.push(
      ...(await GoogleLiveTutorResourceChunk.find({
        ownerKey: safeOwnerKey,
        resourceId: safeResourceId,
      })
        .sort({ page: 1, chunkIndex: 1, createdAt: 1 })
        .limit(safeLimit)
        .lean())
    );
  } catch (error) {
    warnings.push(`resource_chunks model read failed: ${error.message}`);
  }

  for (const collectionName of ["googlelivetutorresourcechunks", "resource_chunks"]) {
    if (chunks.length >= safeLimit) break;

    try {
      const extra = await readChunksFromCollection({
        collectionName,
        ownerKey: safeOwnerKey,
        resourceId: safeResourceId,
        limit: safeLimit,
      });

      chunks.push(...extra);
    } catch (error) {
      warnings.push(`${collectionName} read failed: ${error.message}`);
    }
  }

  const normalized = dedupeBy(
    chunks
      .map(normalizeChunkDoc)
      .filter((chunk) => cleanText(chunk.text || chunk.textPreview, 100).length > 0),
    (chunk) => `${chunk.chunkId}|${chunk.sourceRef}|${chunk.page}|${chunk.chunkIndex}`
  )
    .sort(
      (a, b) =>
        Number(a.page || 0) - Number(b.page || 0) ||
        Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0)
    )
    .slice(0, safeLimit);

  if (!normalized.length) {
    const error = new Error(
      `No resource chunks found for resourceId=${safeResourceId}, ownerKey=${safeOwnerKey}. Checked resource_chunks and googlelivetutorresourcechunks.`
    );
    error.statusCode = 404;
    error.metadata = {
      fallbackUsed: false,
      usedSmartFallback: false,
      ownerKey: safeOwnerKey,
      resourceId: safeResourceId,
      checkedCollections: ["resource_chunks", "googlelivetutorresourcechunks"],
      warnings,
    };
    throw error;
  }

  Object.defineProperty(normalized, "_loadResourceChunksTrace", {
    value: {
      ok: true,
      count: normalized.length,
      checkedCollections: ["resource_chunks", "googlelivetutorresourcechunks"],
      warnings,
    },
    enumerable: false,
  });

  return normalized;
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

function getRichSourcePack(selectedNode) {
  const n = safeObject(selectedNode);
  const data = safeObject(n.data);
  return safeObject(safeObject(n.metadata).richSourcePack || data.richSourcePack || n.richSourcePack);
}

function getRichSourcePackPageImages(selectedNode) {
  const rich = getRichSourcePack(selectedNode);
  const pages = new Set(safeArray(rich.pages).map((p) => Number(p)).filter(Boolean));

  return dedupeBy(
    safeArray(rich.pageImages || rich.images || rich.pdfPageImages)
      .map((raw) => {
        const item = safeObject(raw);
        const page = Number(item.page || item.pageNumber || item.pageNo || 0) || 0;
        if (page) pages.add(page);
        const url = cleanText(item.url || item.src || item.pageImageUrl || item.publicUrl || item.imageUrl || "", 1800);
        const path = cleanText(item.path || item.pageImagePath || item.filePath || item.localPath || "", 1800);
        return {
          page,
          pageImageUrl: url,
          pageImagePath: path,
          url,
          src: url,
          path,
          type: cleanText(item.type || "pdfPageImage", 120),
          evidenceRole: "selectedNodeRichSourcePackImage",
          source: "selectedNode.metadata.richSourcePack.pageImages",
          useRule: "Selected node full-page PDF image. Send to Gemini Vision for diagram/layout/figure shape; source text/OCR/chunks remain truth.",
        };
      })
      .filter((x) => x.page && (x.pageImageUrl || x.pageImagePath)),
    (x) => `${x.page}|${x.pageImageUrl}|${x.pageImagePath}`
  );
}

function imageMapByPage(pageImages) {
  const map = new Map();
  for (const image of safeArray(pageImages)) {
    const item = safeObject(image);
    const page = Number(item.page || 0);
    if (!page) continue;
    const existing = map.get(page) || {};
    map.set(page, {
      ...existing,
      ...item,
      pageImageUrl: cleanText(existing.pageImageUrl || existing.url || item.pageImageUrl || item.url || item.src || "", 1800),
      pageImagePath: cleanText(existing.pageImagePath || existing.path || item.pageImagePath || item.path || "", 1800),
    });
  }
  return map;
}

function hydrateEvidenceImagesFromRichSourcePack(evidence, richPageImages) {
  const byPage = imageMapByPage(richPageImages);
  return safeArray(evidence).map((raw) => {
    const c = safeObject(raw);
    const page = Number(c.page || 0);
    const image = byPage.get(page);
    if (!image) return c;
    return {
      ...c,
      pageImageUrl: c.pageImageUrl || image.pageImageUrl || image.url || "",
      pageImagePath: c.pageImagePath || image.pageImagePath || image.path || "",
      hasPageImage: Boolean(c.hasPageImage || c.pageImageUrl || c.pageImagePath || image.pageImageUrl || image.pageImagePath || image.url || image.path),
      fullPageImageFromRichSourcePack: Boolean(image.pageImageUrl || image.pageImagePath || image.url || image.path),
    };
  });
}

function hydratePageContextsWithRichSourcePackImages(pageContexts, richPageImages) {
  const byPage = imageMapByPage(richPageImages);
  return safeArray(pageContexts).map((raw) => {
    const ctx = safeObject(raw);
    const page = Number(ctx.page || 0);
    const image = byPage.get(page);
    if (!image) return ctx;
    const pageImageUrl = ctx.pageImageUrl || image.pageImageUrl || image.url || "";
    const pageImagePath = ctx.pageImagePath || image.pageImagePath || image.path || "";
    return {
      ...ctx,
      pageImageUrl,
      pageImagePath,
      hasPageImage: Boolean(pageImageUrl || pageImagePath),
      fullPageImageFromRichSourcePack: Boolean(image.pageImageUrl || image.pageImagePath || image.url || image.path),
      visualUseRule: ctx.visualUseRule || "Gemini may inspect this selected-node full-page image as diagram/layout guide; PDF extracted text remains truth.",
    };
  });
}

function mergeRichSourcePackImagesIntoVisualContext(visualContext, richPageImages, pageContexts, sourceRefs) {
  const selectedPages = new Set([
    ...safeArray(pageContexts).filter((p) => safeObject(p).relation === "selected_or_same_page").map((p) => Number(safeObject(p).page)).filter(Boolean),
    ...safeArray(sourceRefs).map((r) => Number(safeObject(r).page)).filter(Boolean),
  ]);

  const existingImages = safeArray(safeObject(visualContext).pageImages);
  const richImages = safeArray(richPageImages)
    .filter((image) => !selectedPages.size || selectedPages.has(Number(safeObject(image).page)))
    .map((image) => ({
      ...safeObject(image),
      evidenceRole: "selectedNodeRichSourcePackImage",
      useRule: "Send this selected-node full-page PDF image to Gemini Vision for diagram/layout/figure shape. Recover labels from selectedEvidence/OCR/text chunks.",
    }));

  const pageImages = dedupeBy(
    [...existingImages, ...richImages],
    (x) => `${safeObject(x).page}|${safeObject(x).pageImageUrl || safeObject(x).url || ""}|${safeObject(x).pageImagePath || safeObject(x).path || ""}`
  );

  const meta = safeObject(safeObject(visualContext).metadata);
  return {
    ...safeObject(visualContext),
    pageImages,
    metadata: {
      ...meta,
      pageImageCount: pageImages.length,
      pageImagesIncluded: pageImages.length > 0,
      richSourcePackPageImageCount: richImages.length,
      selectedNodeFullPageImagesAvailable: richImages.length > 0,
      geminiVisionCanInspectSelectedPageImages: pageImages.length > 0,
    },
  };
}

function selectedNodeTitle(selectedNode) {
  const n = safeObject(selectedNode);
  const data = safeObject(n.data);
  return inlineText(n.title || n.label || n.name || data.title || data.label || n.nodeId || n.id || "selected concept", 360);
}

function selectedNodeId(selectedNode) {
  const n = safeObject(selectedNode);
  const data = safeObject(n.data);
  return cleanText(n.nodeId || n.id || data.nodeId || data.id || selectedNodeTitle(n), 260);
}

function selectedNodeDefinition(selectedNode) {
  const n = safeObject(selectedNode);
  const data = safeObject(n.data);
  const metadata = safeObject(n.metadata);

  return cleanText(
    n.shortDefinition ||
      n.definition ||
      n.summary ||
      n.description ||
      data.shortDefinition ||
      data.definition ||
      data.summary ||
      data.description ||
      metadata.shortDefinition ||
      metadata.summary ||
      "",
    5000
  );
}

function nodeSearchText(selectedNode) {
  const n = safeObject(selectedNode);
  const rich = getRichSourcePack(n);

  return cleanText(
    [
      selectedNodeTitle(n),
      selectedNodeDefinition(n),
      n.nodeType || n.type || "",
      safeArray(n.tags).join(" "),
      safeArray(n.visualHints).join(" "),
      safeArray(rich.pages).join(" "),
      rich.fullPageTextPreview || "",
      rich.ocrTextPreview || "",
      rich.tablesPreview || "",
      rich.figuresPreview || "",
    ].join("\n"),
    30000
  );
}

function getAllNodeRefsAndPages(selectedNode) {
  const refsFromNode = sourceRefsFromNode(selectedNode);
  const rich = getRichSourcePack(selectedNode);
  const richPages = safeArray(rich.pages || rich.pageRefs).map((p) => Number(p)).filter(Boolean);
  const pageRefs = safeArray(
    selectedNode.pageRefs ||
      selectedNode.pages ||
      selectedNode.data?.pageRefs ||
      selectedNode.metadata?.pageRefs ||
      []
  )
    .map((p) => Number(p))
    .filter(Boolean);

  const pages = dedupeBy(
    [
      ...refsFromNode.map((ref) => Number(ref.page)).filter(Boolean),
      ...richPages,
      ...pageRefs,
    ],
    String
  ).sort((a, b) => a - b);

  const refs = normalizeSourceRefs([
    ...refsFromNode,
    ...pages.map((page) => ({
      page,
      pageRef: `selectedNode:page:${page}`,
      sourceRef: `selectedNode:page:${page}`,
      quote: "",
      confidence: 0.7,
    })),
  ]);

  return { refs, pages };
}

function matchChunkBySourceRef(chunk, refs) {
  const c = compactChunk(chunk, 12000);

  return safeArray(refs).some((ref) => {
    const r = safeObject(ref);
    return Boolean(
      (r.chunkId && c.chunkId && r.chunkId === c.chunkId) ||
        (r.sourceRef && c.sourceRef && r.sourceRef === c.sourceRef) ||
        (r.pageRef && c.pageRef && r.pageRef === c.pageRef && Number(r.page) === Number(c.page))
    );
  });
}

function tokenize(text) {
  const stop = new Set(
    "the and for with that this from into about page source chunk concept student teacher board what when then your you are was were can will have has had not but or of to in on a an is it as by be if so we they their them our us pdf slide lecture chapter".split(
      " "
    )
  );

  const words = inlineText(text, 80000).toLowerCase().match(/[a-z0-9_/-]{3,}/g) || [];
  return words.filter((w) => !stop.has(w));
}

function scoreChunkForSelectedNode(chunk, selectedNode, selectedRefs = [], selectedPages = []) {
  const c = compactChunk(chunk, 18000);
  const target = nodeSearchText(selectedNode).toLowerCase();
  const source = cleanText(
    [
      c.title,
      c.heading,
      c.text,
      c.ocrText,
      c.tables.join("\n"),
      c.figures.join("\n"),
    ].join("\n"),
    50000
  ).toLowerCase();

  let score = 0;

  if (matchChunkBySourceRef(c, selectedRefs)) score += 120;
  if (selectedPages.includes(Number(c.page))) score += 55;

  const words = tokenize(target);
  const seen = new Set();

  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    if (source.includes(word)) score += word.length > 7 ? 5 : 2;
  }

  if (c.hasPageImage) score += 8;
  if (c.hasDiagramCandidate) score += 7;
  if (c.hasFigures) score += 5;
  if (c.hasTables) score += 4;
  if (c.hasLayoutBlocks) score += 3;

  return score;
}

function groupChunksByPage(chunks) {
  const map = new Map();

  for (const raw of safeArray(chunks)) {
    const c = compactChunk(raw);
    if (!map.has(c.page)) map.set(c.page, []);
    map.get(c.page).push(raw);
  }

  for (const [page, items] of map.entries()) {
    map.set(
      page,
      items.sort((a, b) => Number(a.chunkIndex || a.metadata?.chunkIndex || 0) - Number(b.chunkIndex || b.metadata?.chunkIndex || 0))
    );
  }

  return map;
}

function buildPageContextFromChunks({ page, chunks, relation, richPageImages = [] }) {
  const compacted = safeArray(chunks).map((chunk) => compactChunk(chunk, 36000));
  const imageFromChunk = compacted.find((chunk) => chunk.pageImageUrl || chunk.pageImagePath);
  const richImage = safeArray(richPageImages).find((img) => Number(safeObject(img).page) === Number(page));

  const pageImageUrl =
    cleanText(imageFromChunk?.pageImageUrl || richImage?.pageImageUrl || richImage?.url || "", 1800);

  const pageImagePath =
    cleanText(imageFromChunk?.pageImagePath || richImage?.pageImagePath || richImage?.path || "", 1800);

  const fullText = cleanText(compacted.map((chunk) => chunk.text).filter(Boolean).join("\n\n"), 80000);
  const ocrText = cleanText(compacted.map((chunk) => chunk.ocrText).filter(Boolean).join("\n\n"), 50000);

  const tables = dedupeBy(
    compacted.flatMap((chunk) => chunk.tables).filter(Boolean),
    (x) => inlineText(x, 220).toLowerCase()
  ).slice(0, 80);

  const figures = dedupeBy(
    compacted.flatMap((chunk) => chunk.figures).filter(Boolean),
    (x) => inlineText(x, 220).toLowerCase()
  ).slice(0, 80);

  const layoutBlocks = compacted.flatMap((chunk) => chunk.layoutBlocks).slice(0, 300);

  return {
    page,
    relation,
    fullText,
    text: fullText,
    selectedPageFullText: relation === "selected_or_same_page" ? fullText : "",
    ocrText,
    ocrReliable: textReliability(ocrText).ocrReliable,
    ocrGarbled: textReliability(ocrText).ocrGarbled,
    tables,
    figures,
    layoutBlocks,
    chunkIds: compacted.map((chunk) => chunk.chunkId).filter(Boolean),
    sourceRefs: dedupeBy(compacted.map((chunk) => sourceRefFromChunk(chunk)), (ref) => `${ref.chunkId}|${ref.page}`),
    pageImageUrl,
    pageImagePath,
    hasPageImage: Boolean(pageImageUrl || pageImagePath),
    fullPageImageAvailableForGeminiVision: Boolean(pageImageUrl || pageImagePath),
    hasTables: tables.length > 0,
    hasFigures: figures.length > 0,
    hasLayoutBlocks: layoutBlocks.length > 0,
    hasDiagramCandidate:
      figures.length > 0 ||
      tables.length > 0 ||
      layoutBlocks.some((block) =>
        /diagram|figure|visual|chart|schema|workflow|graph|table|image/i.test(
          `${safeString(block.type)} ${safeString(block.text)} ${safeString(block.caption)} ${safeString(block.title)}`
        )
      ),
    pdfExtractedTextIsTruth: true,
    ocrIsHelperOnly: true,
    imageTextIsTruth: false,
    visualUseRule:
      "Full page image can be sent to Gemini Vision for diagram/layout/figure shape. Text labels should be verified from PDF text/OCR/chunks.",
  };
}

function evidenceToSourceTextBlock(evidence, maxItems = 12, maxChars = 36000) {
  const blocks = safeArray(evidence)
    .slice(0, maxItems)
    .map((item) => {
      const e = safeObject(item);
      return cleanText(
        [
          `[${e.evidenceRole || "evidence"} page=${e.page} chunk=${e.chunkId}]`,
          e.heading ? `Heading: ${e.heading}` : "",
          e.text ? cleanText(e.text, 4000) : "",
          e.ocrText ? `OCR: ${cleanText(e.ocrText, 1500)}` : "",
          e.tables?.length ? `Tables: ${safeArray(e.tables).slice(0, 4).join("\n")}` : "",
          e.figures?.length ? `Figures: ${safeArray(e.figures).slice(0, 4).join("\n")}` : "",
          e.pageImageUrl || e.pageImagePath ? `Full page image: ${e.pageImageUrl || e.pageImagePath}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        9000
      );
    });

  return cleanText(blocks.join("\n\n---\n\n"), maxChars);
}

function compactFullPdfSummary(resource, selectedNode) {
  const r = compactResource(resource);
  const meta = safeObject(r.metadata);
  const treeMeta = safeObject(selectedNode?.treeMetadata || selectedNode?.metadata?.treeMetadata);

  const summaryObj =
    safeObject(meta.fullPdfSummary) ||
    safeObject(meta.summaryForTree) ||
    safeObject(treeMeta.fullPdfSummary) ||
    safeObject(selectedNode?.metadata?.fullPdfSummary);

  const summaryText =
    summaryObj.fullPdfSummary ||
    summaryObj.summary ||
    r.summary ||
    meta.fullPdfSummaryText ||
    meta.documentSummary ||
    "";

  return {
    fullPdfSummary: cleanText(summaryText, 18000),
    mainTopic: cleanText(summaryObj.mainTopic || meta.mainTopic || r.title, 260),
    learningGoal: cleanText(summaryObj.learningGoal || meta.learningGoal || "", 1200),
    majorThemes: safeArray(summaryObj.majorThemes || meta.majorThemes).map((x) => cleanText(x, 200)).filter(Boolean).slice(0, 20),
    keyConcepts: safeArray(summaryObj.keyConcepts || meta.keyConcepts).slice(0, 80),
    diagramPages: safeArray(summaryObj.diagramPages || meta.diagramPages).slice(0, 80),
  };
}

function compactFullPdfOutline(resource, selectedNode) {
  const r = compactResource(resource);
  const meta = safeObject(r.metadata);
  const treeMeta = safeObject(selectedNode?.treeMetadata || selectedNode?.metadata?.treeMetadata);

  const outlineObj =
    safeObject(meta.fullPdfOutline) ||
    safeObject(meta.pdfOutline) ||
    safeObject(meta.documentOutline) ||
    safeObject(treeMeta.fullPdfOutline) ||
    safeObject(selectedNode?.metadata?.fullPdfOutline);

  const modules = safeArray(outlineObj.modules || meta.roadmapModules || meta.modules);

  return {
    title: cleanText(outlineObj.title || meta.outlineTitle || r.title, 260),
    modules: modules
      .map((raw, index) => {
        const m = safeObject(raw);
        return {
          moduleId: cleanText(m.moduleId || m.id || `module_${index + 1}`, 160),
          title: cleanText(m.title || `Module ${index + 1}`, 240),
          summary: cleanText(m.summary || m.description || "", 1200),
          pages: safeArray(m.pages).map((p) => Number(p)).filter(Boolean),
          pageStart: Number(m.pageStart || safeArray(m.pages)[0] || 0) || undefined,
          pageEnd: Number(m.pageEnd || safeArray(m.pages).slice(-1)[0] || 0) || undefined,
          children: safeArray(m.children || m.items).slice(0, 30),
        };
      })
      .filter((m) => m.title)
      .slice(0, 40),
  };
}

function selectedNodeTreeMetadata(selectedNode, resource) {
  const n = safeObject(selectedNode);
  const meta = safeObject(n.metadata);
  const data = safeObject(n.data);
  const resourceMeta = safeObject(resource?.metadata);

  return {
    fullPdfSummary:
      safeObject(meta.fullPdfSummary) ||
      safeObject(data.fullPdfSummary) ||
      safeObject(resourceMeta.fullPdfSummary) ||
      null,
    fullPdfOutline:
      safeObject(meta.fullPdfOutline) ||
      safeObject(data.fullPdfOutline) ||
      safeObject(resourceMeta.fullPdfOutline) ||
      null,
    roadmapModules:
      safeArray(meta.roadmapModules || data.roadmapModules || resourceMeta.roadmapModules).slice(0, 40),
  };
}

function buildVisualContext({ pageContexts, selectedEvidence, samePageEvidence, nearbyEvidence, richPageImages, selectedNode, resource }) {
  const allEvidence = [
    ...safeArray(selectedEvidence),
    ...safeArray(samePageEvidence),
    ...safeArray(nearbyEvidence),
  ];

  const evidenceImages = safeArray(allEvidence)
    .map((ev) => {
      const e = safeObject(ev);
      if (!e.pageImageUrl && !e.pageImagePath) return null;
      return {
        page: e.page,
        pageImageUrl: e.pageImageUrl,
        pageImagePath: e.pageImagePath,
        url: e.pageImageUrl,
        src: e.pageImageUrl,
        path: e.pageImagePath,
        evidenceRole: e.evidenceRole || "evidencePageImage",
        sourceRefs: e.sourceRefs || [],
        fullPageImageAvailableForGeminiVision: true,
        imageTextIsTruth: false,
        pdfExtractedTextIsTruth: true,
        ocrIsHelperOnly: true,
      };
    })
    .filter(Boolean);

  const contextImages = safeArray(pageContexts)
    .map((ctx) => {
      const p = safeObject(ctx);
      if (!p.pageImageUrl && !p.pageImagePath) return null;
      return {
        page: p.page,
        pageImageUrl: p.pageImageUrl,
        pageImagePath: p.pageImagePath,
        url: p.pageImageUrl,
        src: p.pageImageUrl,
        path: p.pageImagePath,
        evidenceRole: p.relation === "selected_or_same_page" ? "selectedPageFullImage" : "nearbyPageFullImage",
        sourceRefs: p.sourceRefs || [],
        fullPageImageAvailableForGeminiVision: true,
        imageTextIsTruth: false,
        pdfExtractedTextIsTruth: true,
        ocrIsHelperOnly: true,
      };
    })
    .filter(Boolean);

  const pageImages = dedupeBy(
    [...safeArray(richPageImages), ...contextImages, ...evidenceImages],
    (img) => `${safeObject(img).page}|${safeObject(img).pageImageUrl || safeObject(img).url || ""}|${safeObject(img).pageImagePath || safeObject(img).path || ""}`
  );

  const tables = dedupeBy(
    allEvidence.flatMap((ev) => safeArray(ev.tables).map((table) => ({ page: ev.page, text: table }))),
    (x) => `${x.page}|${inlineText(x.text, 180).toLowerCase()}`
  ).slice(0, 120);

  const figures = dedupeBy(
    allEvidence.flatMap((ev) => safeArray(ev.figures).map((figure) => ({ page: ev.page, text: figure }))),
    (x) => `${x.page}|${inlineText(x.text, 180).toLowerCase()}`
  ).slice(0, 120);

  const layoutBlocks = allEvidence.flatMap((ev) =>
    safeArray(ev.layoutBlocks).map((block) => ({
      page: ev.page,
      ...safeObject(block),
    }))
  ).slice(0, 300);

  const diagramPages = dedupeBy(
    [
      ...safeArray(pageContexts)
        .filter((ctx) => safeObject(ctx).hasDiagramCandidate || safeObject(ctx).hasFigures || safeObject(ctx).hasTables)
        .map((ctx) => ({
          page: safeObject(ctx).page,
          hasPageImage: safeObject(ctx).hasPageImage,
          pageImageUrl: safeObject(ctx).pageImageUrl,
          pageImagePath: safeObject(ctx).pageImagePath,
          tableCount: safeArray(safeObject(ctx).tables).length,
          figureCount: safeArray(safeObject(ctx).figures).length,
          layoutBlockCount: safeArray(safeObject(ctx).layoutBlocks).length,
        })),
      ...safeArray(resource?.metadata?.diagramPages),
    ],
    (x) => `${safeObject(x).page}|${safeObject(x).pageImageUrl || ""}`
  ).slice(0, 100);

  const selectedPages = dedupeBy(
    safeArray(selectedEvidence).map((ev) => Number(safeObject(ev).page)).filter(Boolean),
    String
  );

  return {
    selectedNode: {
      nodeId: selectedNodeId(selectedNode),
      title: selectedNodeTitle(selectedNode),
      definition: selectedNodeDefinition(selectedNode),
      sourceRefs: sourceRefsFromNode(selectedNode),
    },
    selectedPages,
    pageImages,
    tables,
    figures,
    layoutBlocks,
    diagramPages,
    visualEvidenceText: evidenceToSourceTextBlock(allEvidence, 18, 50000),
    metadata: {
      pageImagesIncluded: pageImages.length > 0,
      pageImageCount: pageImages.length,
      selectedPageImageCount: pageImages.filter((img) => selectedPages.includes(Number(img.page))).length,
      richSourcePackPageImageCount: safeArray(richPageImages).length,
      selectedNodeFullPageImagesAvailable: safeArray(richPageImages).length > 0,
      geminiVisionPageImagesAvailable: pageImages.length > 0,
      hasTables: tables.length > 0,
      hasFigures: figures.length > 0,
      hasLayoutBlocks: layoutBlocks.length > 0,
      hasDiagramCandidate: diagramPages.length > 0,
      pdfExtractedTextIsTruth: true,
      ocrIsHelperOnly: true,
      imageTextIsTruth: false,
      fallbackUsed: false,
      usedSmartFallback: false,
    },
  };
}




function selectExactChunks({ chunks, selectedNode, selectedRefs, selectedPages, maxExactChunks }) {
  const exactByRef = safeArray(chunks).filter((chunk) => matchChunkBySourceRef(chunk, selectedRefs));
  const exactByPage = safeArray(chunks).filter((chunk) => selectedPages.includes(Number(chunk.page || chunk.metadata?.page)));

  const scored = dedupeBy([...exactByRef, ...exactByPage], (chunk) => {
    const c = compactChunk(chunk, 8000);
    return `${c.chunkId}|${c.page}|${c.chunkIndex}`;
  })
    .map((chunk) => ({
      chunk,
      score: scoreChunkForSelectedNode(chunk, selectedNode, selectedRefs, selectedPages),
    }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxExactChunks).map(({ chunk }, index) =>
    chunkToEvidence(chunk, index < exactByRef.length ? "selectedEvidence" : "selectedPageEvidence", 100 - index)
  );
}

function selectSamePageChunks({ chunks, selectedPages, selectedEvidence, maxSamePageChunks }) {
  const selectedChunkIds = new Set(safeArray(selectedEvidence).map((ev) => ev.chunkId).filter(Boolean));

  return safeArray(chunks)
    .filter((chunk) => selectedPages.includes(Number(chunk.page || chunk.metadata?.page)))
    .filter((chunk) => !selectedChunkIds.has(compactChunk(chunk, 8000).chunkId))
    .sort((a, b) => Number(a.chunkIndex || a.metadata?.chunkIndex || 0) - Number(b.chunkIndex || b.metadata?.chunkIndex || 0))
    .slice(0, maxSamePageChunks)
    .map((chunk, index) => chunkToEvidence(chunk, "samePageEvidence", 80 - index));
}

function selectNearbyChunks({ chunksByPage, selectedPages, maxNearbyChunks }) {
  const nearbyPages = dedupeBy(
    safeArray(selectedPages)
      .flatMap((page) => [Number(page) - 1, Number(page) + 1])
      .filter((page) => page > 0),
    String
  ).sort((a, b) => a - b);

  const nearby = [];

  for (const page of nearbyPages) {
    const pageChunks = safeArray(chunksByPage.get(page));
    for (const chunk of pageChunks) {
      nearby.push(chunkToEvidence(chunk, page < Math.min(...selectedPages) ? "previousPageEvidence" : "nextPageEvidence", 60));
      if (nearby.length >= maxNearbyChunks) break;
    }
    if (nearby.length >= maxNearbyChunks) break;
  }

  return nearby;
}

function selectRelatedChunks({ chunks, selectedNode, selectedRefs, selectedPages, excludedChunkIds, maxRelatedChunks }) {
  return safeArray(chunks)
    .filter((chunk) => {
      const c = compactChunk(chunk, 8000);
      return !excludedChunkIds.has(c.chunkId) && !selectedPages.includes(Number(c.page));
    })
    .map((chunk) => ({
      chunk,
      score: scoreChunkForSelectedNode(chunk, selectedNode, selectedRefs, selectedPages),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRelatedChunks)
    .map(({ chunk }, index) => chunkToEvidence(chunk, "relatedEvidence", 40 - index));
}

function buildSelectedPageFullText(pageContexts, selectedPages) {
  const selectedSet = new Set(safeArray(selectedPages).map(Number));
  return cleanText(
    safeArray(pageContexts)
      .filter((ctx) => selectedSet.has(Number(safeObject(ctx).page)))
      .map((ctx) => {
        const c = safeObject(ctx);
        return [
          `[[SELECTED PAGE ${c.page}]]`,
          c.fullText || c.text || "",
          c.ocrText ? `OCR:\n${c.ocrText}` : "",
          safeArray(c.tables).length ? `TABLES:\n${safeArray(c.tables).join("\n\n")}` : "",
          safeArray(c.figures).length ? `FIGURES:\n${safeArray(c.figures).join("\n\n")}` : "",
          c.pageImageUrl || c.pageImagePath ? `FULL_PAGE_IMAGE: ${c.pageImageUrl || c.pageImagePath}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n--- SELECTED PAGE BREAK ---\n\n"),
    120000
  );
}

function buildSamePageFullText(pageContexts, selectedPages) {
  const selectedSet = new Set(safeArray(selectedPages).map(Number));
  return cleanText(
    safeArray(pageContexts)
      .filter((ctx) => selectedSet.has(Number(safeObject(ctx).page)))
      .map((ctx) => safeObject(ctx).fullText || safeObject(ctx).text || "")
      .join("\n\n"),
    90000
  );
}

function buildNearbyPageText(pageContexts, selectedPages) {
  const selectedSet = new Set(safeArray(selectedPages).map(Number));
  return cleanText(
    safeArray(pageContexts)
      .filter((ctx) => !selectedSet.has(Number(safeObject(ctx).page)))
      .map((ctx) => {
        const c = safeObject(ctx);
        return `[[${c.relation || "nearby"} PAGE ${c.page}]]\n${cleanText(c.fullText || c.text || "", 20000)}`;
      })
      .join("\n\n"),
    90000
  );
}

function createContextId() {
  return `glt_source_context_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeBuildInput(input = {}) {
  const body = safeObject(input.body || input);
  const context = safeObject(input.context);

  return {
    ownerKey: cleanText(input.ownerKey || body.ownerKey || context.ownerKey || body.offlineUserId || context.offlineUserId || "demo_user", 260),
    resourceId: cleanText(input.resourceId || body.resourceId || context.resourceId || "", 260),
    selectedNode: safeObject(input.selectedNode || body.selectedNode || body.node),
    resource: safeObject(input.resource || body.resource || context.resource),
    body,
    context,
  };
}

function assertSelectedNode(selectedNode) {
  if (!safeObject(selectedNode) || (!selectedNodeTitle(selectedNode) && !selectedNodeId(selectedNode))) {
    const error = new Error("sourceContextBuilder requires selectedNode from the roadmap tree.");
    error.statusCode = 400;
    error.metadata = {
      fallbackUsed: false,
      usedSmartFallback: false,
    };
    throw error;
  }
}

function assertResourceId(resourceId) {
  if (!resourceId) {
    const error = new Error("sourceContextBuilder requires resourceId.");
    error.statusCode = 400;
    error.metadata = {
      fallbackUsed: false,
      usedSmartFallback: false,
    };
    throw error;
  }
}

function buildDebugSummary(result) {
  return {
    contextId: result.contextId,
    selectedNodeTitle: result.selectedNode?.title,
    selectedNodeId: result.selectedNode?.nodeId,
    selectedPages: result.selectedPages,
    selectedEvidenceCount: safeArray(result.selectedEvidence).length,
    samePageEvidenceCount: safeArray(result.samePageEvidence).length,
    nearbyEvidenceCount: safeArray(result.nearbyEvidence).length,
    relatedEvidenceCount: safeArray(result.relatedEvidence).length,
    pageContextCount: safeArray(result.pageContexts).length,
    pageImageCount: safeArray(result.pageImages).length,
    visualContextPageImageCount: safeArray(result.visualContext?.pageImages).length,
    hasSelectedPageFullText: Boolean(result.selectedPageFullText),
    hasFullPdfSummary: Boolean(result.fullPdfSummary?.fullPdfSummary || result.fullPdfSummary),
    hasFullPdfOutline: Boolean(result.fullPdfOutline?.modules?.length || result.fullPdfOutline?.fullPdfOutline),
    geminiVisionPageImagesAvailable: Boolean(result.metadata?.geminiVisionPageImagesAvailable),
  };
}

async function buildSourceContext(input = {}) {
  const {
    ownerKey,
    resourceId,
    selectedNode,
    resource,
    body,
    context,
  } = normalizeBuildInput(input);

  assertResourceId(resourceId);
  assertSelectedNode(selectedNode);

  const maxChunks = boundedInt(
    body.maxContextChunks || process.env.STAGE2_CONTEXT_MAX_CHUNKS,
    1600,
    100,
    3000
  );

  const maxExactChunks = boundedInt(
    body.maxExactChunks || process.env.STAGE2_CONTEXT_MAX_EXACT_CHUNKS,
    12,
    2,
    60
  );

  const maxSamePageChunks = boundedInt(
    body.maxSamePageChunks || process.env.STAGE2_CONTEXT_MAX_SAME_PAGE_CHUNKS,
    24,
    4,
    100
  );

  const maxNearbyChunks = boundedInt(
    body.maxNearbyChunks || process.env.STAGE2_CONTEXT_MAX_NEARBY_CHUNKS,
    16,
    2,
    80
  );

  const maxRelatedChunks = boundedInt(
    body.maxRelatedChunks || process.env.STAGE2_CONTEXT_MAX_RELATED_CHUNKS,
    16,
    0,
    100
  );

  const chunks = await loadResourceChunks({
    ownerKey,
    resourceId,
    limit: maxChunks,
  });

  const chunksByPage = groupChunksByPage(chunks);
  const { refs: selectedRefs, pages: selectedPagesFromNode } = getAllNodeRefsAndPages(selectedNode);
  const richPageImages = getRichSourcePackPageImages(selectedNode);

  const richImagePages = safeArray(richPageImages)
    .map((img) => Number(safeObject(img).page))
    .filter(Boolean);

  const selectedPages = dedupeBy(
    [
      ...selectedPagesFromNode,
      ...richImagePages,
    ],
    String
  ).sort((a, b) => a - b);

  if (!selectedPages.length && !selectedRefs.length) {
    const error = new Error("Selected node has no sourceRefs/pageRefs/richSourcePack pages. Cannot build grounded Stage2 context.");
    error.statusCode = 422;
    error.metadata = {
      fallbackUsed: false,
      usedSmartFallback: false,
      selectedNodeId: selectedNodeId(selectedNode),
      selectedNodeTitle: selectedNodeTitle(selectedNode),
    };
    throw error;
  }

  const selectedEvidenceRaw = selectExactChunks({
    chunks,
    selectedNode,
    selectedRefs,
    selectedPages,
    maxExactChunks,
  });

  const selectedEvidence = hydrateEvidenceImagesFromRichSourcePack(selectedEvidenceRaw, richPageImages);

  const samePageEvidenceRaw = selectSamePageChunks({
    chunks,
    selectedPages,
    selectedEvidence,
    maxSamePageChunks,
  });

  const samePageEvidence = hydrateEvidenceImagesFromRichSourcePack(samePageEvidenceRaw, richPageImages);

  const nearbyEvidenceRaw = selectNearbyChunks({
    chunksByPage,
    selectedPages,
    maxNearbyChunks,
  });

  const nearbyEvidence = hydrateEvidenceImagesFromRichSourcePack(nearbyEvidenceRaw, richPageImages);

  const excludedChunkIds = new Set(
    [...selectedEvidence, ...samePageEvidence, ...nearbyEvidence]
      .map((ev) => safeObject(ev).chunkId)
      .filter(Boolean)
  );

  const relatedEvidence = selectRelatedChunks({
    chunks,
    selectedNode,
    selectedRefs,
    selectedPages,
    excludedChunkIds,
    maxRelatedChunks,
  });

  const pageNumbersForContexts = dedupeBy(
    [
      ...selectedPages,
      ...selectedPages.flatMap((page) => [Number(page) - 1, Number(page) + 1]).filter((page) => page > 0),
    ],
    String
  ).sort((a, b) => a - b);

  const pageContextsRaw = pageNumbersForContexts
    .map((page) => {
      const pageChunks = safeArray(chunksByPage.get(page));
      if (!pageChunks.length) return null;
      return buildPageContextFromChunks({
        page,
        chunks: pageChunks,
        relation: selectedPages.includes(page) ? "selected_or_same_page" : page < Math.min(...selectedPages) ? "previous_page" : "next_page",
        richPageImages,
      });
    })
    .filter(Boolean);

  const pageContexts = hydratePageContextsWithRichSourcePackImages(pageContextsRaw, richPageImages);

  const visualContextRaw = buildVisualContext({
    pageContexts,
    selectedEvidence,
    samePageEvidence,
    nearbyEvidence,
    richPageImages,
    selectedNode,
    resource,
  });

  const visualContext = mergeRichSourcePackImagesIntoVisualContext(
    visualContextRaw,
    richPageImages,
    pageContexts,
    selectedRefs
  );

  const pageImages = dedupeBy(
    [
      ...safeArray(visualContext.pageImages),
      ...safeArray(richPageImages),
      ...safeArray(pageContexts)
        .filter((ctx) => safeObject(ctx).pageImageUrl || safeObject(ctx).pageImagePath)
        .map((ctx) => ({
          page: safeObject(ctx).page,
          pageImageUrl: safeObject(ctx).pageImageUrl,
          pageImagePath: safeObject(ctx).pageImagePath,
          url: safeObject(ctx).pageImageUrl,
          src: safeObject(ctx).pageImageUrl,
          path: safeObject(ctx).pageImagePath,
          evidenceRole: safeObject(ctx).relation === "selected_or_same_page" ? "selectedPageFullImage" : "nearbyPageFullImage",
          sourceRefs: safeObject(ctx).sourceRefs,
          fullPageImageAvailableForGeminiVision: true,
          imageTextIsTruth: false,
          pdfExtractedTextIsTruth: true,
          ocrIsHelperOnly: true,
        })),
    ],
    (img) => `${safeObject(img).page}|${safeObject(img).pageImageUrl || safeObject(img).url || ""}|${safeObject(img).pageImagePath || safeObject(img).path || ""}`
  );

  const treeMeta = selectedNodeTreeMetadata(selectedNode, resource);
  const fullPdfSummary = treeMeta.fullPdfSummary || compactFullPdfSummary(resource, selectedNode);
  const fullPdfOutline = treeMeta.fullPdfOutline || compactFullPdfOutline(resource, selectedNode);
  const roadmapModules = treeMeta.roadmapModules.length ? treeMeta.roadmapModules : safeArray(fullPdfOutline.modules);

  const selectedPageFullText = buildSelectedPageFullText(pageContexts, selectedPages);
  const samePageFullText = buildSamePageFullText(pageContexts, selectedPages);
  const nearbyPageText = buildNearbyPageText(pageContexts, selectedPages);

  const selectedNodeContext = {
    nodeId: selectedNodeId(selectedNode),
    title: selectedNodeTitle(selectedNode),
    definition: selectedNodeDefinition(selectedNode),
    shortDefinition: selectedNodeDefinition(selectedNode),
    pageRefs: selectedPages,
    sourceRefs: selectedRefs,
    richSourcePack: getRichSourcePack(selectedNode),
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      sourceGrounded: true,
      hasRichSourcePack: Boolean(Object.keys(getRichSourcePack(selectedNode)).length),
      richSourcePackPageImageCount: richPageImages.length,
      selectedNodeFullPageImagesAvailable: richPageImages.length > 0,
      selectedNodeGeminiVisionReady: pageImages.length > 0,
    },
  };


    const result = {
    ok: true,
    contextId: createContextId(),

    ownerKey,
    resourceId,

    selectedNode: selectedNodeContext,
    selectedNodeId: selectedNodeContext.nodeId,
    selectedNodeTitle: selectedNodeContext.title,
    selectedNodeDefinition: selectedNodeContext.definition,
    selectedPages,

    sourceRefs: selectedRefs,
    selectedSourceRefs: selectedRefs,

    selectedEvidence,
    selectedNodeExactChunks: selectedEvidence,

    samePageEvidence,
    samePageChunks: samePageEvidence,

    nearbyEvidence,
    nearbyChunks: nearbyEvidence,
    previousNextChunks: nearbyEvidence,

    relatedEvidence,

    comparisonEvidence: [],
    externalEvidence: [],

    pageContexts,
    selectedPageFullText,
    samePageFullText,
    nearbyPageText,

    fullPdfSummary,
    fullPdfOutline,
    roadmapModules,

    pageImages,
    visualContext,

    ocrText: cleanText(
      [
        ...safeArray(selectedEvidence).map((ev) => safeObject(ev).ocrText),
        ...safeArray(samePageEvidence).map((ev) => safeObject(ev).ocrText),
      ]
        .filter(Boolean)
        .join("\n\n"),
      80000
    ),

    tables: dedupeBy(
      [
        ...safeArray(selectedEvidence).flatMap((ev) =>
          safeArray(safeObject(ev).tables).map((table) => ({
            page: safeObject(ev).page,
            text: table,
            evidenceRole: safeObject(ev).evidenceRole || "selectedEvidence",
          }))
        ),
        ...safeArray(samePageEvidence).flatMap((ev) =>
          safeArray(safeObject(ev).tables).map((table) => ({
            page: safeObject(ev).page,
            text: table,
            evidenceRole: safeObject(ev).evidenceRole || "samePageEvidence",
          }))
        ),
        ...safeArray(nearbyEvidence).flatMap((ev) =>
          safeArray(safeObject(ev).tables).map((table) => ({
            page: safeObject(ev).page,
            text: table,
            evidenceRole: safeObject(ev).evidenceRole || "nearbyEvidence",
          }))
        ),
      ],
      (x) => `${safeObject(x).page}|${inlineText(safeObject(x).text, 180).toLowerCase()}`
    ).slice(0, 160),

    figures: dedupeBy(
      [
        ...safeArray(selectedEvidence).flatMap((ev) =>
          safeArray(safeObject(ev).figures).map((figure) => ({
            page: safeObject(ev).page,
            text: figure,
            evidenceRole: safeObject(ev).evidenceRole || "selectedEvidence",
          }))
        ),
        ...safeArray(samePageEvidence).flatMap((ev) =>
          safeArray(safeObject(ev).figures).map((figure) => ({
            page: safeObject(ev).page,
            text: figure,
            evidenceRole: safeObject(ev).evidenceRole || "samePageEvidence",
          }))
        ),
        ...safeArray(nearbyEvidence).flatMap((ev) =>
          safeArray(safeObject(ev).figures).map((figure) => ({
            page: safeObject(ev).page,
            text: figure,
            evidenceRole: safeObject(ev).evidenceRole || "nearbyEvidence",
          }))
        ),
      ],
      (x) => `${safeObject(x).page}|${inlineText(safeObject(x).text, 180).toLowerCase()}`
    ).slice(0, 160),

    layoutBlocks: [
      ...safeArray(selectedEvidence).flatMap((ev) =>
        safeArray(safeObject(ev).layoutBlocks).map((block) => ({
          page: safeObject(ev).page,
          evidenceRole: safeObject(ev).evidenceRole || "selectedEvidence",
          ...safeObject(block),
        }))
      ),
      ...safeArray(samePageEvidence).flatMap((ev) =>
        safeArray(safeObject(ev).layoutBlocks).map((block) => ({
          page: safeObject(ev).page,
          evidenceRole: safeObject(ev).evidenceRole || "samePageEvidence",
          ...safeObject(block),
        }))
      ),
      ...safeArray(nearbyEvidence).flatMap((ev) =>
        safeArray(safeObject(ev).layoutBlocks).map((block) => ({
          page: safeObject(ev).page,
          evidenceRole: safeObject(ev).evidenceRole || "nearbyEvidence",
          ...safeObject(block),
        }))
      ),
    ].slice(0, 500),

    sourceTextPack: {
      selectedEvidenceText: evidenceToSourceTextBlock(selectedEvidence, 16, 70000),
      samePageEvidenceText: evidenceToSourceTextBlock(samePageEvidence, 24, 70000),
      nearbyEvidenceText: evidenceToSourceTextBlock(nearbyEvidence, 18, 50000),
      relatedEvidenceText: evidenceToSourceTextBlock(relatedEvidence, 18, 50000),
      selectedPageFullText,
      samePageFullText,
      nearbyPageText,
    },

    contextForGemini: {
      selectedNode: selectedNodeContext,
      selectedEvidence,
      samePageEvidence,
      nearbyEvidence,
      relatedEvidence,
      pageContexts,
      selectedPageFullText,
      samePageFullText,
      nearbyPageText,
      fullPdfSummary,
      fullPdfOutline,
      roadmapModules,
      pageImages,
      visualContext,
      ocrText: cleanText(
        [
          ...safeArray(selectedEvidence).map((ev) => safeObject(ev).ocrText),
          ...safeArray(samePageEvidence).map((ev) => safeObject(ev).ocrText),
        ]
          .filter(Boolean)
          .join("\n\n"),
        80000
      ),
      tables: safeArray(visualContext.tables),
      figures: safeArray(visualContext.figures),
      layoutBlocks: safeArray(visualContext.layoutBlocks),
      truthRules: {
        selectedEvidenceIsPrimaryTruth: true,
        pdfExtractedTextIsTruth: true,
        ocrIsHelperOnly: true,
        imageTextIsTruth: false,
        pageImagesForGeminiVision: true,
        usePageImagesForDiagramLayoutShape: true,
        recoverLabelsFromTextOcrChunks: true,
      },
    },

    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      sourceGrounded: true,
      parallelContextBuilt: true,

      selectedNodeContextBuilder: "sourceContextBuilder.service.js",
      version: "v16-selected-node-rich-source-pack-page-image-bridge",

      selectedNodeId: selectedNodeContext.nodeId,
      selectedNodeTitle: selectedNodeContext.title,

      selectedPageCount: selectedPages.length,
      selectedPages,

      selectedEvidenceCount: safeArray(selectedEvidence).length,
      samePageEvidenceCount: safeArray(samePageEvidence).length,
      nearbyEvidenceCount: safeArray(nearbyEvidence).length,
      relatedEvidenceCount: safeArray(relatedEvidence).length,
      pageContextCount: safeArray(pageContexts).length,

      fullPdfSummaryIncluded: Boolean(fullPdfSummary?.fullPdfSummary || fullPdfSummary),
      fullPdfOutlineIncluded: Boolean(fullPdfOutline?.modules?.length || fullPdfOutline?.fullPdfOutline),
      roadmapModulesIncluded: safeArray(roadmapModules).length > 0,

      selectedPageFullTextIncluded: Boolean(selectedPageFullText),
      samePageFullTextIncluded: Boolean(samePageFullText),
      nearbyPageTextIncluded: Boolean(nearbyPageText),

      pageImagesIncluded: safeArray(pageImages).length > 0,
      pageImageCount: safeArray(pageImages).length,
      visualContextPageImageCount: safeArray(visualContext.pageImages).length,
      richSourcePackPageImageCount: safeArray(richPageImages).length,
      selectedNodeFullPageImagesAvailable: safeArray(richPageImages).length > 0,
      geminiVisionPageImagesAvailable: safeArray(pageImages).length > 0,

      ocrTextIncluded: Boolean(
        safeArray(selectedEvidence).some((ev) => safeObject(ev).ocrText) ||
          safeArray(samePageEvidence).some((ev) => safeObject(ev).ocrText)
      ),
      tablesIncluded: safeArray(visualContext.tables).length > 0,
      figuresIncluded: safeArray(visualContext.figures).length > 0,
      layoutBlocksIncluded: safeArray(visualContext.layoutBlocks).length > 0,
      diagramCandidateIncluded: Boolean(visualContext.metadata?.hasDiagramCandidate),

      pdfExtractedTextIsTruth: true,
      ocrIsHelperOnly: true,
      imageTextIsTruth: false,
      pageImageUse: "gemini_vision_diagram_layout_shape_source_preview",

      maxContextChunks: maxChunks,
      maxExactChunks,
      maxSamePageChunks,
      maxNearbyChunks,
      maxRelatedChunks,

      debugSummaryAvailable: true,
    },
  };

  result.debugSummary = buildDebugSummary(result);

  return result;
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

function health() {
  return {
    ok: true,
    service: "sourceContextBuilder.service.js",
    role: "selected-node-context-bridge",
    version: "v16-selected-node-rich-source-pack-page-image-bridge",
    capabilities: {
      selectedNodeTitleDefinition: true,
      selectedNodeSourceRefs: true,
      selectedNodeExactChunks: true,
      selectedPageFullText: true,
      samePageChunks: true,
      previousNextPageChunks: true,
      fullPdfSummary: true,
      fullPdfOutline: true,
      pageImagePathUrl: true,
      ocrText: true,
      tables: true,
      figuresDiagramMetadata: true,
      layoutBlocks: true,
      richSourcePackPageImages: true,
      visualContextPageImages: true,
      geminiVisionReadyPageImages: true,
      noFakeFallback: true,
    },
    metadata: {
      fallbackUsed: false,
      usedSmartFallback: false,
      pdfExtractedTextIsTruth: true,
      ocrIsHelperOnly: true,
      imageTextIsTruth: false,
    },
  };
}

module.exports = {
  buildSourceContext,
  buildSelectedNodeContext,
  buildContextForStage2,
  buildNodeSourceContext,
  health,

  _internals: {
    safeString,
    safeObject,
    safeArray,
    cleanText,
    inlineText,
    envNumber,
    envTrue,
    boundedInt,
    dedupeBy,

    isGarbledText,
    textReliability,
    tableToText,
    figureToText,
    collectPageImage,

    compactResource,
    compactChunk,
    loadResourceChunks,
    attachEvidenceRole,
    sourceRefFromChunk,
    normalizeSourceRefs,
    sourceRefsFromNode,

    getRichSourcePack,
    getRichSourcePackPages,
    getRichSourcePackPageImages,
    imageMapByPage,

    hydrateEvidenceImagesFromRichSourcePack,
    hydratePageContextsWithRichSourcePackImages,
    mergeRichSourcePackImagesIntoVisualContext,

    selectedNodeTitle,
    selectedNodeId,
    selectedNodeDefinition,
    nodeSearchText,
    getAllNodeRefsAndPages,

    matchChunkBySourceRef,
    tokenize,
    scoreChunkForSelectedNode,
    groupChunksByPage,
    buildPageContextFromChunks,

    evidenceToSourceTextBlock,
    compactFullPdfSummary,
    compactFullPdfOutline,
    selectedNodeTreeMetadata,
    buildVisualContext,

    selectExactChunks,
    selectSamePageChunks,
    selectNearbyChunks,
    selectRelatedChunks,

    buildSelectedPageFullText,
    buildSamePageFullText,
    buildNearbyPageText,
    createContextId,
    normalizeBuildInput,
    buildDebugSummary,
  },
};


/**
 * ✅ node click করলে selectedNode title/definition যাবে
✅ selectedNode sourceRefs যাবে
✅ exact selected chunks যাবে
✅ selected page full text যাবে
✅ same page chunks যাবে
✅ previous/next page chunks যাবে
✅ fullPdfSummary যাবে
✅ fullPdfOutline যাবে
✅ richSourcePack.pageImages read হবে
✅ selectedEvidence/samePageEvidence/pageContexts hydrate হবে
✅ pageImagePath/pageImageUrl preserve হবে
✅ visualContext.pageImages merge হবে
✅ OCR/tables/figures/layoutBlocks যাবে
✅ selected_page_vision_agent.py এখন actual page image পেতে পারবে
 */