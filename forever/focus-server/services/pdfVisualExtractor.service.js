import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeFileName(value = "upload.pdf") {
  return (
    clean(value)
      .replace(/[^a-z0-9._-]/gi, "_")
      .slice(0, 80) || "upload.pdf"
  );
}

async function commandExists(command) {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function renderPdfPagesWithPoppler(pdfPath, outPrefix, dpi = 160) {
  const hasPdftoppm = await commandExists("pdftoppm");

  if (!hasPdftoppm) {
    return {
      ok: false,
      images: [],
      error: "pdftoppm not found. Install poppler: brew install poppler",
    };
  }

  try {
    await execFileAsync(
      "pdftoppm",
      ["-png", "-r", String(dpi), pdfPath, outPrefix],
      {
        maxBuffer: 1024 * 1024 * 50,
      }
    );

    const dir = path.dirname(outPrefix);
    const base = path.basename(outPrefix);
    const files = await fs.readdir(dir);

    const images = files
      .filter((file) => file.startsWith(base) && file.endsWith(".png"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((file, index) => ({
        pageNumber: index + 1,
        imagePath: path.join(dir, file),
      }));

    return {
      ok: true,
      images,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      images: [],
      error: error?.message || String(error),
    };
  }
}

async function ocrImageWithTesseract(imagePath, pageNumber) {
  const hasTesseract = await commandExists("tesseract");

  if (!hasTesseract) {
    return {
      pageNumber,
      ok: false,
      text: "",
      error: "tesseract not found. Install tesseract: brew install tesseract",
    };
  }

  try {
    const { stdout } = await execFileAsync(
      "tesseract",
      [imagePath, "stdout", "-l", process.env.OCR_LANG || "eng", "--psm", "6"],
      {
        maxBuffer: 1024 * 1024 * 20,
      }
    );

    return {
      pageNumber,
      ok: true,
      text: clean(stdout || ""),
      error: "",
    };
  } catch (error) {
    return {
      pageNumber,
      ok: false,
      text: "",
      error: error?.message || String(error),
    };
  }
}

export async function extractPdfVisuals(buffer, options = {}) {
  if (!buffer) {
    throw new Error("PDF buffer is required.");
  }

  const jobId = crypto.randomBytes(8).toString("hex");
  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `pdf-visual-${jobId}-`)
  );

  const fileName = safeFileName(options.fileName || "upload.pdf");
  const pdfPath = path.join(tmpRoot, fileName);
  const outPrefix = path.join(tmpRoot, "page");

  try {
    await fs.writeFile(pdfPath, buffer);

    const render = await renderPdfPagesWithPoppler(
      pdfPath,
      outPrefix,
      Number(process.env.CONNECT_LEARNING_PDF_RENDER_DPI || 160)
    );

    if (!render.ok) {
      return {
        ok: false,
        pages: [],
        visualText: "",
        error: render.error || "Could not render PDF pages.",
      };
    }

    const maxPages = Number(
      options.maxPages || process.env.CONNECT_LEARNING_PDF_VISUAL_MAX_PAGES || 5
    );

    const selectedImages = render.images.slice(0, maxPages);
    const pages = [];

    for (const image of selectedImages) {
      const ocr = await ocrImageWithTesseract(
        image.imagePath,
        image.pageNumber
      );

      pages.push({
        pageNumber: image.pageNumber,
        imagePath:
          process.env.CONNECT_LEARNING_KEEP_OCR_TEMP === "true"
            ? image.imagePath
            : "",
        ok: ocr.ok,
        text: ocr.text,
        error: ocr.error || "",
        hasVisualSignal: Boolean(ocr.text && ocr.text.length > 20),
      });
    }

    const visualText = pages
      .filter((page) => clean(page.text))
      .map((page) => `[PAGE ${page.pageNumber} OCR]\n${page.text}`)
      .join("\n\n");

    return {
      ok: true,
      pages,
      visualText,
      error: "",
    };
  } finally {
    try {
      if (process.env.CONNECT_LEARNING_KEEP_OCR_TEMP !== "true") {
        await fs.rm(tmpRoot, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup error
    }
  }
}

export default {
  extractPdfVisuals,
};