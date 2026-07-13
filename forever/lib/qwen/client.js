// The ONLY door to Qwen Cloud. Every model call in Forever goes through here:
// one focused job per call, JSON output, usage returned for the cost ledger,
// honest failure (no fallbacks). Transport: LangChain ChatOpenAI over the
// OpenAI-compatible DashScope endpoint (user decision 2026-07-13).

import { ChatOpenAI } from '@langchain/openai';

const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

// Process-wide usage ledger: every call records its real token usage per agent, so cost
// is MEASURED (benchmark tables, ops dashboards), never estimated.
const ledger = { calls: 0, inputTokens: 0, outputTokens: 0, byAgent: {} };

export function recordUsage(agent, usage) {
  ledger.calls += 1;
  ledger.inputTokens += usage?.prompt_tokens ?? 0;
  ledger.outputTokens += usage?.completion_tokens ?? 0;
  const slot = (ledger.byAgent[agent] ??= { calls: 0, inputTokens: 0, outputTokens: 0 });
  slot.calls += 1;
  slot.inputTokens += usage?.prompt_tokens ?? 0;
  slot.outputTokens += usage?.completion_tokens ?? 0;
}

export function resetUsageLedger() {
  ledger.calls = 0;
  ledger.inputTokens = 0;
  ledger.outputTokens = 0;
  ledger.byAgent = {};
}

export function readUsageLedger() {
  return JSON.parse(JSON.stringify(ledger));
}

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
  // 300s: a heavy board (4000-token JSON) at DashScope's slow-window decode (~20 tok/s) takes
  // >150s — a shorter timeout deterministically kills exactly the richest scenes (dry runs,
  // worked examples) while light callout scenes survive. Measured live 2026-07-08.
  timeoutMs = 300_000,
  retries = 3,
  env = process.env,
}) {
  const { apiKey, baseUrl } = qwenConfig(env);
  let lastError;
  // Retry transient failures (timeout/abort, network, 429/5xx) with backoff — the workspace
  // API is intermittently slow, and a whole lesson shouldn't die on one flaky call.
  // Empty content / unparseable JSON also retry HERE (with response_format json_object they
  // mean a degraded provider window — one empty response dropped a whole dry-run scene,
  // measured 2026-07-09) — but they stay OUT of isTransient, which callers use to judge
  // whether a fully-failed call deserves a whole new scene attempt.
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await callOnce();
    } catch (error) {
      lastError = error;
      const flakyResponse = /returned no content|returned invalid JSON/.test(String(error?.message || error));
      if ((!isTransient(error) && !flakyResponse) || attempt === retries) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;

  // TRANSPORT: LangChain ChatOpenAI over DashScope compatible-mode (user decision
  // 2026-07-13: every agent call runs through LangChain, not a bare fetch). The single-door
  // principle is unchanged — this function remains the only way Forever talks to Qwen —
  // and OUR loop still owns retries/JSON contracts (maxRetries: 0 disables LangChain's).
  async function callOnce() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const llm = new ChatOpenAI({
      model,
      temperature,
      maxTokens,
      apiKey,
      configuration: { baseURL: baseUrl },
      modelKwargs: { response_format: { type: 'json_object' } },
      maxRetries: 0,
    });
    let message;
    try {
      message = await llm.invoke(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        { signal: controller.signal },
      );
    } catch (error) {
      // Preserve the HTTP status in the message so isTransient() still classifies it.
      const status = error?.status ?? error?.response?.status;
      throw new Error(`Qwen call failed for agent "${agent}": ${status ? `HTTP ${status} — ` : ''}${String(error?.message ?? error).slice(0, 500)}`);
    }
    const text = typeof message.content === 'string'
      ? message.content
      : (message.content ?? []).map((part) => part?.text ?? '').join('');
    if (!text) throw new Error(`Qwen returned no content for agent "${agent}"`);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Agent "${agent}" returned invalid JSON: ${text.slice(0, 300)}`);
    }
    const tu = message.response_metadata?.tokenUsage;
    const usage = message.response_metadata?.usage
      ?? (tu ? { prompt_tokens: tu.promptTokens, completion_tokens: tu.completionTokens, total_tokens: tu.totalTokens } : null);
    recordUsage(agent, usage);
    return { json, usage, model };
  } finally {
    clearTimeout(timer);
  }
  }
}

// Exported so the lesson generator can distinguish "the provider was flaky" (worth a second
// chance) from "the content failed its contract" (a real quality rejection).
export function isTransient(error) {
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
