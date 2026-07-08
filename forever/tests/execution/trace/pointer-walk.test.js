import assert from 'node:assert/strict';
import test from 'node:test';

import { compilePointerWalk } from '../../../lib/execution/trace/pointer-walk/compiler.js';

const CODE = 'def binary_search(arr, target):\n    low, high = 0, len(arr) - 1\n    while low <= high:\n        mid = (low + high) // 2\n        if arr[mid] == target:\n            return mid\n        if arr[mid] < target:\n            low = mid + 1\n        else:\n            high = mid - 1\n    return -1';
const ARR = [2, 5, 8, 12, 16, 23, 38, 56];

// Real settrace-shaped events for binary_search(ARR, 23): mid 3 -> low 4 -> mid 5 found.
const EVENTS = [
  { line: 2, locals: { arr: ARR, target: 23 } },
  { line: 3, locals: { arr: ARR, target: 23, low: 0, high: 7 } },
  { line: 4, locals: { arr: ARR, target: 23, low: 0, high: 7 } },
  { line: 5, locals: { arr: ARR, target: 23, low: 0, high: 7, mid: 3 } },
  { line: 7, locals: { arr: ARR, target: 23, low: 0, high: 7, mid: 3 } },
  { line: 8, locals: { arr: ARR, target: 23, low: 4, high: 7, mid: 3 } },
  { line: 5, locals: { arr: ARR, target: 23, low: 4, high: 7, mid: 5 } },
  { line: 6, locals: { arr: ARR, target: 23, low: 4, high: 7, mid: 5 } },
];

test('binary search: declared examine pointer rides the probed cell, eliminated half dims, real values narrated', () => {
  const trace = compilePointerWalk({
    events: EVENTS, result: 5, code: CODE, array: ARR,
    pointers: ['low', 'mid', 'high'], examine: 'mid', eliminatedOutside: ['low', 'high'],
  });

  // Steps: target introduced, low/high start, mid=3, low=4, mid=5, + closing.
  assert.equal(trace.steps.length, 6);
  assert.deepEqual(trace.views.array.values, ARR);

  // The setup beat: the target is announced BEFORE any pointer moves (the "frame" the tutor sets).
  assert.match(trace.steps[0].explanation, /target = 23.*keep your eye/s);

  // No highlight until the DECLARED probe (mid) exists — never a random stand-in pointer.
  const initStep = trace.steps[1];
  assert.equal(initStep.array.current, undefined, 'no current cell before mid exists');
  assert.deepEqual(initStep.array.pointers, { low: 0, high: 7 });

  const midStep = trace.steps[2];
  assert.equal(midStep.array.current, 3, 'current cell rides the declared examine pointer');
  assert.deepEqual(midStep.array.pointers, { low: 0, mid: 3, high: 7 });
  assert.match(midStep.explanation, /[Mm]id starts at index 3, where the value is 12/);

  const lowMove = trace.steps[3];
  assert.deepEqual(lowMove.array.eliminated, [0, 1, 2, 3], 'left half dimmed after low jumps to 4');
  assert.match(lowMove.explanation, /[Ll]ow moves to index 4/);
  assert.match(lowMove.explanation, /ELIMINATED.*logarithmic/s, 'teaches WHY the shrinking matters');

  assert.match(trace.steps.at(-1).explanation, /returns 5/);
  for (const s of trace.steps) assert.ok(s.explanation.length > 80, 'tutor voice, never stubs');
});

test('sliding window: window bounds narrated, movement-only steps', () => {
  const trace = compilePointerWalk({
    events: [
      { line: 2, locals: { left: 0, right: 2, sum: 8 } },
      { line: 3, locals: { left: 0, right: 2, sum: 8 } }, // no change -> no step
      { line: 4, locals: { left: 1, right: 3, sum: 7 } },
    ],
    result: 11, code: 'a\nb\nc\nd', array: [2, 1, 5, 1, 3, 2],
    pointers: ['left', 'right'], window: ['left', 'right'],
  });
  assert.equal(trace.steps.length, 3); // 2 changes + closing
  assert.match(trace.steps[0].explanation, /window now spans indices 0\.\.2.*linear instead of quadratic/s);
  assert.equal(trace.steps[1].variables.sum, 7, 'live variables ride along');
});

test('in-place sorting: arrayVar tracks real snapshots — swaps flash and cells carry live values', () => {
  const SORT_CODE = 'def bubble(a):\n    n = len(a)\n    for i in range(n):\n        for j in range(n - 1):\n            if a[j] > a[j + 1]:\n                a[j], a[j + 1] = a[j + 1], a[j]\n    return a';
  const trace = compilePointerWalk({
    events: [
      { line: 2, locals: { a: [3, 1, 2], n: 3 } },
      { line: 4, locals: { a: [3, 1, 2], n: 3, i: 0, j: 0 } },
      { line: 6, locals: { a: [1, 3, 2], n: 3, i: 0, j: 0 } }, // swap 0<->1 recorded from the run
      { line: 4, locals: { a: [1, 3, 2], n: 3, i: 0, j: 1 } },
      { line: 6, locals: { a: [1, 2, 3], n: 3, i: 0, j: 1 } }, // swap 1<->2
    ],
    result: [1, 2, 3], code: SORT_CODE, array: [3, 1, 2],
    pointers: ['i', 'j'], arrayVar: 'a',
  });

  // n intro, i/j start, swap, j moves, swap, + closing.
  assert.equal(trace.steps.length, 6);
  assert.deepEqual(trace.views.array.values, [3, 1, 2], 'the declared view keeps the ORIGINAL array');

  const firstSwap = trace.steps[2];
  assert.deepEqual(firstSwap.array.swapped, [0, 1], 'the two exchanged cells flash');
  assert.deepEqual(firstSwap.array.values, [1, 3, 2], 'cells show the REAL contents after the swap');
  assert.match(firstSwap.explanation, /trade contents.*in-place/s);
  assert.equal(firstSwap.variables.a, undefined, 'the tracked array is not duplicated into the variable chips');

  const secondSwap = trace.steps[4];
  assert.deepEqual(secondSwap.array.swapped, [1, 2]);
  assert.deepEqual(secondSwap.array.values, [1, 2, 3]);

  assert.match(trace.steps.at(-1).explanation, /array ends as \[1, 2, 3\]/);
});

test('honest failures: no events, no array, pointers that never move', () => {
  assert.throws(() => compilePointerWalk({ events: [], result: 1, code: 'x', array: [1], pointers: ['i'] }), /no events/);
  assert.throws(() => compilePointerWalk({ events: EVENTS, result: 1, code: CODE, array: [], pointers: ['low'] }), /concrete array/);
  assert.throws(
    () => compilePointerWalk({ events: [{ line: 2, locals: { x: 'nope' } }], result: 1, code: CODE, array: ARR, pointers: ['low'] }),
    /no pointer movement/,
  );
});
