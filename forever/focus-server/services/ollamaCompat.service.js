// server/services/ollamaCompat.service.js
// Fixed Ollama compatibility service.
// Supports BOTH env styles safely:
// 1) OLLAMA_CLOUD_URL=http://host:11434
// 2) OLLAMA_CLOUD_URL=http://host:11434/api/generate
//
// This prevents the broken URL:
// /api/generate/api/generate

const DEFAULT_TIMEOUT_MS = Number(
  process.env.OLLAMA_TIMEOUT_MS ||
    process.env.OLLAMA_CLOUD_TIMEOUT_MS ||
    process.env.CONNECT_LEARNING_OLLAMA_TIMEOUT_MS ||
    240000
);

function cleanUrl(value = "") {
  let raw = String(value || "").trim();

  if (!raw) return "";

  // Fix accidental spaces/newlines.
  raw = raw.replace(/\s+/g, "");

  // Fix your current broken typo-style value:
  // http://host:11434/api/generateOLLAMA_CLOU
  // becomes:
  // http://host:11434/api/generate
  const knownEndpoint = raw.match(/^(.*?\/api\/(?:generate|embeddings|tags))/i);
  if (knownEndpoint?.[1]) {
    raw = knownEndpoint[1];
  }

  return raw.replace(/\/+$/, "");
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getCloudUrl() {
  return cleanUrl(
    process.env.CONNECT_LEARNING_OLLAMA_URL ||
      process.env.CONNECT_LEARNING_OLLAMA_BASE_URL ||
      process.env.OLLAMA_CLOUD_URL ||
      process.env.OLLAMA_BASE_URL ||
      process.env.D_URL ||
      ""
  );
}

function getLocalUrl() {
  return cleanUrl(
    process.env.OLLAMA_LOCAL_URL ||
      process.env.OLLAMA_LOCAL_BASE_URL ||
      "http://localhost:11434"
  );
}

function getDefaultModel() {
  return (
    process.env.CONNECT_LEARNING_OLLAMA_MODEL ||
    process.env.CONNECT_LEARNING_FAST_MODEL ||
    process.env.OLLAMA_CLOUD_MODEL ||
    process.env.OLLAMA_MODEL ||
    process.env.OLLAMA_LOCAL_MODEL ||
    "gemma3:4b"
  );
}

function getLocalModel() {
  return process.env.OLLAMA_LOCAL_MODEL || process.env.OLLAMA_MODEL || getDefaultModel();
}

function getEmbedModel() {
  return process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text:latest";
}

function replaceKnownEndpoint(url = "", nextEndpoint = "generate") {
  const clean = cleanUrl(url);

  if (!clean) return "";

  if (/\/api\/generate$/i.test(clean)) {
    return clean.replace(/\/api\/generate$/i, `/api/${nextEndpoint}`);
  }

  if (/\/api\/embeddings$/i.test(clean)) {
    return clean.replace(/\/api\/embeddings$/i, `/api/${nextEndpoint}`);
  }

  if (/\/api\/tags$/i.test(clean)) {
    return clean.replace(/\/api\/tags$/i, `/api/${nextEndpoint}`);
  }

  return `${clean}/api/${nextEndpoint}`;
}

function buildGenerateUrl(baseUrl) {
  return replaceKnownEndpoint(baseUrl, "generate");
}

function buildEmbedUrl(baseUrl) {
  return replaceKnownEndpoint(baseUrl, "embeddings");
}

function buildTagsUrl(baseUrl) {
  return replaceKnownEndpoint(baseUrl, "tags");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonCandidate(text = "") {
  const raw = String(text || "").trim();

  if (!raw) {
    throw new Error("Empty AI response.");
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstObj = raw.indexOf("{");
  const lastObj = raw.lastIndexOf("}");

  if (firstObj >= 0 && lastObj > firstObj) {
    return raw.slice(firstObj, lastObj + 1);
  }

  const firstArr = raw.indexOf("[");
  const lastArr = raw.lastIndexOf("]");

  if (firstArr >= 0 && lastArr > firstArr) {
    return raw.slice(firstArr, lastArr + 1);
  }

  return raw;
}

function tryParseJson(text = "") {
  const candidate = extractJsonCandidate(text);

  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    const repaired = candidate
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");

    try {
      return JSON.parse(repaired);
    } catch {
      const error = new Error(`Failed to parse AI JSON: ${firstError.message}`);
      error.raw = text;
      throw error;
    }
  }
}

function normalizePromptInput(input) {
  if (typeof input === "string") {
    return { prompt: input };
  }

  return input || {};
}

function buildSystemWrappedPrompt({ system = "", prompt = "", json = false } = {}) {
  const parts = [];

  if (system) {
    parts.push(`SYSTEM:\n${system}`);
  }

  if (json) {
    parts.push(
      [
        "OUTPUT RULES:",
        "Return valid JSON only.",
        "Do not include markdown.",
        "Do not include explanations outside JSON.",
        "Do not wrap JSON in code fences.",
      ].join("\n")
    );
  }

  parts.push(`USER:\n${prompt}`);

  return parts.filter(Boolean).join("\n\n");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`Ollama request failed ${res.status}: ${text.slice(0, 500)}`);
    }

    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { response: text };
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Ollama request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callOllamaGenerateOnce({
  baseUrl,
  model,
  prompt,
  system = "",
  temperature = 0.2,
  top_p = 0.9,
  top_k = 40,
  num_predict = 4096,
  num_ctx,
  repeat_penalty,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  images = [],
  format = undefined,
  json = false,
} = {}) {
  const finalBaseUrl = cleanUrl(baseUrl);

  if (!finalBaseUrl) {
    throw new Error("Ollama baseUrl is missing.");
  }

  if (!model) {
    throw new Error("Ollama model is missing.");
  }

  const finalPrompt = buildSystemWrappedPrompt({
    system,
    prompt,
    json,
  });

  const options = {
    temperature,
    top_p,
    top_k,
    num_predict,
  };

  if (num_ctx !== undefined) {
    options.num_ctx = Number(num_ctx);
  }

  if (repeat_penalty !== undefined) {
    options.repeat_penalty = Number(repeat_penalty);
  }

  const body = {
    model,
    prompt: finalPrompt,
    stream: false,
    options,
  };

  if (format) {
    body.format = format;
  }

  if (Array.isArray(images) && images.length) {
    body.images = images;
  }

  const url = buildGenerateUrl(finalBaseUrl);
  const started = Date.now();

  console.log(
    `[ollamaCompat] calling ${url} model=${model} timeout=${timeoutMs}ms images=${
      body.images?.length || 0
    }`
  );

  const jsonResponse = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  const ms = Date.now() - started;
  const response = String(jsonResponse.response || "");

  console.log(`[ollamaCompat] success in ${ms}ms chars=${response.length}`);

  return {
    text: response,
    raw: jsonResponse,
    model,
    baseUrl: finalBaseUrl,
    url,
    latencyMs: ms,
  };
}

function shouldAllowLocalFallback(opts = {}, cloudUrl = "") {
  if (opts.allowLocalFallback !== undefined) {
    return Boolean(opts.allowLocalFallback);
  }

  if (boolEnv("CONNECT_LEARNING_CLOUD_ONLY", false)) {
    return false;
  }

  if (boolEnv("OLLAMA_DISABLE_LOCAL_FALLBACK", false)) {
    return false;
  }

  if (!cloudUrl) {
    return true;
  }

  return boolEnv("OLLAMA_LOCAL_FALLBACK", true);
}

export async function callOllamaText(input = {}) {
  const opts = normalizePromptInput(input);

  const timeoutMs = safeNumber(
    opts.timeoutMs,
    Number(
      process.env.CONNECT_LEARNING_OLLAMA_TIMEOUT_MS ||
        process.env.OLLAMA_CLOUD_TIMEOUT_MS ||
        DEFAULT_TIMEOUT_MS
    )
  );

  const model = opts.model || getDefaultModel();
  const cloudUrl = cleanUrl(opts.baseUrl || getCloudUrl());
  const localUrl = getLocalUrl();
  const allowLocalFallback = shouldAllowLocalFallback(opts, cloudUrl);

  const attempts = Math.max(1, safeNumber(opts.attempts, Number(process.env.CONNECT_LEARNING_OLLAMA_RETRIES || 1)));

  let lastError = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      if (cloudUrl) {
        return await callOllamaGenerateOnce({
          ...opts,
          baseUrl: cloudUrl,
          model,
          timeoutMs,
        });
      }

      if (localUrl && allowLocalFallback) {
        return await callOllamaGenerateOnce({
          ...opts,
          baseUrl: localUrl,
          model: opts.model || getLocalModel(),
          timeoutMs,
        });
      }

      throw new Error("No cloud Ollama URL configured and local fallback is disabled.");
    } catch (error) {
      lastError = error;
      console.warn(
        `[ollamaCompat] cloud/local failed attempt ${i + 1}/${attempts}:`,
        error.message
      );

      if (i < attempts - 1) {
        await sleep(700);
      }
    }
  }

  if (allowLocalFallback && cloudUrl && localUrl) {
    try {
      console.warn("[ollamaCompat] trying local fallback...");
      return await callOllamaGenerateOnce({
        ...opts,
        baseUrl: localUrl,
        model: opts.localModel || getLocalModel(),
        timeoutMs: safeNumber(opts.localTimeoutMs, Number(process.env.OLLAMA_LOCAL_TIMEOUT_MS || timeoutMs)),
      });
    } catch (error) {
      throw new Error(
        `Cloud Gemma failed and local fallback also failed: ${lastError?.message}; local: ${error.message}`
      );
    }
  }

  throw new Error(
    `Cloud Gemma failed and local fallback disabled: ${lastError?.message || "unknown error"}`
  );
}

function shouldRepairJson(opts = {}) {
  if (opts.repairJson !== undefined) return Boolean(opts.repairJson);
  return boolEnv("OLLAMA_JSON_REPAIR", true);
}

async function repairJsonWithModel({ badText = "", originalPrompt = "", opts = {}, firstError = null } = {}) {
  const repairPrompt = [
    "You are a JSON repair tool.",
    "The previous model response was intended to be JSON but could not be parsed.",
    "Return ONLY corrected valid JSON. Do not add markdown or explanation.",
    "Preserve all supported facts from the bad response. If a field is unknown, use an empty array/string/null as appropriate.",
    "The expected task prompt was:",
    String(originalPrompt || "").slice(0, 5000),
    "Parse error:",
    String(firstError?.message || firstError || "unknown"),
    "Bad response:",
    String(badText || "").slice(0, 12000),
  ].join("\n\n");

  console.warn("[ollamaCompat] trying JSON repair call...");

  const repaired = await callOllamaText({
    ...opts,
    prompt: repairPrompt,
    system: "Repair invalid JSON into strict valid JSON only.",
    json: true,
    format: opts.format || "json",
    temperature: 0,
    timeoutMs: safeNumber(opts.repairTimeoutMs, safeNumber(opts.timeoutMs, DEFAULT_TIMEOUT_MS)),
    attempts: 1,
  });

  const parsed = tryParseJson(repaired.text);

  return {
    parsed,
    repairMeta: {
      repaired: true,
      repairModel: repaired.model,
      repairUrl: repaired.url,
      repairLatencyMs: repaired.latencyMs,
    },
  };
}

export async function callOllamaJson(input = {}) {
  const opts = normalizePromptInput(input);

  const result = await callOllamaText({
    ...opts,
    json: true,
    format: opts.format || "json",
    temperature: opts.temperature ?? 0.1,
  });

  try {
    const parsed = tryParseJson(result.text);

    return {
      ...parsed,
      _meta: {
        model: result.model,
        baseUrl: result.baseUrl,
        url: result.url,
        latencyMs: result.latencyMs,
        repaired: false,
      },
    };
  } catch (error) {
    console.error("[ollamaCompat] JSON parse failed:", error.message);
    console.error("[ollamaCompat] raw AI response:", result.text.slice(0, 2000));

    if (shouldRepairJson(opts)) {
      try {
        const { parsed, repairMeta } = await repairJsonWithModel({
          badText: result.text,
          originalPrompt: opts.prompt,
          opts,
          firstError: error,
        });

        return {
          ...parsed,
          _meta: {
            model: result.model,
            baseUrl: result.baseUrl,
            url: result.url,
            latencyMs: result.latencyMs,
            repaired: true,
            ...repairMeta,
          },
        };
      } catch (repairError) {
        console.error("[ollamaCompat] JSON repair failed:", repairError.message);
        const finalError = new Error(`AI JSON parse failed and repair failed: ${error.message}; repair: ${repairError.message}`);
        finalError.raw = result.text;
        throw finalError;
      }
    }

    throw error;
  }
}

export async function callOllamaVisionJson(input = {}) {
  const opts = normalizePromptInput(input);

  return callOllamaJson({
    ...opts,
    images: opts.images || [],
    temperature: opts.temperature ?? 0.1,
    timeoutMs: safeNumber(
      opts.timeoutMs,
      Number(process.env.CONNECT_LEARNING_VISION_TIMEOUT_MS || process.env.OLLAMA_VISION_TIMEOUT_MS || 300000)
    ),
  });
}

export async function callOllamaVisionText(input = {}) {
  const opts = normalizePromptInput(input);

  return callOllamaText({
    ...opts,
    images: opts.images || [],
    temperature: opts.temperature ?? 0.2,
    timeoutMs: safeNumber(
      opts.timeoutMs,
      Number(process.env.CONNECT_LEARNING_VISION_TIMEOUT_MS || process.env.OLLAMA_VISION_TIMEOUT_MS || 300000)
    ),
  });
}

export async function embedText(text = "", options = {}) {
  const input = String(text || "").trim();

  if (!input) {
    return [];
  }

  const baseUrl =
    options.baseUrl ||
    cleanUrl(process.env.OLLAMA_EMBED_URL || "") ||
    getCloudUrl() ||
    getLocalUrl();

  const model = options.model || getEmbedModel();
  const timeoutMs = safeNumber(
    options.timeoutMs,
    Number(process.env.CONNECT_LEARNING_EMBED_TIMEOUT_MS || process.env.OLLAMA_EMBED_TIMEOUT_MS || 120000)
  );

  try {
    const res = await fetchWithTimeout(
      buildEmbedUrl(baseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: input,
        }),
      },
      timeoutMs
    );

    if (Array.isArray(res.embedding)) {
      return res.embedding;
    }

    if (Array.isArray(res.embeddings?.[0])) {
      return res.embeddings[0];
    }

    return [];
  } catch (error) {
    console.warn("[ollamaCompat] embedText failed:", error.message);
    return [];
  }
}

export async function checkOllamaHealth(options = {}) {
  const baseUrl = cleanUrl(options.baseUrl || getCloudUrl() || getLocalUrl());
  const timeoutMs = safeNumber(options.timeoutMs, 15000);

  try {
    const res = await fetchWithTimeout(
      buildTagsUrl(baseUrl),
      {
        method: "GET",
      },
      timeoutMs
    );

    return {
      ok: true,
      baseUrl,
      generateUrl: buildGenerateUrl(baseUrl),
      tagsUrl: buildTagsUrl(baseUrl),
      models: Array.isArray(res.models) ? res.models : [],
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl,
      generateUrl: buildGenerateUrl(baseUrl),
      tagsUrl: buildTagsUrl(baseUrl),
      message: error.message,
    };
  }
}

export function extractJsonFromText(text = "") {
  return tryParseJson(text);
}

export default {
  callOllamaText,
  callOllamaJson,
  callOllamaVisionJson,
  callOllamaVisionText,
  embedText,
  checkOllamaHealth,
  extractJsonFromText,
};