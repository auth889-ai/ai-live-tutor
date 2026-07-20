import LearningNode from "../models/LearningNode.js";
import LearningResource from "../models/LearningResource.js";
import { embedText } from "./ollamaCompat.service.js";

function dot(a = [], b = []) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) s += Number(a[i] || 0) * Number(b[i] || 0);
  return s;
}
function norm(a = []) { return Math.sqrt(dot(a, a)) || 0; }
export function cosineSimilarity(a = [], b = []) {
  const na = norm(a); const nb = norm(b);
  if (!na || !nb) return 0;
  return dot(a, b) / (na * nb);
}

function textOfResource(r = {}) {
  return [r.title, r.summary, r.extractedText, r.transcript, ...(r.keyPoints || []), ...(r.concepts || []), ...(r.tags || [])].filter(Boolean).join("\n").slice(0, 8000);
}
function textOfNode(n = {}) {
  return [n.title, n.summary, ...(n.concepts || []), ...(n.tags || [])].filter(Boolean).join("\n").slice(0, 4000);
}

export async function buildEmbedding(text) {
  return embedText(text);
}

export async function upsertNodeMemory(node) {
  const embedding = await buildEmbedding(textOfNode(node));
  if (embedding.length) {
    await LearningNode.findByIdAndUpdate(node._id, { embedding });
  }
  return embedding;
}

export async function upsertResourceMemory(resource) {
  const embedding = await buildEmbedding(textOfResource(resource));
  if (embedding.length) {
    await LearningResource.findByIdAndUpdate(resource._id, { embedding });
  }
  return embedding;
}

export async function findSimilarNodes({ deviceId, userId = "", treeId = "", text = "", limit = 8 }) {
  const embedding = await buildEmbedding(text);
  const query = { deviceId };
  if (userId) query.userId = userId;
  if (treeId) query.treeId = treeId;

  const nodes = await LearningNode.find(query).sort({ updatedAt: -1 }).limit(200).lean();
  if (!embedding.length) {
    const words = String(text || "").toLowerCase().split(/\W+/).filter(Boolean);
    return nodes.map((node) => {
      const hay = textOfNode(node).toLowerCase();
      const score = words.filter((w) => hay.includes(w)).length / Math.max(1, words.length);
      return { ...node, similarity: score };
    }).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  return nodes
    .map((node) => ({ ...node, similarity: cosineSimilarity(embedding, node.embedding || []) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function findSimilarResources({ deviceId, userId = "", treeId = "", text = "", url = "", contentHash = "", limit = 8 }) {
  const exact = [];
  if (url) {
    const byUrl = await LearningResource.findOne({ deviceId, url }).lean();
    if (byUrl) exact.push({ ...byUrl, similarity: 1, exactReason: "url" });
  }
  if (contentHash) {
    const byHash = await LearningResource.findOne({ deviceId, contentHash }).lean();
    if (byHash) exact.push({ ...byHash, similarity: 1, exactReason: "contentHash" });
  }
  if (exact.length) return exact.slice(0, limit);

  const embedding = await buildEmbedding(text);
  const query = { deviceId };
  if (userId) query.userId = userId;
  if (treeId) query.treeId = treeId;
  const resources = await LearningResource.find(query).sort({ updatedAt: -1 }).limit(200).lean();
  if (!embedding.length) return resources.slice(0, limit).map((r) => ({ ...r, similarity: 0 }));
  return resources
    .map((r) => ({ ...r, similarity: cosineSimilarity(embedding, r.embedding || []) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
