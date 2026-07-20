// QWEN ADAPTER — forever uses Qwen, not Gemma/Ollama. This translates the w2 server's
// Ollama-style generate call into a Qwen OpenAI-compatible /chat/completions call (with
// vision support for the screenshots), and returns the SAME { text, raw } shape the rest of
// the w2 code expects — so the study classification runs on Qwen with zero changes upstream.

// Normalize the base URL exactly like forever's client: Qwen workspace gateways expose the
// native API at /api/v1 and the OpenAI-compatible API at /compatible-mode/v1 — we need the latter.
function normBase() {
  let b = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  b = b.replace(/\/api\/v1$/, '');
  if (!/\/compatible-mode\/v1$/.test(b)) b = `${b}/compatible-mode/v1`;
  return b;
}
const BASE = normBase();
const KEY = process.env.DASHSCOPE_API_KEY || '';
const TEXT_MODEL = process.env.MODEL_FAST || 'qwen-plus';
const VISION_MODEL = process.env.MODEL_VISION || 'qwen3.7-plus';

export function qwenEnabled() {
  return process.env.USE_QWEN === '1' && Boolean(KEY);
}

// Mirrors callOllamaGenerateOnce's contract: { model, prompt, system, temperature, images,
// json/format, timeoutMs } -> { text, raw, model, latencyMs }.
export async function callQwenGenerate({
  prompt = '',
  system = '',
  temperature = 0.2,
  images = [],
  json = false,
  format = undefined,
  timeoutMs = 60000,
} = {}) {
  const hasImages = Array.isArray(images) && images.length > 0;
  const model = hasImages ? VISION_MODEL : TEXT_MODEL;

  // user content: text + any screenshots (base64) as OpenAI image_url data URIs
  const userContent = hasImages
    ? [
        { type: 'text', text: prompt },
        ...images.map((img) => ({
          type: 'image_url',
          image_url: { url: String(img).startsWith('data:') ? String(img) : `data:image/jpeg;base64,${img}` },
        })),
      ]
    : prompt;

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: userContent });

  const body = { model, messages, temperature };
  if (json || format === 'json') body.response_format = { type: 'json_object' };

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Qwen HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const jsonRes = await res.json();
    const text = jsonRes?.choices?.[0]?.message?.content ?? '';
    return { text: String(text), raw: { response: String(text) }, model, latencyMs: Date.now() - started };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
