import assert from 'node:assert/strict';
import test from 'node:test';

import { callQwenJson, isTransient, noteProviderFailure, noteProviderSuccess, providerDegraded } from '../../lib/qwen/client.js';

const ENV = { DASHSCOPE_API_KEY: 'test-key', DASHSCOPE_BASE_URL: 'http://qwen.test' };
// A REAL Response object: the LangChain/OpenAI transport reads status/headers, not a bare {ok, json}.
const reply = (content) => new Response(
  JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

test('isTransient: provider flakiness yes, real rejections no', () => {
  assert.equal(isTransient(new Error('Qwen call failed for agent "x": HTTP 503 — busy')), true);
  assert.equal(isTransient(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), true);
  assert.equal(isTransient(new Error('Qwen call failed for agent "x": HTTP 401 — bad key')), false);
  assert.equal(isTransient(new Error('Board Director failed contract validation after repair')), false);
});

test('an empty provider response is retried in-call, not fatal (the dropped-dry-run bug)', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => reply(++calls === 1 ? '' : '{"objects": []}');
  try {
    const out = await callQwenJson({ agent: 'board_director', system: 's', user: 'u', retries: 2, env: ENV });
    assert.equal(calls, 2, 'first (empty) response retried once');
    assert.deepEqual(out.json, { objects: [] });
  } finally {
    globalThis.fetch = original;
  }
});

test('truncated/invalid JSON is retried in-call; persistent garbage still fails honestly', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return reply('{"objects":[{"id"'); };
  try {
    await assert.rejects(
      () => callQwenJson({ agent: 'board_director', system: 's', user: 'u', retries: 1, env: ENV }),
      /returned invalid JSON/,
    );
    assert.equal(calls, 2); // retries exhausted: 1 try + 1 retry
  } finally {
    globalThis.fetch = original;
  }
});

// Circuit breaker: a degraded pool must cost seconds per call, not 15 minutes (live-caught
// 2026-07-24: 3.9-hour lesson, 16-minute flash routing call). Pure state transitions.
test('breaker opens after 4 consecutive transient failures and closes on one success', () => {
  noteProviderSuccess(); // clean slate
  assert.equal(providerDegraded(), false);
  for (let i = 0; i < 3; i += 1) noteProviderFailure(1000);
  assert.equal(providerDegraded(1000), false); // 3 strikes: still healthy
  noteProviderFailure(1000);
  assert.equal(providerDegraded(1000), true); // 4th opens it
  assert.equal(providerDegraded(1000 + 179_000), true); // holds through the cooldown
  // one SUCCESS closes it immediately — a healthy pool gets its generous retries back
  noteProviderSuccess();
  assert.equal(providerDegraded(1000 + 179_000), false);
  // cooldown expiry alone also closes it (half-open probe path)
  for (let i = 0; i < 4; i += 1) noteProviderFailure(5000);
  assert.equal(providerDegraded(5000 + 181_000), false);
  noteProviderSuccess(); // leave global state clean for other tests
});
