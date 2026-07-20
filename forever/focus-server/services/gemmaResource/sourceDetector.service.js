// server/services/gemmaResource/sourceDetector.service.js

import path from "path";

function clean(value = "") {
  return String(value || "").trim();
}

function lower(value = "") {
  return clean(value).toLowerCase();
}

function safeUrl(value = "") {
  const raw = clean(value);

  if (!raw) return null;

  try {
    return new URL(raw);
  } catch {
    try {
      return new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
}

export function isYouTubeUrl(url = "") {
  const parsed = safeUrl(url);

  if (!parsed) return false;

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  return (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be" ||
    host === "music.youtube.com"
  );
}

export function getYouTubeVideoId(url = "") {
  const parsed = safeUrl(url);

  if (!parsed) return "";

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    return parsed.pathname.replace("/", "").trim();
  }

  const v = parsed.searchParams.get("v");
  if (v) return v.trim();

  const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?]+)/i);
  if (shortsMatch?.[1]) return shortsMatch[1].trim();

  const embedMatch = parsed.pathname.match(/\/embed\/([^/?]+)/i);
  if (embedMatch?.[1]) return embedMatch[1].trim();

  return "";
}

export function isProbablyUrl(value = "") {
  const raw = clean(value);

  if (!raw) return false;

  if (/^https?:\/\//i.test(raw)) return true;

  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return true;

  return false;
}

export function getDomain(url = "") {
  const parsed = safeUrl(url);

  if (!parsed) return "";

  return parsed.hostname.replace(/^www\./, "").toLowerCase();
}

export function getFileExtension(file = null) {
  const name = clean(file?.originalname || file?.filename || file?.name || "");
  return path.extname(name).toLowerCase();
}

export function getMimeType(file = null) {
  return lower(file?.mimetype || file?.type || "");
}

export function isPdfFile(file = null) {
  const ext = getFileExtension(file);
  const mime = getMimeType(file);

  return ext === ".pdf" || mime.includes("pdf");
}

export function isTextLikeFile(file = null) {
  const ext = getFileExtension(file);
  const mime = getMimeType(file);

  const textExts = new Set([
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
  ]);

  return textExts.has(ext) || mime.startsWith("text/");
}

export function isCodeFile(file = null) {
  const ext = getFileExtension(file);

  const codeExts = new Set([
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
    ".m",
    ".lua",
    ".pl",
    ".html",
    ".css",
  ]);

  return codeExts.has(ext);
}

export function isProbablyCode(text = "") {
  const value = clean(text);

  if (!value) return false;

  const codeSignals = [
    /function\s+\w+\s*\(/,
    /const\s+\w+\s*=/,
    /let\s+\w+\s*=/,
    /var\s+\w+\s*=/,
    /=>\s*[{(]/,
    /class\s+\w+/,
    /def\s+\w+\s*\(/,
    /import\s+[\w{},*\s]+\s+from\s+['"]/,
    /from\s+[\w.]+\s+import\s+/,
    /#include\s*</,
    /public\s+static\s+void\s+main/,
    /System\.out\.println/,
    /console\.log\s*\(/,
    /for\s*\([^)]*;[^)]*;[^)]*\)/,
    /while\s*\([^)]*\)\s*{/,
    /if\s*\([^)]*\)\s*{/,
    /return\s+[^;]+;/,
    /SELECT\s+.+\s+FROM\s+/i,
    /CREATE\s+TABLE\s+/i,
  ];

  const hits = codeSignals.reduce(
    (count, regex) => count + (regex.test(value) ? 1 : 0),
    0
  );

  if (hits >= 2) return true;

  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);

  if (lines.length >= 4) {
    const codeLikeLines = lines.filter((line) => {
      return (
        line.endsWith(";") ||
        line.endsWith("{") ||
        line.endsWith("}") ||
        /^\s*(if|for|while|return|class|def|function|const|let|var)\b/.test(
          line
        )
      );
    });

    return codeLikeLines.length / lines.length >= 0.35;
  }

  return false;
}

export function normalizeSourceType(sourceType = "") {
  const value = lower(sourceType);

  if (["youtube", "yt", "video"].includes(value)) return "youtube";
  if (["web", "website", "webpage", "url", "article", "page"].includes(value)) {
    return "webpage";
  }
  if (["pdf", "document"].includes(value)) return "pdf";
  if (["note", "notes", "text", "manual", "paste"].includes(value)) return "notes";
  if (["code", "leetcode", "program", "script"].includes(value)) return "code";

  return "";
}

export function detectGemmaResourceSource({
  sourceType = "",
  url = "",
  text = "",
  file = null,
} = {}) {
  const explicit = normalizeSourceType(sourceType);

  if (explicit) {
    return buildSourceDetectionResult({
      sourceType: explicit,
      url,
      text,
      file,
      confidence: "explicit",
      reason: "User selected source type.",
    });
  }

  if (file) {
    if (isPdfFile(file)) {
      return buildSourceDetectionResult({
        sourceType: "pdf",
        url,
        text,
        file,
        confidence: "high",
        reason: "Uploaded file is PDF.",
      });
    }

    if (isCodeFile(file)) {
      return buildSourceDetectionResult({
        sourceType: "code",
        url,
        text,
        file,
        confidence: "high",
        reason: "Uploaded file extension looks like code.",
      });
    }

    if (isTextLikeFile(file)) {
      return buildSourceDetectionResult({
        sourceType: "notes",
        url,
        text,
        file,
        confidence: "medium",
        reason: "Uploaded file is text-like.",
      });
    }

    return buildSourceDetectionResult({
      sourceType: "notes",
      url,
      text,
      file,
      confidence: "low",
      reason: "Uploaded file type is unknown, defaulting to notes.",
    });
  }

  if (url) {
    if (isYouTubeUrl(url)) {
      return buildSourceDetectionResult({
        sourceType: "youtube",
        url,
        text,
        file,
        confidence: "high",
        reason: "URL is a YouTube URL.",
      });
    }

    if (isProbablyUrl(url)) {
      return buildSourceDetectionResult({
        sourceType: "webpage",
        url,
        text,
        file,
        confidence: "high",
        reason: "URL looks like a webpage.",
      });
    }
  }

  if (text) {
    if (isProbablyCode(text)) {
      return buildSourceDetectionResult({
        sourceType: "code",
        url,
        text,
        file,
        confidence: "medium",
        reason: "Pasted text looks like code.",
      });
    }

    return buildSourceDetectionResult({
      sourceType: "notes",
      url,
      text,
      file,
      confidence: "medium",
      reason: "Pasted text detected as notes.",
    });
  }

  return buildSourceDetectionResult({
    sourceType: "notes",
    url,
    text,
    file,
    confidence: "low",
    reason: "No clear source found. Defaulting to notes.",
  });
}

export function buildSourceDetectionResult({
  sourceType,
  url = "",
  text = "",
  file = null,
  confidence = "medium",
  reason = "",
}) {
  const domain = url ? getDomain(url) : "";
  const videoId = sourceType === "youtube" ? getYouTubeVideoId(url) : "";

  return {
    sourceType,
    confidence,
    reason,
    url: clean(url),
    domain,
    videoId,
    hasUrl: Boolean(clean(url)),
    hasText: Boolean(clean(text)),
    hasFile: Boolean(file),
    file: file
      ? {
          originalname: file.originalname || file.name || "",
          filename: file.filename || "",
          path: file.path || "",
          mimetype: file.mimetype || file.type || "",
          size: file.size || 0,
          ext: getFileExtension(file),
        }
      : null,
  };
}

export function getDefaultTitleForSource({
  sourceType = "",
  url = "",
  file = null,
  text = "",
} = {}) {
  const type = normalizeSourceType(sourceType) || sourceType;

  if (file?.originalname || file?.name) {
    return clean(file.originalname || file.name).replace(/\.[^.]+$/, "");
  }

  if (type === "youtube") {
    const videoId = getYouTubeVideoId(url);
    return videoId ? `YouTube Video ${videoId}` : "Saved YouTube Video";
  }

  if (type === "webpage") {
    const domain = getDomain(url);
    return domain ? `Saved page from ${domain}` : "Saved Webpage";
  }

  if (type === "pdf") return "Saved PDF";
  if (type === "code") return "Saved Code";
  if (type === "notes") {
    const firstLine = clean(text).split("\n")[0]?.trim();
    return firstLine ? firstLine.slice(0, 80) : "Saved Notes";
  }

  return "Saved Resource";
}