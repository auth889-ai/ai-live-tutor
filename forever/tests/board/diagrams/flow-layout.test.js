import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutFlow, estimateNodeHeight } from '../../../lib/board/diagrams/flow-layout.js';

// The REAL flowchart that rendered cramped in Mermaid (ML lesson sc_02): steps carrying math.
const REAL = {
  diagramType: 'flowchart',
  steps: [
    { id: 'features', label: 'Email Features\nwords=4, links=2' },
    { id: 'weighted_sum', label: 'Weighted Sum\nz = w₁×words + w₂×links + b\nz = 1.5×4 + 1.0×2 + (-4)\nz = 6 + 2 - 4 = 4' },
    { id: 'sigmoid', label: 'Sigmoid\nP = 1/(1+e^-z) = 0.98' },
  ],
};

test('long math labels get REAL reserved space — the cramped/cut Mermaid bug is structurally dead', () => {
  const { nodes, edges } = layoutFlow(REAL);
  assert.equal(nodes.length, 3);
  assert.equal(edges.length, 2);
  const sum = nodes.find((n) => n.id === 'weighted_sum');
  const feat = nodes.find((n) => n.id === 'features');
  assert.ok(sum.height > feat.height, 'a 4-line math node is taller than a 2-line node — height follows content');
  // dagre spacing: no two nodes overlap vertically (top-bottom layout).
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(sorted[i].position.y >= sorted[i - 1].position.y + sorted[i - 1].height, 'nodes never overlap');
  }
});

test('a cycle closes the loop back to the start', () => {
  const { edges } = layoutFlow({ diagramType: 'cycle', steps: ['Evaporation', 'Condensation', 'Rain'] });
  assert.equal(edges.length, 3, '3 steps -> 3 edges including the closing one');
  assert.equal(edges.at(-1).target, edges[0].source, 'last edge returns to the first node');
});

test('string steps and object steps both work; height estimator wraps long single lines', () => {
  const { nodes } = layoutFlow({ diagramType: 'flowchart', steps: ['Short', { id: 's2', label: 'x'.repeat(100) }] });
  assert.equal(nodes.length, 2);
  assert.ok(estimateNodeHeight('x'.repeat(100)) > estimateNodeHeight('Short'), 'a 100-char line wraps to more height');
});
