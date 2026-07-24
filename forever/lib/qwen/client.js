// The ONLY door to Qwen Cloud. Every model call in Forever goes through here:
// one focused job per call, JSON output, usage returned for the cost ledger,
// honest failure (no fallbacks). Transport: LangChain ChatOpenAI over the
// OpenAI-compatible DashScope endpoint (user decision 2026-07-13).

import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';

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

import { cacheGet, cachePut } from '../generation/cache/response-cache.js';

export async function runAgentChain({
  agent,
  system,
  user,
  model = process.env.MODEL_SCENE || 'qwen3.7-plus',
  temperature = 0.4,
  maxTokens = 4000,
  // Optional Zod schema: when set, the call uses LangChain withStructuredOutput in
  // FUNCTION-CALLING mode (research-verified: the jsonSchema default 400s on DashScope;
  // functionCalling steers generation with the schema AND validates client-side).
  schema = null,
  // 300s: a heavy board (4000-token JSON) at DashScope's slow-window decode (~20 tok/s) takes
  // >150s — a shorter timeout deterministically kills exactly the richest scenes (dry runs,
  // worked examples) while light callout scenes survive. Measured live 2026-07-08.
  timeoutMs = 300_000,
  retries = 3,
  env = process.env,
}) {
  const { apiKey, baseUrl } = qwenConfig(env);
  // A slow/hanging workspace (e.g. a regional MaaS gateway) makes the generous 300s×3-retry
  // default cost up to 20 min on ONE hung call. QWEN_TIMEOUT_MS / QWEN_RETRIES let a slow
  // workspace fail fast instead. Defaults unchanged when the envs are unset.
  const envTimeout = Number(env.QWEN_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) timeoutMs = envTimeout;
  const envRetries = Number(env.QWEN_RETRIES);
  if (Number.isFinite(envRetries) && envRetries >= 0) retries = envRetries;
  // DashScope hard rule with response_format json_object: the messages must contain the
  // literal word "json" — a prompt without it 400s the whole call (live-caught 2026-07-15:
  // the Arbiter's ruling prompt lacked it and a Training scene died for it). Guarded at the
  // ONE door so no agent can ever hit this again.
  if (!/json/i.test(system) && !/json/i.test(user)) system = `${system}\nOutput ONLY JSON.`;
  // EXACT-MATCH CACHE (QWEN_CACHE=1, default off): identical prompt -> stored result.
  const cacheParams = { agent, model, system, user, temperature, maxTokens };
  const cached = await cacheGet(cacheParams, { env });
  if (cached) return cached;
  // CIRCUIT BREAKER (live-caught 2026-07-24: a degraded provider window stretched one lesson
  // to 3.9 HOURS — a 16-minute qwen3.6-flash routing call, 8 scenes dropped anyway. Generous
  // retries are right for a healthy pool and exactly wrong for a sick one). When the pool is
  // measurably degraded, fail FAST and let the honest-failure machinery drop scenes quickly.
  if (providerDegraded()) {
    retries = Math.min(retries, 1);
    timeoutMs = Math.min(timeoutMs, 120_000);
  }
  let lastError;
  // Retry transient failures (timeout/abort, network, 429/5xx) with backoff — the workspace
  // API is intermittently slow, and a whole lesson shouldn't die on one flaky call.
  // Empty content / unparseable JSON also retry HERE (with response_format json_object they
  // mean a degraded provider window — one empty response dropped a whole dry-run scene,
  // measured 2026-07-09) — but they stay OUT of isTransient, which callers use to judge
  // whether a fully-failed call deserves a whole new scene attempt.
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await callOnce();
      noteProviderSuccess();
      return result;
    } catch (error) {
      lastError = error;
      const flakyResponse = /returned no content|returned invalid JSON/.test(String(error?.message || error));
      if (isTransient(error) || flakyResponse) noteProviderFailure();
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
    // A real LCEL chain per call — ChatPromptTemplate piped into the model (and into the
    // structured-output parser when a schema is given). Mustache format so the JSON braces
    // that fill our prompts are never mistaken for template variables. runName = the agent,
    // so LangSmith traces read as the society's roles, not anonymous invokes.
    const promptTemplate = ChatPromptTemplate.fromMessages(
      [['system', '{{system}}'], ['human', '{{user}}']],
      { templateFormat: 'mustache' },
    );
    let json;
    let usage;
    try {
      const chain = promptTemplate.pipe(llm);
      const message = await chain.invoke({ system, user }, { signal: controller.signal, runName: agent });
      const text = typeof message.content === 'string'
        ? message.content
        : (message.content ?? []).map((part) => part?.text ?? '').join('');
      if (!text) throw new Error(`Qwen returned no content for agent "${agent}"`);
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Agent "${agent}" returned invalid JSON: ${text.slice(0, 300)}`);
      }
      // Zod enforcement CLIENT-SIDE (live-caught: DashScope 400s on LangChain's forced
      // tool_choice, so functionCalling-mode structured output is off the table for this
      // provider — json_object + schema.safeParse gives the same guarantee, and a
      // violation feeds the SAME retry loop with the exact failing paths named).
      if (schema) {
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          const issues = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' ; ');
          throw new Error(`Agent "${agent}" returned invalid JSON: schema violations — ${issues}`);
        }
        json = parsed.data;
      }
      usage = usageFrom(message);
    } catch (error) {
      if (/returned invalid JSON|returned no content/.test(String(error?.message))) throw error;
      // Preserve the HTTP status in the message so isTransient() still classifies it.
      const status = error?.status ?? error?.response?.status;
      throw new Error(`Qwen call failed for agent "${agent}": ${status ? `HTTP ${status} — ` : ''}${String(error?.message ?? error).slice(0, 500)}`);
    }
    recordUsage(agent, usage);
    const out = { json, usage, model };
    await cachePut(cacheParams, out, { env });
    return out;
  } finally {
    clearTimeout(timer);
  }
  }
}

// Exported so the lesson generator can distinguish "the provider was flaky" (worth a second
// chance) from "the content failed its contract" (a real quality rejection).
// ─── provider circuit breaker (module state, ONE door = one health view) ───────────────
// 4 consecutive transient failures across ANY agents => degraded for 3 minutes: retries
// clamp to 1 and timeout to 120s, so a sick pool costs seconds per call, not 15 minutes.
// One success closes it instantly. Pure state helpers, unit-tested without a network.
const BREAKER_THRESHOLD = 4;
const BREAKER_COOLDOWN_MS = 180_000;
const breaker = { consecutive: 0, degradedUntil: 0 };

export function noteProviderFailure(now = Date.now()) {
  breaker.consecutive += 1;
  if (breaker.consecutive >= BREAKER_THRESHOLD && now >= breaker.degradedUntil) {
    breaker.degradedUntil = now + BREAKER_COOLDOWN_MS;
    console.error(`[qwen] provider degraded (${breaker.consecutive} consecutive transient failures) — failing fast for ${BREAKER_COOLDOWN_MS / 1000}s (retries→1, timeout→120s)`);
  }
}

export function noteProviderSuccess() {
  breaker.consecutive = 0;
  breaker.degradedUntil = 0;
}

export function providerDegraded(now = Date.now()) {
  // Time-based only: when the cooldown lapses the breaker goes HALF-OPEN — the next call
  // probes with full patience; its failure re-opens (consecutive is still >= threshold),
  // its success closes for good.
  return now < breaker.degradedUntil;
}

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

function usageFrom(message) {
  const tu = message?.response_metadata?.tokenUsage;
  return message?.response_metadata?.usage
    ?? (tu ? { prompt_tokens: tu.promptTokens, completion_tokens: tu.completionTokens, total_tokens: tu.totalTokens } : null);
}


// Compatibility alias: the door was renamed to say what it IS — every agent call runs a
// LangChain LCEL chain (ChatPromptTemplate -> ChatOpenAI -> zod-validated output), never
// a bare HTTP call. Old name kept so external callers/tests keep working.
export const callQwenJson = runAgentChain;
