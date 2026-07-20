import assert from 'node:assert/strict';
import test from 'node:test';
import { rm } from 'node:fs/promises';

import { ttsCacheKey, ttsCacheGet, ttsCachePut } from '../../lib/tts/tts-cache.js';

test('tts cache keys: deterministic, sensitive to text and voice', () => {
  const a = ttsCacheKey({ text: 'hello class', voiceId: 'v1', modelId: 'm1' });
  assert.equal(a, ttsCacheKey({ text: 'hello class', voiceId: 'v1', modelId: 'm1' }));
  assert.notEqual(a, ttsCacheKey({ text: 'hello class!', voiceId: 'v1', modelId: 'm1' }));
  assert.notEqual(a, ttsCacheKey({ text: 'hello class', voiceId: 'v2', modelId: 'm1' }));
});

test('roundtrip: put then get returns bytes, words and duration; TTS_CACHE=0 disables', async () => {
  const params = { text: `test-line-${Math.floor(1e6 * 0.421)}`, voiceId: 'vx', modelId: 'mx' };
  const payload = { bytes: Buffer.from('AUDIOBYTES'), words: [{ w: 'test', startMs: 0 }], durationMs: 1234 };
  await ttsCachePut(params, payload);
  const hit = await ttsCacheGet(params);
  assert.ok(hit, 'cache hit expected');
  assert.equal(hit.bytes.toString(), 'AUDIOBYTES');
  assert.equal(hit.durationMs, 1234);
  assert.equal(hit.words[0].w, 'test');
  assert.equal(await ttsCacheGet(params, { env: { TTS_CACHE: '0' } }), null);
  await rm(`.data/tts-cache/${ttsCacheKey(params)}.json`, { force: true });
});
