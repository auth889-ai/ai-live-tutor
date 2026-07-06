// Qwen multimodal vision call (qwen3.7-plus, OpenAI-compatible endpoint). Sends image(s) +
// a prompt and returns validated JSON. Used to SEE and explain figures inside a PDF/URL/
// video so the tutor can teach FROM the real image, not just its text.

import { qwenConfig } from './client.js';

export async function callQwenVisionJson({
  agent,
  system,
  user,
  images, // [{ base64, mime }]
  model = process.env.MODEL_VISION || 'qwen3.7-plus',
  temperature = 0.2,
  maxTokens = 1500,
  timeoutMs = 90_000,
  env = process.env,
}) {
  const { apiKey, baseUrl } = qwenConfig(env);
  if (!images?.length) throw new Error('callQwenVisionJson requires at least one image');

  const content = [
    ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime || 'image/png'};base64,${img.base64}` } })),
    { type: 'text', text: user },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Qwen vision failed for "${agent}": HTTP ${response.status} — ${(await response.text()).slice(0, 400)}`);
    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Qwen vision returned no content for "${agent}"`);
    return { json: JSON.parse(text), usage: payload.usage ?? null };
  } finally {
    clearTimeout(timer);
  }
}
