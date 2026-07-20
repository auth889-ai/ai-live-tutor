import { studyRuntimeConfig } from "../config/studyRuntime.config.js";

/**
 * File purpose:
 * Embedding-based relevance.
 *
 * Real behavior:
 * Instead of keyword matching, this compares semantic meaning:
 * user goal vector vs page content vector.
 */
export async function embedText(text) {
  if (!studyRuntimeConfig.embedUrl || !studyRuntimeConfig.embedModel) {
    return null;
  }

  try {
    const res = await fetch(studyRuntimeConfig.embedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: studyRuntimeConfig.embedModel,
        prompt: String(text || "").slice(0, 4000),
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.embedding || null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0.5;
  }

  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  if (!na || !nb) return 0.5;

  const raw = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(1, (raw + 1) / 2));
}

export async function computeGoalRelevance(goal, pageText) {
  const [goalVector, pageVector] = await Promise.all([
    embedText(goal),
    embedText(pageText),
  ]);

  if (!goalVector || !pageVector) return 0.5;

  return cosineSimilarity(goalVector, pageVector);
}