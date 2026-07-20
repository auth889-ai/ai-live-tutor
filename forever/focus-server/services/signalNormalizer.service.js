import { studyRuntimeConfig } from "../config/studyRuntime.config.js";

/**
 * File purpose:
 * Normalizes all signals from extension/mobile before AI sees them.
 *
 * Preserves old features:
 * - accepts old raw shape
 * - accepts page object shape
 * - accepts behavior fields
 *
 * Completes missing Feature 1 parts:
 * - blank page handling
 * - PDF handling
 * - iframe detection
 * - SPA routing detection
 * - restricted page detection
 * - large page trim
 */
function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(text = "", max = studyRuntimeConfig.maxTextChars || 12000) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function getDomain(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function detectEdgeCase(page = {}, raw = {}) {
  const url = String(page.url || "");
  const title = cleanText(page.title || "", 500);
  const text = cleanText(page.visibleText || page.text || "", 3000);

  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const protocol = lowerUrl.split(":")[0];

  const isPdf =
    lowerUrl.includes(".pdf") ||
    lowerTitle.endsWith(".pdf") ||
    raw.contentType === "application/pdf";

  const isBlank = !title && text.length < 20;

  const isRestricted = ["chrome", "edge", "about", "moz-extension", "chrome-extension"].includes(
    protocol
  );

  const hasIframes =
    safeNumber(raw.behavior?.iframeCount ?? raw.iframeCount) > 0;

  const isSpa = Boolean(
    raw.behavior?.routeChanges ||
      raw.routeChanges ||
      raw.client?.isSpa
  );

  let edgeCase = "normal";

  if (isRestricted) edgeCase = "restricted";
  else if (isPdf) edgeCase = "pdf";
  else if (isBlank) edgeCase = "blank";
  else if (hasIframes) edgeCase = "iframe";
  else if (isSpa) edgeCase = "spa";

  return {
    isPdf,
    isBlank,
    isRestricted,
    hasIframes,
    isSpa,
    edgeCase,
  };
}

export function normalizeSignal(raw = {}) {
  const page = raw.page || raw;
  const behavior = raw.behavior || {};
  const max = studyRuntimeConfig.maxTextChars || 12000;

  const rawText = String(page.visibleText || page.text || "");
  const edge = detectEdgeCase(page, raw);

  return {
    userId: String(raw.userId || raw.user?._id || raw.user?.id || "").trim(),
    deviceId: String(raw.deviceId || "").trim(),
    goal: String(raw.goal || raw.goalText || raw.currentGoal || "").trim(),

    page: {
      url: String(page.url || ""),
      domain: String(page.domain || getDomain(page.url)),
      title: cleanText(page.title || "", 500),

      visibleText: cleanText(rawText, max),

      headings: Array.isArray(page.headings)
        ? page.headings.map((x) => cleanText(x, 300)).slice(0, 30)
        : [],

      paragraphs: Array.isArray(page.paragraphs)
        ? page.paragraphs.map((x) => cleanText(x, 1000)).slice(0, 40)
        : [],

      links: Array.isArray(page.links) ? page.links.slice(0, 40) : [],

      screenshotBase64:
        raw.screenshotBase64 ||
        page.screenshotBase64 ||
        null,

      isBlank: edge.isBlank,
      isPdf: edge.isPdf,
      isRestricted: edge.isRestricted,
      isSpa: edge.isSpa,
      hasIframes: edge.hasIframes,
      textLength: rawText.length,
    },

    behavior: {
      dwellMs: safeNumber(behavior.dwellMs ?? behavior.duration),
      scrollDepth: safeNumber(behavior.scrollDepth),
      scrollSpeed: safeNumber(behavior.scrollSpeed),
      tabSwitches: safeNumber(behavior.tabSwitches ?? behavior.switches),
      idleMs: safeNumber(behavior.idleMs),
      typingCount: safeNumber(behavior.typingCount),
      mouseMoves: safeNumber(behavior.mouseMoves),
      routeChanges: safeNumber(behavior.routeChanges),
      iframeCount: safeNumber(behavior.iframeCount),
      isHidden: Boolean(behavior.isHidden),
    },

    client: {
      sentAt: raw.sentAt || new Date().toISOString(),
      source: raw.source || "chrome-extension",
      batchId: raw.batchId || "",
      signalHash: raw.signalHash || "",
    },

    edgeCase: edge.edgeCase,
  };
}

export function buildPageText(signal) {
  return [
    signal.page.title,
    signal.page.visibleText,
    ...(signal.page.headings || []),
    ...(signal.page.paragraphs || []),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, studyRuntimeConfig.maxTextChars || 12000);
}