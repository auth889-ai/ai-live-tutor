// Qwen image creation (Sankofa's per-act illustrations, on DashScope): text2image is an
// ASYNC task API — submit with X-DashScope-Async, poll the task until SUCCEEDED, download
// the image bytes. Honest failure everywhere; no silent placeholder images, ever.

import { qwenConfig } from './client.js';

// Image model availability is REGIONAL (measured 2026-07-18: the Frankfurt MAAS workspace
// 404s every t2i model). A dedicated image-serving workspace (e.g. Singapore/intl) plugs in
// via ALIBABA_IMAGE_API_KEY + ALIBABA_IMAGE_BASE_URL — same pattern as the TTS workspace.
function nativeBase(env = process.env) {
  const key = (env.ALIBABA_IMAGE_API_KEY || '').trim();
  const base = (env.ALIBABA_IMAGE_BASE_URL || '').trim();
  if (key && base && !/^your[_-]/i.test(key) && !/yourWorkspace/i.test(base)) {
    return { apiKey: key, base: `${base.replace(/\/$/, '')}/api/v1` };
  }
  const { apiKey, baseUrl } = qwenConfig(env);
  return { apiKey, base: baseUrl.replace(/\/compatible-mode\/v1$/, '/api/v1') };
}

// One cheap availability probe per process: the stream route asks before promising images.
let _availability = null;
export async function imagesAvailable(env = process.env) {
  if (_availability !== null) return _availability;
  try {
    const { apiKey, base } = nativeBase(env);
    const r = await fetch(`${base}/services/aigc/text2image/image-synthesis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model: env.IMAGE_MODEL || 'wan2.2-t2i-flash', input: { prompt: 'probe' }, parameters: { n: 1, size: '1024*576' } }),
    });
    _availability = r.ok;
  } catch {
    _availability = false;
  }
  return _availability;
}

export async function generateImage({
  prompt,
  // negative_prompt is the ENFORCED no-text rule — instruction-only versions produced
  // gibberish pseudo-labels on technical concepts (measured 2026-07-19).
  negativePrompt = 'text, words, letters, numbers, labels, captions, typography, handwriting, watermark, signature',
  model = process.env.IMAGE_MODEL || 'wan2.2-t2i-flash',
  size = '1024*576',
  timeoutMs = 120_000,
  pollMs = 2500,
  env = process.env,
}) {
  const { apiKey, base } = nativeBase(env);
  const submit = await fetch(`${base}/services/aigc/text2image/image-synthesis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model,
      input: { prompt: String(prompt).slice(0, 800), negative_prompt: String(negativePrompt).slice(0, 300) },
      parameters: { size, n: 1 },
    }),
  });
  if (!submit.ok) throw new Error(`image submit failed: HTTP ${submit.status} — ${(await submit.text()).slice(0, 300)}`);
  const task = (await submit.json())?.output?.task_id;
  if (!task) throw new Error('image submit returned no task_id');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const poll = await fetch(`${base}/tasks/${task}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!poll.ok) throw new Error(`image poll failed: HTTP ${poll.status}`);
    const body = await poll.json();
    const status = body?.output?.task_status;
    if (status === 'SUCCEEDED') {
      const url = body?.output?.results?.[0]?.url;
      if (!url) throw new Error('image task succeeded but returned no url');
      const img = await fetch(url);
      if (!img.ok) throw new Error(`image download failed: HTTP ${img.status}`);
      return { bytes: Buffer.from(await img.arrayBuffer()), model };
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`image task ${status}: ${body?.output?.message ?? 'no message'}`);
    }
  }
  throw new Error('image task timed out');
}
