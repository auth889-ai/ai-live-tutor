import assert from 'node:assert/strict';
import test from 'node:test';

import { compileTraversalTrace } from '../../lib/execution/trace/traversal/compiler.js';

// The classic 7-node binary tree: 1 -> (2, 3), 2 -> (4, 5), 3 -> (6, 7)
const TREE = {
  nodes: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: String(n) })),
  edges: [
    { from: '1', to: '2', side: 'left' }, { from: '1', to: '3', side: 'right' },
    { from: '2', to: '4', side: 'left' }, { from: '2', to: '5', side: 'right' },
    { from: '3', to: '6', side: 'left' }, { from: '3', to: '7', side: 'right' },
  ],
  directed: true,
};
const CODE = 'def level_order(root):\n    queue = deque([root])\n    while queue:\n        node = queue.popleft()\n        visit(node)\n        queue.extend(children(node))\n    return order';
const LINES = { init: 2, visit: 5, done: 7 };

test('BFS: exact level order, live queue at every step, teacher-voice sentences', () => {
  const trace = compileTraversalTrace({ graph: TREE, kind: 'bfs', start: '1', code: CODE, lines: LINES });

  const visitSteps = trace.steps.filter((s) => s.graph.current !== null);
  assert.deepEqual(visitSteps.map((s) => s.graph.current), ['1', '2', '3', '4', '5', '6', '7'], 'true level order');

  // The queue is REAL at each step: after visiting 2, queue is [3, 4, 5].
  const afterTwo = visitSteps[1];
  assert.deepEqual(afterTwo.queue, ['3', '4', '5']);
  assert.equal(afterTwo.line, LINES.visit);
  assert.deepEqual(afterTwo.activeEdge, ['1', '2'], 'we arrived at 2 along the edge from 1');

  // Visited accumulates and never shrinks.
  for (let i = 1; i < visitSteps.length; i += 1) {
    assert.ok(visitSteps[i].graph.visited.length > visitSteps[i - 1].graph.visited.length);
  }

  // Every sentence teaches: real node names, full sentences — never stubs.
  for (const s of trace.steps) assert.ok(s.explanation.length > 80, `rich sentence: ${s.explanation.slice(0, 40)}...`);
  assert.match(trace.steps[0].explanation, /queue.*FRONT/s);
  assert.match(trace.steps.at(-1).explanation, /1 → 2 → 3 → 4 → 5 → 6 → 7.*O\(V \+ E\)/s);
});

test('DFS: dives deep before backtracking, stack shown instead of queue', () => {
  const trace = compileTraversalTrace({ graph: TREE, kind: 'dfs', start: '1', code: CODE, lines: LINES });
  const order = trace.steps.filter((s) => s.graph.current !== null).map((s) => s.graph.current);
  assert.deepEqual(order, ['1', '2', '4', '5', '3', '6', '7'], 'left branch fully explored first');
  assert.ok(trace.steps.every((s) => Array.isArray(s.stack)), 'every step carries the stack');
  assert.ok(trace.steps.every((s) => s.queue === undefined), 'no queue on a DFS');
});

test('undirected graphs traverse both directions; honest failures reject junk', () => {
  const graph = { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }], directed: false };
  const trace = compileTraversalTrace({ graph, kind: 'bfs', start: 'C', code: CODE, lines: LINES });
  const order = trace.steps.filter((s) => s.graph.current !== null).map((s) => s.graph.current);
  assert.deepEqual(order, ['C', 'B', 'A'], 'walks against edge direction when undirected');

  assert.throws(() => compileTraversalTrace({ graph: { nodes: [], edges: [] }, code: CODE }), /non-empty graph/);
  assert.throws(() => compileTraversalTrace({ graph: TREE, start: '99', code: CODE }), /not a node/);
  assert.throws(() => compileTraversalTrace({ graph: { nodes: [{ id: 'A' }], edges: [{ from: 'A', to: 'Z' }] }, start: 'A', code: CODE }), /missing node/);
});
