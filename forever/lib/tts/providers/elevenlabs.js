// ElevenLabs TTS adapter — natural voice WITH built-in character timestamps, so we get
// word-level sync directly (no separate ASR alignment). Activated by ELEVENLABS_API_KEY.
// Returns audio bytes + measured duration + per-word timings for the reconciler.

import { ttsCacheGet, ttsCachePut } from '../tts-cache.js';

const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // a stock ElevenLabs voice id

// Multiple keys can be pooled so their credits add up: when one key runs out of
// characters, we fall back to the next automatically. Sources (in order, de-duplicated):
//   ELEVENLABS_API_KEY            single key
//   ELEVENLABS_API_KEYS           comma-separated list
//   ELEVENLABS_API_KEY_1 .. _10   numbered keys
export function elevenLabsKeys(env = process.env) {
  const keys = [];
  const add = (v) => { const k = (v || '').trim(); if (k && !keys.includes(k)) keys.push(k); };
  add(env.ELEVENLABS_API_KEY);
  (env.ELEVENLABS_API_KEYS || '').split(',').forEach(add);
  for (let i = 1; i <= 10; i += 1) add(env[`ELEVENLABS_API_KEY_${i}`]);
  return keys;
}

// A key that has spent its credits stays out for the rest of the process.
const exhaustedKeys = new Set();

// A key is "unusable" — skip it and try the next — on rate/quota (429) OR any auth failure
// (401: invalid/expired key, out of credits, unusual activity). This makes a bad or empty key
// fall through to the next pooled key instead of failing the whole lesson.
function isKeyUnusable(status, body = '') {
  if (status === 401 || status === 429 || status === 403) return true;
  return /quota_exceeded|out of (characters|credits)|insufficient|invalid_api_key|unauthorized/i.test(body);
}

export async function synthesizeWithTimestamps({
  text,
  // Neighbor-narration context (ElevenLabs' documented fields for regenerating one segment
  // without a prosody seam against the clips around it — the edit-and-revoice case). Not
  // part of the cache key on purpose: unchanged lines keep hitting their cached clip.
  previousText,
  nextText,
  voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE,
  modelId = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5',
  timeoutMs = 60_000,
  env = process.env,
}) {
  const allKeys = elevenLabsKeys(env);
  if (!allKeys.length) throw new Error('ELEVENLABS_API_KEY is not set');
  if (!text?.trim()) throw new Error('synthesizeWithTimestamps: text is required');

  // TTS cache: identical line + voice + model -> stored audio, no provider call
  const cacheParams = { text, voiceId, modelId };
  const cached = await ttsCacheGet(cacheParams, { env });
  if (cached) return cached;

  // Try live keys first; if every key is marked exhausted, give them all one more chance.
  const live = allKeys.filter((k) => !exhaustedKeys.has(k));
  const order = live.length ? live : allKeys;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  let lastError;

  for (let i = 0; i < order.length; i += 1) {
    const apiKey = order[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
        body: JSON.stringify({
          text,
          model_id: modelId,
          output_format: 'mp3_44100_128',
          ...(previousText?.trim() ? { previous_text: previousText.trim().slice(-600) } : {}),
          ...(nextText?.trim() ? { next_text: nextText.trim().slice(0, 600) } : {}),
        }),
      });
      if (!response.ok) {
        const bodyText = (await response.text().catch(() => '')).slice(0, 400);
        if (isKeyUnusable(response.status, bodyText)) {
          exhaustedKeys.add(apiKey); // bad/spent — skip it next time
          lastError = new Error(`ElevenLabs key #${i + 1} unusable (HTTP ${response.status})`);
          continue; // fall back to the next key
        }
        throw new Error(`ElevenLabs failed: HTTP ${response.status} — ${bodyText}`);
      }
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

  throw new Error(`All ${allKeys.length} ElevenLabs key(s) exhausted or failing. Last: ${lastError?.message || 'unknown'}`);
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
