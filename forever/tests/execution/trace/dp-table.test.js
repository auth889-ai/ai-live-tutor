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

test('dpvis step model (unit): reads/chosen/phase come from RECORDED facts of the timestep', () => {
  // dp[1][1] = max(dp[0][1]=2, dp[1][0]=1) — reads + the max op recorded on the writing line
  // (snapshot k-1), the value change visible at snapshot k.
  const events = [
    { line: 3, table: [[0, 2], [1, 0]], locals: {} }, // creation
    { line: 7, table: [[0, 2], [1, 0]], locals: { i: 1, j: 1 }, reads: [{ p: [0, 1], v: 2, q: 1 }, { p: [1, 0], v: 1, q: 2 }], rhsOps: [{ op: 'max', args: [2, 1], r: 2, q: 3 }] },
    { line: 7, table: [[0, 2], [1, 2]], locals: { i: 1, j: 1 } }, // the write lands
  ];
  const trace = compileDpTable({ events, result: 2, code: 'a\nb\nc\nd\ne\nf\ndp[i][j] = ...', entry: null, directReads: true });
  const write = trace.steps.find((s) => Array.isArray(s.reads) && s.reads.length > 0);
  assert.ok(write, 'the write step carries its recorded reads');
  assert.deepEqual(write.reads, [[0, 1], [1, 0]], 'reads = the dp subscript reads of this timestep, deduped, in order');
  assert.deepEqual(write.chosen, [[0, 1]], 'the recorded max op names its winner — the read whose value IS the result');
  assert.equal(write.phase, 'fill');
  assert.equal(write.array2d.rule, 'max (recorded op)');
  assert.match(write.explanation, /To fill dp\[1\]\[1\] we look at the cell above \(dp\[0\]\[1\] = 2\) and the cell to the left \(dp\[1\]\[0\] = 1\), and take the best among them — dp\[0\]\[1\] wins\. So dp\[1\]\[1\] = 2/);
  assert.equal(trace.steps.find((s) => /scaffold/.test(s.explanation))?.phase, 'base', 'the creation beat is the base layer');
  assert.equal(trace.steps.at(-1).phase, 'answer', 'the terminal read-out is the answer phase');
});

test('ADVERSARIAL (unit): a recording with NO reads yields EMPTY reads — no arrows, no chosen, even when arithmetic would "match"', () => {
  // Same values as above: max(top,left)=2 matches arithmetically — but provenance mode with
  // zero recorded reads must claim NOTHING. Empty lists are facts; inferred lists are lies.
  const events = [
    { line: 3, table: [[0, 2], [1, 0]], locals: {} },
    { line: 7, table: [[0, 2], [1, 0]], locals: { i: 1, j: 1 }, reads: [], rhsOps: [] },
    { line: 7, table: [[0, 2], [1, 2]], locals: { i: 1, j: 1 } },
  ];
  const trace = compileDpTable({ events, result: 2, code: 'a\nb\nc\nd\ne\nf\ndp[i][j] = ...', entry: null, directReads: true });
  for (const s of trace.steps) {
    assert.ok(!Array.isArray(s.reads) || s.reads.length === 0, 'no recorded reads -> reads stays EMPTY');
    assert.equal(s.chosen, undefined, 'no recorded op -> no chosen, ever');
    assert.equal(s.array2d?.highlight, undefined, 'no fabricated dependency arrows');
    assert.equal(s.array2d?.rule, undefined, 'no rule claimed from arithmetic coincidence');
    assert.ok(!/we look at|already-filled neighbours/.test(s.explanation), 'the narration never claims dependencies that were not recorded');
  }
});

test('PROVED dependency highlights: exactly one arithmetic rule -> reads light up + rule named; ambiguity -> nothing', () => {
  const events = [
    { line: 3, table: [[0, 0], [0, 0]], locals: {} },                    // init scaffold
    { line: 7, table: [[0, 0], [0, 1]], locals: { i: 1, j: 1 } },        // dp[1][1]=1: diag+1 UNIQUELY (top+left=0, max=0)
    { line: 7, table: [[0, 1], [0, 1]], locals: { i: 0, j: 1 } },        // base-row write: no inference
  ];
  const trace = compileDpTable({ events, result: 1, code: 'a\nb\nc\nd\ne\nf\ndp[i][j] = ...', entry: null });
  const provedStep = trace.steps.find((s) => s.array2d?.rule);
  assert.ok(provedStep, 'the uniquely-proved write carries a rule');
  assert.equal(provedStep.array2d.rule, 'diagonal + 1');
  assert.deepEqual(provedStep.array2d.highlight, [[0, 0]], 'the diagonal READ cell highlights');
  assert.match(provedStep.explanation, /rule: diagonal \+ 1/);

  // Ambiguous case: value 2 where top=1,left=1,diag=1 satisfies BOTH top+left and diag+1.
  const ambiguous = [
    { line: 3, table: [[1, 1], [1, 0]], locals: {} },
    { line: 7, table: [[1, 1], [1, 2]], locals: {} },
  ];
  const trace2 = compileDpTable({ events: ambiguous, result: 2, code: 'x\ny\nz\na\nb\nc\nd', entry: null });
  const writeStep = trace2.steps.find((s) => s.array2d?.current);
  assert.equal(writeStep.array2d.rule, undefined, 'two matching rules -> proved nothing -> no highlight (honesty)');
  assert.equal(writeStep.array2d.highlight, undefined);
});
