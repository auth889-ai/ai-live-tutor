// server/services/connectLearning/phase3PdfNodeResources.service.js

import LearningResource from "../../models/LearningResource.js";
import LearningNode from "../../models/LearningNode.js";
import LearningTree from "../../models/LearningTree.js";

import { callOllamaJson } from "../ollamaCompat.service.js";
import { buildPdfContextBundle } from "./pdfContext.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function cleanSpace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function trunc(value = "", max = 1200) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values = []) {
  return [...new Set(list(values).map(clean).filter(Boolean))];
}

function norm(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9+# ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value, fallback = 0.75) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function resourceSourceType(value = "") {
  const t = clean(value).toLowerCase();

  const allowed = new Set([
    "lecture",
    "note",
    "key_points",
    "pdf",
    "diagram",
    "chart",
    "manual",
    "webpage",
    "video",
    "quiz",
    "flashcards",
    "learning_card",
    "visual",
  ]);

  if (allowed.has(t)) return t;

  if (t === "notes" || t === "notebook") return "note";
  if (t === "keypoints" || t === "key-point") return "key_points";
  if (t === "evidence") return "pdf";
  if (t === "visual_explanation") return "diagram";

  return "note";
}

function nowIso() {
  return new Date().toISOString();
}

function nodeTitle(node = {}) {
  return clean(node.title || node.name || "Selected Concept");
}

function extractTextFromContext(context = {}) {
  const chunks = list(context.chunks);
  const quotes = list(context.evidenceQuotes);

  const chunkText = chunks
    .map((chunk) => {
      const page = chunk.pageNumber || chunk.pageStart || "";
      const id = chunk.chunkId || chunk.id || "";
      return `[${id || "chunk"} | page ${page || "?"}]\n${chunk.text || chunk.content || ""}`;
    })
    .join("\n\n---\n\n");

  const quoteText = quotes
    .map((quote) => {
      return `[page ${quote.pageNumber || "?"} | ${quote.chunkId || ""}] ${quote.quote || ""}`;
    })
    .join("\n");

  return clean([quoteText, chunkText].filter(Boolean).join("\n\n"));
}

function visualTextFromContext(context = {}) {
  const visuals = list(context.visualRefs || context.visualCandidates || context.visualPages);

  return visuals
    .slice(0, 8)
    .map((visual) => {
      return [
        `Page ${visual.pageNumber || "?"}`,
        visual.visualType || visual.type || "",
        visual.title || "",
        visual.summary || "",
        visual.ocrText || "",
      ]
        .filter(Boolean)
        .join(" — ");
    })
    .join("\n");
}

function fallbackInternalResourcePayload({ tree = {}, node = {}, context = {} } = {}) {
  const title = nodeTitle(node);
  const evidenceText = extractTextFromContext(context);
  const firstQuote =
    list(context.evidenceQuotes)[0]?.quote ||
    list(node.evidenceQuotes)[0]?.quote ||
    trunc(evidenceText, 300);

  return {
    learningCard: {
      whatItMeans:
        node.learningCard?.whatItMeans ||
        node.summary ||
        `${title} is a PDF-grounded concept extracted from the uploaded document.`,
      whyItMatters:
        node.learningCard?.whyItMatters ||
        node.whyImportant ||
        "It matters because it connects to the surrounding concepts in the uploaded PDF.",
      beforeThis: list(node.beforeThis),
      afterThis: list(node.afterThis),
      howItConnects:
        node.learningCard?.howItConnects ||
        `This concept is connected inside the learning graph for ${tree.title || "the PDF"}.`,
      examplesFromPdf: list(node.examples),
      commonMistakes: list(node.commonMistakes),
      pdfEvidence: [
        {
          pageNumber: list(context.evidenceQuotes)[0]?.pageNumber || 0,
          chunkId: list(context.evidenceQuotes)[0]?.chunkId || "",
          quote: firstQuote,
          explanation: "Primary evidence found for this concept.",
        },
      ],
    },
    lecture: {
      title: `${title} — PDF Lecture`,
      introduction: node.summary || `This lecture explains ${title} using only the uploaded PDF.`,
      sections: [
        {
          heading: "Core idea",
          content: node.summary || trunc(evidenceText, 700),
          evidenceQuote: firstQuote,
          pageNumber: list(context.evidenceQuotes)[0]?.pageNumber || 0,
        },
      ],
      conclusion: `Review the evidence and connected concepts to understand ${title}.`,
    },
    notes: {
      title: `${title} — Notebook`,
      summary: node.summary || trunc(evidenceText, 500),
      bulletNotes: [
        {
          note: node.summary || `Understand ${title} from the PDF evidence.`,
          evidenceQuote: firstQuote,
          pageNumber: list(context.evidenceQuotes)[0]?.pageNumber || 0,
        },
      ],
    },
    keyPoints: [
      {
        point: node.summary || `${title} is an important PDF-grounded concept.`,
        whyImportant: node.whyImportant || "It is part of the connected learning graph.",
        evidenceQuote: firstQuote,
        pageNumber: list(context.evidenceQuotes)[0]?.pageNumber || 0,
      },
    ],
    quiz: [
      {
        question: `What does ${title} mean according to the PDF?`,
        answer: node.summary || trunc(firstQuote, 300),
        evidenceQuote: firstQuote,
        pageNumber: list(context.evidenceQuotes)[0]?.pageNumber || 0,
      },
    ],
    flashcards: [
      {
        front: `What is ${title}?`,
        back: node.summary || trunc(firstQuote, 300),
        evidenceQuote: firstQuote,
        pageNumber: list(context.evidenceQuotes)[0]?.pageNumber || 0,
      },
    ],
    visualExplanation: null,
  };
}

function buildInternalResourcesPrompt({ tree = {}, node = {}, context = {} } = {}) {
  const title = nodeTitle(node);
  const evidenceText = extractTextFromContext(context);
  const visualText = visualTextFromContext(context);

  return `You are generating study resources for one selected node in a PDF learning graph.

Selected tree:
${tree.title || ""}

Selected node:
${JSON.stringify(
  {
    title: node.title,
    nodeType: node.nodeType,
    summary: node.summary,
    learningObjective: node.learningObjective,
    whyImportant: node.whyImportant,
    beforeThis: node.beforeThis,
    afterThis: node.afterThis,
    examples: node.examples,
    commonMistakes: node.commonMistakes,
    evidenceQuotes: node.evidenceQuotes,
    pageRefs: node.pageRefs,
  },
  null,
  2
)}

PDF evidence for this node:
${trunc(evidenceText, Number(process.env.CONNECT_LEARNING_NODE_RESOURCE_CONTEXT_CHARS || 7000))}

Visual / diagram / table / screenshot candidates connected to this node:
${visualText || "No connected visual candidates."}

TASK:
Generate useful student-facing resources for this selected node ONLY.

STRICT RULES:
1. Use ONLY the uploaded PDF evidence above.
2. Do NOT invent facts not supported by the evidence.
3. Do NOT dump raw chunks.
4. Do NOT start any answer with "[PDF PAGE".
5. Every key point must be human-readable.
6. Every important claim must include evidenceQuote and pageNumber when possible.
7. Explain why the concept matters.
8. Explain how the node connects to before/after concepts.
9. If visual evidence exists, explain the visual as a learning example, not as raw OCR dump.
10. Return valid JSON only. No markdown. No commentary.

Return JSON exactly like this:
{
  "learningCard": {
    "whatItMeans": "student-friendly explanation",
    "whyItMatters": "real-life / learning importance",
    "beforeThis": ["concepts to learn before this"],
    "afterThis": ["concepts to learn after this"],
    "howItConnects": "how this node connects to the graph",
    "examplesFromPdf": ["examples from PDF"],
    "commonMistakes": ["common misconception or risk"],
    "pdfEvidence": [
      {
        "pageNumber": 1,
        "chunkId": "p1_c1",
        "quote": "exact quote",
        "explanation": "why this quote supports the concept"
      }
    ]
  },
  "lecture": {
    "title": "${title} — PDF Lecture",
    "introduction": "short intro",
    "sections": [
      {
        "heading": "section heading",
        "content": "clear paragraph",
        "evidenceQuote": "exact PDF quote",
        "pageNumber": 1
      }
    ],
    "conclusion": "short conclusion"
  },
  "notes": {
    "title": "${title} — Notebook",
    "summary": "concise summary",
    "bulletNotes": [
      {
        "note": "clean note",
        "evidenceQuote": "exact quote",
        "pageNumber": 1
      }
    ]
  },
  "keyPoints": [
    {
      "point": "clear key point",
      "whyImportant": "why this matters",
      "evidenceQuote": "exact quote",
      "pageNumber": 1
    }
  ],
  "quiz": [
    {
      "question": "question from this node",
      "answer": "answer using PDF evidence",
      "evidenceQuote": "exact quote",
      "pageNumber": 1
    }
  ],
  "flashcards": [
    {
      "front": "flashcard question",
      "back": "flashcard answer",
      "evidenceQuote": "exact quote",
      "pageNumber": 1
    }
  ],
  "visualExplanation": {
    "title": "visual/example title",
    "whatItShows": "what the visual/table/code/example shows",
    "whyItConnects": "why it belongs to this node",
    "stepsOrParts": ["part 1", "part 2"],
    "evidenceQuote": "exact quote or OCR text",
    "pageNumber": 1
  }
}

Selected node title: ${title}`;
}

function safeArray(value, max = 20) {
  return list(value).filter(Boolean).slice(0, max);
}

function normalizePayload(payload = {}, fallback = {}) {
  const learningCard = payload.learningCard || fallback.learningCard || {};
  const lecture = payload.lecture || fallback.lecture || {};
  const notes = payload.notes || fallback.notes || {};
  const keyPoints = safeArray(payload.keyPoints || fallback.keyPoints, 10);
  const quiz = safeArray(payload.quiz || fallback.quiz, 8);
  const flashcards = safeArray(payload.flashcards || fallback.flashcards, 12);
  const visualExplanation = payload.visualExplanation || fallback.visualExplanation || null;

  return {
    learningCard: {
      whatItMeans: cleanSpace(learningCard.whatItMeans || ""),
      whyItMatters: cleanSpace(learningCard.whyItMatters || ""),
      beforeThis: uniq(learningCard.beforeThis).slice(0, 8),
      afterThis: uniq(learningCard.afterThis).slice(0, 8),
      howItConnects: cleanSpace(learningCard.howItConnects || ""),
      examplesFromPdf: uniq(learningCard.examplesFromPdf).slice(0, 8),
      commonMistakes: uniq(learningCard.commonMistakes).slice(0, 8),
      pdfEvidence: safeArray(learningCard.pdfEvidence, 8).map((e) => ({
        pageNumber: Number(e.pageNumber || 0),
        chunkId: clean(e.chunkId || ""),
        quote: trunc(cleanSpace(e.quote || ""), 700),
        explanation: trunc(cleanSpace(e.explanation || ""), 350),
      })),
    },

    lecture: {
      title: cleanSpace(lecture.title || fallback.lecture?.title || "PDF Lecture"),
      introduction: cleanSpace(lecture.introduction || ""),
      sections: safeArray(lecture.sections, 8).map((s) => ({
        heading: cleanSpace(s.heading || "Section"),
        content: cleanSpace(s.content || ""),
        evidenceQuote: trunc(cleanSpace(s.evidenceQuote || ""), 700),
        pageNumber: Number(s.pageNumber || 0),
      })),
      conclusion: cleanSpace(lecture.conclusion || ""),
    },

    notes: {
      title: cleanSpace(notes.title || fallback.notes?.title || "Notebook"),
      summary: cleanSpace(notes.summary || ""),
      bulletNotes: safeArray(notes.bulletNotes, 16).map((n) => ({
        note: cleanSpace(n.note || ""),
        evidenceQuote: trunc(cleanSpace(n.evidenceQuote || ""), 700),
        pageNumber: Number(n.pageNumber || 0),
      })),
    },

    keyPoints: keyPoints.map((p) => ({
      point: cleanSpace(p.point || ""),
      whyImportant: cleanSpace(p.whyImportant || ""),
      evidenceQuote: trunc(cleanSpace(p.evidenceQuote || ""), 700),
      pageNumber: Number(p.pageNumber || 0),
    })),

    quiz: quiz.map((q) => ({
      question: cleanSpace(q.question || ""),
      answer: cleanSpace(q.answer || ""),
      evidenceQuote: trunc(cleanSpace(q.evidenceQuote || ""), 700),
      pageNumber: Number(q.pageNumber || 0),
    })),

    flashcards: flashcards.map((f) => ({
      front: cleanSpace(f.front || ""),
      back: cleanSpace(f.back || ""),
      evidenceQuote: trunc(cleanSpace(f.evidenceQuote || ""), 700),
      pageNumber: Number(f.pageNumber || 0),
    })),

    visualExplanation: visualExplanation
      ? {
          title: cleanSpace(visualExplanation.title || "Visual Explanation"),
          whatItShows: cleanSpace(visualExplanation.whatItShows || ""),
          whyItConnects: cleanSpace(visualExplanation.whyItConnects || ""),
          stepsOrParts: uniq(visualExplanation.stepsOrParts).slice(0, 12),
          evidenceQuote: trunc(cleanSpace(visualExplanation.evidenceQuote || ""), 700),
          pageNumber: Number(visualExplanation.pageNumber || 0),
        }
      : null,
  };
}

function stringifyPretty(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

function evidenceResourceText({ node = {}, context = {} } = {}) {
  const quotes = list(context.evidenceQuotes?.length ? context.evidenceQuotes : node.evidenceQuotes);
  const chunks = list(context.chunks);

  const quoteBlock = quotes
    .map((q) => {
      return `Page ${q.pageNumber || "?"} • ${q.chunkId || ""}\n"${q.quote || ""}"\nReason: ${
        q.reason || "Supports this node."
      }`;
    })
    .join("\n\n");

  const chunkBlock = chunks
    .slice(0, 6)
    .map((chunk) => {
      return `[${chunk.chunkId || chunk.id || "chunk"} | page ${
        chunk.pageNumber || chunk.pageStart || "?"
      }]\n${trunc(chunk.text || chunk.content || "", 900)}`;
    })
    .join("\n\n---\n\n");

  return [quoteBlock, chunkBlock].filter(Boolean).join("\n\n====================\n\n");
}

async function upsertResource({
  tree,
  node,
  sourceType,
  title,
  summary,
  extractedText,
  keyPoints = [],
  concepts = [],
  tags = [],
  qualityScore = 0.82,
  confidence = 0.82,
  openMode = "reader",
  metadata = {},
}) {
  const normalizedTitle = norm(title);

  const existing = await LearningResource.findOne({
    treeId: tree._id,
    nodeId: node._id,
    normalizedTitle,
    sourceType: resourceSourceType(sourceType),
  });

  const payload = {
    userId: clean(node.userId || tree.userId || ""),
    deviceId: clean(node.deviceId || tree.deviceId || ""),
    treeId: tree._id,
    nodeId: node._id,
    sourceType: resourceSourceType(sourceType),
    title: clean(title),
    normalizedTitle,
    summary: cleanSpace(summary),
    extractedText: typeof extractedText === "string" ? extractedText : stringifyPretty(extractedText),
    keyPoints: list(keyPoints).map((x) => (typeof x === "string" ? x : stringifyPretty(x))).slice(0, 30),
    concepts: uniq([node.title, ...list(node.concepts), ...concepts]).slice(0, 20),
    tags: uniq(["pdf", "gemma4", "internal", ...tags]).slice(0, 30),
    openMode,
    qualityScore: clamp01(qualityScore, 0.82),
    confidence: clamp01(confidence, 0.82),
    isAiGenerated: true,
    isUserEditable: true,
    metadata: {
      ...metadata,
      generatedAt: nowIso(),
      generator: "phase3PdfNodeResources.service.js",
      model: process.env.CONNECT_LEARNING_FAST_MODEL || process.env.OLLAMA_CLOUD_MODEL || "",
    },
  };

  if (existing) {
    Object.assign(existing, payload);
    await existing.save();
    return existing;
  }

  return LearningResource.create(payload);
}

async function saveInternalResources({ tree, node, context, payload }) {
  const title = nodeTitle(node);
  const resources = [];

  resources.push(
    await upsertResource({
      tree,
      node,
      sourceType: "learning_card",
      title: `${title} — Learning Card`,
      summary: payload.learningCard.whatItMeans || `Understand ${title}.`,
      extractedText: payload.learningCard,
      keyPoints: [
        payload.learningCard.whatItMeans,
        payload.learningCard.whyItMatters,
        payload.learningCard.howItConnects,
      ].filter(Boolean),
      tags: ["learning-card"],
      qualityScore: 0.9,
      confidence: 0.88,
      metadata: { resourceKind: "learning_card" },
    })
  );

  resources.push(
    await upsertResource({
      tree,
      node,
      sourceType: "lecture",
      title: payload.lecture.title || `${title} — PDF Lecture`,
      summary: payload.lecture.introduction || `PDF-grounded lecture for ${title}.`,
      extractedText: payload.lecture,
      keyPoints: payload.lecture.sections?.map((section) => section.heading) || [],
      tags: ["lecture"],
      qualityScore: 0.86,
      confidence: 0.86,
      metadata: { resourceKind: "lecture" },
    })
  );

  resources.push(
    await upsertResource({
      tree,
      node,
      sourceType: "note",
      title: payload.notes.title || `${title} — Notebook`,
      summary: payload.notes.summary || `Notebook notes for ${title}.`,
      extractedText: payload.notes,
      keyPoints: payload.notes.bulletNotes?.map((note) => note.note) || [],
      tags: ["notes", "notebook"],
      qualityScore: 0.84,
      confidence: 0.84,
      metadata: { resourceKind: "notes" },
    })
  );

  resources.push(
    await upsertResource({
      tree,
      node,
      sourceType: "key_points",
      title: `${title} — Key Points`,
      summary: `${payload.keyPoints.length || 0} PDF-grounded key points for ${title}.`,
      extractedText: payload.keyPoints,
      keyPoints: payload.keyPoints.map((point) => point.point).filter(Boolean),
      tags: ["key-points"],
      qualityScore: 0.84,
      confidence: 0.84,
      metadata: { resourceKind: "key_points" },
    })
  );

  resources.push(
    await upsertResource({
      tree,
      node,
      sourceType: "quiz",
      title: `${title} — Quiz`,
      summary: `${payload.quiz.length || 0} quiz questions generated from PDF evidence.`,
      extractedText: payload.quiz,
      keyPoints: payload.quiz.map((q) => q.question).filter(Boolean),
      tags: ["quiz", "practice"],
      qualityScore: 0.8,
      confidence: 0.8,
      metadata: { resourceKind: "quiz" },
    })
  );

  resources.push(
    await upsertResource({
      tree,
      node,
      sourceType: "flashcards",
      title: `${title} — Flashcards`,
      summary: `${payload.flashcards.length || 0} flashcards generated from PDF evidence.`,
      extractedText: payload.flashcards,
      keyPoints: payload.flashcards.map((f) => f.front).filter(Boolean),
      tags: ["flashcards", "practice"],
      qualityScore: 0.8,
      confidence: 0.8,
      metadata: { resourceKind: "flashcards" },
    })
  );

  resources.push(
    await upsertResource({
      tree,
      node,
      sourceType: "pdf",
      title: `${title} — PDF Evidence`,
      summary: "Exact PDF chunks and page references used for this concept.",
      extractedText: evidenceResourceText({ node, context }),
      keyPoints: list(context.evidenceQuotes || node.evidenceQuotes)
        .map((q) => q.quote)
        .filter(Boolean)
        .slice(0, 10),
      tags: ["pdf-evidence", "source"],
      qualityScore: 0.92,
      confidence: 0.92,
      metadata: {
        resourceKind: "pdf_evidence",
        pageRefs: node.pageRefs || [],
        evidenceQuotes: node.evidenceQuotes || [],
      },
    })
  );

  if (payload.visualExplanation) {
    resources.push(
      await upsertResource({
        tree,
        node,
        sourceType: "diagram",
        title: payload.visualExplanation.title || `${title} — Visual Explanation`,
        summary:
          payload.visualExplanation.whatItShows ||
          `Visual explanation connected to ${title}.`,
        extractedText: payload.visualExplanation,
        keyPoints: payload.visualExplanation.stepsOrParts || [],
        tags: ["visual", "diagram", "example"],
        qualityScore: 0.78,
        confidence: 0.78,
        metadata: { resourceKind: "visual_explanation" },
      })
    );
  }

  return resources;
}

async function loadTreeAndNode({ treeId = "", nodeId = "", deviceId = "", userId = "" } = {}) {
  const treeQuery = { _id: treeId };
  if (clean(deviceId)) treeQuery.deviceId = clean(deviceId);
  if (clean(userId)) treeQuery.$or = [{ userId: clean(userId) }, { userId: "" }];

  const nodeQuery = { _id: nodeId, treeId };
  if (clean(deviceId)) nodeQuery.deviceId = clean(deviceId);

  const [tree, node] = await Promise.all([
    LearningTree.findOne(treeQuery),
    LearningNode.findOne(nodeQuery),
  ]);

  if (!tree) throw new Error("Learning tree not found.");
  if (!node) throw new Error("Learning node not found.");

  return { tree, node };
}

export async function generatePdfNodeInternalResources({
  treeId = "",
  nodeId = "",
  deviceId = "",
  userId = "",
  allNodes = [],
  force = false,
} = {}) {
  if (!clean(treeId)) throw new Error("treeId is required.");
  if (!clean(nodeId)) throw new Error("nodeId is required.");

  const { tree, node } = await loadTreeAndNode({ treeId, nodeId, deviceId, userId });

  if (!force && node.resourceStatus === "generated") {
    const existing = await LearningResource.find({ treeId, nodeId }).sort({ createdAt: 1 });
    if (existing.length) {
      return {
        generated: false,
        cached: true,
        resources: existing,
        node,
      };
    }
  }

  node.resourceStatus = "generating";
  node.resourceGenerationStartedAt = new Date();
  node.resourceGenerationError = "";
  await node.save();

  const context = await buildPdfContextBundle({
    tree,
    node,
    allNodes,
  });

  const fallback = fallbackInternalResourcePayload({ tree, node, context });
  const prompt = buildInternalResourcesPrompt({ tree, node, context });

  let aiPayload = null;

  try {
    aiPayload = await callOllamaJson(prompt, fallback, {
      temperature: Number(process.env.CONNECT_LEARNING_RESOURCE_TEMPERATURE || 0.1),
      timeoutMs: Number(process.env.CONNECT_LEARNING_NODE_RESOURCE_TIMEOUT_MS || 900000),
      numPredict: Number(process.env.CONNECT_LEARNING_NODE_RESOURCE_NUM_PREDICT || 2600),
      model: process.env.CONNECT_LEARNING_FAST_MODEL || process.env.OLLAMA_CLOUD_MODEL,
    });
  } catch (error) {
    const requireCloud = String(process.env.CONNECT_LEARNING_REQUIRE_CLOUD_RESOURCES || "").toLowerCase() === "true";

    if (requireCloud) {
      node.resourceStatus = "failed";
      node.resourceGenerationError = error.message || String(error);
      await node.save();
      throw error;
    }

    aiPayload = fallback;
  }

  const payload = normalizePayload(aiPayload, fallback);

  const resources = await saveInternalResources({
    tree,
    node,
    context,
    payload,
  });

  node.learningCard = {
    whatItMeans: payload.learningCard.whatItMeans,
    whyItMatters: payload.learningCard.whyItMatters,
    beforeThis: payload.learningCard.beforeThis,
    afterThis: payload.learningCard.afterThis,
    examplesFromPdf: payload.learningCard.examplesFromPdf,
    commonMistakes: payload.learningCard.commonMistakes,
    howItConnects: payload.learningCard.howItConnects,
  };

  node.resourceStatus = "generated";
  node.resourceGenerationCompletedAt = new Date();
  node.resourceGenerationError = "";
  node.resourceCount = resources.length;
  await node.save();

  await LearningTree.updateOne(
    { _id: tree._id },
    {
      $set: {
        resourceCount: await LearningResource.countDocuments({ treeId: tree._id }),
      },
    }
  );

  return {
    generated: true,
    cached: false,
    resources,
    payload,
    context,
    node,
  };
}

export default {
  generatePdfNodeInternalResources,
};