import assert from 'node:assert/strict';
import test from 'node:test';

import { compileStructureTrace } from '../../../lib/execution/trace/structure/compiler.js';
import { assembleStructureProgram, parseStructureEvents } from '../../../lib/execution/trace/structure/tracker.js';

const ev = (line, state, variables = {}) => ({ line, state, variables });

// Tracker-shaped snapshots of a binary tree being walked: root(4) with children 2 and 7,
// the cursor (`node`) stepping root -> left -> right.
const TREE = [
  ev(2, { kind: 'nodes', nodes: { n1: { label: 4, refs: [['left', 'n2'], ['right', 'n3']] }, n2: { label: 2, refs: [] }, n3: { label: 7, refs: [] } }, pointers: { node: 'n1' } }),
  ev(4, { kind: 'nodes', nodes: { n1: { label: 4, refs: [['left', 'n2'], ['right', 'n3']] }, n2: { label: 2, refs: [] }, n3: { label: 7, refs: [] } }, pointers: { node: 'n2' } }),
  ev(4, { kind: 'nodes', nodes: { n1: { label: 4, refs: [['left', 'n2'], ['right', 'n3']] }, n2: { label: 2, refs: [] }, n3: { label: 7, refs: [] } }, pointers: { node: 'n3' } }),
];

test('binary tree auto-extraction: nodes/edges with sides, cursor walks, visited accumulates', () => {
  const trace = compileStructureTrace({ events: TREE, result: 'n1', code: 'a\nb\nc\nd', entry: 'invert(tree)' });

  assert.match(trace.steps[0].explanation, /extracted live from memory.*Nothing here was declared/s, 'frame beat');
  assert.deepEqual(trace.views.graph.nodes.map((n) => `${n.id}:${n.label}`), ['n1:4', 'n2:2', 'n3:7']);
  assert.deepEqual(trace.views.graph.edges, [
    { from: 'n1', to: 'n2', side: 'left' },
    { from: 'n1', to: 'n3', side: 'right' },
  ], 'left/right ref fields become tree sides for the tidy layout');

  const walkToLeft = trace.steps.find((s) => /node steps to the node holding '2'/.test(s.explanation));
  assert.ok(walkToLeft, 'cursor move narrated with real values');
  assert.deepEqual(walkToLeft.activeEdge, ['n1', 'n2'], 'the walked link lights up');
  assert.ok(walkToLeft.graph.visited.includes('n1'), 'the left-behind node is visited');
  assert.deepEqual(walkToLeft.graph.pointers, { node: 'n2' }, "the cursor rides under the student's variable name");

  assert.match(trace.steps.at(-1).explanation, /3 nodes and 2 links.*IS the algorithm's memory/s);
});

test('growth: nodes appearing mid-run are narrated and revealed accumulates', () => {
  const grow = [
    ev(2, { kind: 'nodes', nodes: { n1: { label: 1, refs: [] } }, pointers: { node: 'n1' } }),
    ev(3, { kind: 'nodes', nodes: { n1: { label: 1, refs: [['next', 'n2']] }, n2: { label: 2, refs: [] } }, pointers: { node: 'n1' } }),
  ];
  const trace = compileStructureTrace({ events: grow, result: null, code: 'a\nb\nc' });
  const growth = trace.steps.find((s) => /structure grows.*node holding '2'.*2 nodes now live/s.test(s.explanation));
  assert.ok(growth, 'the growth beat fires with real labels and counts');
  assert.deepEqual(growth.graph.revealed, ['n1', 'n2']);
});

test('adjacency dict: keys/neighbors become nodes and edges, integer cursor tracked', () => {
  const adj = [
    ev(2, { kind: 'adj', nodes: ['0', '1', '2'], edges: [['0', '1'], ['0', '2'], ['1', '2']], pointers: { u: '0' } }),
    ev(3, { kind: 'adj', nodes: ['0', '1', '2'], edges: [['0', '1'], ['0', '2'], ['1', '2']], pointers: { u: '1' } }),
  ];
  const trace = compileStructureTrace({ events: adj, result: 3, code: 'a\nb\nc' });
  assert.equal(trace.views.graph.nodes.length, 3);
  assert.equal(trace.views.graph.edges.length, 3);
  const move = trace.steps.find((s) => /u steps to the node holding '1'/.test(s.explanation));
  assert.ok(move);
  assert.deepEqual(move.activeEdge, ['0', '1']);
});

test('harness + honest failures: single-expression entry, no structure detected', () => {
  const ok = assembleStructureProgram({ code: 'tree = None\ndef f(t):\n    return t', entry: 'f(tree)' });
  assert.ok(ok.includes("compile(_maybe_tree, '<student>', 'exec')"));
  assert.throws(() => assembleStructureProgram({ code: 'x', entry: 'a();b()' }), /single expression/);
  assert.equal(parseStructureEvents('junk'), null);
  assert.throws(() => compileStructureTrace({ events: [], result: 1, code: 'x' }), /no events/);
  assert.throws(
    () => compileStructureTrace({ events: [{ line: 1, state: null, variables: {} }], result: 1, code: 'a' }),
    /no tree\/graph structure was detected/,
  );
});
