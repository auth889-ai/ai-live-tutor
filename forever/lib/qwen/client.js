// The ONLY door to Qwen Cloud. Every model call in Forever goes through here:
// one focused job per call, JSON output, usage returned for the cost ledger,
// honest failure (no fallbacks). OpenAI-compatible DashScope endpoint.

const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

export function qwenConfig(env = process.env) {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey?.trim()) throw new Error('DASHSCOPE_API_KEY is not set');
  let baseUrl = (env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  // Qwen Cloud workspace gateways expose the native API at /api/v1 and the
  // OpenAI-compatible API at /compatible-mode/v1 — we always use the latter.
  baseUrl = baseUrl.replace(/\/api\/v1$/, '');
  if (!/\/compatible-mode\/v1$/.test(baseUrl)) baseUrl = `${baseUrl}/compatible-mode/v1`;
  return { apiKey, baseUrl };
}

export async function callQwenJson({
  agent,
  system,
  user,
  model = process.env.MODEL_SCENE || 'qwen3.7-plus',
  temperature = 0.4,
  maxTokens = 4000,
  timeoutMs = 150_000,
  retries = 3,
  env = process.env,
}) {
  const { apiKey, baseUrl } = qwenConfig(env);
  let lastError;
  // Retry transient failures (timeout/abort, network, 429/5xx) with backoff — the workspace
  // API is intermittently slow, and a whole lesson shouldn't die on one flaky call.
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await callOnce();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === retries) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;

  async function callOnce() {
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
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Qwen call failed for agent "${agent}": HTTP ${response.status} — ${detail.slice(0, 500)}`);
    }
    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Qwen returned no content for agent "${agent}"`);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Agent "${agent}" returned invalid JSON: ${text.slice(0, 300)}`);
    }
    return { json, usage: payload.usage ?? null, model };
  } finally {
    clearTimeout(timer);
  }
  }
}

function isTransient(error) {
  const m = String(error?.message || error);
  return (
    error?.name === 'AbortError' ||
    /aborted|network|fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(m) ||
    /HTTP (429|500|502|503|504)/.test(m)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
