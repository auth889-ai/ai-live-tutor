import assert from 'node:assert/strict';
import test from 'node:test';

import { compileDivideConquer } from '../../../lib/execution/trace/divide-conquer/compiler.js';
import { assembleDivideProgram, parseDivideEvents } from '../../../lib/execution/trace/divide-conquer/tracker.js';

const CODE = 'def qs(arr, low, high):\n    if low >= high:\n        return\n    p = arr[high]\n    i = low\n    for j in range(low, high):\n        if arr[j] < p:\n            arr[i], arr[j] = arr[j], arr[i]\n            i += 1\n    arr[i], arr[high] = arr[high], arr[i]\n    qs(arr, low, i - 1)\n    qs(arr, i + 1, high)';

// Real tracker-shaped events of a tiny quicksort([3,1,2], 0, 2): partition swaps, then recurse.
const EVENTS = [
  { type: 'call', id: 1, parent: null, line: 1, lo: 0, hi: 2 },
  { type: 'line', line: 4, array: [3, 1, 2], locals: {} },
  { type: 'line', line: 6, array: [3, 1, 2], locals: { p: 2, i: 0, j: 0 } },
  { type: 'line', line: 8, array: [1, 3, 2], locals: { p: 2, i: 0, j: 1 } }, // swap 0<->1
  { type: 'line', line: 9, array: [1, 3, 2], locals: { p: 2, i: 1, j: 1 } },
  { type: 'line', line: 10, array: [1, 2, 3], locals: { p: 2, i: 1, j: 1 } }, // pivot lands
  { type: 'call', id: 2, parent: 1, line: 1, lo: 0, hi: 0 },
  { type: 'return', id: 2, line: 3 },
  { type: 'call', id: 3, parent: 1, line: 1, lo: 2, hi: 2 },
  { type: 'return', id: 3, line: 3 },
  { type: 'return', id: 1, line: 12 },
];

test('quicksort through the tracker: focus band, swaps, and the segment tree in lock-step', () => {
  const trace = compileDivideConquer({
    events: EVENTS, result: null, code: CODE, entry: 'qs([3,1,2], 0, 2)', fn: 'qs', pointers: ['i', 'j'],
  });

  assert.match(trace.steps[0].explanation, /watch two pictures at once.*ACTIVE BAND/s, 'frame beat');

  // The segment tree is REAL: one node per call, labeled with actual bounds.
  assert.deepEqual(trace.views.graph.nodes.map((n) => n.label), ['qs(0..2)', 'qs(0..0)', 'qs(2..2)']);
  assert.deepEqual(trace.views.array.values, [3, 1, 2], 'the declared view is the pre-sort array');

  // Entering a child call: the focus band dims everything outside ITS segment.
  const enterChild = trace.steps.find((s) => /qs\(0\.\.0\) is the BASE CASE/.test(s.explanation));
  assert.ok(enterChild, 'base case narrated as the certainty recursion is built from');
  assert.deepEqual(enterChild.array.dimmed, [1, 2], 'cells outside the active band are dimmed (not struck through)');
  assert.equal(enterChild.graph.current, 'c2', 'the tree pointer stands on the active call');
  assert.deepEqual(enterChild.stack, ['qs(0..2)', 'qs(0..0)'], 'the call stack reads root -> current');

  // Swaps flash with LIVE values — both views fed by the same step object.
  const swap = trace.steps.find((s) => s.array?.swapped);
  assert.ok(swap, 'the partition swap is its own beat');
  assert.deepEqual(swap.array.values, [1, 3, 2], 'cells show the REAL contents after the swap');
  assert.match(swap.explanation, /trade contents/);

  // Returns land the sorted band on the tree node.
  const done1 = trace.steps.find((s) => /qs\(0\.\.0\) RETURNS: its band comes back as \[1\]/.test(s.explanation));
  assert.ok(done1, 'a return narrates the conquered segment with real values');
  assert.equal(done1.graph.returned.c2, '[1]', 'the sorted band rides the tree node');

  assert.match(trace.steps.at(-1).explanation, /\[1, 2, 3\].*entire proof/s, 'terminal beat reads the sorted array');
  for (const s of trace.steps) assert.ok(s.explanation.length > 60, 'tutor voice, never stubs');
});

test('harness assembly is hardened: identifiers validated, single-expression entry', () => {
  const ok = assembleDivideProgram({ code: 'def qs(a, lo, hi):\n    pass', entry: 'qs([2,1], 0, 1)', fn: 'qs', arrayVar: 'arr' });
  assert.ok(ok.includes('FN_NAME = "qs"'));
  assert.ok(ok.includes("compile(_maybe_tree, '<student>', 'exec')"));
  assert.throws(() => assembleDivideProgram({ code: 'x', entry: 'a();b()', fn: 'qs', arrayVar: 'arr' }), /single expression/);
  assert.throws(() => assembleDivideProgram({ code: 'x', entry: 'a()', fn: 'q s', arrayVar: 'arr' }), /simple identifier/);
});

test('honest failures: no calls of the declared fn, no array snapshots, junk stdout', () => {
  assert.equal(parseDivideEvents('nothing here'), null);
  assert.throws(
    () => compileDivideConquer({ events: [{ type: 'line', line: 1, array: [1], locals: {} }], result: 1, code: 'x', fn: 'qs' }),
    /no calls of "qs"/,
  );
  assert.throws(
    () => compileDivideConquer({ events: [{ type: 'call', id: 1, parent: null, line: 1, lo: 0, hi: 1 }], result: 1, code: 'x', fn: 'qs' }),
    /no array snapshots/,
  );
});
