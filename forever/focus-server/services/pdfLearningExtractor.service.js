import { createRequire } from "module";
import { extractPdfVisuals } from "./pdfVisualExtractor.service.js";

const require = createRequire(import.meta.url);

// IMPORTANT:
// Never fallback to require("pdf-parse").
// That root import causes:
// ENOENT: ./test/data/05-versions-space.pdf
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function chunkText(text = "", options = {}) {
  const chunkSize = Number(
    options.chunkSize || process.env.CONNECT_LEARNING_CHUNK_SIZE || 4200
  );

  const overlap = Number(
    options.overlap || process.env.CONNECT_LEARNING_CHUNK_OVERLAP || 450
  );

  const value = clean(text);

  if (!value) return [];

  const chunks = [];
  let start = 0;
  let index = 1;

  while (start < value.length) {
    const end = Math.min(start + chunkSize, value.length);

    chunks.push({
      index,
      chunkId: `pdf_chunk_${index}`,
      source: "pdf_text_and_visual",
      pageNumber: 0,
      type: "text",
      start,
      end,
      text: value.slice(start, end),
    });

    if (end >= value.length) break;

    start = Math.max(0, end - overlap);
    index += 1;
  }

  return chunks;
}

export async function extractPdfLearningContent(buffer, options = {}) {
  if (!buffer) {
    throw new Error("PDF buffer is required.");
  }

  const parsed = await pdfParse(buffer);
  const text = clean(parsed?.text || "");

  let visual = {
    ok: false,
    pages: [],
    visualText: "",
    error: "",
  };

  const maxVisualPages = Number(
    process.env.CONNECT_LEARNING_PDF_VISUAL_MAX_PAGES || 0
  );

  if (maxVisualPages > 0) {
    try {
      visual = await extractPdfVisuals(buffer, {
        maxPages: maxVisualPages,
        fileName: options.fileName || "upload.pdf",
      });
    } catch (error) {
      visual = {
        ok: false,
        pages: [],
        visualText: "",
        error: error?.message || String(error),
      };

      console.warn("[pdf] visual skipped:", visual.error);
    }
  }

  const combinedText = [
    text,
    visual.visualText ? `PDF VISUAL / OCR TEXT:\n${visual.visualText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    fileName: clean(options.fileName || ""),
    text,
    combinedText,
    chunks: chunkText(combinedText, options),
    pageCount: Number(parsed?.numpages || 0),
    info: parsed?.info || {},
    metadata: parsed?.metadata || {},
    visual,
  };
}

export default {
  chunkText,
  extractPdfLearningContent,
};