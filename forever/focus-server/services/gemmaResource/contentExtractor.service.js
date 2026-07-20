// server/services/gemmaResource/contentExtractor.service.js

import fs from "fs/promises";
import path from "path";
import axios from "axios";
import pdfParse from "pdf-parse";

import {
  detectGemmaResourceSource,
  getDefaultTitleForSource,
  getDomain,
  getYouTubeVideoId,
} from "./sourceDetector.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function cleanSpace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const MAX_FETCH_CHARS = numberEnv("GEMMA_RESOURCE_MAX_FETCH_CHARS", 220000);
const FETCH_TIMEOUT_MS = numberEnv("GEMMA_RESOURCE_FETCH_TIMEOUT_MS", 45000);

function clampText(text = "", maxChars = MAX_FETCH_CHARS) {
  const value = String(text || "");
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars);
}

function extensionOf(file = null) {
  const name = file?.originalname || file?.filename || file?.name || "";
  return path.extname(name).toLowerCase();
}

function stripHtml(html = "") {
  const raw = String(html || "");

  return cleanSpace(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
      .replace(/<form[\s\S]*?<\/form>/gi, " ")
      .replace(/<button[\s\S]*?<\/button>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&rsquo;/g, "’")
      .replace(/&lsquo;/g, "‘")
      .replace(/&rdquo;/g, "”")
      .replace(/&ldquo;/g, "“")
  );
}

function extractTitleFromHtml(html = "", fallback = "Saved Webpage") {
  const titleMatch = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (titleMatch?.[1]) {
    return cleanSpace(titleMatch[1]).slice(0, 180);
  }

  const h1Match = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  if (h1Match?.[1]) {
    return cleanSpace(stripHtml(h1Match[1])).slice(0, 180);
  }

  return fallback;
}

function secondsToTimestamp(value = 0) {
  const total = Math.max(0, Number(value || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return `${m}:${String(s).padStart(2, "0")}`;
}

function normalizeTranscriptSegments(rawSegments = []) {
  if (!Array.isArray(rawSegments)) return [];

  return rawSegments
    .map((segment, index) => {
      const startSeconds = Number(
        segment.startSeconds ??
          segment.start ??
          segment.offset ??
          segment.time ??
          segment.startTime ??
          0
      );

      const durationSeconds = Number(
        segment.durationSeconds ?? segment.duration ?? segment.dur ?? 8
      );

      const endSeconds = Number(
        segment.endSeconds ??
          segment.end ??
          startSeconds + (Number.isFinite(durationSeconds) ? durationSeconds : 8)
      );

      const text = cleanSpace(
        segment.text || segment.caption || segment.content || segment.line || ""
      );

      return {
        index,
        startSeconds: Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : 0,
        endSeconds: Number.isFinite(endSeconds)
          ? Math.max(startSeconds + 1, endSeconds)
          : startSeconds + 8,
        timestampStart: secondsToTimestamp(startSeconds),
        timestampEnd: secondsToTimestamp(endSeconds),
        text,
      };
    })
    .filter((segment) => segment.text);
}

function transcriptTextFromSegments(segments = []) {
  return normalizeTranscriptSegments(segments)
    .map((segment) => `[${segment.timestampStart}] ${segment.text}`)
    .join("\n");
}

async function tryExistingYoutubeTranscriptService(url = "") {
  const candidates = [
    "../youtubeTranscript.service.js",
    "../goodContent/youtubeTranscript.service.js",
    "../../youtubeTranscript.service.js",
  ];

  let lastError = null;

  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);

      const fn =
        mod.getYouTubeTranscript ||
        mod.fetchYouTubeTranscript ||
        mod.extractYouTubeTranscript ||
        mod.getTranscript ||
        mod.default;

      if (typeof fn !== "function") continue;

      const result = await fn(url);

      if (!result) continue;

      const segments = normalizeTranscriptSegments(
        result.segments ||
          result.transcript ||
          result.items ||
          result.captions ||
          []
      );

      const text =
        segments.length > 0
          ? transcriptTextFromSegments(segments)
          : clean(result.text || result.transcriptText || result.fullText || "");

      if (!text) continue;

      return {
        title: clean(result.title || "Saved YouTube Video"),
        text,
        transcriptSegments: segments,
        durationSeconds: Number(result.durationSeconds || result.duration || 0),
        metadata: {
          transcriptProvider: "existing-service",
          servicePath: candidate,
          videoId: result.videoId || getYouTubeVideoId(url),
          rawSource: result.source || "",
        },
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    return {
      error: lastError.message || String(lastError),
    };
  }

  return null;
}

async function tryYoutubeTranscriptPackage(url = "") {
  try {
    const mod = await import("youtube-transcript");

    const YoutubeTranscript =
      mod.YoutubeTranscript || mod.default?.YoutubeTranscript || mod.default;

    if (!YoutubeTranscript?.fetchTranscript) {
      return null;
    }

    const videoId = getYouTubeVideoId(url) || url;
    const raw = await YoutubeTranscript.fetchTranscript(videoId);

    const segments = normalizeTranscriptSegments(
      raw.map((item) => ({
        text: item.text,
        start: Number(item.offset || item.start || 0) / (Number(item.offset) > 10000 ? 1000 : 1),
        duration: Number(item.duration || 8) / (Number(item.duration) > 10000 ? 1000 : 1),
      }))
    );

    const text = transcriptTextFromSegments(segments);

    if (!text) return null;

    return {
      title: "Saved YouTube Video",
      text,
      transcriptSegments: segments,
      durationSeconds: segments.at(-1)?.endSeconds || 0,
      metadata: {
        transcriptProvider: "youtube-transcript-package",
        videoId,
      },
    };
  } catch (error) {
    return {
      error: error.message || String(error),
    };
  }
}

async function extractYouTube({ url = "", title = "", studyGoal = "" } = {}) {
  const videoId = getYouTubeVideoId(url);

  const existing = await tryExistingYoutubeTranscriptService(url);

  let result = existing;

  if (!result || !result.text) {
    const fromPackage = await tryYoutubeTranscriptPackage(url);
    if (fromPackage?.text) result = fromPackage;
  }

  if (!result || !result.text) {
    throw new Error(
      "Could not fetch YouTube transcript. Open captions/transcript may be unavailable for this video."
    );
  }

  const finalTitle =
    clean(title) ||
    clean(result.title) ||
    (videoId ? `YouTube Video ${videoId}` : "Saved YouTube Video");

  return {
    title: finalTitle,
    sourceType: "youtube",
    sourceUrl: url,
    domain: "youtube.com",
    text: clampText(result.text),
    transcriptSegments: result.transcriptSegments || [],
    pages: [],
    pageCount: 0,
    durationSeconds: Number(result.durationSeconds || 0),
    studyGoal,
    metadata: {
      videoId,
      ...(result.metadata || {}),
      transcriptError: result.error || "",
    },
  };
}

async function extractWebpage({ url = "", title = "", studyGoal = "" } = {}) {
  const response = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: 15 * 1024 * 1024,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; GemmaResourceTutor/1.0; +offline-study)",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
    },
    validateStatus(status) {
      return status >= 200 && status < 400;
    },
  });

  const contentType = response.headers?.["content-type"] || "";
  const raw = String(response.data || "");

  const extractedText = contentType.includes("text/plain")
    ? clean(raw)
    : stripHtml(raw);

  const text = clampText(extractedText);

  if (text.length < 80) {
    throw new Error("Could not extract enough readable text from this webpage.");
  }

  const domain = getDomain(url);

  return {
    title: clean(title) || extractTitleFromHtml(raw, domain || "Saved Webpage"),
    sourceType: "webpage",
    sourceUrl: url,
    domain,
    text,
    transcriptSegments: [],
    pages: [],
    pageCount: 0,
    durationSeconds: 0,
    studyGoal,
    metadata: {
      status: response.status,
      contentType,
      fetchedAt: new Date().toISOString(),
    },
  };
}

function splitPdfTextIntoPages(text = "") {
  const raw = String(text || "");

  const formFeedPages = raw
    .split(/\f/g)
    .map((pageText, index) => ({
      pageNumber: index + 1,
      text: clean(pageText),
    }))
    .filter((page) => page.text);

  if (formFeedPages.length > 1) return formFeedPages;

  return [
    {
      pageNumber: 1,
      text: clean(raw),
    },
  ].filter((page) => page.text);
}

async function extractPdf({ file = null, title = "", studyGoal = "" } = {}) {
  if (!file?.path) {
    throw new Error("PDF file path is missing.");
  }

  const buffer = await fs.readFile(file.path);
  const parsed = await pdfParse(buffer);

  const rawText = clean(parsed.text || "");

  if (!rawText) {
    throw new Error(
      "Could not extract text from this PDF. Scanned PDF OCR will be added in a later step."
    );
  }

  const pages = splitPdfTextIntoPages(rawText);
  const pageCount = Number(parsed.numpages || pages.length || 0);

  const originalName = file.originalname || file.filename || "Saved PDF";

  return {
    title: clean(title) || originalName.replace(/\.[^.]+$/, ""),
    sourceType: "pdf",
    sourceUrl: "",
    domain: "",
    text: clampText(rawText),
    transcriptSegments: [],
    pages,
    pageCount,
    durationSeconds: 0,
    studyGoal,
    originalFileName: originalName,
    mimeType: file.mimetype || "application/pdf",
    metadata: {
      fileName: originalName,
      filePath: file.path,
      size: file.size || 0,
      pdfInfo: parsed.info || {},
      pdfMetadata: parsed.metadata || {},
      parsedPages: pageCount,
    },
  };
}

async function extractTextLikeFile({
  file = null,
  title = "",
  studyGoal = "",
  sourceType = "notes",
} = {}) {
  if (!file?.path) {
    throw new Error("Uploaded file path is missing.");
  }

  const buffer = await fs.readFile(file.path);
  const text = clampText(buffer.toString("utf8"));

  if (!text) {
    throw new Error("Uploaded file is empty.");
  }

  const originalName = file.originalname || file.filename || "Uploaded Resource";

  return {
    title: clean(title) || originalName.replace(/\.[^.]+$/, ""),
    sourceType,
    sourceUrl: "",
    domain: "",
    text,
    transcriptSegments: [],
    pages: [],
    pageCount: 0,
    durationSeconds: 0,
    studyGoal,
    originalFileName: originalName,
    mimeType: file.mimetype || "",
    metadata: {
      fileName: originalName,
      filePath: file.path,
      ext: extensionOf(file),
      size: file.size || 0,
    },
  };
}

async function extractPastedText({
  text = "",
  title = "",
  studyGoal = "",
  sourceType = "notes",
  url = "",
} = {}) {
  const cleanText = clampText(text);

  if (!cleanText) {
    throw new Error("No text, URL, or file was provided.");
  }

  return {
    title:
      clean(title) ||
      getDefaultTitleForSource({
        sourceType,
        url,
        text: cleanText,
      }),
    sourceType,
    sourceUrl: "",
    domain: "",
    text: cleanText,
    transcriptSegments: [],
    pages: [],
    pageCount: 0,
    durationSeconds: 0,
    studyGoal,
    metadata: {
      inputType: "pasted-text",
      chars: cleanText.length,
    },
  };
}

export async function extractGemmaResourceContent({
  input = {},
  file = null,
} = {}) {
  const url = clean(input.url || input.sourceUrl || "");
  const text = clean(input.text || input.content || input.notes || input.pastedText || "");
  const title = clean(input.title || "");
  const studyGoal = clean(input.studyGoal || input.goal || "");
  const requestedSourceType = clean(input.sourceType || "");

  const detection = detectGemmaResourceSource({
    sourceType: requestedSourceType,
    url,
    text,
    file,
  });

  const sourceType = detection.sourceType;

  if (sourceType === "youtube") {
    if (!url) throw new Error("YouTube URL is required.");
    return extractYouTube({ url, title, studyGoal });
  }

  if (sourceType === "webpage") {
    if (!url) throw new Error("Webpage URL is required.");
    return extractWebpage({ url, title, studyGoal });
  }

  if (sourceType === "pdf") {
    return extractPdf({ file, title, studyGoal });
  }

  if (file) {
    return extractTextLikeFile({
      file,
      title,
      studyGoal,
      sourceType: sourceType === "code" ? "code" : "notes",
    });
  }

  return extractPastedText({
    text,
    title,
    studyGoal,
    sourceType: sourceType === "code" ? "code" : "notes",
    url,
  });
}