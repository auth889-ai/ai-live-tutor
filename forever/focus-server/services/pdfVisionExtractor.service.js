// server/services/pdfVisionExtractor.service.js
import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const execFileAsync = promisify(execFile);

function clean(value = "") {
  return String(value || "").trim();
}

function safeText(value = "", max = 20000) {
  const text = String(value || "").replace(/\u0000/g, "");
  return text.length > max ? text.slice(0, max) : text;
}

function boolEnv(name, fallback = false) {
  const raw = clean(process.env[name]).toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function numberEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args, timeout = 180000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
    };
  }
}

function splitPagesFromPdfText(text = "") {
  const normalized = String(text || "").replace(/\r/g, "");
  const pages = normalized
    .split("\f")
    .map((x) => x.trim())
    .filter(Boolean);

  return pages.length > 1 ? pages : [normalized.trim()].filter(Boolean);
}

async function renderPageToPng(pdfPath, outDir, pageNumber, dpi) {
  const prefix = path.join(outDir, `page-${pageNumber}`);

  const result = await runCommand(
    "pdftoppm",
    [
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      "-r",
      String(dpi),
      "-png",
      pdfPath,
      prefix,
    ],
    240000
  );

  const normal = `${prefix}-${pageNumber}.png`;
  const alt = `${prefix}-1.png`;

  if (await exists(normal)) return normal;
  if (await exists(alt)) return alt;

  if (!result.ok) {
    console.warn(`[pdfVisionExtractor] pdftoppm failed page=${pageNumber}:`, result.stderr);
  }

  return "";
}

async function countEmbeddedImages(pdfPath, pageNumber) {
  const result = await runCommand(
    "pdfimages",
    ["-f", String(pageNumber), "-l", String(pageNumber), "-list", pdfPath],
    120000
  );

  if (!result.ok) return 0;

  return result.stdout.split("\n").filter((line) => /^\s*\d+\s+/.test(line)).length;
}

async function runOcr(imagePath, lang = "eng") {
  if (!imagePath) return "";

  const result = await runCommand(
    "tesseract",
    [imagePath, "stdout", "-l", lang, "--psm", "6"],
    240000
  );

  if (!result.ok) {
    console.warn("[pdfVisionExtractor] tesseract failed:", result.stderr);
    return "";
  }

  return safeText(result.stdout, 30000);
}

async function copyIfNeeded(src, destDir, fileName) {
  if (!src) return "";
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, fileName);
  await fs.copyFile(src, dest);
  return dest;
}

function textDensity(text = "") {
  const raw = String(text || "");
  if (!raw.trim()) return 0;
  const alphaNum = (raw.match(/[a-z0-9]/gi) || []).length;
  return alphaNum / Math.max(raw.length, 1);
}

function isMostlyNormalText({ selectableText = "", ocrText = "" }) {
  const text = `${selectableText}\n${ocrText}`.trim();
  if (!text) return false;

  const lineCount = text.split(/\n+/).filter((line) => line.trim().length > 6).length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const density = textDensity(text);

  const visualSignals =
    /[→⇒➜➔↔↓↑]|\b(diagram|flowchart|workflow|architecture|pipeline|chart|graph|figure|table|screenshot|terminal|console|code|api|npm|localhost)\b/i.test(
      text
    );

  return wordCount >= 90 && lineCount >= 5 && density > 0.45 && !visualSignals;
}

function classifyVisualCandidate({
  pageNumber,
  selectableText = "",
  ocrText = "",
  imageCount = 0,
}) {
  const joined = `${selectableText}\n${ocrText}`.toLowerCase();
  const reasons = [];
  const hints = [];

  const hasText = Boolean(clean(selectableText) || clean(ocrText));
  const wordCount = joined.split(/\s+/).filter(Boolean).length;

  if (!hasText && imageCount === 0) {
    return {
      hasVisualCandidate: false,
      visualTypeGuess: "blank",
      shouldOcr: false,
      skipReason: "blank_or_unreadable_page",
      reasons: [],
      visualHints: [],
      isNormalTextPage: false,
    };
  }

  if (isMostlyNormalText({ selectableText, ocrText }) && imageCount === 0) {
    return {
      hasVisualCandidate: false,
      visualTypeGuess: "normal_text",
      shouldOcr: false,
      skipReason: "normal_text_page",
      reasons: ["page is mostly normal selectable/OCR text"],
      visualHints: [],
      isNormalTextPage: true,
    };
  }

  if (imageCount > 0) reasons.push("embedded image object found");

  if (/\b(diagram|flowchart|workflow|architecture|pipeline|process flow)\b/i.test(joined)) {
    reasons.push("diagram/workflow keyword detected");
    hints.push("diagram", "workflow");
  }

  if (/\b(chart|graph|axis|plot|bar chart|pie chart|line chart)\b/i.test(joined)) {
    reasons.push("chart/graph keyword detected");
    hints.push("chart", "graph");
  }

  if (/\b(table|row|column|matrix)\b/i.test(joined)) {
    reasons.push("table keyword detected");
    hints.push("table");
  }

  if (/[→⇒➜➔↔↓↑]/.test(joined) || /\b(step|process|flow|from|to|then)\b/i.test(joined)) {
    reasons.push("flow/arrow-like content detected");
    hints.push("process", "flow");
  }

  if (/\b(screenshot|terminal|console|localhost|http|api|npm|node|python|function|const|import|error)\b/i.test(joined)) {
    reasons.push("screenshot/code-like content detected");
    hints.push("screenshot", "code");
  }

  let visualTypeGuess = "none";

  if (/\b(table|row|column|matrix)\b/i.test(joined)) {
    visualTypeGuess = "table";
  } else if (/\b(chart|graph|axis|plot|bar chart|pie chart|line chart)\b/i.test(joined)) {
    visualTypeGuess = "chart";
  } else if (
    /\b(diagram|flowchart|workflow|architecture|pipeline|process flow)\b/i.test(joined) ||
    /[→⇒➜➔↔↓↑]/.test(joined)
  ) {
    visualTypeGuess = "diagram_or_workflow";
  } else if (
    /\b(screenshot|terminal|console|localhost|http|api|npm|node|python|function|const|import|error)\b/i.test(joined)
  ) {
    visualTypeGuess = "screenshot_or_code";
  } else if (imageCount > 0 && wordCount < 180) {
    visualTypeGuess = "image_candidate";
  }

  const decorationOnly =
    imageCount > 0 &&
    wordCount < 18 &&
    /\b(logo|copyright|department|university|confidential|slide|page)\b/i.test(joined) &&
    !/\b(diagram|workflow|chart|graph|table|screenshot|code|architecture)\b/i.test(joined);

  if (decorationOnly) {
    return {
      hasVisualCandidate: false,
      visualTypeGuess: "decoration_or_logo",
      shouldOcr: false,
      skipReason: "decoration_logo_background",
      reasons: ["looks like logo/cover/decoration only"],
      visualHints: hints,
      isNormalTextPage: false,
    };
  }

  const hasVisualCandidate = visualTypeGuess !== "none" && reasons.length > 0;

  return {
    hasVisualCandidate,
    visualTypeGuess: hasVisualCandidate ? visualTypeGuess : "none",
    shouldOcr: false,
    skipReason: hasVisualCandidate ? "" : "no_meaningful_visual_signal",
    reasons,
    visualHints: [...new Set(hints)].filter(Boolean),
    isNormalTextPage: false,
  };
}

function chunkPage({ pageNumber, text = "", ocrText = "" }, size, overlap) {
  const merged = [
    text ? `[PDF PAGE ${pageNumber} TEXT]\n${text}` : "",
    ocrText ? `[PDF PAGE ${pageNumber} OCR]\n${ocrText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!merged.trim()) return [];

  const chunks = [];
  let start = 0;
  let index = 1;

  while (start < merged.length) {
    const end = Math.min(start + size, merged.length);

    chunks.push({
      chunkId: `p${pageNumber}_c${index}`,
      pageNumber,
      pageStart: pageNumber,
      pageEnd: pageNumber,
      type: "text",
      source: "pdf",
      text: merged.slice(start, end),
      textChars: end - start,
    });

    if (end >= merged.length) break;

    start = Math.max(0, end - overlap);
    index += 1;
  }

  return chunks;
}

export async function extractPdfWithVisionAndOCR({
  buffer = null,
  filePath = "",
  fileName = "uploaded.pdf",
  studyGoal = "",
  deviceId = "",
  jobId = "",
} = {}) {
  if (!buffer && !filePath) {
    throw new Error("PDF buffer or filePath is required.");
  }

  if (!buffer && filePath) {
    buffer = await fs.readFile(filePath);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "connect-learning-pdf-"));
  const safeFileName = fileName.replace(/[^a-z0-9_.-]/gi, "_") || "source.pdf";
  const pdfPath = path.join(tempDir, safeFileName);

  const dpi = numberEnv("CONNECT_LEARNING_PDF_RENDER_DPI", 110);
  const maxRenderPages = numberEnv("CONNECT_LEARNING_MAX_RENDER_PAGES", 80);
  const maxOcrPages = numberEnv("CONNECT_LEARNING_MAX_OCR_PAGES", 20);
  const enableOcr = boolEnv("CONNECT_LEARNING_ENABLE_PDF_OCR", true);
  const ocrOnlyLowTextOrImage = boolEnv("CONNECT_LEARNING_OCR_ONLY_LOW_TEXT_OR_IMAGE", true);
  const lang = clean(process.env.CONNECT_LEARNING_OCR_LANG) || "eng";
  const chunkSize = numberEnv("CONNECT_LEARNING_CHUNK_SIZE", 9000);
  const chunkOverlap = numberEnv("CONNECT_LEARNING_CHUNK_OVERLAP", 900);
  const fullTextLimit = numberEnv("CONNECT_LEARNING_FULL_TEXT_LIMIT", 90000);
  const keepRenderedCandidates = boolEnv("CONNECT_LEARNING_KEEP_VISUAL_CANDIDATE_IMAGES", true);
  const renderAllThumbnails = boolEnv("CONNECT_LEARNING_RENDER_ALL_THUMBNAILS", false);

  const visualBaseDir = path.resolve(
    process.env.CONNECT_LEARNING_UPLOAD_DIR || "uploads/connect-learning/pdf-visuals"
  );

  const visualJobDir = path.join(
    visualBaseDir,
    clean(jobId) || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  await fs.writeFile(pdfPath, buffer);

  const parsed = await pdfParse(buffer).catch((error) => {
    console.warn("[pdfVisionExtractor] pdf-parse failed:", error.message);
    return { text: "", numpages: 0, info: {}, metadata: null };
  });

  const rawPages = splitPagesFromPdfText(parsed.text || "");
  const pageCount = Math.max(Number(parsed.numpages || 0), rawPages.length, 1);

  const pages = [];
  const chunks = [];
  const visualCandidates = [];
  const pageImages = [];

  let ocrUsed = 0;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const selectableText = safeText(rawPages[pageNumber - 1] || "", 40000);
    const imageCount = pageNumber <= maxRenderPages ? await countEmbeddedImages(pdfPath, pageNumber) : 0;

    let renderedImagePath = "";
    let ocrText = "";
    const lowText = selectableText.trim().length < 250;
    const shouldTryRender =
      pageNumber <= maxRenderPages &&
      (renderAllThumbnails || lowText || imageCount > 0 || /diagram|chart|table|workflow|figure/i.test(selectableText));

    if (shouldTryRender) {
      renderedImagePath = await renderPageToPng(pdfPath, tempDir, pageNumber, dpi);
    }

    const shouldOcr =
      enableOcr &&
      renderedImagePath &&
      ocrUsed < maxOcrPages &&
      (!ocrOnlyLowTextOrImage || lowText || imageCount > 0);

    if (shouldOcr) {
      ocrText = await runOcr(renderedImagePath, lang);
      if (ocrText.trim()) ocrUsed += 1;
    }

    const visualInfo = classifyVisualCandidate({
      pageNumber,
      selectableText,
      ocrText,
      imageCount,
    });

    let savedImagePath = "";
    if (keepRenderedCandidates && renderedImagePath && visualInfo.hasVisualCandidate) {
      savedImagePath = await copyIfNeeded(renderedImagePath, visualJobDir, `page-${pageNumber}.png`);
      pageImages.push({
        pageNumber,
        imagePath: savedImagePath,
        publicPath: savedImagePath.replace(process.cwd(), "").replace(/\\/g, "/"),
      });
    }

    const page = {
      pageNumber,
      text: selectableText,
      ocrText,
      mergedText: safeText(`${selectableText}\n${ocrText}`.trim(), 50000),
      imageCount,
      extractionMethod: ocrText ? "mixed" : selectableText ? "text" : "empty",
      hasVisualCandidate: visualInfo.hasVisualCandidate,
      visualTypeGuess: visualInfo.visualTypeGuess,
      visualCandidates: visualInfo.hasVisualCandidate
        ? [
            {
              page: pageNumber,
              pageNumber,
              type: visualInfo.visualTypeGuess,
              reasons: visualInfo.reasons,
              hints: visualInfo.visualHints,
              imagePath: savedImagePath,
              confidence: visualInfo.reasons.length >= 2 ? 0.8 : 0.65,
              explained: false,
            },
          ]
        : [],
      skipReason: visualInfo.skipReason,
      isNormalTextPage: visualInfo.isNormalTextPage,
    };

    pages.push(page);

    if (page.visualCandidates.length) {
      visualCandidates.push(...page.visualCandidates);
    }

    const pageChunks = chunkPage(
      {
        pageNumber,
        text: selectableText,
        ocrText,
      },
      chunkSize,
      chunkOverlap
    ).map((chunk) => ({
      ...chunk,
      visualCandidates: page.visualCandidates,
    }));

    chunks.push(...pageChunks);
  }

  const fullText = safeText(
    pages
      .map((page) => {
        const text = page.mergedText || page.text || "";
        return text ? `[PAGE ${page.pageNumber}]\n${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n"),
    fullTextLimit
  );

  const titleGuess =
    clean(parsed.info?.Title) ||
    clean(
      pages
        .flatMap((page) => (page.mergedText || "").split(/\n+/).map((line) => clean(line)))
        .find((line) => line.length > 8 && line.length < 140)
    ) ||
    fileName.replace(/\.pdf$/i, "");

  const extraction = {
    ok: true,
    sourceType: "pdf",
    fileName,
    titleGuess,
    studyGoal,
    deviceId,
    pageCount,
    text: fullText,
    fullText,
    textCharCount: fullText.length,
    pages: pages.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text,
      ocrText: page.ocrText,
      mergedText: page.mergedText,
      charCount: (page.mergedText || "").length,
      extractionMethod: page.extractionMethod,
      imageCount: page.imageCount,
      hasVisualCandidate: page.hasVisualCandidate,
      visualTypeGuess: page.visualTypeGuess,
      visualCandidates: page.visualCandidates,
      skipReason: page.skipReason,
      isNormalTextPage: page.isNormalTextPage,
    })),
    chunks,
    visualCandidates,
    pageImages,
    stats: {
      pageCount,
      chunkCount: chunks.length,
      visualCandidateCount: visualCandidates.length,
      ocrPages: ocrUsed,
      textChars: fullText.length,
      selectablePages: pages.filter((page) => clean(page.text)).length,
      emptyPages: pages.filter((page) => !clean(page.mergedText)).length,
    },
  };

  if (!chunks.length && !fullText.trim()) {
    extraction.ok = false;
    extraction.warning = "No extractable text found. Try enabling OCR dependencies.";
  }

  return extraction;
}

export default {
  extractPdfWithVisionAndOCR,
};