// ElevenLabs TTS adapter — natural voice WITH built-in character timestamps, so we get
// word-level sync directly (no separate ASR alignment). Activated by ELEVENLABS_API_KEY.
// Returns audio bytes + measured duration + per-word timings for the reconciler.

import { ttsCacheGet, ttsCachePut } from '../tts-cache.js';

const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // a stock ElevenLabs voice id

export async function synthesizeWithTimestamps({
  text,
  voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE,
  modelId = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5',
  timeoutMs = 60_000,
  env = process.env,
}) {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey?.trim()) throw new Error('ELEVENLABS_API_KEY is not set');
  if (!text?.trim()) throw new Error('synthesizeWithTimestamps: text is required');

  // TTS cache: identical line + voice + model -> stored audio, no provider call
  const cacheParams = { text, voiceId, modelId };
  const cached = await ttsCacheGet(cacheParams, { env });
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
      body: JSON.stringify({ text, model_id: modelId, output_format: 'mp3_44100_128' }),
    });
    if (!response.ok) throw new Error(`ElevenLabs failed: HTTP ${response.status} — ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json();
    const bytes = Buffer.from(payload.audio_base64, 'base64');
    const words = charsToWordTimings(payload.alignment);
    const durationMs = words.length ? words[words.length - 1].endMs : 0;
    const _out = { bytes, wordTimings: words, durationMs };
    await ttsCachePut(cacheParams, _out, { env });
    return _out;
  } finally {
    clearTimeout(timer);
  }
}

// Aggregate ElevenLabs character timings into word timings (pure — unit-tested).
export function charsToWordTimings(alignment) {
  if (!alignment?.characters?.length) return [];
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;

  const words = [];
  let current = null;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      if (current) {
        words.push(current);
        current = null;
      }
      continue;
    }
    if (!current) current = { word: '', startMs: Math.round(starts[i] * 1000), endMs: 0 };
    current.word += ch;
    current.endMs = Math.round(ends[i] * 1000);
  }
  if (current) words.push(current);
  return words;
}
