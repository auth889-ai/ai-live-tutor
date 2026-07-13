// Qwen multimodal vision call (qwen3.7-plus, OpenAI-compatible endpoint). Sends image(s) +
// a prompt and returns validated JSON. Used to SEE and explain figures inside a PDF/URL/
// video so the tutor can teach FROM the real image, not just its text.
// Transport: LangChain ChatOpenAI (user rule: NO agent runs on a bare AI call) — multimodal
// content parts over the same DashScope compatible-mode door, usage recorded in the ledger.

import { ChatOpenAI } from '@langchain/openai';
import { qwenConfig, recordUsage } from './client.js';

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
        [{ role: 'system', content: system }, { role: 'user', content }],
        { signal: controller.signal },
      );
    } catch (error) {
      const status = error?.status ?? error?.response?.status;
      throw new Error(`Qwen vision failed for "${agent}": ${status ? `HTTP ${status} — ` : ''}${String(error?.message ?? error).slice(0, 400)}`);
    }
    const text = typeof message.content === 'string'
      ? message.content
      : (message.content ?? []).map((part) => part?.text ?? '').join('');
    if (!text) throw new Error(`Qwen vision returned no content for "${agent}"`);
    const tu = message.response_metadata?.tokenUsage;
    const usage = message.response_metadata?.usage
      ?? (tu ? { prompt_tokens: tu.promptTokens, completion_tokens: tu.completionTokens, total_tokens: tu.totalTokens } : null);
    recordUsage(agent, usage);
    return { json: JSON.parse(text), usage };
  } finally {
    clearTimeout(timer);
  }
}
