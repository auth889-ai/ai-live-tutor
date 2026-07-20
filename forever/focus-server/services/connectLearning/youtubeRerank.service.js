// server/services/connectLearning/youtubeRerank.service.js

import { callOllamaJson } from "../ollamaCompat.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function cleanSpace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function trunc(value = "", max = 1000) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function norm(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9+# ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value, fallback = 0.65) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeVideo(video = {}, index = 0) {
  const videoId =
    clean(video.videoId) ||
    clean(video.id?.videoId) ||
    clean(video.id) ||
    clean(video.providerId);

  const url =
    clean(video.url) ||
    (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

  return {
    id: videoId || `video_${index + 1}`,
    videoId,
    title: clean(video.title || video.snippet?.title || "YouTube Video"),
    url,
    description: trunc(
      clean(video.description || video.snippet?.description || video.summary || ""),
      1200
    ),
    summary: trunc(
      clean(video.summary || video.description || video.snippet?.description || ""),
      900
    ),
    channelTitle: clean(video.channelTitle || video.snippet?.channelTitle || video.creator || ""),
    thumbnail:
      clean(video.thumbnail) ||
      clean(video.thumbnailUrl) ||
      clean(video.snippet?.thumbnails?.high?.url) ||
      clean(video.snippet?.thumbnails?.medium?.url) ||
      clean(video.snippet?.thumbnails?.default?.url),
    publishedAt: clean(video.publishedAt || video.snippet?.publishedAt || ""),
    relevance: clamp01(video.relevance || video.score || 0.55, 0.55),
    raw: video,
  };
}

function localScoreVideo({ video, nodeTitle = "", nodeSummary = "", pdfEvidence = "", domainTerms = [] }) {
  const hay = norm(`${video.title} ${video.description} ${video.channelTitle}`);
  const terms = [
    ...norm(nodeTitle).split(/\s+/),
    ...norm(nodeSummary).split(/\s+/),
    ...norm(pdfEvidence).split(/\s+/).slice(0, 30),
    ...list(domainTerms).map(norm),
  ].filter((x) => x.length >= 4);

  const uniqueTerms = [...new Set(terms)].slice(0, 40);

  let hit = 0;
  for (const term of uniqueTerms) {
    if (hay.includes(term)) hit += 1;
  }

  const termScore = uniqueTerms.length ? hit / uniqueTerms.length : 0;

  let qualityBoost = 0;
  if (/tutorial|explained|course|lecture|guide|walkthrough|example/i.test(video.title)) {
    qualityBoost += 0.12;
  }
  if (/shorts|meme|funny|reaction/i.test(video.title)) {
    qualityBoost -= 0.2;
  }

  return Math.max(0, Math.min(1, termScore * 0.75 + video.relevance * 0.25 + qualityBoost));
}

function fallbackRerank({ videos = [], nodeTitle = "", nodeSummary = "", pdfEvidence = "", domainTerms = [], max = 2 }) {
  return list(videos)
    .map(normalizeVideo)
    .map((video) => {
      const score = localScoreVideo({
        video,
        nodeTitle,
        nodeSummary,
        pdfEvidence,
        domainTerms,
      });

      return {
        ...video,
        aiRelevance: score,
        relevance: score,
        difficulty: score > 0.75 ? "intermediate" : "beginner",
        bestUse: /example|demo|walkthrough/i.test(`${video.title} ${video.description}`)
          ? "example"
          : "intro",
        rerankReason:
          score >= 0.55
            ? `Matches the selected concept "${nodeTitle}" using title/description keyword overlap.`
            : `Weak match for "${nodeTitle}".`,
      };
    })
    .filter((video) => video.aiRelevance >= Number(process.env.YOUTUBE_MIN_RELEVANCE || 0.45))
    .sort((a, b) => b.aiRelevance - a.aiRelevance)
    .slice(0, max);
}

function buildPrompt({
  videos = [],
  nodeTitle = "",
  nodeSummary = "",
  pdfEvidence = "",
  treeTitle = "",
  studyGoal = "",
  domainTerms = [],
  max = 2,
}) {
  const normalized = list(videos).map(normalizeVideo).slice(0, 10);

  return `You are reranking YouTube videos for one selected PDF learning node.

Selected tree:
${treeTitle}

Study goal:
${studyGoal}

Selected node:
${nodeTitle}

Node summary:
${nodeSummary}

PDF evidence for this node:
${trunc(pdfEvidence, 3500)}

Important domain terms:
${list(domainTerms).slice(0, 20).join(", ")}

Candidate videos:
${JSON.stringify(
  normalized.map((v, index) => ({
    index,
    id: v.id,
    videoId: v.videoId,
    title: v.title,
    url: v.url,
    channelTitle: v.channelTitle,
    description: trunc(v.description, 700),
  })),
  null,
  2
)}

TASK:
Pick only videos that are actually useful for learning this selected node.

Reject if:
- generic/unrelated
- clickbait
- too broad
- unrelated meaning of the same words
- does not match the PDF evidence
- no tutorial/explanation/lecture/example value

Return JSON only:
{
  "items": [
    {
      "index": 0,
      "aiRelevance": 0.88,
      "difficulty": "beginner|intermediate|advanced",
      "bestUse": "intro|deep_dive|example|practice|reference|visual|tool_doc|review",
      "reason": "why this video matches the PDF node evidence"
    }
  ]
}

Return at most ${max} videos.`;
}

export async function rerankYouTubeVideosForNode({
  videos = [],
  nodeTitle = "",
  nodeSummary = "",
  pdfEvidence = "",
  treeTitle = "",
  studyGoal = "",
  domainTerms = [],
  max = Number(process.env.YOUTUBE_RERANK_MAX || 2),
} = {}) {
  const normalized = list(videos).map(normalizeVideo).filter((v) => v.title && v.url);

  if (!normalized.length) return [];

  const fallback = {
    items: fallbackRerank({
      videos: normalized,
      nodeTitle,
      nodeSummary,
      pdfEvidence,
      domainTerms,
      max,
    }).map((video) => ({
      index: normalized.findIndex((v) => v.url === video.url),
      aiRelevance: video.aiRelevance,
      difficulty: video.difficulty,
      bestUse: video.bestUse,
      reason: video.rerankReason,
    })),
  };

  let result = null;

  try {
    result = await callOllamaJson(buildPrompt({
      videos: normalized,
      nodeTitle,
      nodeSummary,
      pdfEvidence,
      treeTitle,
      studyGoal,
      domainTerms,
      max,
    }), fallback, {
      temperature: Number(process.env.CONNECT_LEARNING_RERANK_TEMPERATURE || 0.1),
      timeoutMs: Number(process.env.CONNECT_LEARNING_RERANK_TIMEOUT_MS || 360000),
      numPredict: Number(process.env.CONNECT_LEARNING_RERANK_NUM_PREDICT || 900),
      model: process.env.CONNECT_LEARNING_FAST_MODEL || process.env.OLLAMA_CLOUD_MODEL,
    });
  } catch (error) {
    console.warn("[connect-learning:youtubeRerank] Gemma rerank failed:", error.message);
    result = fallback;
  }

  const items = list(result?.items)
    .map((item) => {
      const index = Number(item.index);
      if (!Number.isInteger(index) || index < 0 || index >= normalized.length) return null;

      const video = normalized[index];
      const aiRelevance = clamp01(item.aiRelevance, 0.65);

      return {
        ...video,
        aiRelevance,
        relevance: aiRelevance,
        difficulty: clean(item.difficulty || "unknown"),
        bestUse: clean(item.bestUse || "intro"),
        rerankReason: cleanSpace(item.reason || ""),
      };
    })
    .filter(Boolean)
    .filter((item) => item.aiRelevance >= Number(process.env.YOUTUBE_MIN_RELEVANCE || 0.45))
    .sort((a, b) => b.aiRelevance - a.aiRelevance)
    .slice(0, max);

  if (items.length) return items;

  return fallbackRerank({
    videos: normalized,
    nodeTitle,
    nodeSummary,
    pdfEvidence,
    domainTerms,
    max,
  });
}

export default {
  rerankYouTubeVideosForNode,
};