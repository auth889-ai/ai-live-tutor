import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFrameTimeline } from '../../../lib/execution/trace/universal/frames.js';

// Factorial-shaped: f(3) -> f(2) -> f(1) returns 1, then unwinds. Statuses + stable ids.
const FACT = [
  { ev: 'call', fn: 'f', line: 1, depth: 1, args: { n: 3 } },
  { ev: 'line', fn: 'f', line: 2, depth: 1, locals: { n: 3 } },
  { ev: 'call', fn: 'f', line: 1, depth: 2, args: { n: 2 } },
  { ev: 'call', fn: 'f', line: 1, depth: 3, args: { n: 1 } },
  { ev: 'return', fn: 'f', line: 3, depth: 3, value: 1 },
  { ev: 'return', fn: 'f', line: 3, depth: 2, value: 2 },
  { ev: 'return', fn: 'f', line: 3, depth: 1, value: 6 },
];

test('factorial: stable frameIds, active/waiting statuses, returns captured', () => {
  const t = buildFrameTimeline(FACT);
  assert.equal(t.frames.length, 3);
  assert.deepEqual(t.frames.map((f) => f.frameId), ['f0', 'f1', 'f2']);
  assert.equal(t.frames[1].parentFrameId, 'f0');
  const deep = t.stackAt(3); // all three open
  assert.deepEqual(deep.map((f) => f.status), ['waiting', 'waiting', 'active']);
  assert.deepEqual(deep.map((f) => f.arguments.n), [3, 2, 1]);
  assert.equal(t.frames[2].status, 'returned');
  assert.equal(t.frames[2].returnValue, 1);
  assert.equal(t.finishedBefore(5).returnValue, 2, 'most recently finished frame rides along');
});

test('mutual recursion keeps the parent chain across alternating functions', () => {
  const t = buildFrameTimeline([
    { ev: 'call', fn: 'is_even', line: 1, depth: 1, args: { n: 2 } },
    { ev: 'call', fn: 'is_odd', line: 4, depth: 2, args: { n: 1 } },
    { ev: 'call', fn: 'is_even', line: 1, depth: 3, args: { n: 0 } },
    { ev: 'return', fn: 'is_even', line: 2, depth: 3, value: true },
    { ev: 'return', fn: 'is_odd', line: 5, depth: 2, value: true },
    { ev: 'return', fn: 'is_even', line: 2, depth: 1, value: true },
  ]);
  assert.deepEqual(t.frames.map((f) => f.functionName), ['is_even', 'is_odd', 'is_even']);
  assert.equal(t.frames[2].parentFrameId, 'f1');
});

test('exception then immediate return = threw; caught exception = returned', () => {
  const threw = buildFrameTimeline([
    { ev: 'call', fn: 'g', line: 1, depth: 1, args: {} },
    { ev: 'exception', fn: 'g', line: 2, depth: 1, type: 'ValueError', message: 'boom' },
    { ev: 'return', fn: 'g', line: 2, depth: 1, value: null },
  ]);
  assert.equal(threw.frames[0].status, 'threw');
  assert.deepEqual(threw.frames[0].exception, { type: 'ValueError', message: 'boom' });

  const caught = buildFrameTimeline([
    { ev: 'call', fn: 'g', line: 1, depth: 1, args: {} },
    { ev: 'exception', fn: 'g', line: 2, depth: 1, type: 'KeyError', message: 'x' },
    { ev: 'line', fn: 'g', line: 4, depth: 1, locals: {} }, // the except block runs
    { ev: 'return', fn: 'g', line: 5, depth: 1, value: 'fallback' },
  ]);
  assert.equal(caught.frames[0].status, 'returned', 'a REAL return value proves recovery');
  assert.equal(caught.frames[0].returnValue, 'fallback');
  // try/finally (external probe): finally runs a LINE but the exception still escapes —
  // a pending exception + null return is THREW, lines no longer launder it.
  const fin = buildFrameTimeline([
    { ev: 'call', fn: 'g', line: 1, depth: 1, args: {} },
    { ev: 'exception', fn: 'g', line: 2, depth: 1, type: 'ValueError', message: 'boom' },
    { ev: 'line', fn: 'g', line: 6, depth: 1, locals: {} }, // finally body
    { ev: 'return', fn: 'g', line: 6, depth: 1, value: null },
  ]);
  assert.equal(fin.frames[0].status, 'threw', 'finally lines cannot launder a propagating exception');
});
