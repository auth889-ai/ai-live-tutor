import assert from 'node:assert/strict';
import test from 'node:test';

import { assembleLineProgram, parseLineEvents, compileLineTrace, LINE_TRACKER_PY } from '../../lib/execution/trace/line-simulator.js';

const CODE = 'def linear_search(arr, target):\n    for i in range(len(arr)):\n        if arr[i] == target:\n            return i\n    return -1';

test('assembleLineProgram: student code compiled under <student>, entry hardened', () => {
  const program = assembleLineProgram({ code: CODE, entry: 'linear_search([4, 7, 9], 9)' });
  for (const marker of ['sys.settrace(_tracer)', "compile(_src, '<student>', 'exec')", '@@LINESIM', 'MAX_EVENTS']) {
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
  assert.match(trace.steps[1].explanation, /deciding WHERE/, 'no-change lines explain control flow');
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
