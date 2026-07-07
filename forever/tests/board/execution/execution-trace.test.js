import assert from 'node:assert/strict';
import test from 'node:test';

import { validateExecutionTrace, traceStateAt } from '../../../lib/board/execution/execution-trace.js';

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

test('traceStateAt maps clock progress to the active step and accumulates variable history', () => {
  const start = traceStateAt(BINARY_SEARCH, 0);
  assert.equal(start.index, 0);
  assert.equal(start.history.length, 1);

  const end = traceStateAt(BINARY_SEARCH, 1);
  assert.equal(end.index, 1);
  assert.equal(end.history.length, 2);
  assert.deepEqual(end.history[1].variables, { lo: 4, hi: 6, mid: 5 });
});
