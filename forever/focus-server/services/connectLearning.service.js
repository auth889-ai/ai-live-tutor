// server/services/connectLearning.service.js
// Full fixed service for Connect Learning.
// Safe imports: no fragile named imports from pdfContext/web/rerank helper files.
// Works with routes/controller/api included in this package.

import mongoose from "mongoose";
import LearningTree from "../models/LearningTree.js";
import LearningNode from "../models/LearningNode.js";
import LearningResource from "../models/LearningResource.js";
import { emitStudyEvent } from "../config/realtime.js";
import { callOllamaJson } from "./ollamaCompat.service.js";
import { extractPdfWithVisionAndOCR } from "./pdfVisionExtractor.service.js";

const pdfJobs = new Map();

const MAX_TEXT_CHARS = Number(process.env.CONNECT_LEARNING_MAX_TEXT_CHARS || 30000);
const JOB_TTL_MS = Number(process.env.CONNECT_LEARNING_JOB_TTL_MS || 21600000);

const SOURCE_ALIASES = {
  pdf: "pdf", evidence: "pdf", pdf_evidence: "pdf",
  lecture: "lecture",
  note: "note", notes: "note", book: "note",
  video: "video", youtube: "video", yt: "video",
  key_points: "key_points", keypoints: "key_points", points: "key_points",
  webpage: "webpage", web: "webpage", article: "webpage", page: "webpage",
  related_link: "related_link", link: "related_link", related: "related_link",
  chart: "chart", graph: "chart", diagram: "diagram", workflow: "diagram",
  manual: "manual", user: "manual",
  voice: "voice", speech: "voice",
  image: "image", screenshot: "screenshot", table: "table", code: "code",
  audio: "audio", file: "file", question: "question", flashcard: "flashcard",
};

const RELATIONS = new Set([
  "contains", "related", "explains", "depends_on", "part_of", "has_step",
  "example_of", "uses_tool", "warning_for", "causes", "leads_to",
  "compared_with", "shown_in_visual", "supports", "contradicts",
  "prerequisite_for", "implemented_by", "child", "ai_inferred",
]);

function clean(v = "") { return String(v || "").trim(); }
function cleanSpace(v = "") { return String(v || "").replace(/\s+/g, " ").trim(); }
function list(v) { return Array.isArray(v) ? v : []; }
function uniq(v = []) { return [...new Set(list(v).map(clean).filter(Boolean))]; }
function trunc(v = "", n = MAX_TEXT_CHARS) { const s = String(v || ""); return s.length > n ? s.slice(0, n) : s; }
function norm(v = "") { return clean(v).toLowerCase().replace(/[^a-z0-9+# ]/gi, " ").replace(/\s+/g, " ").trim(); }
function source(v = "manual") { return SOURCE_ALIASES[clean(v).toLowerCase()] || "manual"; }
function relation(v = "related") { const r = clean(v).toLowerCase().replace(/\s+/g, "_"); return RELATIONS.has(r) ? r : "related"; }
function isId(v) { return mongoose.Types.ObjectId.isValid(String(v || "")); }
function clamp01(v, d = 0.5) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d; }
function domain(url = "") { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function jobId() { return `pdfjob_${Date.now()}_${Math.random().toString(16).slice(2)}`; }

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function allowPartialTree() {
  return boolEnv("CONNECT_LEARNING_ALLOW_PARTIAL_TREE", false);
}

function storeFullTextChars() {
  return Number(process.env.CONNECT_LEARNING_STORE_FULLTEXT_CHARS || process.env.CONNECT_LEARNING_STORE_FULL_TEXT_CHARS || 120000);
}


async function optionalFn(modulePath, exportName) {
  try {
    const mod = await import(modulePath);
    return typeof mod[exportName] === "function" ? mod[exportName] : null;
  } catch {
    return null;
  }
}

function setJob(id, patch = {}) {
  const prev = pdfJobs.get(id) || { jobId: id, status: "queued", progress: 0, createdAt: new Date().toISOString() };
  const next = { ...prev, ...patch, jobId: id, updatedAt: new Date().toISOString() };
  pdfJobs.set(id, next);
  return next;
}

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of pdfJobs.entries()) {
    const t = new Date(job.updatedAt || job.createdAt || 0).getTime();
    if (t && now - t > JOB_TTL_MS) pdfJobs.delete(id);
  }
}

async function emitCL({ deviceId = "", userId = "" } = {}, event, data = {}) {
  try {
    if (typeof emitStudyEvent !== "function") return;
    try { emitStudyEvent({ deviceId: clean(deviceId), userId: clean(userId) }, event, data); }
    catch { emitStudyEvent(clean(deviceId), event, data); }
  } catch (e) {
    console.warn("[connect-learning] emit failed:", e.message);
  }
}

async function mapLimit(items = [], limit = 2, worker) {
  const arr = list(items);
  const out = new Array(arr.length);
  let i = 0;
  const n = Math.max(1, Math.min(Number(limit) || 1, arr.length || 1));
  async function run() {
    while (i < arr.length) {
      const idx = i++;
      out[idx] = await worker(arr[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: n }, run));
  return out;
}

function fuzzyTitleMatch(a = "", b = "") {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length > 8 && y.includes(x)) return true;
  if (y.length > 8 && x.includes(y)) return true;
  const xs = new Set(x.split(/\s+/).filter(Boolean));
  const ys = new Set(y.split(/\s+/).filter(Boolean));
  const overlap = [...xs].filter(t => ys.has(t)).length;
  const denom = Math.max(1, Math.min(xs.size, ys.size));
  return denom >= 2 && overlap / denom >= 0.75;
}

function makeBookPages(text = "", title = "Book Notes") {
  const raw = clean(text);
  if (!raw) return [];
  const paras = raw.split(/\n\s*\n/g).map(x => x.trim()).filter(Boolean);
  const pages = [];
  let cur = "";
  for (const p of paras) {
    if (cur && `${cur}\n\n${p}`.length > 1150) { pages.push(cur); cur = p; }
    else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) pages.push(cur);
  return pages.slice(0, 12).map((content, i) => ({ page: i + 1, title: i ? `${title} — continued` : title, content }));
}

function conceptScore(c = {}) {
  return clamp01(c.confidence, 0.65) * 10
    + list(c.evidenceQuotes).length * 2
    + list(c.relatedChunkIds).length
    + list(c.visualPageNumbers).length * 0.75
    + Number(c.mergedCount || 1);
}

function resourceStats(resources = []) {
  const stats = {};
  for (const r of list(resources)) {
    const id = String(r.nodeId || "");
    if (!id) continue;
    if (!stats[id]) stats[id] = { all: 0, lecture: 0, note: 0, video: 0, chart: 0, diagram: 0, key_points: 0, related_link: 0, pdf: 0, webpage: 0, manual: 0, voice: 0 };
    const t = source(r.sourceType);
    stats[id].all += 1;
    stats[id][t] = (stats[id][t] || 0) + 1;
  }
  return stats;
}

async function recalculateNode(nodeId) {
  if (!isId(nodeId)) return null;
  const count = await LearningResource.countDocuments({ nodeId });
  return LearningNode.findByIdAndUpdate(nodeId, { resourceCount: count }, { new: true });
}

async function recalculateTree(treeId) {
  if (!isId(treeId)) return null;
  const [nodeCount, resourceCount, generatedNodeCount] = await Promise.all([
    LearningNode.countDocuments({ treeId }),
    LearningResource.countDocuments({ treeId }),
    LearningNode.countDocuments({ treeId, resourceStatus: "generated" }),
  ]);
  const progressPercentage = nodeCount ? Math.round((generatedNodeCount / nodeCount) * 100) : 0;
  const status = nodeCount === 0 ? "not_started" : generatedNodeCount === nodeCount ? "completed" : resourceCount > 0 ? "in_progress" : "not_started";
  return LearningTree.findByIdAndUpdate(treeId, { nodeCount, resourceCount, progressPercentage, status }, { new: true });
}

function normalizeChunk(chunk = {}, index = 0) {
  const pageNumber = Number(chunk.pageNumber || chunk.page || chunk.pageStart || chunk.pageIndex || 0) || 0;
  return {
    chunkId: clean(chunk.chunkId || chunk.id || `chunk_${index + 1}`),
    pageNumber,
    pageStart: Number(chunk.pageStart || pageNumber || 0),
    pageEnd: Number(chunk.pageEnd || pageNumber || 0),
    type: clean(chunk.type || chunk.source || "text"),
    source: clean(chunk.source || chunk.type || "pdf"),
    text: clean(chunk.text || chunk.content || chunk.ocrText || chunk.summary || ""),
  };
}

function normalizeVisual(page = {}, index = 0) {
  const vision = page.vision || page.visualAnalysis || page.analysis || {};
  const pageNumber = Number(page.pageNumber || page.page || page.pageIndex || index + 1);
  const visualType = clean(vision.visualType || page.visualType || page.visualTypeGuess || page.type);
  const title = clean(vision.title || page.title || `Visual candidate page ${pageNumber}`);
  const summary = clean(vision.summary || page.summary || page.reason || list(page.reasons).join("; ") || list(page.visualHints).join(", "));
  const relatedConcepts = list(vision.relatedConcepts || page.relatedConcepts || page.visualHints).map(clean).filter(Boolean);
  const meaningful = page.hasVisualCandidate || page.hasMeaningfulVisual || page.isCandidateOnly || vision.isMeaningful || /diagram|workflow|chart|flowchart|screenshot|table|code|architecture|process/i.test(`${visualType} ${title} ${summary}`);
  if (!meaningful) return null;
  return { visualId: clean(page.visualId || page.id || `visual_page_${pageNumber}_${index + 1}`), pageNumber, visualType: visualType || "visual_candidate", title, summary, relatedConcepts, imagePath: clean(page.imagePath || page.path || ""), imageUrl: clean(page.imageUrl || page.url || ""), confidence: clamp01(vision.confidence || page.confidence, 0.65) };
}

function prepareExtraction(extraction = {}) {
  const rawChunks = [...list(extraction.chunks), ...list(extraction.textChunks), ...list(extraction.pageChunks)];
  const chunks = rawChunks.map(normalizeChunk).filter(c => c.text && c.text.length >= 30);
  if (!chunks.length && clean(extraction.text || extraction.fullText)) {
    chunks.push({ chunkId: "full_text_1", pageNumber: 1, pageStart: 1, pageEnd: 1, type: "text", source: "pdf", text: clean(extraction.text || extraction.fullText) });
  }
  const visualSources = [
    ...list(extraction.visualCandidates),
    ...list(extraction.visualPages),
    ...list(extraction.pages).filter(p => p?.hasVisualCandidate || p?.hasMeaningfulVisual || p?.isCandidateOnly),
  ];
  const visualCandidates = visualSources.map(normalizeVisual).filter(Boolean).slice(0, Number(process.env.CONNECT_LEARNING_MAX_VISUAL_CANDIDATES || 20));
  const visualChunks = visualCandidates.map((v, i) => ({
    chunkId: `visual_${v.pageNumber}_${i + 1}`, pageNumber: v.pageNumber, pageStart: v.pageNumber, pageEnd: v.pageNumber,
    type: "visual", source: "visual_candidate", visual: v,
    text: `VISUAL CANDIDATE\nPage: ${v.pageNumber}\nType: ${v.visualType}\nTitle: ${v.title}\nSummary: ${v.summary}\nRelated concepts: ${v.relatedConcepts.join(", ")}`
  }));
  return { chunks: [...chunks, ...visualChunks], textChunks: chunks, visualCandidates, text: chunks.map(c => c.text).join("\n\n"), pageCount: Number(extraction.pageCount || extraction.pages?.length || 0), meta: extraction.meta || extraction.metadata || {} };
}

function buildChunkGroups(chunks = []) {
  const maxChars = Number(process.env.CONNECT_LEARNING_CHUNK_SIZE || 9000);
  const overlapChars = Number(process.env.CONNECT_LEARNING_CHUNK_OVERLAP || 900);
  const groupSize = Number(process.env.CONNECT_LEARNING_TREE_GROUP_SIZE || 1);
  const groups = [];
  let current = [], currentLength = 0;
  for (const chunk of list(chunks)) {
    const len = clean(chunk.text).length;
    if (current.length && currentLength + len > maxChars) {
      groups.push(current);
      if (overlapChars > 0) {
        const overlap = [];
        let overlapLength = 0;
        for (let i = current.length - 1; i >= 0; i--) {
          const c = current[i], cLen = clean(c.text).length;
          if (overlapLength + cLen > overlapChars && overlap.length) break;
          overlap.unshift(c); overlapLength += cLen;
        }
        current = overlap; currentLength = overlapLength;
      } else { current = []; currentLength = 0; }
    }
    current.push(chunk); currentLength += len;
  }
  if (current.length) groups.push(current);
  if (groupSize <= 1) return groups;
  const merged = [];
  for (let i = 0; i < groups.length; i += groupSize) merged.push(groups.slice(i, i + groupSize).flat());
  return merged;
}

function groupPromptText(group = []) {
  const maxChunkChars = Number(
    process.env.CONNECT_LEARNING_TREE_GROUP_CHUNK_CHARS ||
      process.env.CONNECT_LEARNING_MAX_CHUNK_TEXT ||
      700
  );

  return list(group)
    .map((chunk) => {
      const header = `[chunkId=${chunk.chunkId} | pages=${
        chunk.pageStart || chunk.pageNumber
      }-${chunk.pageEnd || chunk.pageNumber} | type=${chunk.type}]`;

      return `${header}\n${trunc(chunk.text, maxChunkChars)}`;
    })
    .join("\n\n---\n\n");
}

function extractionPrompt({ title = "", studyGoal = "", group = [], groupIndex = 0, totalGroups = 1 }) {
  return `
You are extracting a SMALL evidence-backed learning graph from a PDF chunk group.

CRITICAL OUTPUT RULES:
- Return VALID JSON only.
- Do not use markdown.
- Do not include text outside JSON.
- Close every quote, array, and object.
- Keep the JSON compact.

HARD LIMITS:
- Maximum 3 concepts.
- Maximum 3 relations.
- Each concept summary must be under 160 characters.
- Each concept must have exactly 1 evidenceQuote.
- Each evidenceQuote must be under 180 characters.
- Each relation reason must be under 140 characters.
- Each relation evidenceQuote must be under 180 characters.
- Do not include long code blocks.
- Do not include full examples.
- Do not include multi-line evidence quotes.
- If a concept needs a long quote, choose the shortest exact phrase.
- If unsure, omit the concept.

GROUNDING RULES:
- Only include concepts supported by the provided text.
- Every concept must have pageRefs, evidenceQuotes, relatedChunkIds.
- relatedChunkIds must use provided chunkId values only.
- Every relation must have sourceTitle, targetTitle, relationType, reason, evidenceQuote, pageRefs, confidence.
- Do not invent concepts.
- Ignore references, headers, footers, page numbers, author info, and decoration.
- Visual candidates are metadata only. Attach them only if clearly relevant.

Allowed concept types:
core_concept, definition, process, step, example, tool, warning, formula, diagram, table, code, best_practice, common_mistake, subtopic

Allowed relation types:
explains, depends_on, part_of, has_step, example_of, uses_tool, warning_for, causes, leads_to, compared_with, shown_in_visual, supports, contradicts, prerequisite_for, related, implemented_by

Document title: ${title || "Untitled PDF"}
Study goal: ${studyGoal || "General learning"}
Chunk group: ${groupIndex + 1}/${totalGroups}

Return exactly this JSON shape:
{
  "concepts": [
    {
      "title": "short title",
      "type": "core_concept",
      "summary": "short summary under 160 chars",
      "pageRefs": [1],
      "evidenceQuotes": ["one short exact quote under 180 chars"],
      "relatedChunkIds": ["chunk_id_from_input"],
      "visualPageNumbers": [],
      "confidence": 0.8
    }
  ],
  "relations": [
    {
      "sourceTitle": "Concept A",
      "targetTitle": "Concept B",
      "relationType": "supports",
      "reason": "short reason under 140 chars",
      "pageRefs": [1],
      "evidenceQuote": "short exact quote under 180 chars",
      "confidence": 0.8
    }
  ],
  "warnings": []
}

Content:
${groupPromptText(group)}
`.trim();
}

function normalizeConcept(raw = {}, fallbackChunkIds = []) {
  const title = cleanSpace(raw.title || raw.name || raw.concept || "");
  if (!title || title.length < 3) return null;

  const pageRefs = uniq(list(raw.pageRefs || raw.pages || raw.pageNumbers).map(x => String(Number(x) || x)))
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0);

  const evidenceQuotes = uniq(
    list(raw.evidenceQuotes || raw.evidence || raw.quotes)
      .map((q) => cleanSpace(typeof q === "string" ? q : q?.quote || q?.text || ""))
      .map((q) => q.replace(/\n+/g, " ").slice(0, 180))
      .filter((q) => q.length >= 12)
  ).slice(0, 1);

  const relatedChunkIds = uniq([...list(raw.relatedChunkIds || raw.chunkIds), ...fallbackChunkIds]).slice(0, 16);

  // STRICT ACCURACY GUARD:
  // A concept is saved only when it is grounded in a PDF page, quote, and chunk.
  if (!pageRefs.length) return null;
  if (!evidenceQuotes.length) return null;
  if (!relatedChunkIds.length) return null;

  return {
    title,
    normalizedTitle: norm(title),
    type: clean(raw.type || raw.nodeType || "core_concept").toLowerCase().replace(/\s+/g, "_"),
    summary: cleanSpace(raw.summary || raw.description || "").slice(0, 180),
    pageRefs,
    evidenceQuotes,
    relatedChunkIds,
    visualPageNumbers: list(raw.visualPageNumbers || raw.visualPages).map(Number).filter(n => Number.isFinite(n) && n > 0),
    confidence: clamp01(raw.confidence, 0.68),
    mergedCount: 1,
  };
}
function normalizeRel(raw = {}) {
  const sourceTitle = cleanSpace(raw.sourceTitle || raw.source || raw.from || "");
  const targetTitle = cleanSpace(raw.targetTitle || raw.target || raw.to || "");
  if (!sourceTitle || !targetTitle || norm(sourceTitle) === norm(targetTitle)) return null;

  const pageRefs = uniq(list(raw.pageRefs || raw.pages || raw.pageNumbers).map(x => String(Number(x) || x)))
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0);

  const evidenceQuote = cleanSpace(raw.evidenceQuote || raw.quote || "")
    .replace(/\n+/g, " ")
    .slice(0, 180);

  // STRICT RELATION GUARD:
  // Do not save concept edges unless the PDF provides page + quote evidence.
  if (!pageRefs.length) return null;
  if (!evidenceQuote || evidenceQuote.length < 12) return null;

  return {
    sourceTitle,
    targetTitle,
    relationType: relation(raw.relationType || raw.relation || raw.type || "related"),
    reason: cleanSpace(raw.reason || raw.explanation || "").slice(0, 160),
    pageRefs,
    evidenceQuote,
    confidence: clamp01(raw.confidence, 0.65),
  };
}
function mergeConcepts(concepts = []) {
  const merged = [];

  for (const c of list(concepts)) {
    if (!c?.title) continue;

    const existing = merged.find(x => fuzzyTitleMatch(x.title, c.title));

    if (!existing) {
      merged.push({
        ...c,
        normalizedTitle: norm(c.title),
        type: c.type || "core_concept",
        summary: c.summary || "",
        pageRefs: list(c.pageRefs).map(Number).filter(Boolean),
        evidenceQuotes: list(c.evidenceQuotes).filter(Boolean),
        relatedChunkIds: uniq(c.relatedChunkIds),
        visualPageNumbers: list(c.visualPageNumbers).map(Number).filter(Boolean),
        confidence: clamp01(c.confidence, 0.68),
        mergedCount: Number(c.mergedCount || 1),
      });
      continue;
    }

    const betterTitle =
      c.title.length > existing.title.length &&
      !/^(introduction|conclusion|overview|summary|references)$/i.test(c.title)
        ? c.title
        : existing.title;

    existing.title = betterTitle;
    existing.normalizedTitle = norm(betterTitle);
    existing.type = existing.type || c.type || "core_concept";
    existing.summary = existing.summary || c.summary || "";
    existing.pageRefs = uniq([...list(existing.pageRefs).map(String), ...list(c.pageRefs).map(String)])
      .map(Number)
      .filter(Boolean);
    existing.evidenceQuotes = uniq([...list(existing.evidenceQuotes), ...list(c.evidenceQuotes)]).slice(0, 10);
    existing.relatedChunkIds = uniq([...list(existing.relatedChunkIds), ...list(c.relatedChunkIds)]).slice(0, 20);
    existing.visualPageNumbers = uniq([...list(existing.visualPageNumbers).map(String), ...list(c.visualPageNumbers).map(String)])
      .map(Number)
      .filter(Boolean);
    existing.confidence = Math.max(clamp01(existing.confidence, 0.68), clamp01(c.confidence, 0.68));
    existing.mergedCount = Number(existing.mergedCount || 1) + 1;
  }

  return merged
    .filter(c => {
      const n = norm(c.title);
      const generic = ["introduction", "conclusion", "references", "abstract", "table of contents", "contents", "overview", "summary"];
      if (generic.includes(n)) return false;
      if (!list(c.evidenceQuotes).length && !list(c.visualPageNumbers).length) return false;
      return true;
    })
    .sort((a, b) => conceptScore(b) - conceptScore(a))
    .slice(0, Number(process.env.CONNECT_LEARNING_MAX_CONCEPTS || 60));
}

function buildFinalTree({ concepts = [], relations = [], fileName = "", studyGoal = "" }) {
  const cleanConcepts = mergeConcepts(concepts).slice(0, Number(process.env.CONNECT_LEARNING_MAX_TREE_NODES || 28));
  const rootId = "root";

  const nodes = [
    {
      id: rootId,
      title: clean(studyGoal) || clean(fileName).replace(/\.pdf$/i, "") || "PDF Learning Roadmap",
      level: 0,
      parentId: "",
      summary: `Learning roadmap generated from ${fileName || "uploaded PDF"}.`,
      concepts: uniq([clean(studyGoal), clean(fileName).replace(/\.pdf$/i, "")]).filter(Boolean),
      tags: ["pdf", "roadmap"],
      pdfEvidence: "Root node groups the PDF concepts.",
      evidenceQuotes: [],
      pageRefs: [],
      relatedChunkIds: [],
      visualPageNumbers: [],
      confidence: 0.85,
    },
  ];

  cleanConcepts.forEach((c, i) => {
    nodes.push({
      id: `node_${i + 1}`,
      title: c.title,
      level: 1,
      parentId: rootId,
      summary: c.summary || c.title,
      concepts: uniq([c.title, c.type]),
      tags: uniq(["pdf", c.type]),
      pdfEvidence: list(c.evidenceQuotes)[0] || c.summary || "",
      evidenceQuotes: list(c.evidenceQuotes),
      pageRefs: list(c.pageRefs).map(pageNumber => ({
        pageNumber: Number(pageNumber),
        source: "pdf",
        confidence: c.confidence,
      })),
      relatedChunkIds: uniq(c.relatedChunkIds),
      visualPageNumbers: list(c.visualPageNumbers).map(Number).filter(Boolean),
      confidence: clamp01(c.confidence, 0.75),
      raw: c,
    });
  });

  const byTitle = new Map(nodes.map(n => [norm(n.title), n]));

  function findNode(title = "") {
    const direct = byTitle.get(norm(title));
    if (direct) return direct;
    return nodes.find(n => n.id !== rootId && fuzzyTitleMatch(n.title, title)) || null;
  }

  const edges = [];
  const seen = new Set();

  for (const r of list(relations)) {
    const from = findNode(r.sourceTitle);
    const to = findNode(r.targetTitle);
    if (!from || !to || from.id === to.id) continue;

    const rel = relation(r.relationType);
    const key = `${from.id}->${to.id}->${rel}`;
    if (seen.has(key)) continue;
    seen.add(key);

    edges.push({
      from: from.id,
      to: to.id,
      relation: rel,
      label: rel.replace(/_/g, " "),
      reason: clean(r.reason),
      evidenceQuote: clean(r.evidenceQuote),
      pageNumber: Number(list(r.pageRefs)[0] || 0),
      chunkId: clean(r.chunkId),
      confidence: clamp01(r.confidence, 0.7),
    });
  }

  for (const node of nodes) {
    if (node.id !== rootId && !edges.some(e => e.to === node.id)) {
      edges.push({
        from: rootId,
        to: node.id,
        relation: "contains",
        label: "contains",
        reason: "Root roadmap contains this PDF concept.",
        confidence: 0.8,
      });
    }
  }

  return {
    title: nodes[0].title,
    description: `Evidence-backed learning tree from ${fileName || "PDF"}.`,
    nodes,
    edges,
  };
}

async function extractConceptCandidates({ extraction = {}, fileName = "", studyGoal = "", jobId = "", deviceId = "", userId = "" } = {}) {
  const prepared = prepareExtraction(extraction);
  const groups = buildChunkGroups(prepared.chunks);

  if (!groups.length) throw new Error("No readable PDF text/chunks found for concept extraction.");

  const fallback = { concepts: [], relations: [], warnings: [] };
  const concurrency = Number(process.env.CONNECT_LEARNING_TREE_CONCURRENCY || 2);

  const results = await mapLimit(groups, concurrency, async (group, index) => {
    const chunkIds = group.map(c => c.chunkId).filter(Boolean);
    const prompt = extractionPrompt({
      title: fileName,
      studyGoal,
      group,
      groupIndex: index,
      totalGroups: groups.length,
    });

    try {
      const result = await callOllamaJson({
        prompt,
        temperature: 0.05,
        timeoutMs: Number(process.env.CONNECT_LEARNING_TREE_GROUP_TIMEOUT_MS || 300000),
        num_predict: Number(process.env.CONNECT_LEARNING_TREE_GROUP_NUM_PREDICT || 2600),
        num_ctx: Number(process.env.CONNECT_LEARNING_TREE_GROUP_NUM_CTX || 12288),
      });

      const concepts = list(result.concepts).map(raw => normalizeConcept(raw, chunkIds)).filter(Boolean);
      const relations = list(result.relations).map(normalizeRel).filter(Boolean);

      await emitCL({ deviceId, userId }, "connect-learning:pdf-job", {
        jobId,
        status: "processing",
        step: "extracting_concept_candidates",
        progress: Math.min(68, 45 + Math.round(((index + 1) / groups.length) * 20)),
        message: `Processed chunk group ${index + 1}/${groups.length}`,
      });

      return { concepts, relations };
    } catch (e) {
      console.warn(`[connect-learning] chunk group ${index + 1}/${groups.length} extraction failed:`, e.message);
      return {
        concepts: [],
        relations: [],
        failed: true,
        groupIndex: index + 1,
        error: e.message || "Chunk group extraction failed.",
      };
    }
  });

  const failedGroups = results.filter(r => r?.failed);

  if (failedGroups.length && !allowPartialTree()) {
    const detail = failedGroups.map(g => `group ${g.groupIndex}: ${g.error}`).join("; ");
    throw new Error(
      `Tree was not saved to avoid inaccurate/random concepts. Failed chunk groups: ${detail}`
    );
  }

  const concepts = results.flatMap(r => list(r?.concepts));
  const relations = results.flatMap(r => list(r?.relations));

  if (!concepts.length) throw new Error("AI could not extract supported concepts from this PDF.");

  console.log(
    `[connect-learning] concept extraction completed: groups=${groups.length}, rawConcepts=${concepts.length}, relations=${relations.length}, failedGroups=${failedGroups.length}`
  );

  return { concepts, relations, prepared, failedGroups };
}

async function savePdfLearningTree({ deviceId, userId = "", userEmail = "", fileName = "", studyGoal = "", extraction = {}, finalTree = {} }) {
  const tree = await LearningTree.create({
    userId: clean(userId),
    deviceId: clean(deviceId),
    title: clean(finalTree.title) || clean(studyGoal) || clean(fileName).replace(/\.pdf$/i, "") || "PDF Learning Tree",
    description: clean(finalTree.description) || `Evidence-backed concept tree generated from ${fileName || "uploaded PDF"}.`,
    category: "pdf",
    status: "not_started",
    progressPercentage: 0,
    nodeCount: 0,
    resourceCount: 0,
    source: "pdf",
    sourceType: "pdf",
    sourceUrl: "",
    sourceFileName: clean(fileName),
    originalName: clean(fileName),
    fileName: clean(fileName),
    studyGoal: clean(studyGoal),
    pdf: {
      pageCount: Number(extraction.pageCount || extraction.pages?.length || 0),
      pages: list(extraction.pages).map((page, index) => ({
        pageNumber: Number(page.pageNumber || page.page || index + 1),
        text: trunc(page.text || "", Number(process.env.CONNECT_LEARNING_STORE_CHUNK_CHARS || 6000)),
        ocrText: trunc(page.ocrText || "", Number(process.env.CONNECT_LEARNING_STORE_CHUNK_CHARS || 6000)),
        mergedText: trunc(page.mergedText || page.text || page.ocrText || "", Number(process.env.CONNECT_LEARNING_STORE_CHUNK_CHARS || 6000)),
        charCount: Number(page.charCount || clean(page.text || page.mergedText || page.ocrText).length || 0),
        extractionMethod: clean(page.extractionMethod || page.method || "text") || "text",
        visualCandidates: list(page.visualCandidates),
      })),
      chunks: list(extraction.chunks).map((chunk, index) => ({
        chunkId: clean(chunk.chunkId || chunk.id || `chunk_${index + 1}`),
        pageStart: Number(chunk.pageStart || chunk.pageNumber || chunk.page || 0),
        pageEnd: Number(chunk.pageEnd || chunk.pageNumber || chunk.page || 0),
        text: trunc(chunk.text || chunk.content || "", Number(process.env.CONNECT_LEARNING_STORE_CHUNK_CHARS || 6000)),
        charCount: Number(chunk.charCount || clean(chunk.text || chunk.content).length || 0),
        visualCandidates: list(chunk.visualCandidates),
      })),
      visualCandidates: list(extraction.visualCandidates || extraction.visualPages),
      extractionStats: extraction.meta || extraction.metadata || extraction.extractionMetadata || {},
      textCharCount: Number(clean(extraction.fullText || extraction.text || "").length || 0),
    },
    metadata: {
      fileName: clean(fileName),
      pageCount: Number(extraction.pageCount || extraction.pages?.length || 0),
      chunks: list(extraction.chunks),
      visualCandidates: list(extraction.visualCandidates || extraction.visualPages),
      pages: list(extraction.pages),
      extractionMetadata: extraction.meta || extraction.metadata || extraction.extractionMetadata || {},
      fullText: trunc(extraction.fullText || extraction.text || "", storeFullTextChars()),
    },
    rawAIOutput: {
      extractionMeta: {
        pageCount: extraction.pageCount,
        chunkCount: list(extraction.chunks).length,
        visualPageCount: list(extraction.visualCandidates || extraction.visualPages).length,
        generatedAt: new Date().toISOString(),
      },
      finalTree,
    },
  });

  const localToDbId = new Map();

  for (const node of list(finalTree.nodes)) {
    const parentId = node.parentId && localToDbId.has(node.parentId) ? localToDbId.get(node.parentId) : null;

    const created = await LearningNode.create({
      userId: clean(userId),
      deviceId: clean(deviceId),
      treeId: tree._id,
      parentId,
      title: clean(node.title),
      normalizedTitle: norm(node.title),
      summary: clean(node.summary),
      concepts: uniq(node.concepts),
      tags: uniq(node.tags),
      pdfEvidence: clean(node.pdfEvidence),
      sourceType: "pdf",
      pageRefs: list(node.pageRefs),
      evidenceQuotes: list(node.evidenceQuotes),
      relatedChunkIds: uniq(node.relatedChunkIds),
      visualPageNumbers: list(node.visualPageNumbers).map(Number).filter(Boolean),
      level: Math.max(0, Number(node.level || 0)),
      position: {
        x: Number(node.position?.x || 0),
        y: Number(node.position?.y || 0),
      },
      resourceStatus: "not_generated",
      resourceCount: 0,
      confidence: clamp01(node.confidence, 0.75),
      rawAIOutput: node.raw || node,
    });

    localToDbId.set(node.id, created._id);
  }

  const treeEdges = [];

  for (const edge of list(finalTree.edges)) {
    const fromId = localToDbId.get(edge.from);
    const toId = localToDbId.get(edge.to);
    if (!fromId || !toId || String(fromId) === String(toId)) continue;

    const relType = relation(edge.relation);
    const pageNumber = Number(edge.pageNumber || 0);
    const edgeDoc = {
      source: fromId,
      target: toId,
      fromNodeId: fromId,
      toNodeId: toId,
      sourceTitle: clean(list(finalTree.nodes).find(n => n.id === edge.from)?.title || ""),
      targetTitle: clean(list(finalTree.nodes).find(n => n.id === edge.to)?.title || ""),
      relation: relType,
      relationType: relType,
      label: clean(edge.label || relType.replace(/_/g, " ")),
      reason: clean(edge.reason),
      aiReason: clean(edge.reason),
      evidenceQuote: clean(edge.evidenceQuote),
      pageNumber: Number.isFinite(pageNumber) ? pageNumber : 0,
      pageRefs: pageNumber ? [{ pageNumber, source: "pdf" }] : [],
      chunkId: clean(edge.chunkId),
      relatedChunkIds: clean(edge.chunkId) ? [clean(edge.chunkId)] : [],
      confidence: clamp01(edge.confidence, 0.7),
      sourceKind: clean(edge.evidenceQuote) ? "ai_pdf_evidence" : "system",
    };

    treeEdges.push(edgeDoc);

    await Promise.all([
      LearningNode.findByIdAndUpdate(toId, {
        $addToSet: {
          relationships: {
            nodeId: fromId,
            relation: relType,
            label: clean(edge.label || relType),
            direction: "incoming",
            reason: clean(edge.reason),
            evidenceQuote: clean(edge.evidenceQuote),
            pageNumber: Number(edge.pageNumber || 0),
            chunkId: clean(edge.chunkId),
            confidence: clamp01(edge.confidence, 0.7),
          },
        },
      }),
      LearningNode.findByIdAndUpdate(fromId, {
        $addToSet: {
          relationships: {
            nodeId: toId,
            relation: relType,
            label: clean(edge.label || relType),
            direction: "outgoing",
            reason: clean(edge.reason),
            evidenceQuote: clean(edge.evidenceQuote),
            pageNumber: Number(edge.pageNumber || 0),
            chunkId: clean(edge.chunkId),
            confidence: clamp01(edge.confidence, 0.7),
          },
        },
      }),
    ]);
  }

  await LearningTree.findByIdAndUpdate(tree._id, {
    edges: treeEdges,
    edgeCount: treeEdges.length,
  });

  await recalculateTree(tree._id);

  const fullTree = await getFullTree(tree._id);

  await emitCL({ deviceId, userId }, "connect-learning:pdf-tree-created", {
    treeId: String(tree._id),
    title: tree.title,
    nodeCount: fullTree.nodes.length,
  });

  return fullTree;
}

async function buildLearningTreeFromPdf({ deviceId, userId = "", userEmail = "", fileName = "", studyGoal = "", extraction = {}, jobId = "" }) {
  setJob(jobId, {
    status: "processing",
    progress: 45,
    step: "extracting_concept_candidates",
    message: "Finding PDF concepts and local connections.",
  });

  const extracted = await extractConceptCandidates({
    extraction,
    fileName,
    studyGoal,
    jobId,
    deviceId,
    userId,
  });

  setJob(jobId, {
    status: "processing",
    progress: 72,
    step: "building_learning_graph",
    message: "Merging concepts and building graph.",
  });

  const finalTree = buildFinalTree({
    concepts: mergeConcepts(extracted.concepts),
    relations: extracted.relations,
    fileName,
    studyGoal,
  });

  const fullTree = await savePdfLearningTree({
    deviceId,
    userId,
    userEmail,
    fileName,
    studyGoal,
    extraction: {
      ...extraction,
      chunks: extracted.prepared?.chunks || extraction.chunks || [],
      visualCandidates: extracted.prepared?.visualCandidates || extraction.visualCandidates || [],
    },
    finalTree,
  });

  setJob(jobId, {
    status: "processing",
    progress: 92,
    step: "saving_tree",
    message: "Saving learning tree.",
  });

  return fullTree;
}

async function runPdfJob({ jobId = "", deviceId = "", userId = "", userEmail = "", file = null, filePath = "", originalName = "", studyGoal = "" } = {}) {
  try {
    if (!clean(deviceId)) throw new Error("deviceId is required.");
    if (!filePath) throw new Error("PDF file path is required.");

    setJob(jobId, {
      status: "processing",
      progress: 10,
      step: "extracting_text",
      message: "Extracting text, OCR fallback, and visual candidates from PDF.",
    });

    await emitCL({ deviceId, userId }, "connect-learning:pdf-job", {
      jobId,
      status: "processing",
      progress: 10,
      step: "extracting_text",
      message: "Extracting PDF content.",
    });

    const extraction = await extractPdfWithVisionAndOCR({
      filePath,
      fileName: originalName || file?.originalname || "uploaded.pdf",
      deviceId,
      userId,
      studyGoal,
      jobId,
    });
        setJob(jobId, {
      status: "processing",
      progress: 35,
      step: "content_extracted",
      message: "PDF content extracted. Building learning graph.",
      extractionMeta: {
        pageCount: extraction?.pageCount || extraction?.pages?.length || 0,
        chunkCount:
          extraction?.chunks?.length ||
          extraction?.textChunks?.length ||
          extraction?.pageChunks?.length ||
          0,
        visualCandidates:
          extraction?.visualCandidates?.length ||
          extraction?.visualPages?.length ||
          0,
      },
    });

    await emitCL({ deviceId, userId }, "connect-learning:pdf-job", {
      jobId,
      status: "processing",
      progress: 35,
      step: "content_extracted",
      message: "PDF content extracted.",
    });

    const fullTree = await buildLearningTreeFromPdf({
      deviceId,
      userId,
      userEmail,
      fileName: originalName || file?.originalname || "uploaded.pdf",
      studyGoal,
      extraction,
      jobId,
    });

    setJob(jobId, {
      status: "completed",
      progress: 100,
      step: "tree_ready",
      message: "Learning tree is ready.",
      treeId: String(fullTree?.tree?._id || ""),
      result: {
        treeId: String(fullTree?.tree?._id || ""),
        tree: fullTree?.tree,
        nodeCount: fullTree?.nodes?.length || 0,
      },
    });

    await emitCL({ deviceId, userId }, "connect-learning:pdf-job", {
      jobId,
      status: "completed",
      progress: 100,
      step: "tree_ready",
      treeId: String(fullTree?.tree?._id || ""),
      message: "Learning tree is ready.",
    });

    await emitCL({ deviceId, userId }, "connect-learning:pdf-processed", {
      jobId,
      treeId: String(fullTree?.tree?._id || ""),
      tree: fullTree?.tree,
      nodeCount: fullTree?.nodes?.length || 0,
    });

    return fullTree;
  } catch (error) {
    console.error("[connect-learning] PDF job failed:", error);

    setJob(jobId, {
      status: "failed",
      progress: 100,
      step: "failed",
      message: error.message || "PDF processing failed.",
      error: error.message || "PDF processing failed.",
    });

    await emitCL({ deviceId, userId }, "connect-learning:pdf-job", {
      jobId,
      status: "failed",
      progress: 100,
      step: "failed",
      error: error.message || "PDF processing failed.",
    });

    await emitCL({ deviceId, userId }, "connect-learning:error", {
      feature: "pdf_upload",
      jobId,
      error: error.message || "PDF processing failed.",
    });

    throw error;
  }
}

export async function uploadPdfResource({
  deviceId = "",
  userId = "",
  userEmail = "",
  file = null,
  filePath = "",
  originalName = "",
  studyGoal = "",
  async = true,
} = {}) {
  if (!clean(deviceId)) throw new Error("deviceId is required.");

  const finalFilePath = filePath || file?.path;
  const finalOriginalName =
    originalName ||
    file?.originalname ||
    file?.filename ||
    "uploaded.pdf";

  if (!finalFilePath) throw new Error("PDF file is required.");

  const id = jobId();

  setJob(id, {
    status: "queued",
    progress: 0,
    step: "queued",
    message: "PDF learning tree job queued.",
    deviceId: clean(deviceId),
    userId: clean(userId),
    userEmail: clean(userEmail),
    fileName: finalOriginalName,
    studyGoal: clean(studyGoal),
  });

  await emitCL({ deviceId, userId }, "connect-learning:pdf-job", {
    jobId: id,
    status: "queued",
    progress: 0,
    step: "queued",
    message: "PDF learning tree job queued.",
  });

  const payload = {
    jobId: id,
    deviceId,
    userId,
    userEmail,
    file,
    filePath: finalFilePath,
    originalName: finalOriginalName,
    studyGoal,
  };

  if (async === false || async === "false") {
    const fullTree = await runPdfJob(payload);
    return {
      jobId: id,
      status: "completed",
      treeId: String(fullTree?.tree?._id || ""),
      tree: fullTree,
    };
  }

  setTimeout(() => {
    runPdfJob(payload).catch((error) => {
      console.error("[connect-learning] async PDF job error:", error.message);
    });
  }, 0);

  return {
    jobId: id,
    status: "queued",
    message: "PDF upload accepted. Tree generation is running in the background.",
  };
}

export async function getPdfJob({ jobId = "" } = {}) {
  cleanupJobs();

  const job = pdfJobs.get(clean(jobId));
  if (!job) throw new Error("PDF job not found.");

  return { job };
}

async function createResourceDirect(payload = {}) {
  const title = clean(payload.title) || "Untitled Resource";
  const sourceType = source(payload.sourceType);
  const extractedText = trunc(payload.extractedText || payload.content || "", 30000);

  const resource = await LearningResource.create({
    userId: clean(payload.userId),
    deviceId: clean(payload.deviceId),
    treeId: payload.treeId,
    nodeId: payload.nodeId,

    sourceType,
    title,
    normalizedTitle: norm(title),

    creator: clean(payload.creator),
    url: clean(payload.url),
    thumbnail: clean(payload.thumbnail),
    domain: clean(payload.domain) || domain(payload.url),
    duration: clean(payload.duration),

    extractedText,
    transcript: trunc(payload.transcript || "", 30000),
    summary: clean(payload.summary),

    keyPoints: list(payload.keyPoints).map(clean).filter(Boolean),
    concepts: list(payload.concepts).map(clean).filter(Boolean),
    tags: list(payload.tags).map(clean).filter(Boolean),

    pageRefs: list(payload.pageRefs),
    evidence: list(payload.evidence),
    bookPages:
      list(payload.bookPages).length > 0
        ? list(payload.bookPages)
        : sourceType === "note"
          ? makeBookPages(extractedText, title)
          : [],

    openMode:
      clean(payload.openMode) ||
      (sourceType === "video"
        ? "video"
        : sourceType === "note"
          ? "flip_book"
          : sourceType === "pdf"
            ? "pdf_evidence"
            : payload.url
              ? "external"
              : "reader"),

    isUserEditable: Boolean(payload.isUserEditable),
    isUserCreated: Boolean(payload.isUserCreated),

    fileName: clean(payload.fileName),
    mimeType: clean(payload.mimeType),
    fileSize: Number(payload.fileSize || 0),

    qualityScore: clamp01(payload.qualityScore, 0.65),
    confidence: clamp01(payload.confidence, 0.65),
    rawAIOutput: payload.rawAIOutput || null,
  });

  await recalculateNode(resource.nodeId);
  await recalculateTree(resource.treeId);

  return resource;
}

function fallbackContextBundle({ tree = {}, node = {}, allNodes = [] } = {}) {
  const evidenceQuotes = list(node.evidenceQuotes);
  const pageRefs = list(node.pageRefs);

  const evidence = evidenceQuotes.map((quote, index) => ({
    pageNumber:
      pageRefs[index]?.pageNumber ||
      pageRefs[index]?.page ||
      pageRefs[0]?.pageNumber ||
      pageRefs[0]?.page ||
      0,
    chunkId: list(node.relatedChunkIds)[index] || list(node.relatedChunkIds)[0] || "",
    quote: typeof quote === "string" ? quote : quote?.quote || quote?.text || "",
    source: "pdf",
    reason: "Evidence saved on node.",
  }));

  const contextText = [
    `Tree: ${tree.title || ""}`,
    `Concept: ${node.title || ""}`,
    `Summary: ${node.summary || ""}`,
    `PDF Evidence: ${node.pdfEvidence || ""}`,
    evidence.map((e) => `Page ${e.pageNumber || "?"}: ${e.quote}`).join("\n"),
    `Connected concepts: ${list(node.relationships)
      .map((rel) => {
        const other = list(allNodes).find((n) => String(n._id) === String(rel.nodeId));
        return other?.title ? `${rel.relation || "related"} ${other.title}` : "";
      })
      .filter(Boolean)
      .join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    contextText,
    text: contextText,
    pageRefs,
    evidence,
    selectedChunks: [],
    visualContext: list(node.visualPageNumbers)
      .map((page) => `Visual candidate on page ${page}`)
      .join("\n"),
    searchQueryBase: [node.title, tree.title, ...list(node.concepts)].filter(Boolean).join(" "),
  };
}

async function getContextBundle({ tree = {}, node = {}, allNodes = [] } = {}) {
  const fn = await optionalFn("./connectLearning/pdfContext.service.js", "buildPdfContextBundle");

  if (fn) {
    try {
      const bundle = fn({ tree, node, allNodes });
      return normalizeContextBundle(bundle, { tree, node, allNodes });
    } catch (error) {
      console.warn("[connect-learning] buildPdfContextBundle failed:", error.message);
    }
  }

  return normalizeContextBundle(fallbackContextBundle({ tree, node, allNodes }), {
    tree,
    node,
    allNodes,
  });
}

function normalizeContextBundle(bundle = {}, { tree = {}, node = {}, allNodes = [] } = {}) {
  const selectedChunks = list(bundle.selectedChunks);
  const existingPageRefs = list(bundle.pageRefs);
  const existingEvidence = list(bundle.evidence);

  const contextText = clean(bundle.contextText || bundle.text || "");

  const pageRefs = existingPageRefs.length
    ? existingPageRefs
    : selectedChunks.map((chunk) => ({
        pageNumber: Number(chunk.pageNumber || chunk.pageStart || chunk.pageEnd || 0),
        chunkId: clean(chunk.chunkId || `chunk_${chunk.index || 0}`),
        source: clean(chunk.type || chunk.source || "pdf"),
        visualType: clean(chunk.visualType || ""),
        imageUrl: clean(chunk.imageUrl || ""),
        imagePath: clean(chunk.imagePath || ""),
        confidence: clamp01(chunk.score ? chunk.score / 20 : 0.7, 0.7),
      }));

  const evidence = existingEvidence.length
    ? existingEvidence
    : selectedChunks.length
      ? selectedChunks.map((chunk) => ({
          pageNumber: Number(chunk.pageNumber || chunk.pageStart || chunk.pageEnd || 0),
          chunkId: clean(chunk.chunkId || `chunk_${chunk.index || 0}`),
          quote: trunc(clean(chunk.text), 1200),
          source: clean(chunk.type || chunk.source || "pdf"),
          reason: "Selected because it matched this concept node.",
        }))
      : list(node.evidenceQuotes).map((quote, index) => ({
          pageNumber:
            pageRefs[index]?.pageNumber ||
            pageRefs[index]?.page ||
            pageRefs[0]?.pageNumber ||
            pageRefs[0]?.page ||
            0,
          chunkId: list(node.relatedChunkIds)[index] || list(node.relatedChunkIds)[0] || "",
          quote: typeof quote === "string" ? quote : quote?.quote || quote?.text || "",
          source: "pdf",
          reason: "Evidence saved on node.",
        }));

  const visualContext =
    clean(bundle.visualContext) ||
    selectedChunks
      .filter((chunk) =>
        /VISION|visual title|visual summary|related concepts|diagram|workflow|chart|screenshot|table|flowchart|architecture/i.test(
          chunk.text || ""
        )
      )
      .map(
        (chunk) => `[${chunk.chunkId || "visual_chunk"} | page ${
          chunk.pageNumber || chunk.pageStart || "?"
        }]
${trunc(chunk.text, 1800)}`
      )
      .join("\n\n") ||
    list(node.visualPageNumbers)
      .map((page) => `Visual candidate on page ${page}`)
      .join("\n");

  return {
    ...bundle,
    text: contextText,
    contextText,
    pageRefs,
    evidence,
    visualContext,
    searchQueryBase:
      clean(bundle.searchQueryBase) ||
      [node.title, tree.title, ...list(node.concepts)].filter(Boolean).join(" "),
  };
}

function buildGroundedSearchQueries({ tree = {}, node = {}, contextBundle = {} } = {}) {
  const nodeTitle = clean(node.title);
  const treeTitle = clean(tree.title || tree.studyGoal);
  const concepts = uniq([nodeTitle, ...list(node.concepts), ...list(node.tags)]).slice(0, 6);

  const evidenceTerms = list(contextBundle.evidence)
    .map((item) => clean(item.quote || item.text || ""))
    .join(" ")
    .split(/\s+/)
    .filter((word) => word.length > 4)
    .slice(0, 12)
    .join(" ");

  const exactBase = concepts.filter(Boolean).slice(0, 3).join(" ");
  const broadBase = [nodeTitle, treeTitle].filter(Boolean).join(" ");

  return {
    youtubeQueries: uniq([
      `${nodeTitle} tutorial`,
      `${exactBase} explained`,
      `${broadBase} lecture`,
      `${nodeTitle} ${evidenceTerms} tutorial`,
    ]).slice(0, 4),
    webQueries: uniq([
      `${nodeTitle} explanation`,
      `${exactBase} guide`,
      `${broadBase} notes`,
      `${nodeTitle} ${evidenceTerms}`,
    ]).slice(0, 4),
    exactQuery: nodeTitle,
    broadQuery: broadBase,
  };
}

function isResourceRelevantFallback(item = {}, contextBundle = {}) {
  const hay = norm(
    [
      item.title,
      item.name,
      item.description,
      item.summary,
      item.snippet,
      item.url,
      item.link,
    ]
      .filter(Boolean)
      .join(" ")
  );

  const terms = norm(contextBundle.searchQueryBase || "")
    .split(/\s+/)
    .filter((word) => word.length > 3);

  if (!terms.length) return { ok: true, score: 1 };

  const hit = terms.filter((term) => hay.includes(term)).length;
  const score = hit / Math.max(terms.length, 1);

  return {
    ok: score >= 0.15 || hit >= 1,
    score,
  };
}

async function createPdfInternalResources({ tree, node, contextBundle }) {
  let generated = null;
  const generatePdfNodeResources = await optionalFn(
    "./connectLearning/phase3PdfNodeResources.service.js",
    "generatePdfNodeResources"
  );

  if (generatePdfNodeResources) {
    try {
      generated = await generatePdfNodeResources({
        tree,
        node,
        contextBundle,
        pdfContext: contextBundle.contextText || contextBundle.text,
        pageRefs: contextBundle.pageRefs,
        evidence: contextBundle.evidence,
      });
    } catch (error) {
      console.warn("[connect-learning] PDF node resources service failed:", error.message);
    }
  }

  const nodeTitle = clean(node.title);
  const subject = clean(tree.title || tree.studyGoal);

  const fallbackLecture = `# ${nodeTitle}

This lecture note is grounded only in the uploaded PDF evidence.

${list(contextBundle.evidence)
  .slice(0, 4)
  .map((evidence) => `Page ${evidence.pageNumber || "?"}: ${evidence.quote}`)
  .join("\n\n")}`;

  const fallbackKeyPoints = list(contextBundle.evidence)
    .slice(0, 6)
    .map((evidence) => cleanSpace(evidence.quote).slice(0, 180))
    .filter(Boolean);

  const lectureText =
    clean(generated?.lecture?.content) ||
    clean(generated?.lectureNotes) ||
    clean(generated?.lecture) ||
    fallbackLecture;

  const notesText =
    clean(generated?.notes?.content) ||
    clean(generated?.notes) ||
    `# ${nodeTitle} Notes\n\n${list(contextBundle.evidence)
      .slice(0, 5)
      .map((evidence) => `- ${evidence.quote}`)
      .join("\n")}`;

  const keyPoints = list(generated?.keyPoints?.items || generated?.keyPoints || generated?.points);
  const finalKeyPoints = keyPoints.length ? keyPoints.map(clean).filter(Boolean) : fallbackKeyPoints;

  const created = [];

  created.push(
    await createResourceDirect({
      userId: tree.userId,
      deviceId: tree.deviceId,
      treeId: tree._id,
      nodeId: node._id,
      sourceType: "lecture",
      title: `${nodeTitle} — PDF Lecture`,
      summary: `PDF-grounded lecture generated for ${nodeTitle}.`,
      extractedText: lectureText,
      keyPoints: finalKeyPoints,
      concepts: node.concepts,
      tags: uniq(["pdf", "lecture", subject, nodeTitle]),
      pageRefs: contextBundle.pageRefs,
      evidence: contextBundle.evidence,
      openMode: "reader",
      qualityScore: 0.86,
      confidence: 0.82,
      rawAIOutput: generated?.lecture || generated || null,
    })
  );
    created.push(
    await createResourceDirect({
      userId: tree.userId,
      deviceId: tree.deviceId,
      treeId: tree._id,
      nodeId: node._id,
      sourceType: "note",
      title: `${nodeTitle} — Notebook`,
      summary: "Book-style notes generated only from uploaded PDF evidence.",
      extractedText: notesText,
      keyPoints: finalKeyPoints,
      concepts: node.concepts,
      tags: uniq(["pdf", "notes", subject, nodeTitle]),
      pageRefs: contextBundle.pageRefs,
      evidence: contextBundle.evidence,
      bookPages: makeBookPages(notesText, `${nodeTitle} Notebook`),
      openMode: "flip_book",
      qualityScore: 0.84,
      confidence: 0.82,
      rawAIOutput: generated?.notes || generated || null,
    })
  );

  created.push(
    await createResourceDirect({
      userId: tree.userId,
      deviceId: tree.deviceId,
      treeId: tree._id,
      nodeId: node._id,
      sourceType: "key_points",
      title: `${nodeTitle} — Key Points`,
      summary: finalKeyPoints.join("\n"),
      extractedText: finalKeyPoints.map((point) => `• ${point}`).join("\n"),
      keyPoints: finalKeyPoints,
      concepts: node.concepts,
      tags: uniq(["pdf", "key-points", subject, nodeTitle]),
      pageRefs: contextBundle.pageRefs,
      evidence: contextBundle.evidence,
      openMode: "reader",
      qualityScore: 0.82,
      confidence: 0.8,
      rawAIOutput: generated?.keyPoints || generated || null,
    })
  );

  created.push(
    await createResourceDirect({
      userId: tree.userId,
      deviceId: tree.deviceId,
      treeId: tree._id,
      nodeId: node._id,
      sourceType: "pdf",
      title: `${nodeTitle} — PDF Evidence`,
      summary: "Exact PDF chunks and page references used for this concept.",
      extractedText: list(contextBundle.evidence)
        .map(
          (evidence) =>
            `[Page ${evidence.pageNumber || "?"} | ${evidence.chunkId || ""}]\n${evidence.quote || ""}`
        )
        .join("\n\n---\n\n"),
      keyPoints: [],
      concepts: node.concepts,
      tags: uniq(["pdf", "evidence", subject, nodeTitle]),
      pageRefs: contextBundle.pageRefs,
      evidence: contextBundle.evidence,
      openMode: "pdf_evidence",
      qualityScore: 0.9,
      confidence: 0.92,
    })
  );

  return created;
}

async function createVisualResources({ tree, node, contextBundle }) {
  const visualPages = list(node.visualPageNumbers).map(Number).filter(Boolean);
  const visualContext = clean(contextBundle.visualContext);

  if (!visualPages.length && !visualContext) return [];

  return [
    await createResourceDirect({
      userId: tree.userId,
      deviceId: tree.deviceId,
      treeId: tree._id,
      nodeId: node._id,
      sourceType: "diagram",
      title: `${node.title} — Visual Candidate`,
      summary: "Visual/table/diagram candidate detected from the uploaded PDF.",
      extractedText: visualContext || `Visual candidate page(s): ${visualPages.join(", ")}`,
      keyPoints: visualPages.map((page) => `Review visual candidate on page ${page}`),
      concepts: node.concepts,
      tags: uniq(["visual", "diagram", "pdf", node.title]),
      pageRefs: contextBundle.pageRefs,
      evidence: contextBundle.evidence,
      openMode: "reader",
      qualityScore: 0.72,
      confidence: 0.7,
    }),
  ];
}

async function createExternalVideoResources({ tree, node, contextBundle }) {
  if (process.env.CONNECT_LEARNING_DISABLE_EXTERNAL === "true") return [];

  const searchYouTubeVideos = await optionalFn(
    "./youtubeSearch.service.js",
    "searchYouTubeVideos"
  );

  if (!searchYouTubeVideos) return [];

  const rerankYouTubeVideosForNode = await optionalFn(
    "./connectLearning/youtubeRerank.service.js",
    "rerankYouTubeVideosForNode"
  );

  const isResourceDomainRelevant = await optionalFn(
    "./connectLearning/pdfContext.service.js",
    "isResourceDomainRelevant"
  );

  const queries = buildGroundedSearchQueries({ tree, node, contextBundle });
  const rawCandidates = [];

  for (const query of list(queries.youtubeQueries).slice(0, 2)) {
    try {
      const found = await searchYouTubeVideos(query, {
        maxResults: Number(process.env.CONNECT_LEARNING_YOUTUBE_MAX_RESULTS || 8),
      });

      const videos = Array.isArray(found)
        ? found
        : Array.isArray(found?.videos)
          ? found.videos
          : [];

      rawCandidates.push(...videos);
    } catch (error) {
      console.warn("[connect-learning] youtube search failed:", error.message);
    }
  }

  const deduped = [];
  const seen = new Set();

  for (const item of rawCandidates) {
    const key = clean(item.url || item.videoId || item.id || item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    let relevance = { ok: true, score: 1 };

    try {
      relevance = isResourceDomainRelevant
        ? isResourceDomainRelevant(item, contextBundle)
        : isResourceRelevantFallback(item, contextBundle);
    } catch {
      relevance = { ok: true, score: 1 };
    }

    if (relevance.ok || relevance.score >= 1) {
      deduped.push({ ...item, _relevance: relevance });
    }
  }

  if (!deduped.length) return [];

  let ranked = deduped.slice(0, 8);

  if (rerankYouTubeVideosForNode) {
    try {
      const aiRanked = await rerankYouTubeVideosForNode({
        tree,
        node,
        candidates: deduped.slice(0, 12),
        contextBundle,
        pdfContext: contextBundle.contextText || contextBundle.text,
      });

      if (Array.isArray(aiRanked) && aiRanked.length) {
        ranked = aiRanked;
      } else if (Array.isArray(aiRanked?.videos)) {
        ranked = aiRanked.videos;
      }
    } catch (error) {
      console.warn("[connect-learning] youtube rerank failed:", error.message);
    }
  }

  const selected = ranked.slice(0, Number(process.env.CONNECT_LEARNING_SAVE_VIDEOS_PER_NODE || 3));
  const created = [];

  for (const item of selected) {
    const title = clean(item.title) || clean(item.name) || "Related video";
    const url =
      clean(item.url) ||
      (clean(item.videoId) ? `https://www.youtube.com/watch?v=${clean(item.videoId)}` : "");

    if (!url) continue;

    const exists = await LearningResource.findOne({
      treeId: tree._id,
      nodeId: node._id,
      url,
    }).lean();

    if (exists) continue;

    created.push(
      await createResourceDirect({
        userId: tree.userId,
        deviceId: tree.deviceId,
        treeId: tree._id,
        nodeId: node._id,
        sourceType: "video",
        title,
        creator: clean(item.channelTitle || item.channel || item.creator),
        url,
        thumbnail: clean(item.thumbnail || item.thumbnailUrl),
        duration: clean(item.duration),
        summary: clean(item.summary || item.description),
        extractedText: clean(item.description || item.summary),
        keyPoints: list(item.keyPoints),
        concepts: node.concepts,
        tags: uniq(["youtube", "video", tree.title, node.title]),
        pageRefs: contextBundle.pageRefs,
        evidence: list(contextBundle.evidence).slice(0, 3),
        openMode: "video",
        qualityScore: clamp01(item.qualityScore || item.score, 0.72),
        confidence: clamp01(item.confidence, 0.7),
        rawAIOutput: item,
      })
    );
  }

  return created;
}

async function createExternalWebResources({ tree, node, contextBundle }) {
  if (process.env.CONNECT_LEARNING_DISABLE_EXTERNAL === "true") return [];

  const searchWebResourcesForNode = await optionalFn(
    "./connectLearning/webSearch.service.js",
    "searchWebResourcesForNode"
  );

  if (!searchWebResourcesForNode) return [];

  const rerankWebResourcesForNode = await optionalFn(
    "./connectLearning/webResourceRerank.service.js",
    "rerankWebResourcesForNode"
  );

  const isResourceDomainRelevant = await optionalFn(
    "./connectLearning/pdfContext.service.js",
    "isResourceDomainRelevant"
  );

  let candidates = [];

  try {
    const found = await searchWebResourcesForNode({
      tree,
      node,
      contextBundle,
      pdfContext: contextBundle.contextText || contextBundle.text,
      maxResults: Number(process.env.CONNECT_LEARNING_WEB_MAX_RESULTS || 8),
    });

    candidates = Array.isArray(found)
      ? found
      : Array.isArray(found?.resources)
        ? found.resources
        : Array.isArray(found?.items)
          ? found.items
          : [];
  } catch (error) {
    console.warn("[connect-learning] web search failed:", error.message);
    candidates = [];
  }

  const deduped = [];
  const seen = new Set();

  for (const item of candidates) {
    const key = clean(item.url || item.link || item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    let relevance = { ok: true, score: 1 };

    try {
      relevance = isResourceDomainRelevant
        ? isResourceDomainRelevant(item, contextBundle)
        : isResourceRelevantFallback(item, contextBundle);
    } catch {
      relevance = { ok: true, score: 1 };
    }

    if (relevance.ok || relevance.score >= 1) {
      deduped.push({ ...item, _relevance: relevance });
    }
  }

  if (!deduped.length) return [];

  let ranked = deduped.slice(0, 8);

  if (rerankWebResourcesForNode) {
    try {
      const aiRanked = await rerankWebResourcesForNode({
        tree,
        node,
        candidates: deduped.slice(0, 12),
        contextBundle,
        pdfContext: contextBundle.contextText || contextBundle.text,
      });

      if (Array.isArray(aiRanked) && aiRanked.length) {
        ranked = aiRanked;
      } else if (Array.isArray(aiRanked?.resources)) {
        ranked = aiRanked.resources;
      } else if (Array.isArray(aiRanked?.items)) {
        ranked = aiRanked.items;
      }
    } catch (error) {
      console.warn("[connect-learning] web rerank failed:", error.message);
    }
  }

  const selected = ranked.slice(0, Number(process.env.CONNECT_LEARNING_SAVE_WEB_PER_NODE || 3));
  const created = [];

  for (const item of selected) {
    const title = clean(item.title) || clean(item.name) || "Related webpage";
    const url = clean(item.url || item.link);

    if (!url) continue;

    const exists = await LearningResource.findOne({
      treeId: tree._id,
      nodeId: node._id,
      url,
    }).lean();

    if (exists) continue;

    created.push(
      await createResourceDirect({
        userId: tree.userId,
        deviceId: tree.deviceId,
        treeId: tree._id,
        nodeId: node._id,
        sourceType: "webpage",
        title,
        creator: clean(item.creator || item.source || item.domain),
        url,
        thumbnail: clean(item.thumbnail || item.image),
        summary: clean(item.summary || item.description || item.snippet),
        extractedText: clean(item.description || item.snippet || item.summary),
        keyPoints: list(item.keyPoints),
        concepts: node.concepts,
        tags: uniq(["web", "webpage", tree.title, node.title]),
        pageRefs: contextBundle.pageRefs,
        evidence: list(contextBundle.evidence).slice(0, 3),
        openMode: "external",
        qualityScore: clamp01(item.qualityScore || item.score, 0.7),
        confidence: clamp01(item.confidence, 0.68),
        rawAIOutput: item,
      })
    );
  }

  return created;
}

export async function createTree({
  deviceId = "",
  userId = "",
  title = "",
  description = "",
  category = "general",
  studyGoal = "",
  source = "manual",
  sourceUrl = "",
} = {}) {
  if (!clean(deviceId)) throw new Error("deviceId is required.");
  if (!clean(title)) throw new Error("title is required.");

  const tree = await LearningTree.create({
    userId: clean(userId),
    deviceId: clean(deviceId),
    title: clean(title),
    description: clean(description),
    category: clean(category) || "general",
    studyGoal: clean(studyGoal),
    source: clean(source) || "manual",
    sourceUrl: clean(sourceUrl),
    status: "not_started",
    progressPercentage: 0,
    nodeCount: 0,
    resourceCount: 0,
  });

  await emitCL({ deviceId, userId }, "connect-learning:tree-created", {
    treeId: String(tree._id),
    tree,
  });

  return { tree };
}

export async function getTrees({
  deviceId = "",
  userId = "",
  limit = 50,
  category = "",
  status = "",
} = {}) {
  if (!clean(deviceId)) throw new Error("deviceId is required.");

  const query = { deviceId: clean(deviceId) };
  if (clean(userId)) query.userId = clean(userId);
  if (clean(category)) query.category = clean(category);
  if (clean(status)) query.status = clean(status);

  const trees = await LearningTree.find(query)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();

  return { trees };
}

export async function getFullTree(treeIdOrParams = {}) {
  const params =
    typeof treeIdOrParams === "string" || isId(treeIdOrParams)
      ? { treeId: treeIdOrParams }
      : treeIdOrParams;

  const { treeId = "", deviceId = "", userId = "" } = params;

  if (!isId(treeId)) throw new Error("treeId is required.");

  const query = { _id: treeId };
  if (clean(deviceId)) query.deviceId = clean(deviceId);
  if (clean(userId)) query.userId = clean(userId);

  const tree = await LearningTree.findOne(query).lean();
  if (!tree) throw new Error("Learning tree not found.");

  const [nodes, resources] = await Promise.all([
    LearningNode.find({ treeId: tree._id }).sort({ level: 1, order: 1, createdAt: 1 }).lean(),
    LearningResource.find({ treeId: tree._id }).sort({ createdAt: -1 }).lean(),
  ]);

  const stats = resourceStats(resources);

  const shapedNodes = nodes.map((node) => ({
    ...node,
    resourceStats: stats[String(node._id)] || {
      all: 0,
      lecture: 0,
      note: 0,
      video: 0,
      chart: 0,
      diagram: 0,
      key_points: 0,
      related_link: 0,
      pdf: 0,
      webpage: 0,
      manual: 0,
      voice: 0,
    },
  }));

  return {
    tree,
    nodes: shapedNodes,
    resources,
    nodeStats: stats,
  };
}

export async function updateTreeStatus({
  treeId = "",
  deviceId = "",
  userId = "",
  status = "",
  progressPercentage,
} = {}) {
  if (!isId(treeId)) throw new Error("treeId is required.");

  const query = { _id: treeId };
  if (clean(deviceId)) query.deviceId = clean(deviceId);
  if (clean(userId)) query.userId = clean(userId);

  const patch = {};
  if (clean(status)) patch.status = clean(status);
  if (progressPercentage !== undefined) {
    patch.progressPercentage = Math.max(0, Math.min(100, Number(progressPercentage) || 0));
  }

  const tree = await LearningTree.findOneAndUpdate(query, patch, { new: true });
  if (!tree) throw new Error("Learning tree not found.");

  await emitCL({ deviceId: tree.deviceId, userId: tree.userId }, "connect-learning:tree-updated", {
    treeId: String(tree._id),
    tree,
  });

  return { tree };
}

export async function deleteTree({ treeId = "", deviceId = "", userId = "" } = {}) {
  if (!isId(treeId)) throw new Error("treeId is required.");

  const query = { _id: treeId };
  if (clean(deviceId)) query.deviceId = clean(deviceId);
  if (clean(userId)) query.userId = clean(userId);

  const tree = await LearningTree.findOneAndDelete(query);
  if (!tree) throw new Error("Learning tree not found.");

  await Promise.all([
    LearningNode.deleteMany({ treeId: tree._id }),
    LearningResource.deleteMany({ treeId: tree._id }),
  ]);

  await emitCL({ deviceId: tree.deviceId, userId: tree.userId }, "connect-learning:tree-deleted", {
    treeId: String(tree._id),
  });

  return { ok: true, treeId: String(tree._id) };
}

export async function createNode({
  treeId = "",
  parentId = "",
  deviceId = "",
  userId = "",
  title = "",
  summary = "",
  concepts = [],
  tags = [],
  pdfEvidence = "",
  sourceType = "manual",
  pageRefs = [],
  evidenceQuotes = [],
  relatedChunkIds = [],
  visualPageNumbers = [],
  level,
  position = {},
} = {}) {
  if (!isId(treeId)) throw new Error("treeId is required.");
  if (!clean(deviceId)) throw new Error("deviceId is required.");
  if (!clean(title)) throw new Error("title is required.");

  const tree = await LearningTree.findOne({ _id: treeId, deviceId });
  if (!tree) throw new Error("Learning tree not found.");

  let resolvedParentId = null;
  if (isId(parentId)) {
    const parent = await LearningNode.findOne({ _id: parentId, treeId, deviceId }).lean();
    if (parent) resolvedParentId = parent._id;
  }

  const node = await LearningNode.create({
    userId: clean(userId) || tree.userId,
    deviceId: clean(deviceId),
    treeId: tree._id,
    parentId: resolvedParentId,
    title: clean(title),
    normalizedTitle: norm(title),
    summary: clean(summary),
    concepts: uniq(concepts),
    tags: uniq(tags),
    pdfEvidence: clean(pdfEvidence),
    sourceType: source(sourceType),
    pageRefs: list(pageRefs),
    evidenceQuotes: list(evidenceQuotes),
    relatedChunkIds: uniq(relatedChunkIds),
    visualPageNumbers: list(visualPageNumbers).map(Number).filter(Boolean),
    level: level !== undefined ? Number(level) || 0 : resolvedParentId ? 1 : 0,
    position: {
      x: Number(position?.x || 0),
      y: Number(position?.y || 0),
    },
    resourceStatus: "not_generated",
    resourceCount: 0,
    confidence: 0.85,
  });

  await recalculateTree(tree._id);

  await emitCL({ deviceId, userId: tree.userId }, "connect-learning:node-created", {
    treeId: String(tree._id),
    nodeId: String(node._id),
    node,
  });

  return { node };
}

export async function updateNodeStatus({
  nodeId = "",
  treeId = "",
  deviceId = "",
  userId = "",
  status = "",
  resourceStatus = "",
  progressPercentage,
} = {}) {
  if (!isId(nodeId)) throw new Error("nodeId is required.");

  const query = { _id: nodeId };
  if (isId(treeId)) query.treeId = treeId;
  if (clean(deviceId)) query.deviceId = clean(deviceId);

  const patch = {};
  if (clean(status)) patch.status = clean(status);
  if (clean(resourceStatus)) patch.resourceStatus = clean(resourceStatus);
  if (progressPercentage !== undefined) {
    patch.progressPercentage = Math.max(0, Math.min(100, Number(progressPercentage) || 0));
  }

  const node = await LearningNode.findOneAndUpdate(query, patch, { new: true });
  if (!node) throw new Error("Learning node not found.");

  await emitCL({ deviceId: node.deviceId, userId }, "connect-learning:node-updated", {
    treeId: String(node.treeId),
    nodeId: String(node._id),
    node,
  });

  return { node };
}

export async function deleteNode({
  nodeId = "",
  treeId = "",
  deviceId = "",
  userId = "",
  deleteChildren = false,
} = {}) {
  if (!isId(nodeId)) throw new Error("nodeId is required.");

  const query = { _id: nodeId };
  if (isId(treeId)) query.treeId = treeId;
  if (clean(deviceId)) query.deviceId = clean(deviceId);

  const node = await LearningNode.findOne(query);
  if (!node) throw new Error("Learning node not found.");

  const idsToDelete = [node._id];

  if (deleteChildren) {
    const children = await LearningNode.find({ parentId: node._id }).lean();
    idsToDelete.push(...children.map((child) => child._id));
  } else {
    await LearningNode.updateMany({ parentId: node._id }, { $set: { parentId: node.parentId || null } });
  }

  await Promise.all([
    LearningNode.deleteMany({ _id: { $in: idsToDelete } }),
    LearningResource.deleteMany({ nodeId: { $in: idsToDelete } }),
    LearningNode.updateMany({ treeId: node.treeId }, { $pull: { relationships: { nodeId: { $in: idsToDelete } } } }),
  ]);

  await recalculateTree(node.treeId);

  await emitCL({ deviceId: node.deviceId, userId }, "connect-learning:node-deleted", {
    treeId: String(node.treeId),
    nodeId: String(node._id),
    deletedNodeIds: idsToDelete.map(String),
  });

  return {
    ok: true,
    nodeId: String(node._id),
    deletedNodeIds: idsToDelete.map(String),
  };
}
async function getFirstNodeForTree(treeId) {
  if (!isId(treeId)) return null;
  return LearningNode.findOne({ treeId }).sort({ level: 1, order: 1, createdAt: 1 });
}

async function ensureTreeAndNodeForResource({
  deviceId = "",
  userId = "",
  userEmail = "",
  treeId = "",
  nodeId = "",
  title = "",
  studyGoal = "",
} = {}) {
  if (!clean(deviceId)) throw new Error("deviceId is required.");

  let tree = null;
  if (isId(treeId)) {
    tree = await LearningTree.findOne({ _id: treeId, deviceId: clean(deviceId) });
  }

  if (!tree) {
    tree = await LearningTree.findOne({
      deviceId: clean(deviceId),
      userId: clean(userId),
      title: "Saved Learning Inbox",
    }).sort({ updatedAt: -1 });
  }

  if (!tree) {
    tree = await LearningTree.create({
      userId: clean(userId),
      deviceId: clean(deviceId),
      title: "Saved Learning Inbox",
      description: "Auto-created tree for manually saved learning resources.",
      category: "inbox",
      source: "manual",
      studyGoal: clean(studyGoal),
      status: "completed",
      progressPercentage: 100,
    });
  }

  let node = null;
  if (isId(nodeId)) {
    node = await LearningNode.findOne({ _id: nodeId, treeId: tree._id, deviceId: clean(deviceId) });
  }

  if (!node) {
    node = await getFirstNodeForTree(tree._id);
  }

  if (!node) {
    node = await LearningNode.create({
      userId: clean(userId) || tree.userId,
      deviceId: clean(deviceId),
      treeId: tree._id,
      parentId: null,
      title: clean(studyGoal) || clean(title) || "Saved Learning Resources",
      normalizedTitle: norm(clean(studyGoal) || clean(title) || "Saved Learning Resources"),
      summary: "Resources saved manually by the user.",
      sourceType: "manual",
      nodeType: "root",
      level: 0,
      order: 0,
      resourceStatus: "not_generated",
      confidence: 0.8,
    });
  }

  return { tree, node, autoCreated: !isId(treeId) || !isId(nodeId) };
}

export async function getNodeResources({
  treeId = "",
  nodeId = "",
  deviceId = "",
  userId = "",
  autoGenerate = false,
} = {}) {
  if (!isId(nodeId)) throw new Error("nodeId is required.");

  const nodeQuery = { _id: nodeId };
  if (isId(treeId)) nodeQuery.treeId = treeId;
  if (clean(deviceId)) nodeQuery.deviceId = clean(deviceId);
  if (clean(userId)) nodeQuery.userId = clean(userId);

  const node = await LearningNode.findOne(nodeQuery).lean();
  if (!node) throw new Error("Learning node not found.");

  let resources = await LearningResource.find({ nodeId: node._id })
    .sort({ qualityScore: -1, confidence: -1, createdAt: -1 })
    .lean();

  if (!resources.length && autoGenerate) {
    const generated = await generateNodeResources({
      treeId: node.treeId,
      nodeId: node._id,
      deviceId: node.deviceId,
      userId: node.userId,
    });
    resources = generated.resources || generated.created || [];
  }

  return { node, resources, stats: resourceStats(resources)[String(node._id)] || {} };
}

export async function generateNodeResources({
  treeId = "",
  nodeId = "",
  deviceId = "",
  userId = "",
  force = false,
  includeExternal = true,
  includeVideos = true,
  includeWeb = true,
  includeVisual = true,
} = {}) {
  if (!isId(nodeId)) throw new Error("nodeId is required.");

  const nodeQuery = { _id: nodeId };
  if (isId(treeId)) nodeQuery.treeId = treeId;
  if (clean(deviceId)) nodeQuery.deviceId = clean(deviceId);
  if (clean(userId)) nodeQuery.userId = clean(userId);

  const node = await LearningNode.findOne(nodeQuery);
  if (!node) throw new Error("Learning node not found.");

  const tree = await LearningTree.findOne({ _id: node.treeId, deviceId: node.deviceId });
  if (!tree) throw new Error("Learning tree not found.");

  if (!force) {
    const existing = await LearningResource.find({ nodeId: node._id })
      .sort({ qualityScore: -1, confidence: -1, createdAt: -1 })
      .lean();
    if (existing.length) {
      return {
        tree,
        node,
        resources: existing,
        created: [],
        reused: true,
        message: "Resources already exist. Use force=true to regenerate.",
      };
    }
  } else {
    await LearningResource.deleteMany({ nodeId: node._id, isUserCreated: { $ne: true } });
  }

  await LearningNode.updateOne(
    { _id: node._id },
    { $set: { resourceStatus: "generating", progressPercentage: 15, resourceGenerationError: "" } }
  );

  await emitCL({ deviceId: node.deviceId, userId: node.userId }, "connect-learning:resources-generating", {
    treeId: String(tree._id),
    nodeId: String(node._id),
  });

  try {
    const allNodes = await LearningNode.find({ treeId: tree._id }).lean();
    const contextBundle = await getContextBundle({ tree, node, allNodes });
    const created = [];

    created.push(...(await createPdfInternalResources({ tree, node, contextBundle })));
    await LearningNode.updateOne({ _id: node._id }, { $set: { progressPercentage: 45 } });

    if (includeVisual !== false && includeVisual !== "false") {
      created.push(...(await createVisualResources({ tree, node, contextBundle })));
    }
    await LearningNode.updateOne({ _id: node._id }, { $set: { progressPercentage: 58 } });

    if (includeExternal !== false && includeExternal !== "false") {
      if (includeVideos !== false && includeVideos !== "false") {
        created.push(...(await createExternalVideoResources({ tree, node, contextBundle })));
      }
      await LearningNode.updateOne({ _id: node._id }, { $set: { progressPercentage: 76 } });

      if (includeWeb !== false && includeWeb !== "false") {
        created.push(...(await createExternalWebResources({ tree, node, contextBundle })));
      }
    }

    await recalculateNode(node._id);
    await recalculateTree(tree._id);

    const resources = await LearningResource.find({ nodeId: node._id })
      .sort({ qualityScore: -1, confidence: -1, createdAt: -1 })
      .lean();

    const finalNode = await LearningNode.findByIdAndUpdate(
      node._id,
      {
        $set: {
          resourceStatus: resources.length ? "generated" : "partial",
          progressPercentage: 100,
          resourceGenerationError: "",
        },
      },
      { new: true }
    ).lean();

    await emitCL({ deviceId: node.deviceId, userId: node.userId }, "connect-learning:resources-generated", {
      treeId: String(tree._id),
      nodeId: String(node._id),
      resources,
    });

    return {
      tree,
      node: finalNode || node,
      resources,
      created,
      reused: false,
      message: `Generated ${created.length} resources for ${node.title}.`,
    };
  } catch (error) {
    await LearningNode.updateOne(
      { _id: node._id },
      {
        $set: {
          resourceStatus: "failed",
          progressPercentage: 0,
          resourceGenerationError: error.message || "Resource generation failed.",
        },
      }
    );
    throw error;
  }
}

export async function generateTreeResources({
  treeId = "",
  deviceId = "",
  userId = "",
  limit = 6,
} = {}) {
  if (!isId(treeId)) throw new Error("treeId is required.");

  const nodeQuery = { treeId };
  if (clean(deviceId)) nodeQuery.deviceId = clean(deviceId);
  if (clean(userId)) nodeQuery.userId = clean(userId);

  const nodes = await LearningNode.find(nodeQuery)
    .sort({ confidence: -1, level: 1, order: 1 })
    .limit(Math.max(1, Math.min(Number(limit) || 6, 20)))
    .lean();

  const results = [];
  for (const node of nodes) {
    results.push(
      await generateNodeResources({
        treeId,
        nodeId: node._id,
        deviceId: node.deviceId,
        userId: node.userId,
      })
    );
  }

  return { treeId, generatedNodes: results.length, results };
}

export async function addManualResource({
  deviceId = "",
  userId = "",
  userEmail = "",
  treeId = "",
  nodeId = "",
  title = "",
  url = "",
  summary = "",
  content = "",
  extractedText = "",
  sourceType = "manual",
  studyGoal = "",
  tags = [],
  concepts = [],
  isUserCreated = true,
  isUserEditable = true,
} = {}) {
  const ensured = await ensureTreeAndNodeForResource({
    deviceId,
    userId,
    userEmail,
    treeId,
    nodeId,
    title,
    studyGoal,
  });

  const finalSource = clean(url) && sourceType === "manual" ? "webpage" : sourceType;
  const resource = await createResourceDirect({
    userId: clean(userId) || ensured.tree.userId,
    deviceId: clean(deviceId),
    treeId: ensured.tree._id,
    nodeId: ensured.node._id,
    sourceType: finalSource,
    title: clean(title) || clean(url) || "Manual Resource",
    url,
    summary: clean(summary) || trunc(clean(extractedText || content), 260),
    extractedText: clean(extractedText || content || summary),
    tags: uniq(["manual", ...list(tags)]),
    concepts: uniq(concepts),
    openMode: clean(url) ? "external" : "reader",
    isUserCreated,
    isUserEditable,
    qualityScore: 0.75,
    confidence: 0.78,
  });

  await emitCL({ deviceId, userId }, "connect-learning:resource-created", {
    treeId: String(ensured.tree._id),
    nodeId: String(ensured.node._id),
    resource,
  });

  return { tree: ensured.tree, node: ensured.node, resource, autoCreated: ensured.autoCreated };
}

export async function saveWebpageResource(params = {}) {
  const url = clean(params.url || params.link);
  if (!url) throw new Error("url is required.");
  return addManualResource({
    ...params,
    url,
    sourceType: "webpage",
    title: clean(params.title) || url,
    summary: clean(params.summary) || `Saved webpage: ${url}`,
  });
}



// Backward-compatible legacy names used by older agent graph files.
export async function createTreeManual(body = {}) {
  return createTree(body);
}

export async function createNodeManual(body = {}) {
  return createNode(body);
}

export async function saveResource(body = {}) {
  return addManualResource(body);
}

export async function saveWebpage(body = {}) {
  return saveWebpageResource(body);
}

export async function updateResource({
  resourceId = "",
  treeId = "",
  nodeId = "",
  deviceId = "",
  userId = "",
  patch = {},
} = {}) {
  if (!isId(resourceId)) throw new Error("resourceId is required.");

  const query = { _id: resourceId };
  if (isId(treeId)) query.treeId = treeId;
  if (isId(nodeId)) query.nodeId = nodeId;
  if (clean(deviceId)) query.deviceId = clean(deviceId);
  if (clean(userId)) query.userId = clean(userId);

  const allowed = [
    "title", "summary", "url", "creator", "thumbnail", "duration", "extractedText",
    "transcript", "keyPoints", "concepts", "tags", "openMode", "qualityScore", "confidence",
    "isUserEditable", "isUserCreated", "fileName", "mimeType", "fileSize",
  ];
  const update = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) update[key] = patch[key];
  }
  if (patch.sourceType !== undefined) update.sourceType = source(patch.sourceType);
  if (update.title) update.normalizedTitle = norm(update.title);
  if (update.url) update.domain = domain(update.url);

  const resource = await LearningResource.findOneAndUpdate(query, { $set: update }, { new: true });
  if (!resource) throw new Error("Learning resource not found.");

  await recalculateNode(resource.nodeId);
  await recalculateTree(resource.treeId);

  await emitCL({ deviceId: resource.deviceId, userId: resource.userId }, "connect-learning:resource-updated", {
    treeId: String(resource.treeId),
    nodeId: String(resource.nodeId),
    resource,
  });

  return { resource };
}

export async function deleteResource({
  resourceId = "",
  treeId = "",
  nodeId = "",
  deviceId = "",
  userId = "",
} = {}) {
  if (!isId(resourceId)) throw new Error("resourceId is required.");

  const query = { _id: resourceId };
  if (isId(treeId)) query.treeId = treeId;
  if (isId(nodeId)) query.nodeId = nodeId;
  if (clean(deviceId)) query.deviceId = clean(deviceId);
  if (clean(userId)) query.userId = clean(userId);

  const resource = await LearningResource.findOneAndDelete(query);
  if (!resource) throw new Error("Learning resource not found.");

  await recalculateNode(resource.nodeId);
  await recalculateTree(resource.treeId);

  await emitCL({ deviceId: resource.deviceId, userId: resource.userId }, "connect-learning:resource-deleted", {
    treeId: String(resource.treeId),
    nodeId: String(resource.nodeId),
    resourceId: String(resource._id),
  });

  return { ok: true, resourceId: String(resource._id), treeId: String(resource.treeId), nodeId: String(resource.nodeId) };
}

export async function connectResource({
  resourceId = "",
  treeId = "",
  nodeId = "",
  deviceId = "",
  userId = "",
} = {}) {
  if (!isId(resourceId)) throw new Error("resourceId is required.");
  if (!isId(treeId)) throw new Error("treeId is required.");
  if (!isId(nodeId)) throw new Error("nodeId is required.");

  const node = await LearningNode.findOne({ _id: nodeId, treeId, ...(clean(deviceId) ? { deviceId: clean(deviceId) } : {}) });
  if (!node) throw new Error("Target node not found.");

  const resource = await LearningResource.findOneAndUpdate(
    { _id: resourceId, ...(clean(deviceId) ? { deviceId: clean(deviceId) } : {}) },
    { $set: { treeId, nodeId } },
    { new: true }
  );
  if (!resource) throw new Error("Learning resource not found.");

  await recalculateNode(nodeId);
  await recalculateTree(treeId);
  return { resource, node };
}

export async function moveResource({
  resourceId = "",
  targetTreeId = "",
  targetNodeId = "",
  deviceId = "",
  userId = "",
} = {}) {
  return connectResource({
    resourceId,
    treeId: targetTreeId,
    nodeId: targetNodeId,
    deviceId,
    userId,
  });
}

export async function updateResourceProgress({
  resourceId = "",
  progress = 0,
  completed = false,
  deviceId = "",
  userId = "",
} = {}) {
  if (!isId(resourceId)) throw new Error("resourceId is required.");

  const query = { _id: resourceId };
  if (clean(deviceId)) query.deviceId = clean(deviceId);
  if (clean(userId)) query.userId = clean(userId);

  const pct = Math.max(0, Math.min(100, Number(progress) || (completed ? 100 : 0)));
  const resource = await LearningResource.findOneAndUpdate(
    query,
    { $set: { progress: pct, completedAt: completed || pct >= 100 ? new Date() : null } },
    { new: true }
  );
  if (!resource) throw new Error("Learning resource not found.");

  return { resource };
}

export async function agentCommand(params = {}) {
  const resolveAgentCommand = await optionalFn("./connectLearning/agentCommand.service.js", "resolveAgentCommand");
  if (!resolveAgentCommand) throw new Error("Agent command resolver is unavailable.");

  const resolved = await resolveAgentCommand(params);
  const action = resolved.action || {};
  const type = clean(action.type || resolved.executionType || resolved.intent);

  if (type === "GENERATE_NODE_RESOURCES") {
    const result = await generateNodeResources({
      treeId: action.treeId || params.treeId,
      nodeId: action.nodeId || params.nodeId || params.selectedNodeId,
      deviceId: params.deviceId,
      userId: params.userId,
      force: Boolean(action.force),
    });
    return { ...resolved, ...result, executionType: type, action, message: action.message || result.message };
  }

  if (type === "CREATE_NODE") {
    const result = await createNode({
      treeId: action.treeId || params.treeId,
      parentId: action.parentNodeId || params.nodeId || params.selectedNodeId,
      deviceId: params.deviceId,
      userId: params.userId,
      title: action.title,
      summary: action.summary,
      sourceType: "voice",
    });
    return { ...resolved, ...result, executionType: type, action: { ...action, nodeId: result.node?._id }, message: action.message || "Node created." };
  }

  if (type === "SAVE_MANUAL_RESOURCE") {
    const result = await addManualResource({
      deviceId: params.deviceId,
      userId: params.userId,
      treeId: action.treeId || params.treeId,
      nodeId: action.nodeId || params.nodeId || params.selectedNodeId,
      sourceType: action.sourceType || "manual",
      title: action.title,
      summary: action.summary,
      extractedText: action.extractedText || action.content,
      tags: action.tags || ["voice", "manual"],
      studyGoal: params.studyGoal || params.goal,
    });
    return { ...resolved, ...result, executionType: type, action: { ...action, resourceId: result.resource?._id, resource: result.resource }, message: action.message || "Manual note saved." };
  }

  if (type === "DELETE_RESOURCE") {
    const result = await deleteResource({
      resourceId: action.resourceId || params.resourceId || params.currentResourceId,
      deviceId: params.deviceId,
      userId: params.userId,
    });
    return { ...resolved, ...result, executionType: type, message: action.message || "Resource deleted." };
  }

  if (type === "UPDATE_NODE_STATUS") {
    const wanted = clean(action.status).toLowerCase();
    const result = await updateNodeStatus({
      nodeId: action.nodeId || params.nodeId || params.selectedNodeId,
      deviceId: params.deviceId,
      userId: params.userId,
      resourceStatus: wanted === "completed" ? "generated" : wanted === "in_progress" ? "generating" : "partial",
      progressPercentage: wanted === "completed" ? 100 : wanted === "in_progress" ? 35 : undefined,
    });
    return { ...resolved, ...result, executionType: type, message: action.message || "Node updated." };
  }

  if (type === "OPEN_RESOURCE") {
    return { ...resolved, executionType: type, resource: action.resource || null, message: action.message || "Opening resource." };
  }

  return { ...resolved, executionType: type || "SAY", message: action.message || resolved.message || "Agent command processed." };
}

export async function search({
  deviceId = "",
  userId = "",
  q = "",
  treeId = "",
  limit = 20,
} = {}) {
  if (!clean(deviceId)) throw new Error("deviceId is required.");
  const rx = clean(q) ? new RegExp(clean(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  const base = { deviceId: clean(deviceId) };
  if (clean(userId)) base.userId = clean(userId);
  if (isId(treeId)) base.treeId = treeId;

  const nodeQuery = { ...base };
  const resQuery = { ...base };
  if (rx) {
    nodeQuery.$or = [{ title: rx }, { summary: rx }, { concepts: rx }, { tags: rx }, { evidenceQuotes: rx }];
    resQuery.$or = [{ title: rx }, { summary: rx }, { extractedText: rx }, { tags: rx }, { concepts: rx }, { url: rx }];
  }

  const [nodes, resources] = await Promise.all([
    LearningNode.find(nodeQuery).sort({ updatedAt: -1 }).limit(Math.min(Number(limit) || 20, 50)).lean(),
    LearningResource.find(resQuery).sort({ qualityScore: -1, updatedAt: -1 }).limit(Math.min(Number(limit) || 20, 50)).lean(),
  ]);

  return { q, nodes, resources };
}

export async function recommendations({
  deviceId = "",
  userId = "",
  treeId = "",
  limit = 10,
} = {}) {
  if (!clean(deviceId)) throw new Error("deviceId is required.");
  const base = { deviceId: clean(deviceId) };
  if (clean(userId)) base.userId = clean(userId);
  if (isId(treeId)) base.treeId = treeId;

  const [needsResources, strongResources] = await Promise.all([
    LearningNode.find({ ...base, resourceStatus: { $in: ["not_generated", "failed", "partial"] } })
      .sort({ confidence: -1, updatedAt: -1 })
      .limit(Math.min(Number(limit) || 10, 30))
      .lean(),
    LearningResource.find(base)
      .sort({ qualityScore: -1, confidence: -1, updatedAt: -1 })
      .limit(Math.min(Number(limit) || 10, 30))
      .lean(),
  ]);

  return {
    recommendations: [
      ...needsResources.map((node) => ({
        type: "generate_resources",
        title: `Generate resources for ${node.title}`,
        nodeId: node._id,
        treeId: node.treeId,
        reason: "This concept does not have complete generated resources yet.",
      })),
      ...strongResources.map((resource) => ({
        type: "review_resource",
        title: resource.title,
        resourceId: resource._id,
        nodeId: resource.nodeId,
        treeId: resource.treeId,
        reason: "High quality saved resource.",
      })),
    ].slice(0, Math.min(Number(limit) || 10, 30)),
  };
}