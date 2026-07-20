// server/middleware/gemmaResourceUpload.middleware.js

import fs from "fs/promises";
import path from "path";
import multer from "multer";
import { createUploadFileName } from "../services/gemmaResource/localCache.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getUploadRoot() {
  const cacheRoot =
    clean(process.env.GEMMA_RESOURCE_CACHE_DIR) ||
    clean(process.env.OFFLINE_RESOURCE_CACHE_DIR) ||
    path.join(process.cwd(), "data", "gemma-resource");

  return path.join(cacheRoot, "uploads");
}

async function ensureUploadRoot() {
  const root = getUploadRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

function getFileExt(file = {}) {
  const name = clean(file.originalname || file.name || "");
  return path.extname(name).toLowerCase();
}

function isAllowedGemmaResourceFile(file = {}) {
  const ext = getFileExt(file);
  const mime = clean(file.mimetype || file.type || "").toLowerCase();

  const allowedExts = new Set([
    ".pdf",
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".xml",
    ".html",
    ".htm",
    ".log",
    ".yaml",
    ".yml",

    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".java",
    ".cpp",
    ".cc",
    ".cxx",
    ".c",
    ".h",
    ".hpp",
    ".cs",
    ".go",
    ".rs",
    ".php",
    ".rb",
    ".swift",
    ".kt",
    ".kts",
    ".dart",
    ".scala",
    ".sql",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".r",
    ".lua",
    ".pl",
    ".css",
  ]);

  if (allowedExts.has(ext)) return true;

  if (mime.includes("pdf")) return true;
  if (mime.startsWith("text/")) return true;
  if (mime.includes("json")) return true;
  if (mime.includes("xml")) return true;
  if (mime.includes("csv")) return true;

  return false;
}

const storage = multer.diskStorage({
  async destination(req, file, cb) {
    try {
      const root = await ensureUploadRoot();
      cb(null, root);
    } catch (error) {
      cb(error);
    }
  },

  filename(req, file, cb) {
    try {
      cb(null, createUploadFileName(file.originalname || "upload"));
    } catch (error) {
      cb(error);
    }
  },
});

const maxFileSizeMB = numberEnv("GEMMA_RESOURCE_UPLOAD_MAX_MB", 60);
const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;

export const gemmaResourceUpload = multer({
  storage,
  limits: {
    fileSize: maxFileSizeBytes,
    files: 1,
  },
  fileFilter(req, file, cb) {
    if (isAllowedGemmaResourceFile(file)) {
      cb(null, true);
      return;
    }

    cb(
      new Error(
        "Unsupported file type. Upload PDF, text, notes, or code files only."
      )
    );
  },
});

export const uploadSingleGemmaResourceFile =
  gemmaResourceUpload.single("file");

export async function cleanupUploadedGemmaResourceFile(file = null) {
  if (!file?.path) return;

  try {
    await fs.rm(file.path, { force: true });
  } catch {
    // safe cleanup only
  }
}

export function normalizeUploadedGemmaFile(file = null) {
  if (!file) return null;

  return {
    fieldname: file.fieldname || "",
    originalname: file.originalname || "",
    encoding: file.encoding || "",
    mimetype: file.mimetype || "",
    destination: file.destination || "",
    filename: file.filename || "",
    path: file.path || "",
    size: file.size || 0,
    ext: getFileExt(file),
  };
}

export function handleGemmaResourceUploadError(err, req, res, next) {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      message:
        err.code === "LIMIT_FILE_SIZE"
          ? `File is too large. Maximum allowed size is ${maxFileSizeMB}MB.`
          : err.message || "Upload failed.",
      code: err.code || "upload_error",
    });
  }

  return res.status(400).json({
    ok: false,
    message: err.message || "Upload failed.",
    code: "upload_error",
  });
}

export function gemmaResourceUploadInfo() {
  return {
    uploadRoot: getUploadRoot(),
    maxFileSizeMB,
    supported: [
      "pdf",
      "txt",
      "md",
      "csv",
      "json",
      "html",
      "xml",
      "yaml",
      "code files",
    ],
  };
}