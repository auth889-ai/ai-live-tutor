import assert from 'node:assert/strict';
import test from 'node:test';

import { assembleLineProgram, parseLineEvents, compileLineTrace, LINE_TRACKER_PY } from '../../../lib/execution/trace/line-sim/compiler.js';

const CODE = 'def linear_search(arr, target):\n    for i in range(len(arr)):\n        if arr[i] == target:\n            return i\n    return -1';

test('assembleLineProgram: student code compiled under <student>, entry hardened', () => {
  const program = assembleLineProgram({ code: CODE, entry: 'linear_search([4, 7, 9], 9)' });
  for (const marker of ['sys.settrace(_tracer)', "compile(_maybe_tree, '<student>', 'exec')", '@@LINESIM', 'MAX_EVENTS']) {
    assert.ok(program.includes(marker), `program carries ${marker}`);
  }
  assert.throws(() => assembleLineProgram({ code: CODE, entry: 'x = 1\nimport os' }), /single expression/);
  assert.throws(() => assembleLineProgram({ code: '', entry: 'f()' }), /needs the algorithm code/);
  assert.ok(LINE_TRACKER_PY.includes("f_code.co_filename == '<student>'"), 'harness lines never leak into the animation');
});

test('compileLineTrace: one step per executed line, narrated from the REAL locals diff', () => {
  const events = [
    { line: 2, fn: 'linear_search', locals: { arr: [4, 7, 9], target: 9, i: 0 } },
    { line: 3, fn: 'linear_search', locals: { arr: [4, 7, 9], target: 9, i: 0 } },
    { line: 2, fn: 'linear_search', locals: { arr: [4, 7, 9], target: 9, i: 1 } },
    { line: 3, fn: 'linear_search', locals: { arr: [4, 7, 9], target: 9, i: 1 } },
    { line: 2, fn: 'linear_search', locals: { arr: [4, 7, 9], target: 9, i: 2 } },
    { line: 3, fn: 'linear_search', locals: { arr: [4, 7, 9], target: 9, i: 2 } },
    { line: 4, fn: 'linear_search', locals: { arr: [4, 7, 9], target: 9, i: 2 } },
  ];
  const trace = compileLineTrace({ events, result: 2, code: CODE });
  assert.equal(trace.steps.length, 8); // 7 line events + closing step
  assert.equal(trace.steps[0].line, 2);
  assert.match(trace.steps[0].explanation, /i starts as 0/);
  assert.match(trace.steps[2].explanation, /i becomes 1/, 'the diff narrates what actually changed');
  assert.match(trace.steps[1].explanation, /asks.*FALSE — so this branch is skipped/s, 'a failed check is narrated as a verdict');
  assert.match(trace.steps[5].explanation, /TRUE — so execution steps INTO/, 'the winning check is narrated as a verdict');
  assert.match(trace.steps.at(-1).explanation, /returns 2/);
  assert.deepEqual(trace.steps[4].variables, { arr: [4, 7, 9], target: 9, i: 2 });
  for (const s of trace.steps) assert.ok(s.explanation.length > 60, 'floor still speaks in full sentences');
});

test('collapses consecutive duplicate states; honest failures reject empty runs', () => {
  const events = [
    { line: 2, locals: { i: 0 } },
    { line: 2, locals: { i: 0 } }, // duplicate -> collapsed
    { line: 2, locals: { i: 1 } },
  ];
  const trace = compileLineTrace({ events, result: null, code: CODE });
  assert.equal(trace.steps.length, 3); // 2 distinct + closing
  assert.throws(() => compileLineTrace({ events: [], result: 1, code: CODE }), /no events/);
  assert.throws(() => compileLineTrace({ events: [{ line: 99, locals: {} }], result: 1, code: CODE }), /no in-range steps/);
  assert.equal(parseLineEvents('noise\n@@LINESIM {"events":[{"line":2,"locals":{}}],"result":5}').result, 5);
  assert.equal(parseLineEvents('nothing'), null);
});

test('truncation is an EXPLICIT terminal beat, never a silent cut', () => {
  const events = [
    { line: 2, fn: 'f', locals: { i: 0 } },
    { line: 2, fn: 'f', locals: { i: 1 } },
    { truncated: true }, // the tracker's cap sentinel
  ];
  const trace = compileLineTrace({ events, result: 42, code: 'def f():\n    i = 0', language: 'python' });
  assert.match(trace.steps.at(-1).explanation, /recording stops HERE.*returned 42.*cut openly/s);
});

test('opening frame beat: the entry call is announced before anything moves', () => {
  const trace = compileLineTrace({
    events: [{ line: 2, fn: 'gcd', locals: { a: 48, b: 18 } }],
    result: 6, code: 'def gcd(a, b):\n    pass', entry: 'gcd(48, 18)',
  });
  assert.match(trace.steps[0].explanation, /We run gcd\(48, 18\).*Keep your eye on the variables/s);
  assert.deepEqual(trace.steps[0].variables, {}, 'the frame beat precedes any recorded state');
});

test('the floor DRAWS: a run carrying a list gets the array view with flash + pointers', () => {
  // Kadane-shaped locals: the hero list is present throughout, cur/best are scalars, x walks.
  const events = [
    { line: 2, locals: { a: [-2, 1, -3], best: -2 } },
    { line: 4, locals: { a: [-2, 1, -3], best: -2, x: 1 } },
    { line: 5, locals: { a: [-2, 1, -3], best: 1, x: 1 } },
  ];
  const trace = compileLineTrace({ events, result: 1, code: 'l1\nl2\nfor x in range(3):\n    v = a[x]\nl5' });
  assert.deepEqual(trace.views.array, { values: [-2, 1, -3] }, 'hero list becomes the drawn array view');
  const withPtr = trace.steps.find((s) => s.array?.pointers?.x !== undefined);
  assert.ok(withPtr, 'a variable the code subscripts with (a[x]) rides as a pointer');
  // Kadane's trap: best is an in-range INTEGER VALUE but never indexes a — it must NOT point.
  const noIdx = compileLineTrace({ events, result: 1, code: 'l1\nl2\nl3\nl4\nl5' });
  assert.ok(noIdx.steps.every((s) => !s.array?.pointers), 'value-integers never masquerade as pointers');
  // A scalar-only run stays an honest text floor — no fake structure invented.
  const scalars = compileLineTrace({ events: [{ line: 1, locals: { n: 3 } }, { line: 1, locals: { n: 6 } }], result: 6, code: 'l1' });
  assert.deepEqual(scalars.views, {});
});

test('conditions narrate CHECK -> VERDICT -> THEREFORE with live values (instructor formula)', () => {
  const code = 'def f(u):\n    if u > 2:\n        return "big"\n    return "small"';
  const events = [
    { line: 2, locals: { u: 5 } },
    { line: 3, locals: { u: 5 } },
  ];
  const trace = compileLineTrace({ events, result: 'big', code });
  const cond = trace.steps.find((s) => s.line === 2);
  assert.match(cond.explanation, /asks/, 'a condition is posed as a question');
  assert.match(cond.explanation, /u = 5/, 'live values appear at the moment of decision');
  assert.match(cond.explanation, /TRUE — so execution steps INTO/, 'the real verdict is stated');
  const skipped = compileLineTrace({ events: [{ line: 2, locals: { u: 1 } }, { line: 4, locals: { u: 1 } }], result: 'small', code });
  assert.match(skipped.steps.find((s) => s.line === 2).explanation, /FALSE — so this branch is skipped/);
});
