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

test('binary search: pointer moves become steps, eliminated half dims, sentences use real values', () => {
  const trace = compilePointerWalk({
    events: EVENTS, result: 5, code: CODE, array: ARR,
    pointers: ['low', 'mid', 'high'], eliminatedOutside: ['low', 'high'],
  });

  // Steps only where pointers MOVED: init(low,high), mid=3, low=4, mid=5, + closing.
  assert.equal(trace.steps.length, 5);
  assert.deepEqual(trace.views.array.values, ARR);

  const midStep = trace.steps[1];
  assert.equal(midStep.array.current, 3, 'current cell rides mid');
  assert.deepEqual(midStep.array.pointers, { low: 0, mid: 3, high: 7 });
  assert.match(midStep.explanation, /[Mm]id starts at index 3, where the value is 12/);

  const lowMove = trace.steps[2];
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
      { line: 3, locals: { left: 0, right: 2, sum: 8 } }, // no move -> no step
      { line: 4, locals: { left: 1, right: 3, sum: 7 } },
    ],
    result: 11, code: 'a\nb\nc\nd', array: [2, 1, 5, 1, 3, 2],
    pointers: ['left', 'right'], window: ['left', 'right'],
  });
  assert.equal(trace.steps.length, 3); // 2 moves + closing
  assert.match(trace.steps[0].explanation, /window now spans indices 0\.\.2.*linear instead of quadratic/s);
  assert.equal(trace.steps[1].variables.sum, 7, 'live variables ride along');
});

test('honest failures: no events, no array, pointers that never move', () => {
  assert.throws(() => compilePointerWalk({ events: [], result: 1, code: 'x', array: [1], pointers: ['i'] }), /no events/);
  assert.throws(() => compilePointerWalk({ events: EVENTS, result: 1, code: CODE, array: [], pointers: ['low'] }), /concrete array/);
  assert.throws(
    () => compilePointerWalk({ events: [{ line: 2, locals: { x: 'nope' } }], result: 1, code: CODE, array: ARR, pointers: ['low'] }),
    /no pointer movement/,
  );
});
