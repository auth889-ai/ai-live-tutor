import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutForce, wantsForceLayout } from '../../../lib/board/diagrams/force-layout.js';

const GRAPH = {
  nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }, { id: 'F' }, { id: 'G' }],
  edges: [
    { from: 'A', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'C' }, { from: 'B', to: 'D' },
    { from: 'C', to: 'E' }, { from: 'D', to: 'E' }, { from: 'E', to: 'G' }, { from: 'C', to: 'F' }, { from: 'F', to: 'G' },
  ],
};

test('deterministic: the same graph always lays out identically', () => {
  const a = layoutForce(GRAPH);
  const b = layoutForce(GRAPH);
  assert.deepEqual(a, b);
});

test('organic spread: nodes are well separated, connected nodes are closer than distant ones', () => {
  const { nodes } = layoutForce(GRAPH);
  const at = new Map(nodes.map((n) => [n.id, { x: n.x + n.width / 2, y: n.y + n.height / 2 }]));
  const dist = (p, q) => Math.hypot(at.get(p).x - at.get(q).x, at.get(p).y - at.get(q).y);
  // No two nodes collapse onto each other.
  const ids = [...at.keys()];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      assert.ok(dist(ids[i], ids[j]) > 60, `${ids[i]} and ${ids[j]} are too close (${dist(ids[i], ids[j]).toFixed(0)}px)`);
    }
  }
  // An edge-connected pair sits closer than the graph's farthest pair (structure shows).
  const connected = dist('A', 'B');
  const far = Math.max(...ids.flatMap((p) => ids.map((q) => (p === q ? 0 : dist(p, q)))));
  assert.ok(connected < far, 'edges pull neighbors together');
});

test('output matches the dagre layout contract (x/y/width/height, edges, extent)', () => {
  const out = layoutForce({ nodes: [{ id: '1', label: 'hello' }], edges: [] });
  assert.equal(out.nodes[0].height, 44);
  assert.ok(out.nodes[0].width >= 48);
  assert.ok(out.width > 0 && out.height > 0);
  assert.deepEqual(out.edges, []);
});

test('wantsForceLayout: cycles/cross-edges/undirected -> organic; clean rooted trees -> not', () => {
  assert.equal(wantsForceLayout(GRAPH, true), true, 'cycle graph is organic');
  assert.equal(wantsForceLayout({ nodes: [{ id: 'r' }, { id: 'a' }, { id: 'b' }], edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'b' }] }, true), false, 'a clean tree stays hierarchical');
  assert.equal(wantsForceLayout({ nodes: [{ id: 'x' }, { id: 'y' }], edges: [{ from: 'x', to: 'y' }] }, false), true, 'undirected is organic');
  const sharedChild = { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }] };
  assert.equal(wantsForceLayout(sharedChild, true), true, 'a shared child (DAG) is organic');
});
