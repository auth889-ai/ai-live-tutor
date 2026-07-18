// Qwen embeddings (text-embedding-v4, 1024-dim) — the vector layer under the notebook's
// retrieval. Regional like every other modality: Frankfurt serves none (measured), the
// Singapore workspace does — same env pair as images. In-memory cosine over a user's own
// blocks (≤ hundreds) needs no vector database: honest, fast, zero new infra.

import { qwenConfig } from './client.js';

function endpoint(env = process.env) {
  const key = (env.ALIBABA_IMAGE_API_KEY || '').trim();
  const base = (env.ALIBABA_IMAGE_BASE_URL || '').trim();
  if (key && base && !/^your[_-]/i.test(key)) {
    return { apiKey: key, base: `${base.replace(/\/$/, '')}/compatible-mode/v1` };
  }
  const { apiKey, baseUrl } = qwenConfig(env);
  return { apiKey, base: baseUrl };
}

export async function embedTexts(texts, { model = process.env.EMBEDDING_MODEL || 'text-embedding-v4', timeoutMs = 20_000, env = process.env } = {}) {
  const inputs = texts.map((t) => String(t ?? '').slice(0, 6000)).filter((t) => t.trim());
  if (inputs.length === 0) return [];
  const { apiKey, base } = endpoint(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}/embeddings`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: inputs }),
    });
    if (!r.ok) throw new Error(`embeddings failed: HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
    const body = await r.json();
    return (body?.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
  } finally {
    clearTimeout(timer);
  }
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}
