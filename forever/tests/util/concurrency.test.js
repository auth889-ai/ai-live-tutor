import assert from 'node:assert/strict';
import test from 'node:test';

import { mapWithConcurrency } from '../../lib/util/concurrency.js';

test('runs at most `limit` tasks in flight and preserves input order', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapWithConcurrency([10, 20, 30, 40, 50], 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.equal(peak, 2); // never more than the cap
  assert.deepEqual(results.map((r) => r.value), [20, 40, 60, 80, 100]); // input order kept
});

test('allSettled semantics: one failure never kills the batch', async () => {
  const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
    if (n === 2) throw new Error('scene exploded');
    return n;
  });
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(String(results[1].reason.message), /scene exploded/);
  assert.equal(results[2].value, 3);
});

test('degenerate limits are clamped to 1 (never unbounded, never zero)', async () => {
  const results = await mapWithConcurrency([1, 2], 0, async (n) => n);
  assert.deepEqual(results.map((r) => r.value), [1, 2]);
});
