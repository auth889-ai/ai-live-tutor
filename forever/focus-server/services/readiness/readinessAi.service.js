import { callOllamaJson } from "../ollamaCompat.service.js";

function normalizeAiResult(result, fallback) {
  if (!result) return fallback;

  if (result.data && typeof result.data === "object") return result.data;
  if (result.json && typeof result.json === "object") return result.json;
  if (result.result && typeof result.result === "object") return result.result;
  if (typeof result === "object") return result;

  return fallback;
}

export async function callReadinessGemma(prompt, fallback, options = {}) {
  try {
    const result = await callOllamaJson({
      prompt,
      system:
        options.system ||
        "You are Gemma, a student readiness coach. Return valid JSON only.",
      timeoutMs: Number(
        process.env.READINESS_GEMMA_TIMEOUT_MS ||
          process.env.OLLAMA_TIMEOUT_MS ||
          90000
      ),
      model:
        process.env.READINESS_GEMMA_MODEL ||
        process.env.OLLAMA_CLOUD_MODEL ||
        process.env.OLLAMA_MODEL,
      temperature: options.temperature ?? 0.12,
      num_predict: options.num_predict || 4096,
      attempts: Number(process.env.READINESS_GEMMA_RETRIES || 1),
      allowLocalFallback: process.env.READINESS_GEMMA_LOCAL_FALLBACK !== "false",
    });

    return normalizeAiResult(result, fallback);
  } catch (error) {
    console.warn("[ReadinessCoach] Gemma fallback:", error?.message || error);
    return fallback;
  }
}