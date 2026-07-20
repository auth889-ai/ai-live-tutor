// server/services/youtubeSearch.service.js

import crypto from "crypto";

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseDurationMs(value, fallbackMs) {
  const raw = clean(value).toLowerCase();
  if (!raw) return fallbackMs;

  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)?$/);
  if (!match) return fallbackMs;

  const n = Number(match[1]);
  const unit = match[2] || "ms";

  if (["s", "sec", "secs"].includes(unit)) return n * 1000;
  if (["m", "min", "mins"].includes(unit)) return n * 60 * 1000;
  if (["h", "hr", "hrs"].includes(unit)) return n * 60 * 60 * 1000;
  if (["d", "day", "days"].includes(unit)) return n * 24 * 60 * 60 * 1000;

  return n;
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hash(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function domainFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "youtube.com";
  }
}

const memoryCache = new Map();

function getCache(key) {
  const item = memoryCache.get(key);
  if (!item) return null;

  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    return null;
  }

  return item.value;
}

function setCache(key, value, ttlMs) {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function normalizeVideo(item = {}, query = "") {
  const videoId = item?.id?.videoId || item?.id;
  const snippet = item?.snippet || item || {};

  if (!videoId) return null;

  const url = `https://www.youtube.com/watch?v=${videoId}`;

  return {
    sourceType: "video",
    title: clean(snippet.title) || `YouTube video for ${query}`,
    creator: clean(snippet.channelTitle),
    channelTitle: clean(snippet.channelTitle),
    url,
    domain: domainFromUrl(url),
    thumbnail:
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.default?.url ||
      "",
    description: clean(snippet.description),
    publishedAt: clean(snippet.publishedAt),
    videoId,
    query,
  };
}

/**
 * Main YouTube search used by Connect Learning.
 * Keep this export because connectLearning.service.js imports it.
 */
export async function searchYouTubeVideos(query = "", options = {}) {
  const apiKey = clean(options.apiKey || process.env.YOUTUBE_API_KEY);
  const q = clean(query);

  if (!apiKey) {
    return {
      ok: false,
      reason: "YOUTUBE_API_KEY missing",
      videos: [],
    };
  }

  if (!q || q.length < 4) {
    return {
      ok: false,
      reason: "YouTube search query too short",
      videos: [],
    };
  }

  const maxResults = Math.max(
    1,
    Math.min(
      10,
      safeNumber(options.maxResults || process.env.YOUTUBE_SEARCH_MAX_RESULTS, 2)
    )
  );

  const relevanceLanguage = clean(
    options.relevanceLanguage || process.env.YOUTUBE_RELEVANCE_LANGUAGE || "en"
  );

  const cacheTtlMs = parseDurationMs(
    options.cacheTtlMs || process.env.YOUTUBE_SEARCH_CACHE_TTL_MS || "7d",
    7 * 24 * 60 * 60 * 1000
  );

  const cacheKey = hash(JSON.stringify({ q, maxResults, relevanceLanguage }));
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    q,
    maxResults: String(maxResults),
    key: apiKey,
    safeSearch: "moderate",
    videoEmbeddable: "true",
    relevanceLanguage,
  });

  const endpoint = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const failed = {
        ok: false,
        reason: json?.error?.message || `YouTube API failed ${res.status}`,
        videos: [],
        raw: json,
      };

      setCache(cacheKey, failed, Math.min(cacheTtlMs, 10 * 60 * 1000));
      return failed;
    }

    const videos = Array.isArray(json.items)
      ? json.items.map((item) => normalizeVideo(item, q)).filter(Boolean)
      : [];

    const result = {
      ok: true,
      reason: "",
      videos,
      raw: json,
    };

    setCache(cacheKey, result, cacheTtlMs);
    return result;
  } catch (error) {
    return {
      ok: false,
      reason: error.message,
      videos: [],
    };
  }
}

/**
 * Compatibility export.
 * connectLearning.service.js imports this exact name.
 */
export function buildYouTubeQueryForNode({
  studyGoal = "",
  conceptTitle = "",
  keyPoints = [],
  pdfTitle = "",
} = {}) {
  const points = Array.isArray(keyPoints)
    ? keyPoints.map(clean).filter(Boolean).slice(0, 3)
    : [];

  return [
    clean(conceptTitle),
    clean(studyGoal),
    ...points,
    clean(pdfTitle),
    "lecture tutorial explained",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

export default {
  searchYouTubeVideos,
  buildYouTubeQueryForNode,
};