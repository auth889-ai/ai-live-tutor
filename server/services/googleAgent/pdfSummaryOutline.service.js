"use strict";

/**
 * pdfSummaryOutline.service.js
 * ────────────────────────────
 * POWERFUL_WORKFLOW Phase 0.9 — generated ONCE per PDF at upload:
 *   fullPdfSummary: what the whole document teaches
 *   fullPdfOutline: chapter/section/page map
 * Saved on resource.metadata → attached to EVERY downstream agent payload
 * (richSourcePackAssembler already reads metadata.fullPdfSummary/Outline).
 *
 * Uses Gemini REST with responseSchema — guaranteed valid JSON (Golden Rule #3).
 */

const {
  GoogleLiveTutorResource,
  GoogleLiveTutorResourceChunk,
} = require("../../models/GoogleLiveTutorResource");

const MODEL = process.env.GEMINI_PRO_MODEL || "gemini-2.5-pro";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    fullPdfSummary: {
      type: "object",
      properties: {
        title: { type: "string" },
        overview: { type: "string", description: "What this document teaches, 3-6 sentences" },
        mainTopics: { type: "array", items: { type: "string" } },
        targetAudience: { type: "string" },
        documentType: { type: "string", description: "textbook | slides | paper | notes | manual" },
      },
      required: ["title", "overview", "mainTopics"],
    },
    fullPdfOutline: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              startPage: { type: "integer" },
              endPage: { type: "integer" },
              summary: { type: "string" },
            },
            required: ["heading", "startPage", "endPage"],
          },
        },
      },
      required: ["sections"],
    },
  },
  required: ["fullPdfSummary", "fullPdfOutline"],
};

function apiKey() {
  const key =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return key;
}

async function callGeminiStructured(prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}` +
    `:generateContent?key=${apiKey()}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini summary call failed ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  if (!text) throw new Error("Gemini summary call returned empty response");
  return JSON.parse(text); // schema-enforced — parse is safe
}

/**
 * Generate + save fullPdfSummary and fullPdfOutline for a resource.
 * Idempotent: skips when already present unless force=true.
 */
async function generatePdfSummaryOutline(resourceId, { force = false } = {}) {
  const resource = await GoogleLiveTutorResource.findOne({ resourceId });
  if (!resource) throw new Error(`Resource not found: ${resourceId}`);

  const meta = resource.metadata || {};
  if (!force && meta.fullPdfSummary?.overview && meta.fullPdfOutline?.sections?.length) {
    return { ok: true, resourceId, skipped: true };
  }

  const chunks = await GoogleLiveTutorResourceChunk.find({ resourceId })
    .sort({ page: 1, chunkIndex: 1 })
    .select("page text textPreview heading")
    .lean();
  if (!chunks.length) throw new Error(`No chunks for resource ${resourceId}`);

  const maxPage = Math.max(...chunks.map((c) => Number(c.page) || 1));

  // Whole document, bounded per chunk so even big PDFs fit comfortably.
  const perChunk = Math.max(300, Math.floor(220000 / chunks.length));
  const docText = chunks
    .map((c) => `[Page ${c.page}] ${(c.text || c.textPreview || "").slice(0, perChunk)}`)
    .join("\n\n");

  const prompt = `You are analyzing a ${maxPage}-page educational document.
Produce its full summary and a section-by-section outline with REAL page numbers (1-${maxPage}).
Base everything ONLY on the text below — never invent sections that are not present.

DOCUMENT TEXT:
${docText}`;

  const result = await callGeminiStructured(prompt);

  resource.metadata = {
    ...meta,
    fullPdfSummary: result.fullPdfSummary,
    fullPdfOutline: result.fullPdfOutline,
    summaryGeneratedAt: new Date().toISOString(),
    summaryModel: MODEL,
  };
  resource.markModified("metadata");
  await resource.save();

  return {
    ok: true,
    resourceId,
    skipped: false,
    title: result.fullPdfSummary?.title,
    sectionCount: result.fullPdfOutline?.sections?.length || 0,
  };
}

module.exports = { generatePdfSummaryOutline };
