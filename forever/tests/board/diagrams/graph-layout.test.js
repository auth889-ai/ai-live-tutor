import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutGraph } from '../../../lib/board/diagrams/graph-layout.js';

test('lays out a binary tree with children below the root (dagre)', () => {
  const out = layoutGraph({
    nodes: [{ id: '1', label: '8' }, { id: '2', label: '3' }, { id: '3', label: '10' }],
    edges: [{ from: '1', to: '2' }, { from: '1', to: '3' }],
  });
  const root = out.nodes.find((n) => n.id === '1');
  const left = out.nodes.find((n) => n.id === '2');
  const right = out.nodes.find((n) => n.id === '3');
  assert.ok(left.y > root.y && right.y > root.y, 'children sit below the root');
  assert.notEqual(left.x, right.x, 'siblings are horizontally separated');
  assert.equal(out.edges.length, 2);
});

test('preserves node labels and edges', () => {
  const out = layoutGraph({ nodes: [{ id: 'a', label: 'Head' }, { id: 'b', label: 'Next' }], edges: [{ from: 'a', to: 'b', label: 'ptr' }] });
  assert.equal(out.nodes[0].label, 'Head');
  assert.equal(out.edges[0].label, 'ptr');
});

test('is deterministic and rejects empty graphs', () => {
  const spec = { nodes: [{ id: '1', label: 'x' }], edges: [] };
  assert.deepEqual(layoutGraph(spec), layoutGraph(spec));
  assert.throws(() => layoutGraph({ nodes: [], edges: [] }), /at least one node/);
});
