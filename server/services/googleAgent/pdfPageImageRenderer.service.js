"use strict";

/**
 * server/services/googleAgent/pdfPageImageRenderer.service.js
 * =============================================================================
 * FIXED PDF PAGE IMAGE RENDERER
 *
 * PURPOSE:
 * - Upload time-এ PDF-এর every page exact full-page PNG image বানানো।
 * - Gemini Vision পরে selected node-এর source page image দেখতে পারবে।
 *
 * IMPORTANT:
 * - Browser/Puppeteer PDF viewer screenshot disabled.
 * - Chrome PDF viewer screenshot sidebar/toolbar ধরে, same page repeat করে।
 * - তাই browser renderer এখানে intentionally disabled.
 *
 * Correct render order:
 * 1. pdftocairo  -> exact full PDF page PNG
 * 2. pdftoppm    -> fallback exact full PDF page PNG
 *
 * Output:
 * images[] = {
 *   page,
 *   filename,
 *   path,
 *   url,
 *   mimeType,
 *   source,
 *   renderer,
 *   dpi,
 *   quality
 * }
 * =============================================================================
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

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

function cleanText(value, max = 3000) {
  return safeString(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
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

function envNumber(names, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  for (const name of safeArray(names)) {
    const n = Number(process.env[name]);
    if (Number.isFinite(n) && n > 0) {
      return Math.max(min, Math.min(max, Math.floor(n)));
    }
  }
  return fallback;
}

function serverRoot() {
  return path.resolve(__dirname, "../..");
}

function publicRoot() {
  return path.join(serverRoot(), "public");
}

function pageImageBaseDir() {
  return path.join(publicRoot(), "live-tutor-page-images");
}

function publicPageImageUrl(resourceId, filename) {
  return `/live-tutor-page-images/${resourceId}/${filename}`;
}

function imageName(page) {
  return `page-${String(page).padStart(2, "0")}.png`;
}

function slug(value, fallback = "resource") {
  return cleanText(value, 180)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function hashBuffer(buffer, length = 10) {
  return crypto.createHash("sha1").update(buffer).digest("hex").slice(0, length);
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function removeDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timeoutMs = options.timeoutMs || 180000;

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }

      finish({
        ok: false,
        code: -1,
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.on("close", (code) => {
      finish({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        code: -1,
        stdout,
        stderr: error.message,
      });
    });
  });
}

function estimateImageQuality(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const byteLength = stat.size;

    if (byteLength < 10_000) {
      return {
        ok: false,
        score: 0.05,
        reason: `image_too_small_${byteLength}_bytes`,
        byteLength,
      };
    }

    if (byteLength < 40_000) {
      return {
        ok: true,
        score: 0.45,
        reason: "small_page_image",
        byteLength,
      };
    }

    if (byteLength < 100_000) {
      return {
        ok: true,
        score: 0.7,
        reason: "page_image_ok",
        byteLength,
      };
    }

    return {
      ok: true,
      score: 0.92,
      reason: "page_image_good",
      byteLength,
    };
  } catch (error) {
    return {
      ok: false,
      score: 0,
      reason: error.message,
      byteLength: 0,
    };
  }
}

function listPngFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((name) => /\.png$/i.test(name));
  } catch {
    return [];
  }
}

function extractLastNumber(filename) {
  const matches = filename.match(/(\d+)(?=\.png$)/i);
  return matches ? Number(matches[1]) : 0;
}

async function normalizeRenderedFiles({ outDir, resourceId, tool, expectedMaxPages }) {
  const files = listPngFiles(outDir)
    .filter((name) => name.startsWith(`${tool}-page`))
    .sort((a, b) => extractLastNumber(a) - extractLastNumber(b));

  const images = [];

  for (let index = 0; index < files.length; index += 1) {
    const oldName = files[index];
    const detectedNumber = extractLastNumber(oldName);
    const page = detectedNumber > 0 ? detectedNumber : index + 1;

    if (page > expectedMaxPages) continue;

    const normalizedName = imageName(page);
    const oldPath = path.join(outDir, oldName);
    const newPath = path.join(outDir, normalizedName);

    try {
      if (oldPath !== newPath) {
        await fsp.copyFile(oldPath, newPath);
      }
    } catch {
      // If copy fails, use original path.
    }

    const finalPath = fs.existsSync(newPath) ? newPath : oldPath;
    const finalName = path.basename(finalPath);

    images.push({
      page,
      filename: finalName,
      path: finalPath,
      url: publicPageImageUrl(resourceId, finalName),
      mimeType: "image/png",
      source: tool,
      renderer: tool,
      dpi: null,
      quality: estimateImageQuality(finalPath),
    });
  }

  return images.sort((a, b) => Number(a.page || 0) - Number(b.page || 0));
}

async function renderWithPdftocairo({ buffer, resourceId, pageCount, maxPages, dpi, timeoutMs }) {
  const outDir = path.join(pageImageBaseDir(), resourceId);
  await ensureDir(outDir);

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "glt-pdf-pdftocairo-"));
  const pdfPath = path.join(tmpDir, "input.pdf");

  try {
    await fsp.writeFile(pdfPath, buffer);

    const lastPage = String(Math.min(Number(pageCount || 1), maxPages));
    const prefix = path.join(outDir, "pdftocairo-page");

    const args = [
      "-png",
      "-r",
      String(dpi),
      "-f",
      "1",
      "-l",
      lastPage,
      pdfPath,
      prefix,
    ];

    const result = await runCommand("pdftocairo", args, { timeoutMs });

    if (!result.ok) {
      return {
        ok: false,
        skipped: false,
        method: "pdftocairo",
        error: `pdftocairo failed. Install poppler: brew install poppler. Details: ${cleanText(result.stderr, 2000)}`,
        images: [],
        diagnostics: result,
      };
    }

    const images = await normalizeRenderedFiles({
      outDir,
      resourceId,
      tool: "pdftocairo",
      expectedMaxPages: Number(lastPage),
    });

    for (const image of images) {
      image.dpi = dpi;
    }

    return {
      ok: images.length > 0,
      skipped: false,
      method: "pdftocairo",
      error: images.length ? "" : "pdftocairo produced no PNG images.",
      images,
      diagnostics: {
        stdout: cleanText(result.stdout, 1000),
        stderr: cleanText(result.stderr, 2000),
        pageCountRequested: Number(lastPage),
      },
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      method: "pdftocairo",
      error: error.message,
      images: [],
    };
  } finally {
    await removeDir(tmpDir);
  }
}

async function renderWithPdftoppm({ buffer, resourceId, pageCount, maxPages, dpi, timeoutMs }) {
  const outDir = path.join(pageImageBaseDir(), resourceId);
  await ensureDir(outDir);

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "glt-pdf-pdftoppm-"));
  const pdfPath = path.join(tmpDir, "input.pdf");

  try {
    await fsp.writeFile(pdfPath, buffer);

    const lastPage = String(Math.min(Number(pageCount || 1), maxPages));
    const prefix = path.join(outDir, "pdftoppm-page");

    const args = [
      "-png",
      "-r",
      String(dpi),
      "-f",
      "1",
      "-l",
      lastPage,
      "-aa",
      "yes",
      "-aaVector",
      "yes",
      pdfPath,
      prefix,
    ];

    const result = await runCommand("pdftoppm", args, { timeoutMs });

    if (!result.ok) {
      return {
        ok: false,
        skipped: false,
        method: "pdftoppm",
        error: `pdftoppm failed. Install poppler: brew install poppler. Details: ${cleanText(result.stderr, 2000)}`,
        images: [],
        diagnostics: result,
      };
    }

    const images = await normalizeRenderedFiles({
      outDir,
      resourceId,
      tool: "pdftoppm",
      expectedMaxPages: Number(lastPage),
    });

    for (const image of images) {
      image.dpi = dpi;
    }

    return {
      ok: images.length > 0,
      skipped: false,
      method: "pdftoppm",
      error: images.length ? "" : "pdftoppm produced no PNG images.",
      images,
      diagnostics: {
        stdout: cleanText(result.stdout, 1000),
        stderr: cleanText(result.stderr, 2000),
        pageCountRequested: Number(lastPage),
      },
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      method: "pdftoppm",
      error: error.message,
      images: [],
    };
  } finally {
    await removeDir(tmpDir);
  }
}

/**
 * Compatibility stub.
 * Browser PDF viewer rendering is intentionally disabled because it caused
 * repeated/same page screenshots with sidebar/toolbar.
 */
async function renderWithBrowser() {
  return {
    ok: false,
    skipped: true,
    method: "browser-puppeteer-disabled",
    error:
      "Browser/Puppeteer PDF viewer rendering is disabled because it captures the viewer viewport, not exact PDF pages.",
    images: [],
  };
}

async function renderPdfPageImages({ buffer, resourceId, pageCount }) {
  const enabled = envTrue(
    ["AGENT1_ENABLE_PAGE_IMAGES", "LIVE_TUTOR_ENABLE_PDF_PAGE_IMAGES"],
    false
  );

  if (!enabled) {
    return {
      ok: false,
      skipped: true,
      error: "PDF page image rendering disabled by env.",
      images: [],
      selectedMethod: "disabled",
      method: "disabled",
      attempts: [],
      metadata: {
        cleanRendererUsed: true,
        browserPdfViewerDisabled: true,
      },
    };
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return {
      ok: false,
      skipped: false,
      error: "renderPdfPageImages requires a non-empty PDF buffer.",
      images: [],
      selectedMethod: "none",
      method: "none",
      attempts: [],
      metadata: {
        cleanRendererUsed: true,
        browserPdfViewerDisabled: true,
      },
    };
  }

  const safeResourceId = slug(resourceId || `glt_resource_${hashBuffer(buffer, 8)}`, "resource");
  const safePageCount = Math.max(1, Number(pageCount || 1));

  const maxPages = Math.min(
    safePageCount,
    envNumber(["AGENT1_PAGE_IMAGE_MAX_PAGES"], 100, 1, 500)
  );

  const dpi = envNumber(["AGENT1_PAGE_IMAGE_DPI"], 170, 72, 320);
  const timeoutMs = envNumber(["AGENT1_PAGE_IMAGE_TIMEOUT_MS"], 180000, 30000, 600000);

  /**
   * Supported preferred renderers:
   * - pdftocairo
   * - pdftoppm
   *
   * If env says browser, we ignore browser and still use pdftocairo first.
   * This prevents repeated same-page Chrome viewer screenshots.
   */
  const preferred = cleanText(process.env.AGENT1_PAGE_IMAGE_RENDERER || "pdftocairo", 40)
    .toLowerCase();

  const order =
    preferred === "pdftoppm"
      ? ["pdftoppm", "pdftocairo"]
      : ["pdftocairo", "pdftoppm"];

  const outDir = path.join(pageImageBaseDir(), safeResourceId);

  /**
   * Remove old wrong images for same resourceId before rendering.
   * This prevents old Chrome-viewer screenshots from staying mixed with new clean pages.
   */
  await removeDir(outDir);
  await ensureDir(outDir);

  const attempts = [
    {
      ok: false,
      skipped: true,
      method: "browser-puppeteer-disabled",
      error:
        "Browser/Puppeteer PDF viewer screenshot is disabled to prevent same-page/toolbar/sidebar images.",
      images: [],
    },
  ];

  for (const method of order) {
    let attempt;

    if (method === "pdftoppm") {
      attempt = await renderWithPdftoppm({
        buffer,
        resourceId: safeResourceId,
        pageCount: safePageCount,
        maxPages,
        dpi,
        timeoutMs,
      });
    } else {
      attempt = await renderWithPdftocairo({
        buffer,
        resourceId: safeResourceId,
        pageCount: safePageCount,
        maxPages,
        dpi,
        timeoutMs,
      });
    }

    attempts.push(attempt);

    const goodImages = safeArray(attempt.images).filter((img) => {
      return img && img.path && fs.existsSync(img.path) && estimateImageQuality(img.path).ok;
    });

    if (attempt.ok && goodImages.length > 0) {
      return {
        ok: true,
        skipped: false,
        selectedMethod: attempt.method,
        method: attempt.method,
        error: "",
        images: goodImages,
        attempts,
        metadata: {
          cleanRendererUsed: true,
          browserPdfViewerDisabled: true,
          exactPageRendererUsed: true,
          selectedMethod: attempt.method,
          pageImageCount: goodImages.length,
          fallbackUsed: method !== order[0],
          dpi,
          maxPages,
        },
      };
    }
  }

  return {
    ok: false,
    skipped: false,
    selectedMethod: "none",
    method: "none",
    error: attempts.map((a) => `${a.method}: ${a.error}`).join(" | "),
    images: [],
    attempts,
    metadata: {
      cleanRendererUsed: true,
      browserPdfViewerDisabled: true,
      exactPageRendererUsed: false,
      fallbackUsed: false,
      dpi,
      maxPages,
    },
  };
}

module.exports = {
  renderPdfPageImages,
  renderWithBrowser,
  renderWithPdftocairo,
  renderWithPdftoppm,
  renderWithPdfTool: renderWithPdftocairo,
  pageImageBaseDir,
  publicPageImageUrl,
};