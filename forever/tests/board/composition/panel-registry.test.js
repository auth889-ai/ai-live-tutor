import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSpec, chooseLayout } from '../../../lib/board/composition/panel-registry.js';
import { structureSpecFrom } from '../../../lib/board/execution/structure-spec.js';

test('normalizeSpec: valid spec passes; unknown types, panel floods, CSS smuggling all reject', () => {
  const good = normalizeSpec({ layoutIntent: 'force', panels: [{ type: 'graph', title: 'G' }, { type: 'concept-card', title: 'Rule', content: 'x' }] });
  assert.equal(good.ok, true);
  assert.equal(normalizeSpec({ panels: [{ type: 'hologram' }] }).ok, false);
  assert.equal(normalizeSpec({ panels: Array.from({ length: 7 }, () => ({ type: 'legend' })) }).ok, false, 'a cockpit is not a dashboard dump');
  assert.equal(normalizeSpec({ panels: [{ type: 'graph', x: 10 }] }).ok, false, 'no coordinates');
  assert.equal(normalizeSpec({ panels: [{ type: 'graph', css: 'red' }] }).ok, false, 'no CSS');
  assert.equal(normalizeSpec({ panels: [{ type: 'state-table' }] }).ok, false, 'state-table needs columns');
  assert.equal(normalizeSpec({ layoutIntent: 'spiral', panels: [{ type: 'graph' }] }).ok, false);
});

test('chooseLayout is deterministic from structure + intent — the AI never names engines', () => {
  const grid = structureSpecFrom({ views: { array2d: { rows: 3, cols: 4 } } });
  assert.equal(chooseLayout(grid, 'force'), 'css-grid', 'a grid NEVER goes to a graph engine, whatever the intent');
  const small = structureSpecFrom({ views: { graph: { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }] } } });
  assert.equal(chooseLayout(small, 'auto'), 'force');
  assert.equal(chooseLayout(small, 'hierarchical'), 'tree');
  const big = structureSpecFrom({ views: { graph: { nodes: Array.from({ length: 20 }, (_, i) => ({ id: String(i) })), edges: [] } } });
  assert.equal(chooseLayout(big, 'auto'), 'elk', 'dense graphs route to the strongest layered engine');
  const arr = structureSpecFrom({ views: { array: { values: [1, 2, 3] } } });
  assert.equal(chooseLayout(arr, 'auto'), 'linear');
});
