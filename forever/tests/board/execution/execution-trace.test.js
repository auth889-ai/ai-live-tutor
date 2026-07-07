import assert from 'node:assert/strict';
import test from 'node:test';

import { validateExecutionTrace, traceStateAt, traceStateAtMs } from '../../../lib/board/execution/execution-trace.js';

const BINARY_SEARCH = {
  language: 'python',
  code: 'def search(a, t):\n    lo, hi = 0, len(a)-1\n    while lo <= hi:\n        mid = (lo+hi)//2\n        if a[mid] == t: return mid\n        if a[mid] < t: lo = mid+1\n        else: hi = mid-1',
  views: { array: { values: [1, 3, 5, 7, 9, 11, 13] } },
  steps: [
    { line: 4, explanation: 'mid=3 -> a[3]=7 < 11, go right', array: { current: 3, pointers: { lo: 0, mid: 3, hi: 6 } }, variables: { lo: 0, hi: 6, mid: 3 } },
    { line: 6, explanation: 'discard left half', array: { current: 5, eliminated: [0, 1, 2, 3], pointers: { lo: 4, mid: 5, hi: 6 } }, variables: { lo: 4, hi: 6, mid: 5 } },
  ],
};

const BFS = {
  language: 'javascript',
  code: 'function bfs(g, s) {\n  const q = [s], seen = new Set([s]);\n  while (q.length) {\n    const v = q.shift();\n  }\n}',
  views: { graph: { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }], directed: true } },
  steps: [
    { line: 2, explanation: 'start at A, enqueue', graph: { current: 'A', visited: [] }, queue: ['A'] },
    { line: 4, explanation: 'dequeue A, visit B and C', graph: { current: 'A', visited: ['A'] }, queue: ['B', 'C'] },
  ],
};

test('accepts a real binary-search execution trace (array-backed)', () => {
  const t = validateExecutionTrace(BINARY_SEARCH);
  assert.equal(t.steps.length, 2);
});

test('accepts a real BFS execution trace (graph-backed, with a queue)', () => {
  validateExecutionTrace(BFS);
});

test('rejects an unknown language', () => {
  assert.throws(() => validateExecutionTrace({ ...BINARY_SEARCH, language: 'cobol' }), /language must be one of/);
});

test('rejects a step whose code line is out of range', () => {
  assert.throws(
    () => validateExecutionTrace({ ...BINARY_SEARCH, steps: [{ line: 99, explanation: 'x' }] }),
    /line must be a valid 1-based code line/,
  );
});

test('rejects a step with an explanation missing', () => {
  assert.throws(
    () => validateExecutionTrace({ ...BINARY_SEARCH, steps: [{ line: 1 }] }),
    /needs an explanation/,
  );
});

test('rejects array state when no views.array is declared', () => {
  assert.throws(
    () => validateExecutionTrace({ language: 'python', code: 'x = 1', steps: [{ line: 1, explanation: 'x', array: { current: 0 } }] }),
    /has array state but no views.array/,
  );
});

test('rejects an out-of-bounds array pointer and a missing graph node', () => {
  assert.throws(() => validateExecutionTrace({ ...BINARY_SEARCH, steps: [{ line: 1, explanation: 'x', array: { pointers: { lo: 99 } } }] }), /array pointer index out of bounds/);
  assert.throws(() => validateExecutionTrace({ ...BFS, steps: [{ line: 1, explanation: 'x', graph: { current: 'Z' } }] }), /graph current references a missing node/);
});

test('rejects an empty steps array', () => {
  assert.throws(() => validateExecutionTrace({ ...BINARY_SEARCH, steps: [] }), /non-empty steps/);
});

// --- clock-driven, timed trace (BFS with startMs/endMs, activeEdge, queue, traceRow) ---

const TIMED_BFS = {
  language: 'javascript',
  code: 'function bfs(g, s) {\n  const q = [s], seen = new Set([s]);\n  while (q.length) {\n    const v = q.shift();\n  }\n}',
  views: { graph: { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }], directed: true } },
  steps: [
    { startMs: 0, endMs: 4000, line: 2, explanation: 'enqueue A', graph: { current: 'A', visited: [] }, queue: ['A'], variables: { seen: 1 }, traceRow: { step: 1, action: 'visit A' } },
    { startMs: 4000, endMs: 8000, line: 4, explanation: 'dequeue A, reach B', graph: { current: 'B', visited: ['A'] }, activeEdge: ['A', 'B'], queue: ['C', 'B'], variables: { seen: 3 }, traceRow: { step: 2, action: 'visit B' } },
    { startMs: 8000, endMs: 12000, line: 4, explanation: 'dequeue C', graph: { current: 'C', visited: ['A', 'B'] }, queue: [], variables: { seen: 3 }, traceRow: { step: 3, action: 'visit C' } },
  ],
};

test('accepts a timed clock-driven trace with activeEdge, queue and traceRow', () => {
  const t = validateExecutionTrace(TIMED_BFS);
  assert.equal(t.steps.length, 3);
});

test('rejects a partially-timed trace (all steps or none must carry startMs)', () => {
  const bad = { ...TIMED_BFS, steps: [TIMED_BFS.steps[0], { line: 4, explanation: 'x', graph: { current: 'B' } }] };
  assert.throws(() => validateExecutionTrace(bad), /either all steps carry startMs or none/);
});

test('rejects endMs <= startMs and an activeEdge to a missing node', () => {
  assert.throws(() => validateExecutionTrace({ ...TIMED_BFS, steps: [{ startMs: 100, endMs: 50, line: 2, explanation: 'x' }] }), /endMs must be greater than startMs/);
  assert.throws(() => validateExecutionTrace({ ...TIMED_BFS, steps: [{ startMs: 0, endMs: 10, line: 2, explanation: 'x', activeEdge: ['A', 'Z'] }] }), /activeEdge references a missing node/);
});

test('rejects overlapping / out-of-order step windows', () => {
  const overlap = {
    ...TIMED_BFS,
    steps: [
      { startMs: 0, endMs: 5000, line: 2, explanation: 'a' },
      { startMs: 3000, endMs: 8000, line: 4, explanation: 'b' }, // starts before previous ended
    ],
  };
  assert.throws(() => validateExecutionTrace(overlap), /windows must be ordered/);
});

test('traceStateAtMs is deterministic: same time -> identical state (seek safety)', () => {
  const a = traceStateAtMs(TIMED_BFS, 5000);
  const b = traceStateAtMs(TIMED_BFS, 5000);
  assert.deepEqual(a, b);
  assert.equal(a.index, 1); // 5000ms falls in step 2's window
});

test('traceStateAtMs: current changes over time and visited persists', () => {
  assert.equal(traceStateAtMs(TIMED_BFS, 0).step.graph.current, 'A');
  assert.equal(traceStateAtMs(TIMED_BFS, 6000).step.graph.current, 'B');
  const late = traceStateAtMs(TIMED_BFS, 10000);
  assert.equal(late.step.graph.current, 'C');
  assert.deepEqual(late.step.graph.visited, ['A', 'B']); // earlier nodes stay visited
});

test('traceStateAtMs reveals trace-table rows only up to the current step', () => {
  assert.equal(traceStateAtMs(TIMED_BFS, 0).history.length, 1);
  assert.equal(traceStateAtMs(TIMED_BFS, 12000).history.length, 3);
  assert.deepEqual(traceStateAtMs(TIMED_BFS, 12000).history.map((h) => h.traceRow.action), ['visit A', 'visit B', 'visit C']);
});

test('traceStateAtMs before the first window clamps to step 0; after the last clamps to the end', () => {
  assert.equal(traceStateAtMs(TIMED_BFS, -100).index, 0);
  assert.equal(traceStateAtMs(TIMED_BFS, 999999).index, 2);
});

test('traceStateAtMs refuses an untimed trace (points you at the progress API)', () => {
  assert.throws(() => traceStateAtMs(BINARY_SEARCH, 1000), /requires timed steps/);
});

test('traceStateAt maps clock progress to the active step and accumulates variable history', () => {
  const start = traceStateAt(BINARY_SEARCH, 0);
  assert.equal(start.index, 0);
  assert.equal(start.history.length, 1);

  const end = traceStateAt(BINARY_SEARCH, 1);
  assert.equal(end.index, 1);
  assert.equal(end.history.length, 2);
  assert.deepEqual(end.history[1].variables, { lo: 4, hi: 6, mid: 5 });
});
