import assert from 'node:assert/strict';
import test from 'node:test';

import { compileIntervals } from '../../../lib/execution/trace/intervals/compiler.js';

// Real merge-intervals recording shape: sorted input held in `intervals`, result grows in `merged`.
const EVENTS = [
  { line: 2, locals: { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]] } },
  { line: 4, locals: { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]], merged: [[1, 3]] } },
  { line: 6, locals: { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]], merged: [[1, 6]] } },
  { line: 4, locals: { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]], merged: [[1, 6], [8, 10]] } },
  { line: 4, locals: { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]], merged: [[1, 6], [8, 10], [15, 18]] } },
];

test('islands fuse on the number line: sorted -> first -> fuse -> new islands, all narrated with real bounds', () => {
  const trace = compileIntervals({
    events: EVENTS, result: [[1, 6], [8, 10], [15, 18]], code: 'l1\nl2\nl3\nl4\nl5\nl6',
    intervalsVar: 'intervals', mergedVar: 'merged',
  });
  assert.deepEqual(trace.views.intervals.intervals, [[1, 3], [2, 6], [8, 10], [15, 18]]);
  assert.match(trace.steps[0].explanation, /sort.*Sorting is the whole trick/si);
  assert.match(trace.steps[1].explanation, /opens the first island/);
  const fuse = trace.steps.find((s) => /YES, they touch/.test(s.explanation));
  assert.ok(fuse, 'the overlap verdict is narrated');
  assert.match(fuse.explanation, /start 2 is ≤ the island's end 3/, 'live bounds in the check');
  assert.deepEqual(fuse.intervals.merged, [[1, 6]]);
  const island = trace.steps.find((s) => /NO, there is a gap/.test(s.explanation));
  assert.ok(island, 'the non-overlap verdict is narrated');
  assert.match(trace.steps.at(-1).explanation, /3 islands remain/);
});

test('honest failures: missing lens vars and a merged list that never grows', () => {
  assert.throws(() => compileIntervals({ events: EVENTS, code: 'x', intervalsVar: 'nope', mergedVar: 'merged' }), /never held a list/);
  assert.throws(
    () => compileIntervals({ events: [{ line: 1, locals: { intervals: [[1, 2]] } }], code: 'x', intervalsVar: 'intervals', mergedVar: 'merged' }),
    /never grew/,
  );
});
