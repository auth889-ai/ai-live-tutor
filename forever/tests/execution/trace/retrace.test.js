import assert from 'node:assert/strict';
import test from 'node:test';

import { retrace } from '../../../lib/execution/trace/retrace.js';

const GRAPH = {
  nodes: [{ id: '1' }, { id: '2' }, { id: '3' }],
  edges: [{ from: '1', to: '2', side: 'left' }, { from: '1', to: '3', side: 'right' }],
  directed: true,
};

test('traversal retrace: student changes the start node and kind — new exact walk, recipe kept', async () => {
  const fromThree = await retrace({ tool: 'traversal', params: { graph: GRAPH, kind: 'dfs', start: '3', code: 'a\nb' } });
  const order = fromThree.steps.filter((s) => s.graph.current !== null).map((s) => s.graph.current);
  assert.deepEqual(order, ['3'], 'starting at a leaf visits only what is reachable');
  assert.equal(fromThree.meta.tool, 'traversal', 'the retraced trace is itself re-retraceable');
  assert.equal(fromThree.meta.params.start, '3');

  const bfs = await retrace({ tool: 'traversal', params: { graph: GRAPH, kind: 'bfs', start: '1', code: 'a\nb' } });
  assert.deepEqual(bfs.steps.filter((s) => s.graph.current).map((s) => s.graph.current), ['1', '2', '3']);
});

test('recursion retrace: memo toggle re-runs the REAL engine (injected sandbox)', async () => {
  const stdout = '@@CALLTREE ' + JSON.stringify({
    fnName: 'fib', result: 1,
    vertices: { 0: { args: [2], children: [{ id: 1, value: 1 }, { id: 2, value: 0 }], memoized: false }, 1: { args: [1], children: [], memoized: false }, 2: { args: [0], children: [], memoized: false } },
  });
  const calls = [];
  const trace = await retrace(
    { tool: 'recursion', params: { code: 'def fib(n):\n    return n if n <= 1 else fib(n-1) + fib(n-2)', fnName: 'fib', args: [2], memoize: true } },
    { runCode: async ({ source }) => { calls.push(source); return { stdout, stderr: '', timedOut: false }; } },
  );
  assert.ok(calls[0].includes('MEMOIZE = True'), 'the toggle reaches the instrumented run');
  assert.equal(trace.steps.length, 6);
  assert.equal(trace.meta.params.memoize, true);
});

test('bounded and honest: caps, timeouts, unknown tools reject loudly', async () => {
  await assert.rejects(retrace({ tool: 'quantum' }), /must be one of/);
  await assert.rejects(
    retrace({ tool: 'traversal', params: { graph: { nodes: Array.from({ length: 41 }, (_, i) => ({ id: String(i) })), edges: [] }, code: 'x' } }),
    /max 40 nodes/,
  );
  await assert.rejects(
    retrace({ tool: 'recursion', params: { code: 'def f(n):\n    return f(n)', fnName: 'f', args: [1] } }, { runCode: async () => ({ timedOut: true }) }),
    /timed out/,
  );
  await assert.rejects(
    retrace({ tool: 'recursion', params: { code: 'def f(n):\n    return 1', fnName: 'f', args: Array(300).fill(9) } }),
    /arguments too large/,
  );
});
