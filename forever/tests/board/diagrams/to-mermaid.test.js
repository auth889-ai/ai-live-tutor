import assert from 'node:assert/strict';
import test from 'node:test';

import { toMermaid } from '../../../lib/board/diagrams/to-mermaid.js';

test('flowchart becomes readable mermaid with nodes and edges', () => {
  const m = toMermaid({ diagramType: 'flowchart', steps: ['Create file', 'Write SQL', 'Run'] });
  assert.match(m, /flowchart LR/);
  assert.match(m, /n0\["Create file"\]/);
  assert.match(m, /n0 --> n1/);
  assert.match(m, /n1 --> n2/);
});

test('cycle loops the last node back to the first', () => {
  const m = toMermaid({ diagramType: 'cycle', steps: ['A', 'B', 'C'] });
  assert.match(m, /n2 --> n0/);
});

test('tree renders root and children top-down', () => {
  const m = toMermaid({ diagramType: 'tree', root: { label: 'Migration', children: [{ label: 'Up' }, { label: 'Down' }] } });
  assert.match(m, /flowchart TD/);
  assert.match(m, /root\["Migration"\]/);
  assert.match(m, /root --> c0/);
  assert.match(m, /root --> c1/);
});

test('labels are escaped so long/quoted text cannot break mermaid', () => {
  const m = toMermaid({ diagramType: 'flowchart', steps: ['Runs ALTER TABLE users DROP COLUMN "email"'] });
  assert.ok(!m.includes('["Runs ALTER TABLE users DROP COLUMN "email""]'));
  assert.ok(m.includes("'email'"));
});

test('comparison is not a mermaid diagram (renders as HTML table)', () => {
  assert.throws(() => toMermaid({ diagramType: 'comparison', columns: ['a'], rows: [] }), /HTML table/);
});
