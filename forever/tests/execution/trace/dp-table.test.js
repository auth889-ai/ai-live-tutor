import assert from 'node:assert/strict';
import test from 'node:test';

import { compileDpTable } from '../../../lib/execution/trace/dp-table/compiler.js';
import { assembleDpProgram, parseDpEvents } from '../../../lib/execution/trace/dp-table/tracker.js';

const CODE = 'def lcs(a, b):\n    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]\n    for i in range(1, len(a) + 1):\n        for j in range(1, len(b) + 1):\n            if a[i-1] == b[j-1]:\n                dp[i][j] = dp[i-1][j-1] + 1\n            else:\n                dp[i][j] = max(dp[i-1][j], dp[i][j-1])\n    return dp[-1][-1]';

// Real tracker-shaped events of lcs("ab", "a"): a 3x2 table seeded with zeros, then two writes.
const EVENTS = [
  { line: 3, table: [[0, 0], [0, 0], [0, 0]], locals: {} },
  { line: 4, table: [[0, 0], [0, 1], [0, 0]], locals: { i: 1, j: 1 } }, // a==a -> diag + 1
  { line: 4, table: [[0, 0], [0, 1], [0, 1]], locals: { i: 2, j: 1 } }, // b!=a -> max of neighbours
];

test('LCS through the lens: init scaffold, one visible write per cell, answer read from the table', () => {
  const trace = compileDpTable({
    events: EVENTS, result: 1, code: CODE, entry: "lcs('ab', 'a')",
    rowLabels: ['', 'a', 'b'], colLabels: ['', 'a'],
  });

  assert.match(trace.steps[0].explanation, /know what a cell MEANS/s, 'frame beat defines the cell meaning first');
  assert.equal(trace.views.array2d.rows, 3);
  assert.equal(trace.views.array2d.cols, 2);
  assert.deepEqual(trace.views.array2d.rowLabels, ['', 'a', 'b'], 'labels pass through when they fit');

  // Init is scaffold, not answers: values land but nothing is marked filled yet.
  const init = trace.steps.find((s) => /scaffold the real answers/.test(s.explanation));
  assert.ok(init, 'table creation is its own beat');
  assert.equal(init.array2d.values.length, 6, 'all seeded cells render');
  assert.equal(init.array2d.filled, undefined, 'seeded zeros are not the green filled region');

  // Interior writes narrate real old -> new values and mark the write current.
  const w1 = trace.steps.find((s) => /dp\[1\]\[1\] becomes 1/.test(s.explanation));
  assert.ok(w1, 'the first real write is its own beat');
  assert.match(w1.explanation, /\(it was 0\).*already-filled neighbours/s);
  assert.deepEqual(w1.array2d.current, [1, 1], 'the written cell glows');
  assert.deepEqual(w1.array2d.values, [[1, 1, 1]], 'only the observed write is shown — nothing invented');
  assert.equal(w1.variables.i, 1, 'the loop indices ride the variables panel');

  const w2 = trace.steps.find((s) => /dp\[2\]\[1\] becomes 1/.test(s.explanation));
  assert.ok(w2.array2d.filled.some(([r, c]) => r === 1 && c === 1), 'earlier writes stay green');

  assert.match(trace.steps.at(-1).explanation, /read out of dp\[2\]\[1\] = 1.*O\(rows × cols\)/s, 'terminal beat');
  for (const s of trace.steps) assert.ok(s.explanation.length > 60, 'tutor voice, never stubs');
});

test('labels that do not fit the real dimensions are dropped, never shown stale', () => {
  const trace = compileDpTable({
    events: EVENTS, result: 1, code: CODE, entry: "lcs('ab', 'a')",
    rowLabels: ['only-two', 'labels'], colLabels: null,
  });
  assert.equal(trace.views.array2d.rowLabels, undefined, 'mismatched labels fall back to indices');
});

test('honest failures: oversized table, missing dp variable, junk stdout', () => {
  assert.throws(
    () => compileDpTable({ events: [{ too_big: true }], result: 1, code: 'x' }),
    /exceeds 24x24.*smaller teaching example/s,
  );
  assert.throws(
    () => compileDpTable({ events: [{ line: 99, table: [[0]], locals: {} }], result: 1, code: 'a\nb' }),
    /saw no table/,
  );
  assert.equal(parseDpEvents('junk'), null);
  const ok = assembleDpProgram({ code: 'def lcs(a, b):\n    return 0', entry: 'lcs("ab", "a")' });
  assert.ok(ok.includes('DP_VAR = "dp"'));
  assert.throws(() => assembleDpProgram({ code: 'x', entry: 'a()', dp: 'd p' }), /simple identifier/);
  assert.throws(() => assembleDpProgram({ code: 'x', entry: 'a();b()' }), /single expression/);
});
