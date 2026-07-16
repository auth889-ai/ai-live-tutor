import assert from 'node:assert/strict';
import test from 'node:test';

import { entityId, parseEntityId, structureSpecFrom, stepEntityRefs } from '../../../lib/board/execution/structure-spec.js';
import { compileGraphWalk } from '../../../lib/execution/trace/graph-walk/compiler.js';

test('typed entity ids: build + parse round-trip, edge notation, malformed rejected', () => {
  assert.equal(entityId('graphNode', 4), 'graphNode:4');
  assert.equal(entityId('gridCell', 1, 2), 'gridCell:1:2');
  assert.equal(entityId('edge', 4, 6), 'edge:4->6');
  assert.deepEqual(parseEntityId('graphNode:4'), { type: 'graphNode', parts: ['4'] });
  assert.deepEqual(parseEntityId('gridCell:1:2'), { type: 'gridCell', parts: ['1', '2'] });
  assert.deepEqual(parseEntityId('edge:4->6'), { type: 'edge', from: '4', to: '6' });
  assert.equal(parseEntityId('justastring'), null);
  assert.equal(parseEntityId('edge:broken'), null);
  assert.throws(() => entityId('edge', 1), /edge:<from>-><to>/);
});

test('structureSpecFrom: graph is primary over array; entities and meta are typed and counted', () => {
  const spec = structureSpecFrom({
    views: {
      array: { values: [7, 1, 5] },
      graph: { nodes: [{ id: 'A' }, { id: 'B', label: 'BB' }], edges: [{ from: 'A', to: 'B' }], directed: false },
    },
  });
  assert.equal(spec.kind, 'graph', 'graph outranks array as the primary structure');
  assert.equal(spec.views.length, 2);
  assert.ok(spec.entities.has('graphNode:A') && spec.entities.has('edge:A->B') && spec.entities.has('arrayCell:2'));
  const g = spec.views.find((v) => v.kind === 'graph');
  assert.equal(g.meta.nodeCount, 2);
  assert.equal(g.meta.directed, false);
  assert.ok(g.meta.avgLabelLength > 0);
});

test('structureSpecFrom: grid enumerates every cell; empty views is an honest null kind', () => {
  const spec = structureSpecFrom({ views: { array2d: { rows: 2, cols: 3 } } });
  assert.equal(spec.kind, 'grid');
  assert.equal(spec.views[0].entities.length, 6);
  assert.ok(spec.entities.has('gridCell:1:2'));
  assert.equal(structureSpecFrom({ views: {} }).kind, null, 'a pure line trace has no persistent structure');
});

test('the invariant, mechanically: every entity a real compiled step references exists in the spec', () => {
  // Real compiler output (Tarjan-shaped): references must be a subset of declared structure.
  const trace = compileGraphWalk({
    events: [
      { line: 2, locals: { u: 0, disc: [0, -1, -1], low: [0, -1, -1] } },
      { line: 3, locals: { u: 1, disc: [0, 1, -1], low: [0, 1, -1] } },
      { line: 4, locals: { u: 1, disc: [0, 1, -1], low: [0, 0, -1] } },
    ],
    result: 1,
    code: 'a\nb\nc\nd',
    graph: { nodes: [{ id: '0' }, { id: '1' }, { id: '2' }], edges: [{ from: '0', to: '1' }, { from: '1', to: '2' }], directed: true },
    lens: { current: 'u' },
  });
  const spec = structureSpecFrom(trace);
  for (const step of trace.steps) {
    for (const ref of stepEntityRefs(step)) {
      assert.ok(spec.entities.has(ref), `step references ${ref} which is not in the structure`);
    }
  }
});
