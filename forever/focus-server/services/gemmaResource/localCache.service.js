// server/services/gemmaResource/localCache.service.js

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

function clean(value = "") {
  return String(value || "").trim();
}

function safeFileName(value = "") {
  const base = clean(value) || "resource";

  return base
    .replace(/[^a-z0-9_.-]+/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function getConfiguredCacheRoot() {
  return (
    clean(process.env.GEMMA_RESOURCE_CACHE_DIR) ||
    clean(process.env.OFFLINE_RESOURCE_CACHE_DIR) ||
    path.join(process.cwd(), "data", "gemma-resource")
  );
}

function resourceIdString(resourceOrId) {
  if (!resourceOrId) return "";

  if (typeof resourceOrId === "string") return resourceOrId;

  if (resourceOrId._id) return String(resourceOrId._id);

  if (resourceOrId.id) return String(resourceOrId.id);

  return String(resourceOrId);
}

function clampText(text = "", maxChars = 500000) {
  const value = String(text || "");

  if (value.length <= maxChars) return value;

  return value.slice(0, maxChars);
}

function hashContent(text = "") {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

export function getGemmaResourceCacheRoot() {
  return getConfiguredCacheRoot();
}

export function getGemmaResourceCacheDir(resourceOrId) {
  const id = resourceIdString(resourceOrId);

  if (!id) {
    throw new Error("resourceId is required for cache directory.");
  }

  return path.join(getGemmaResourceCacheRoot(), id);
}

export function getGemmaResourceCachePaths(resourceOrId) {
  const dir = getGemmaResourceCacheDir(resourceOrId);

  return {
    dir,
    rawTextPath: path.join(dir, "raw.txt"),
    chunksPath: path.join(dir, "chunks.json"),
    packPath: path.join(dir, "pack.json"),
    metaPath: path.join(dir, "meta.json"),
    bookPath: path.join(dir, "book.json"),
    tutorMemoryPath: path.join(dir, "tutor-memory.json"),
  };
}

export async function ensureGemmaResourceCacheRoot() {
  const root = getGemmaResourceCacheRoot();

  await fs.mkdir(root, { recursive: true });

  const testFile = path.join(root, ".write-test");

  await fs.writeFile(testFile, "ok", "utf8");
  await fs.rm(testFile, { force: true });

  return root;
}

export async function ensureResourceCacheDir(resourceOrId) {
  await ensureGemmaResourceCacheRoot();

  const dir = getGemmaResourceCacheDir(resourceOrId);

  await fs.mkdir(dir, { recursive: true });

  return dir;
}

export async function writeTextFile(filePath, text = "") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(text || ""), "utf8");

  return filePath;
}

export async function readTextFile(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath, data = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");

  return filePath;
}

export async function readJsonFile(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function saveRawTextToCache({
  resource,
  rawText = "",
  maxChars = Number(process.env.GEMMA_RESOURCE_STORE_RAW_CHARS || 500000),
} = {}) {
  if (!resource) throw new Error("resource is required.");

  const paths = getGemmaResourceCachePaths(resource);
  const textToStore = clampText(rawText, maxChars);

  await writeTextFile(paths.rawTextPath, textToStore);

  return {
    path: paths.rawTextPath,
    chars: textToStore.length,
    fullChars: String(rawText || "").length,
    sha256: hashContent(textToStore),
    truncated: String(rawText || "").length > textToStore.length,
  };
}

export async function saveChunksToCache({ resource, chunks = [] } = {}) {
  if (!resource) throw new Error("resource is required.");

  const paths = getGemmaResourceCachePaths(resource);

  const payload = {
    resourceId: resourceIdString(resource),
    savedAt: new Date().toISOString(),
    count: Array.isArray(chunks) ? chunks.length : 0,
    chunks: Array.isArray(chunks) ? chunks : [],
  };

  await writeJsonFile(paths.chunksPath, payload);

  return {
    path: paths.chunksPath,
    count: payload.count,
    sha256: hashContent(JSON.stringify(payload)),
  };
}

export async function saveStudyPackToCache({ resource, pack = {} } = {}) {
  if (!resource) throw new Error("resource is required.");

  const paths = getGemmaResourceCachePaths(resource);

  const payload = {
    resourceId: resourceIdString(resource),
    savedAt: new Date().toISOString(),
    pack: pack || {},
  };

  await writeJsonFile(paths.packPath, payload);

  return {
    path: paths.packPath,
    sha256: hashContent(JSON.stringify(payload)),
  };
}

export async function saveBookToCache({ resource, book = {} } = {}) {
  if (!resource) throw new Error("resource is required.");

  const paths = getGemmaResourceCachePaths(resource);

  const payload = {
    resourceId: resourceIdString(resource),
    savedAt: new Date().toISOString(),
    book: book || {},
  };

  await writeJsonFile(paths.bookPath, payload);

  return {
    path: paths.bookPath,
    sha256: hashContent(JSON.stringify(payload)),
  };
}

export async function saveCacheMeta({
  resource,
  fetched = {},
  rawInfo = {},
  chunkInfo = {},
  packInfo = {},
  extra = {},
} = {}) {
  if (!resource) throw new Error("resource is required.");

  const paths = getGemmaResourceCachePaths(resource);

  const payload = {
    resourceId: resourceIdString(resource),
    title: resource.title || "",
    sourceType: resource.sourceType || "",
    sourceUrl: resource.sourceUrl || "",
    domain: resource.domain || "",
    createdAt: new Date().toISOString(),
    fetched: {
      title: fetched.title || "",
      sourceType: fetched.sourceType || "",
      sourceUrl: fetched.sourceUrl || "",
      domain: fetched.domain || "",
      pageCount: fetched.pageCount || 0,
      durationSeconds: fetched.durationSeconds || 0,
      metadata: fetched.metadata || {},
    },
    files: {
      rawTextPath: paths.rawTextPath,
      chunksPath: paths.chunksPath,
      packPath: paths.packPath,
      bookPath: paths.bookPath,
      tutorMemoryPath: paths.tutorMemoryPath,
    },
    rawInfo,
    chunkInfo,
    packInfo,
    extra,
  };

  await writeJsonFile(paths.metaPath, payload);

  return {
    path: paths.metaPath,
    meta: payload,
  };
}

export async function saveCompleteResourceCache({
  resource,
  fetched = {},
  chunks = [],
  pack = {},
  extra = {},
} = {}) {
  if (!resource) throw new Error("resource is required.");

  await ensureResourceCacheDir(resource);

  const rawInfo = await saveRawTextToCache({
    resource,
    rawText: fetched.text || "",
  });

  const chunkInfo = await saveChunksToCache({
    resource,
    chunks,
  });

  const packInfo = await saveStudyPackToCache({
    resource,
    pack,
  });

  const metaInfo = await saveCacheMeta({
    resource,
    fetched,
    rawInfo,
    chunkInfo,
    packInfo,
    extra,
  });

  return {
    dir: getGemmaResourceCacheDir(resource),
    rawTextPath: rawInfo.path,
    chunksPath: chunkInfo.path,
    packPath: packInfo.path,
    metaPath: metaInfo.path,
    rawInfo,
    chunkInfo,
    packInfo,
    metaInfo,
  };
}

export async function loadCompleteResourceCache(resourceOrId) {
  const paths = getGemmaResourceCachePaths(resourceOrId);

  const [rawText, chunksPayload, packPayload, meta] = await Promise.all([
    readTextFile(paths.rawTextPath, ""),
    readJsonFile(paths.chunksPath, null),
    readJsonFile(paths.packPath, null),
    readJsonFile(paths.metaPath, null),
  ]);

  return {
    dir: paths.dir,
    rawText,
    chunks: chunksPayload?.chunks || [],
    pack: packPayload?.pack || null,
    meta,
    paths,
  };
}

export async function deleteGemmaResourceCache(resourceOrId) {
  const dir = getGemmaResourceCacheDir(resourceOrId);

  await fs.rm(dir, {
    recursive: true,
    force: true,
  });

  return {
    deleted: true,
    dir,
  };
}

export async function getGemmaResourceCacheStats(resourceOrId) {
  const dir = getGemmaResourceCacheDir(resourceOrId);

  async function walk(folder) {
    let totalBytes = 0;
    let files = 0;

    try {
      const entries = await fs.readdir(folder, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(folder, entry.name);

        if (entry.isDirectory()) {
          const nested = await walk(entryPath);
          totalBytes += nested.totalBytes;
          files += nested.files;
        } else {
          const stat = await fs.stat(entryPath);
          totalBytes += stat.size;
          files += 1;
        }
      }
    } catch {
      return { totalBytes: 0, files: 0 };
    }

    return { totalBytes, files };
  }

  const stats = await walk(dir);

  return {
    dir,
    files: stats.files,
    totalBytes: stats.totalBytes,
    totalMB: Number((stats.totalBytes / (1024 * 1024)).toFixed(2)),
  };
}

export async function getGemmaResourceRootCacheStats() {
  const root = getGemmaResourceCacheRoot();

  async function walk(folder) {
    let totalBytes = 0;
    let files = 0;
    let folders = 0;

    try {
      const entries = await fs.readdir(folder, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(folder, entry.name);

        if (entry.isDirectory()) {
          folders += 1;
          const nested = await walk(entryPath);
          totalBytes += nested.totalBytes;
          files += nested.files;
          folders += nested.folders;
        } else {
          const stat = await fs.stat(entryPath);
          totalBytes += stat.size;
          files += 1;
        }
      }
    } catch {
      return { totalBytes: 0, files: 0, folders: 0 };
    }

    return { totalBytes, files, folders };
  }

  await fs.mkdir(root, { recursive: true });

  const stats = await walk(root);

  return {
    root,
    files: stats.files,
    folders: stats.folders,
    totalBytes: stats.totalBytes,
    totalMB: Number((stats.totalBytes / (1024 * 1024)).toFixed(2)),
  };
}

export function createUploadFileName(originalName = "upload") {
  const ext = path.extname(originalName || "") || ".txt";
  const base = safeFileName(path.basename(originalName || "upload", ext));
  const stamp = Date.now();
  const rand = crypto.randomBytes(5).toString("hex");

  return `${stamp}_${rand}_${base}${ext}`;
}