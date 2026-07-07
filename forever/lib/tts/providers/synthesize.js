// Qwen3-TTS adapter: one voice line -> one audio clip (url + measured duration).
// Non-realtime HTTP synthesis via DashScope native API. Honest failure, no silent
// empty audio. Duration is decoded from the returned audio so the reconciler gets
// REAL clip lengths (playbook Phase 2 decision).

import { qwenConfig } from '../../qwen/client.js';
import { measureAudioDurationMs } from '../audio/measure-duration.js';

// TTS model availability is REGIONAL: a workspace that serves the chat models may not serve
// any TTS model (the Frankfurt workspace doesn't). A dedicated TTS workspace can be
// configured via ALIBABA_TTS_API_KEY + ALIBABA_TTS_BASE_URL; placeholders are ignored.
function ttsEndpoint(env) {
  const key = (env.ALIBABA_TTS_API_KEY || '').trim();
  const base = (env.ALIBABA_TTS_BASE_URL || '').trim();
  if (key && base && !/^your[_-]/i.test(key)) {
    return { apiKey: key, nativeBase: `${base.replace(/\/$/, '')}/api/v1` };
  }
  const { apiKey, baseUrl } = qwenConfig(env);
  return { apiKey, nativeBase: baseUrl.replace(/\/compatible-mode\/v1$/, '/api/v1') };
}

export async function synthesizeLine({
  text,
  voice = process.env.TTS_VOICE_ID || 'Cherry',
  model = process.env.TTS_MODEL || 'qwen3-tts-flash',
  languageType = 'English',
  timeoutMs = 60_000,
  env = process.env,
}) {
  const { apiKey, nativeBase } = ttsEndpoint(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${nativeBase}/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: { text, voice, language_type: languageType },
      }),
    });
    if (!response.ok) {
      throw new Error(`TTS failed: HTTP ${response.status} — ${(await response.text()).slice(0, 400)}`);
    }
    const payload = await response.json();
    const url = payload.output?.audio?.url;
    if (!url) throw new Error(`TTS returned no audio url: ${JSON.stringify(payload).slice(0, 300)}`);

    const audio = await fetch(url, { signal: controller.signal });
    if (!audio.ok) throw new Error(`Failed to download TTS audio: HTTP ${audio.status}`);
    const bytes = Buffer.from(await audio.arrayBuffer());
    const durationMs = measureAudioDurationMs(bytes);
    return { url, bytes, durationMs };
  } finally {
    clearTimeout(timer);
  }
}
