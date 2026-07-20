// server/services/connectLearning/webResourceRerank.service.js

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

function normalizeResource(resource = {}, index = 0) {
  return {
    id: clean(resource.id || `web_${index + 1}`),
    title: clean(resource.title || resource.name || resource.url || "Web Resource"),
    url: clean(resource.url || resource.link || ""),
    summary: trunc(clean(resource.summary || resource.description || resource.snippet || ""), 1000),
    description: trunc(clean(resource.description || resource.summary || resource.snippet || ""), 1400),
    provider: clean(resource.provider || "web"),
    relevance: clamp01(resource.relevance || resource.score || 0.55, 0.55),
    raw: resource.raw || resource,
  };
}

function domainQualityBoost(url = "") {
  const value = clean(url).toLowerCase();

  if (
    /martinfowler\.com|liquibase\.com|flywaydb\.org|guides\.rubyonrails\.org|postgresql\.org|mysql\.com|mongodb\.com|prisma\.io|docs\./i.test(
      value
    )
  ) {
    return 0.18;
  }

  if (/wikipedia\.org/i.test(value)) return 0.05;
  if (/medium\.com|dev\.to|hashnode/i.test(value)) return 0.02;
  if (/pinterest|facebook|instagram|tiktok/i.test(value)) return -0.25;

  return 0;
}

function localScoreResource({ resource, nodeTitle = "", nodeSummary = "", pdfEvidence = "", domainTerms = [] }) {
  const hay = norm(`${resource.title} ${resource.summary} ${resource.description} ${resource.url}`);
  const terms = [
    ...norm(nodeTitle).split(/\s+/),
    ...norm(nodeSummary).split(/\s+/),
    ...norm(pdfEvidence).split(/\s+/).slice(0, 35),
    ...list(domainTerms).map(norm),
  ].filter((x) => x.length >= 4);

  const uniqueTerms = [...new Set(terms)].slice(0, 45);

  let hit = 0;
  for (const term of uniqueTerms) {
    if (hay.includes(term)) hit += 1;
  }

  const termScore = uniqueTerms.length ? hit / uniqueTerms.length : 0;

  return Math.max(
    0,
    Math.min(1, termScore * 0.72 + resource.relevance * 0.23 + domainQualityBoost(resource.url))
  );
}

function fallbackRerank({ resources = [], nodeTitle = "", nodeSummary = "", pdfEvidence = "", domainTerms = [], max = 2 }) {
  return list(resources)
    .map(normalizeResource)
    .map((resource) => {
      const score = localScoreResource({
        resource,
        nodeTitle,
        nodeSummary,
        pdfEvidence,
        domainTerms,
      });

      return {
        ...resource,
        aiRelevance: score,
        relevance: score,
        difficulty: score > 0.78 ? "intermediate" : "beginner",
        bestUse: /docs|documentation|reference|api/i.test(`${resource.title} ${resource.url}`)
          ? "reference"
          : /example|tutorial|guide/i.test(`${resource.title} ${resource.summary}`)
            ? "example"
            : "intro",
        reason:
          score >= 0.55
            ? `Matches the selected concept "${nodeTitle}" and its PDF evidence.`
            : `Weak match for "${nodeTitle}".`,
      };
    })
    .filter((resource) => resource.aiRelevance >= Number(process.env.WEB_MIN_RELEVANCE || 0.45))
    .sort((a, b) => b.aiRelevance - a.aiRelevance)
    .slice(0, max);
}

function buildPrompt({
  resources = [],
  nodeTitle = "",
  nodeSummary = "",
  pdfEvidence = "",
  treeTitle = "",
  studyGoal = "",
  domainTerms = [],
  max = 2,
}) {
  const normalized = list(resources).map(normalizeResource).slice(0, 10);

  return `You are reranking web pages for one selected PDF learning node.

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

Candidate web resources:
${JSON.stringify(
  normalized.map((r, index) => ({
    index,
    title: r.title,
    url: r.url,
    summary: trunc(r.summary || r.description, 800),
    provider: r.provider,
  })),
  null,
  2
)}

TASK:
Pick only web resources that are useful for learning this selected node.

Reject if:
- generic unrelated page
- keyword overlap but wrong meaning
- too shallow
- clickbait
- not useful for this concept
- does not match PDF evidence

Prefer:
- official docs
- high-quality tutorials
- university/educational sources
- authoritative domain experts
- pages that explain examples/tools/processes connected to this node

Return JSON only:
{
  "items": [
    {
      "index": 0,
      "aiRelevance": 0.88,
      "difficulty": "beginner|intermediate|advanced",
      "bestUse": "intro|deep_dive|example|practice|reference|visual|tool_doc|review",
      "reason": "why this resource matches the PDF node evidence"
    }
  ]
}

Return at most ${max} resources.`;
}

export async function rerankWebResourcesForNode({
  resources = [],
  nodeTitle = "",
  nodeSummary = "",
  pdfEvidence = "",
  treeTitle = "",
  studyGoal = "",
  domainTerms = [],
  max = Number(process.env.WEB_SEARCH_SAVE_MAX_PER_NODE || 2),
} = {}) {
  const normalized = list(resources)
    .map(normalizeResource)
    .filter((r) => r.title && /^https?:\/\//i.test(r.url));

  if (!normalized.length) return [];

  const fallback = {
    items: fallbackRerank({
      resources: normalized,
      nodeTitle,
      nodeSummary,
      pdfEvidence,
      domainTerms,
      max,
    }).map((resource) => ({
      index: normalized.findIndex((r) => r.url === resource.url),
      aiRelevance: resource.aiRelevance,
      difficulty: resource.difficulty,
      bestUse: resource.bestUse,
      reason: resource.reason,
    })),
  };

  let result = null;

  try {
    result = await callOllamaJson(buildPrompt({
      resources: normalized,
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
    console.warn("[connect-learning:webRerank] Gemma rerank failed:", error.message);
    result = fallback;
  }

  const items = list(result?.items)
    .map((item) => {
      const index = Number(item.index);
      if (!Number.isInteger(index) || index < 0 || index >= normalized.length) return null;

      const resource = normalized[index];
      const aiRelevance = clamp01(item.aiRelevance, 0.65);

      return {
        ...resource,
        aiRelevance,
        relevance: aiRelevance,
        difficulty: clean(item.difficulty || "unknown"),
        bestUse: clean(item.bestUse || "intro"),
        reason: cleanSpace(item.reason || ""),
        rerankReason: cleanSpace(item.reason || ""),
      };
    })
    .filter(Boolean)
    .filter((item) => item.aiRelevance >= Number(process.env.WEB_MIN_RELEVANCE || 0.45))
    .sort((a, b) => b.aiRelevance - a.aiRelevance)
    .slice(0, max);

  if (items.length) return items;

  return fallbackRerank({
    resources: normalized,
    nodeTitle,
    nodeSummary,
    pdfEvidence,
    domainTerms,
    max,
  });
}

export default {
  rerankWebResourcesForNode,
};