import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheKey, cacheGet, cachePut } from '../../lib/generation/cache/response-cache.js';

// Step 4 production cache — model-free tests (doc law): key determinism + flag discipline.

test('cache keys are deterministic and prompt-sensitive', () => {
  const a = cacheKey({ agent: 'x', model: 'm', system: 's', user: 'u', temperature: 0.4, maxTokens: 100 });
  const b = cacheKey({ agent: 'x', model: 'm', system: 's', user: 'u', temperature: 0.4, maxTokens: 100 });
  const c = cacheKey({ agent: 'x', model: 'm', system: 's', user: 'DIFFERENT', temperature: 0.4, maxTokens: 100 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('cache is a no-op unless QWEN_CACHE=1 (flag discipline: default off)', async () => {
  const params = { agent: 'x', model: 'm', system: 's', user: 'u', temperature: 0, maxTokens: 1 };
  assert.equal(await cacheGet(params, { env: {} }), null);
  await cachePut(params, { json: {} }, { env: {} }); // must not throw, must not write
  assert.equal(await cacheGet(params, { env: {} }), null);
});
