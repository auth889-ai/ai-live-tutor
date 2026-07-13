import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { callQwenJson } from '../../lib/qwen/client.js';

const ENV = { DASHSCOPE_API_KEY: 'test-key', DASHSCOPE_BASE_URL: 'http://qwen.test' };
const reply = (content) => new Response(
  JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

test('zod schema violations are named precisely and retried in-call (provider-safe structured output)', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => reply(++calls === 1
    ? '{"domain": 42}'                 // wrong type -> schema violation -> retry
    : '{"domain": "architecture"}');   // valid on the second attempt
  try {
    const out = await callQwenJson({
      agent: 'domain_router', system: 's', user: 'u', retries: 2, env: ENV,
      schema: z.object({ domain: z.string() }),
    });
    assert.equal(calls, 2, 'schema violation retried once');
    assert.deepEqual(out.json, { domain: 'architecture' });
  } finally {
    globalThis.fetch = original;
  }
});
