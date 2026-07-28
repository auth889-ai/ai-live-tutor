// TRACE -> JSAV ADAPTER — pure-translation tests. Fixture steps mirror the REAL shapes the
// trace compilers emit (pointer-walk/compiler.js, dp-table/compiler.js, graph-walk/compiler.js,
// recursion/compiler.js — the validated ExecutionTrace contract). The adapter must diff the
// snapshot steps into ordered abstract JSAV ops: dp reads flash BEFORE the write, recursion
// backtracks mark the undoing caller, graph visits reference declared nodes only, and unknown
// step kinds degrade to a safe note op — never a throw.

import assert from 'node:assert/strict';
import test from 'node:test';

import { traceToJsavOps, opsByStep, diffStack, diffQueue, JSAV_OPS, JSAV_STRUCTURES } from '../../lib/board/execution/jsav-adapter.js';

const opsAt = (ops, stepIndex) => ops.filter((o) => o.stepIndex === stepIndex);

// ---- pointer-array family (pointer-walk compiler shapes) ----------------------------------

const BINARY_SEARCH = {
  language: 'python',
  code: 'def bs(a, t):\n    lo, hi = 0, len(a) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        pass',
  views: { array: { values: [1, 3, 5, 7, 9, 11] } },
  steps: [
    { line: 2, explanation: 'lo and hi bracket the whole array.', array: { pointers: { lo: 0, hi: 5 } }, variables: { lo: 0, hi: 5 } },
    { line: 4, explanation: 'mid lands on index 2.', array: { current: 2, pointers: { lo: 0, hi: 5, mid: 2 } }, variables: { mid: 2 } },
    { line: 4, explanation: 'a[mid] = 5 < 7 — indices 0..2 are ruled out.', array: { current: 4, pointers: { lo: 3, hi: 5, mid: 4 }, eliminated: [0, 1, 2] }, variables: { lo: 3, mid: 4 } },
  ],
};

test('pointer-array: pointer moves, transient current highlight, newly-eliminated dims', () => {
  const ops = traceToJsavOps(BINARY_SEARCH);
  for (const o of ops) {
    assert.ok(JSAV_STRUCTURES.includes(o.structure), `structure ${o.structure} is declared`);
    assert.ok(JSAV_OPS.includes(o.op), `op ${o.op} is in the vocabulary`);
    assert.ok(Number.isInteger(o.stepIndex), 'every op names its step');
  }

  const s0 = opsAt(ops, 0);
  assert.deepEqual(
    s0.filter((o) => o.op === 'movePointer').map((o) => [o.meta.name, o.target]).sort(),
    [['hi', 5], ['lo', 0]],
    'both pointers land on their recorded indices',
  );

  // step 1: only the NEW pointer moves; the current cell flashes
  const s1 = opsAt(ops, 1);
  assert.deepEqual(s1.filter((o) => o.op === 'movePointer').map((o) => o.meta.name), ['mid'], 'unchanged pointers emit nothing');
  assert.ok(s1.some((o) => o.op === 'highlight' && o.target === 2 && o.meta?.kind === 'current'), 'the examined cell flashes');

  // step 2: the transient current from step 1 is cleared FIRST, then the new emphasis
  const s2 = opsAt(ops, 2);
  const unhl = s2.findIndex((o) => o.op === 'unhighlight' && o.target === 2);
  assert.ok(unhl >= 0, 'the previous current highlight is undone');
  const dims = s2.filter((o) => o.op === 'dim');
  assert.deepEqual(dims.map((o) => o.target).sort(), [0, 1, 2], 'exactly the newly eliminated cells dim');
  assert.ok(dims.every((o) => o.meta?.kind === 'eliminated'));
});

test('pointer-array in-place: a declared swap becomes ONE swap op, not two setValues', () => {
  const sorting = {
    language: 'python',
    code: 'def sort(a):\n    pass',
    views: { array: { values: [3, 1, 2] } },
    steps: [
      { line: 1, explanation: 'compare a[0] and a[1]', array: { pointers: { i: 0, j: 1 }, comparing: [0, 1], values: [3, 1, 2] }, variables: {} },
      { line: 2, explanation: 'swap them', array: { pointers: { i: 0, j: 1 }, swapped: [0, 1], values: [1, 3, 2] }, variables: {} },
    ],
  };
  const ops = traceToJsavOps(sorting);
  const s1 = opsAt(ops, 1);
  assert.deepEqual(s1.filter((o) => o.op === 'swap').map((o) => o.target), [[0, 1]], 'one swap op for the pair');
  assert.equal(s1.filter((o) => o.op === 'setValue').length, 0, 'the swapped cells do not double as writes');
  const s0 = opsAt(ops, 0);
  assert.equal(s0.filter((o) => o.op === 'highlight' && o.meta?.kind === 'comparing').length, 2, 'both compared cells flash');
});

// ---- dp-table family (dp-table compiler + dpvis provenance fields) -------------------------

const DP = {
  language: 'python',
  code: 'def lcs(a, b):\n    dp = [[0] * 3 for _ in range(3)]\n    for i in range(1, 3):\n        for j in range(1, 3):\n            if a[i-1] == b[j-1]:\n                dp[i][j] = dp[i-1][j-1] + 1\n            else:\n                dp[i][j] = max(dp[i-1][j], dp[i][j-1])\n    return dp[2][2]',
  views: { array2d: { rows: 3, cols: 3 } },
  steps: [
    { line: 2, explanation: 'the scaffold: a 3x3 table of zeros', phase: 'base', array2d: {}, variables: {} },
    { line: 6, explanation: 'To fill dp[1][1] we look at dp[0][0] = 0. So dp[1][1] = 1.', phase: 'fill', reads: [[0, 0]], array2d: { current: [1, 1], values: [[1, 1, 1]], filled: [[1, 1]] }, variables: { i: 1, j: 1 } },
    { line: 8, explanation: 'we take the best among them', phase: 'fill', reads: [[0, 2], [1, 1]], chosen: [[1, 1]], array2d: { current: [1, 2], values: [[1, 2, 1]], filled: [[1, 1], [1, 2]] }, variables: { i: 1, j: 2 } },
    { line: 9, explanation: 'the answer is 1', phase: 'answer', array2d: { current: [2, 2] }, variables: {} },
  ],
};

test('dp-table: the recorded reads flash BEFORE the write op lands', () => {
  const ops = traceToJsavOps(DP);
  const s1 = opsAt(ops, 1);
  const readIdx = s1.findIndex((o) => o.op === 'highlight' && o.meta?.kind === 'read');
  const writeIdx = s1.findIndex((o) => o.op === 'setValue');
  assert.ok(readIdx >= 0, 'the read flashes');
  assert.ok(writeIdx >= 0, 'the write lands');
  assert.ok(readIdx < writeIdx, 'reads-flash ops come BEFORE the write op');
  assert.deepEqual(s1[readIdx].target, [0, 0], 'the flash is the recorded dependency');
  assert.deepEqual(s1[writeIdx].target, [1, 1]);
  assert.equal(s1[writeIdx].value, 1, 'the write carries the recorded value');
  assert.equal(s1[writeIdx].structure, 'matrix');
});

test('dp-table: a max write flashes ALL reads then marks the chosen winner, still before the write', () => {
  const ops = traceToJsavOps(DP);
  const s2 = opsAt(ops, 2);
  const reads = s2.filter((o) => o.op === 'highlight' && o.meta?.kind === 'read');
  assert.deepEqual(reads.map((o) => o.target), [[0, 2], [1, 1]], 'every recorded read flashes');
  const chosen = s2.find((o) => o.op === 'highlight' && o.meta?.kind === 'chosen');
  assert.deepEqual(chosen?.target, [1, 1], 'the winner is marked');
  const writeIdx = s2.findIndex((o) => o.op === 'setValue');
  for (const o of [...reads, chosen]) assert.ok(s2.indexOf(o) < writeIdx, 'provenance precedes the write');
  // transient read/chosen emphasis is cleared at the start of the NEXT step
  const s3 = opsAt(ops, 3);
  assert.ok(s3.some((o) => o.op === 'unhighlight' && o.meta?.kind === 'read'), 'read flashes do not linger');
});

// ---- graph-walk family (graph-walk compiler shapes) ----------------------------------------

const BFS = {
  language: 'python',
  code: 'from collections import deque\ndef bfs(g, s):\n    pass',
  views: { graph: { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }], directed: true } },
  steps: [
    { line: 2, explanation: 'start at A', graph: { current: 'A', visited: ['A'], pointers: { curr: 'A' } }, queue: ['A'], variables: {} },
    { line: 3, explanation: 'dequeue A; its edge to B is inspected and B joins the queue', graph: { current: 'A', visited: ['A'], pointers: { curr: 'A' } }, queue: ['B'], activeEdge: ['A', 'B'], variables: {} },
    // 'Z' is NOT a declared node: the adapter must refuse to visit it (defense in depth —
    // the trace validator would reject this upstream, the adapter never invents a node).
    { line: 3, explanation: 'B is visited', graph: { current: 'B', visited: ['A', 'B', 'Z'], pointers: { curr: 'B' } }, queue: [], variables: {} },
  ],
};

test('graph-walk: visit ops reference declared nodes ONLY, cumulative visited never re-fires', () => {
  const ops = traceToJsavOps(BFS);
  const visits = ops.filter((o) => o.op === 'visit');
  const declared = new Set(['A', 'B', 'C']);
  for (const v of visits) assert.ok(declared.has(v.target), `visit ${v.target} is a declared node`);
  assert.deepEqual(visits.map((o) => o.target), ['A', 'B'], 'each node visited exactly once, in order — no Z, no repeats');
  assert.ok(visits.every((o) => o.structure === 'graph'));
});

test('graph-walk: the active edge is inspected and the frontier diffs to enqueue/dequeue ops', () => {
  const ops = traceToJsavOps(BFS);
  const s1 = opsAt(ops, 1);
  const edge = s1.find((o) => o.op === 'inspectEdge');
  assert.deepEqual(edge?.target, ['A', 'B'], 'the ridden edge is the declared one');
  assert.deepEqual(s1.filter((o) => o.op === 'dequeue').map((o) => o.value), ['A']);
  assert.deepEqual(s1.filter((o) => o.op === 'enqueue').map((o) => o.value), ['B']);
  const s0 = opsAt(ops, 0);
  assert.deepEqual(s0.filter((o) => o.op === 'enqueue').map((o) => o.value), ['A'], 'the seed enqueue is a step-0 op');
  const s2 = opsAt(ops, 2);
  assert.deepEqual(s2.filter((o) => o.op === 'dequeue').map((o) => o.value), ['B'], 'emptying the queue is a dequeue');
});

// ---- recursion-tree family (recursion compiler call-lifecycle shapes) ----------------------

const FIB = {
  language: 'python',
  code: 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)',
  views: {
    graph: {
      nodes: [{ id: '0', label: 'fib(2)', x: 0, y: 0 }, { id: '1', label: 'fib(1)', x: -1, y: 1 }, { id: '2', label: 'fib(0)', x: 1, y: 1 }],
      edges: [{ from: '0', to: '1' }, { from: '0', to: '2' }],
      directed: true,
    },
  },
  steps: [
    {
      line: 1, explanation: 'we call fib(2)',
      graph: { current: '0', visited: ['0'], revealed: ['0'], returned: {}, memo: [], pointers: { call: '0' } },
      stack: ['fib(2)'], variables: { call: 'fib(2)' },
      callId: '0', parentCallId: null, args: [2], phase: 'enter', stackDepth: 1,
    },
    {
      line: 4, explanation: 'fib(2) picks 1 into path and calls down into fib(1)',
      graph: { current: '1', visited: ['0', '1'], revealed: ['0', '1'], returned: {}, memo: [], pointers: { call: '1' } },
      stack: ['fib(2)', 'fib(1)'], variables: { call: 'fib(1)' }, activeEdge: ['0', '1'],
      callId: '1', parentCallId: '0', args: [1], phase: 'enter', stackDepth: 2,
    },
    {
      line: 2, explanation: 'fib(1) is a base case: it returns 1 to fib(2)',
      graph: { current: '0', visited: ['0', '1'], revealed: ['0', '1'], returned: { 1: 1 }, memo: [], pointers: { call: '0' } },
      stack: ['fib(2)'], variables: { call: 'fib(1)', returns: 1 }, activeEdge: ['1', '0'], activeEdgeReverse: true,
      callId: '1', parentCallId: '0', args: [1], phase: 'return', returned: 1, stackDepth: 1,
    },
    {
      line: 4, explanation: 'backtrack: fib(2) removes 1 from path, restoring it',
      graph: { current: '0', visited: ['0', '1'], revealed: ['0', '1'], returned: { 1: 1 }, memo: [], pointers: { call: '0' } },
      stack: ['fib(2)'], variables: { call: 'fib(2)' },
      callId: '0', parentCallId: null, args: [2], phase: 'backtrack', stackDepth: 1,
      undo: { name: 'path', value: 1, stateBefore: [1], stateAfter: [] },
    },
  ],
};

test('recursion-tree: the tree GROWS (addNode + parent edge), returns land on the node', () => {
  const ops = traceToJsavOps(FIB);
  const s0 = opsAt(ops, 0);
  const root = s0.find((o) => o.op === 'addNode');
  assert.equal(root?.target, '0');
  assert.equal(root?.value, 'fib(2)', 'the node carries its declared label');
  assert.equal(root?.structure, 'tree');
  assert.equal(s0.filter((o) => o.op === 'addEdge').length, 0, 'the root has no parent edge');

  const s1 = opsAt(ops, 1);
  const child = s1.find((o) => o.op === 'addNode');
  assert.equal(child?.target, '1', 'the descended-into call is revealed');
  const edge = s1.find((o) => o.op === 'addEdge');
  assert.deepEqual(edge?.target, ['0', '1'], 'the parent edge is the DECLARED caller->callee edge');
  assert.ok(s1.indexOf(child) < s1.indexOf(edge), 'the node exists before its edge');
  assert.ok(s1.some((o) => o.op === 'traverseEdge' && !o.meta?.reverse), 'the descent rides the edge forward');

  const s2 = opsAt(ops, 2);
  const ret = s2.find((o) => o.op === 'setNodeValue');
  assert.equal(ret?.target, '1');
  assert.equal(ret?.value, 1, 'the recorded return value lands on the returning node');
  assert.equal(ret?.meta?.kind, 'returned');
  const rideBack = s2.find((o) => o.op === 'traverseEdge');
  assert.deepEqual(rideBack?.target, ['1', '0']);
  assert.equal(rideBack?.meta?.reverse, true, 'the return ride is marked reverse');
});

test('recursion-tree: the backtrack marker lands on the UNDOING CALLER with its recorded undo', () => {
  const ops = traceToJsavOps(FIB);
  const s3 = opsAt(ops, 3);
  const bt = s3.filter((o) => o.op === 'backtrack');
  assert.equal(bt.length, 1, 'exactly one backtrack marker');
  assert.equal(bt[0].target, '0', 'the marker is on the caller doing the undo (step.callId), not the child');
  assert.equal(bt[0].structure, 'tree');
  assert.equal(bt[0].meta?.undo?.name, 'path', 'the recorded undo rides along');
  assert.deepEqual(bt[0].meta?.undo?.stateBefore, [1]);

  // the call stack diffs into push/pop ops tagged as the call stack
  const pushes = ops.filter((o) => o.op === 'push' && o.meta?.collection === 'callStack');
  assert.deepEqual(pushes.map((o) => o.value), ['fib(2)', 'fib(1)']);
  const pops = ops.filter((o) => o.op === 'pop' && o.meta?.collection === 'callStack');
  assert.deepEqual(pops.map((o) => o.value), ['fib(1)']);
});

// ---- unknown kinds + totality ---------------------------------------------------------------

test('unknown step kinds become a note op — never a throw', () => {
  const weird = {
    language: 'python',
    code: 'x = 1',
    views: {},
    steps: [
      { line: 1, explanation: 'a step shape from the future', wobble: { flux: 9 } },
    ],
  };
  const ops = traceToJsavOps(weird);
  const notes = ops.filter((o) => o.op === 'note');
  assert.equal(notes.length, 1, 'exactly one safe note op');
  assert.equal(notes[0].value, 'a step shape from the future', 'the note keeps the narration');
  assert.ok(ops.every((o) => JSAV_OPS.includes(o.op)));
});

test('totality: null, junk, and board-object wrapping all yield ops, never exceptions', () => {
  assert.equal(traceToJsavOps(null)[0].op, 'note');
  assert.equal(traceToJsavOps({ steps: [] })[0].op, 'note');
  assert.equal(traceToJsavOps('nonsense')[0].op, 'note');
  // renderHint 'algorithm' board objects hold the trace as content — both spellings work
  const direct = traceToJsavOps(BINARY_SEARCH);
  const wrapped = traceToJsavOps({ renderHint: 'algorithm', content: BINARY_SEARCH });
  assert.deepEqual(wrapped, direct, 'the board object translates identically to its trace');
  // a malformed step inside an otherwise good trace degrades to a note for THAT step only
  const mixed = { ...BINARY_SEARCH, steps: [BINARY_SEARCH.steps[0], null, BINARY_SEARCH.steps[1]] };
  const ops = traceToJsavOps(mixed);
  assert.ok(opsAt(ops, 1).every((o) => o.op === 'note'), 'the bad step is a note');
  assert.ok(opsAt(ops, 2).some((o) => o.op === 'movePointer'), 'the good steps still animate');
});

test('every step narrates: setLine on line changes, umsg with the explanation', () => {
  const ops = traceToJsavOps(BINARY_SEARCH);
  assert.deepEqual(ops.filter((o) => o.op === 'setLine').map((o) => o.target), [2, 4], 'line ops only when the line changes');
  const msgs = ops.filter((o) => o.op === 'umsg');
  assert.equal(msgs.length, BINARY_SEARCH.steps.length, 'one umsg per step');
  assert.equal(msgs[0].value, BINARY_SEARCH.steps[0].explanation);
});

test('opsByStep groups the same ops per step for scrubbing renderers', () => {
  const grouped = opsByStep(DP);
  assert.equal(grouped.length, DP.steps.length);
  const flat = grouped.flat();
  assert.deepEqual(flat, traceToJsavOps(DP), 'grouping loses and reorders nothing');
});

test('collection diffs: stack tops pop in order, queues remove from the front only', () => {
  assert.deepEqual(diffStack([1, 2, 3], [1, 2]), { popped: [3], pushed: [] });
  assert.deepEqual(diffStack([1, 2], [1, 5, 6]), { popped: [2], pushed: [5, 6] });
  assert.deepEqual(diffQueue([1, 2, 3], [2, 3, 4]), { dequeued: [1], enqueued: [4] });
  assert.deepEqual(diffQueue([], [7]), { dequeued: [], enqueued: [7] });
  assert.deepEqual(diffQueue([7], []), { dequeued: [7], enqueued: [] });
});
