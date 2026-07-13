import assert from 'node:assert/strict';
import test from 'node:test';

import { callQwenJson, isTransient } from '../../lib/qwen/client.js';

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
