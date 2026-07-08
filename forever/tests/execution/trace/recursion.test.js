import assert from 'node:assert/strict';
import test from 'node:test';

import { compileRecursionTrace, assembleRecursionProgram, parseCallTree, RECURSION_TRACKER_PY } from '../../../lib/execution/trace/recursion/compiler.js';

const CODE = 'def fib(n):\n    if n <= 1:\n        return n\n    # memo check happens here\n    return fib(n-1) + fib(n-2)';
const LINES = { call: 5, base: 2, memo: 4, combine: 5 };

// fib(4) memoized, exactly as the tracker records it: fib(2) is computed once (vertex 2)
// and hit from memory the second time (vertex 6).
const CALL_TREE = {
  fnName: 'fib',
  result: 3,
  vertices: {
    0: { args: [4], children: [{ id: 1, value: 2 }, { id: 6, value: 1 }], memoized: false },
    1: { args: [3], children: [{ id: 2, value: 1 }, { id: 5, value: 1 }], memoized: false },
    2: { args: [2], children: [{ id: 3, value: 1 }, { id: 4, value: 0 }], memoized: false },
    3: { args: [1], children: [], memoized: false },
    4: { args: [0], children: [], memoized: false },
    5: { args: [1], children: [], memoized: false },
    6: { args: [2], children: [], memoized: true },
  },
};

test('the recursion tree GROWS call by call and the pointer walks down and back up (Euler tour)', () => {
  const trace = compileRecursionTrace({ callTree: CALL_TREE, code: CODE, lines: LINES });
  assert.equal(trace.views.graph.nodes.length, 7);
  assert.equal(trace.views.graph.edges.length, 6);
  // 1 root call + 6 down-edges + 6 return-edges + 1 final = 14 snapshots
  assert.equal(trace.steps.length, 14);

  // The tree grows monotonically: revealed never shrinks, starts with just the root.
  assert.deepEqual(trace.steps[0].graph.revealed, ['0']);
  for (let i = 1; i < trace.steps.length; i += 1) {
    assert.ok(trace.steps[i].graph.revealed.length >= trace.steps[i - 1].graph.revealed.length);
  }

  // Walking down: fib(4) -> fib(3): current moves to the child, edge is active.
  const down = trace.steps[1];
  assert.equal(down.graph.current, '1');
  assert.deepEqual(down.activeEdge, ['0', '1']);
  assert.match(down.explanation, /calls/);

  // At the deepest call the stack shows the whole path root -> current.
  const deepest = trace.steps.find((s) => s.graph.current === '3');
  assert.deepEqual(deepest.stack, ["fib(4)", "fib(3)", "fib(2)", "fib(1)"]);

  // Walking back up: the base case returns, current moves BACK to the parent.
  const back = trace.steps.find((s) => s.activeEdge?.[0] === '3');
  assert.equal(back.graph.current, '2');
  assert.equal(back.line, LINES.base);
  assert.match(back.explanation, /base case.*returns 1/);
  assert.equal(back.graph.returned['3'], 1);
});

test('a memo hit is narrated as the DP win, colored, and never recursed into', () => {
  const trace = compileRecursionTrace({ callTree: CALL_TREE, code: CODE, lines: LINES });
  const memoReturn = trace.steps.find((s) => s.activeEdge?.[0] === '6');
  assert.match(memoReturn.explanation, /memo.*no recomputation/);
  assert.equal(memoReturn.line, LINES.memo);
  assert.ok(memoReturn.graph.memo.includes('6'));
  // vertex 6 got no down-edges of its own (children were never explored)
  assert.ok(!trace.steps.some((s) => s.activeEdge?.[0] === '6' && s.activeEdge?.[1] !== '0'));

  // Return values accumulate on the tree and the final step closes the story.
  const last = trace.steps.at(-1);
  assert.equal(last.graph.returned['0'], 3);
  assert.match(last.explanation, /returns 3/);
});

test('honest failures: tracker error and empty tree refuse to compile', () => {
  assert.throws(() => compileRecursionTrace({ callTree: { error: 'too many recursive calls' }, code: CODE }), /tracker failed/);
  assert.throws(() => compileRecursionTrace({ callTree: { fnName: 'f', vertices: {} }, code: CODE }), /no vertices/);
});

test('the tracker template is real instrumented Python with the @@CALLTREE protocol', () => {
  // Structural sanity of the tool we inject (the model never writes this machinery).
  for (const marker of ['@@CALLTREE', 'MAX_CALLS', 'memoized', '_stack.pop()']) {
    assert.ok(RECURSION_TRACKER_PY.includes(marker), `template carries ${marker}`);
  }
});

test('assembleRecursionProgram instruments the UNMODIFIED student function via global rebinding', () => {
  const program = assembleRecursionProgram({ code: CODE, fnName: 'fib', args: [5], memoize: true });
  // Order matters: tracker defs -> student code -> rebinding -> run.
  const order = ['def fn(*args):', 'def fib(n):', '_fn = fib', 'fib = fn', 'result = fn(*ARGS)', "json.dumps({'fnName': FN_NAME"];
  let last = -1;
  for (const marker of order) {
    const at = program.indexOf(marker);
    assert.ok(at > last, `"${marker}" appears in order`);
    last = at;
  }
  assert.ok(program.includes('MEMOIZE = True'));

  // Injection-hardened: fnName must be a plain identifier, args a real array, code must define it.
  assert.throws(() => assembleRecursionProgram({ code: CODE, fnName: 'fib; import os', args: [] }), /identifier/);
  assert.throws(() => assembleRecursionProgram({ code: CODE, fnName: 'other', args: [] }), /must define/);
  assert.throws(() => assembleRecursionProgram({ code: CODE, fnName: 'fib', args: 'nope' }), /array/);
});

test('parseCallTree extracts the payload from noisy stdout, null when absent/broken', () => {
  const payload = { fnName: 'fib', result: 3, vertices: {} };
  assert.deepEqual(parseCallTree(`warmup noise\n@@CALLTREE ${JSON.stringify(payload)}\n`), payload);
  assert.equal(parseCallTree('no marker here'), null);
  assert.equal(parseCallTree('@@CALLTREE {broken'), null);
});
