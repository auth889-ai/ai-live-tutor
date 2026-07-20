// TTS CACHE — Universal Course Build Step 4: hash(text + voiceId + modelId + format) →
// stored synthesis. Identical narration lines never hit ElevenLabs twice — regeneration
// runs and repeated course builds reuse yesterday's audio for free. Disk-backed under
// .data/tts-cache (gitignored), JSON with base64 bytes + word timings + duration.
// Default ON (identical text → identical audio is semantics-preserving); TTS_CACHE=0 disables.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.join('.data', 'tts-cache');

export function ttsCacheKey({ text, voiceId, modelId, format = 'mp3_44100_128' }) {
  return createHash('sha256').update([voiceId, modelId, format, text].join(' ')).digest('hex');
}

export async function ttsCacheGet(params, { env = process.env } = {}) {
  if (env.TTS_CACHE === '0') return null;
  try {
    const raw = await readFile(path.join(DIR, `${ttsCacheKey(params)}.json`), 'utf8');
    const hit = JSON.parse(raw);
    return { bytes: Buffer.from(hit.audioBase64, 'base64'), words: hit.words ?? [], durationMs: hit.durationMs ?? 0 };
  } catch { return null; }
}

export async function ttsCachePut(params, { bytes, words = [], durationMs = 0 }, { env = process.env } = {}) {
  if (env.TTS_CACHE === '0') return;
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(
      path.join(DIR, `${ttsCacheKey(params)}.json`),
      JSON.stringify({ audioBase64: Buffer.from(bytes).toString('base64'), words, durationMs, at: new Date().toISOString() }),
    );
  } catch { /* cache is never load-bearing */ }
}
