import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBinding, ungroundedNumbers } from '../../../lib/board/composition/binding.js';
import { compileGraphWalk } from '../../../lib/execution/trace/graph-walk/compiler.js';

// C2 CORE: the HANDWRITTEN Tarjan CompositionSpec (the user's reference spec, verbatim in
// meaning) resolved over a REAL engine trace. A test fixture, not a product output — it
// proves Layer 3 (resolver + contract) before any AI writes a spec. If this fails, the bug
// is never the Director.
const SPEC = {
  algorithmFamily: 'tarjan-bridges',
  primaryLens: 'graph',
  layoutIntent: 'force',
  panels: [
    {
      type: 'graph',
      title: 'Discovery and Low-Link Values',
      nodeBadges: [
        { label: 'disc', binding: { op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'disc' } },
        { label: 'low', binding: { op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'low' } },
      ],
    },
    { type: 'call-stack', title: 'DFS Call Stack', binding: { op: 'select', collection: 'frames', field: 'status' } },
    {
      type: 'state-table',
      title: 'Discovery / Low Values',
      columns: [
        { label: 'disc', binding: { op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'disc' } },
        { label: 'low', binding: { op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'low' } },
      ],
    },
    { type: 'concept-card', title: 'Bridge Rule', content: 'An edge u to v is a bridge when low[v] > disc[u].' },
  ],
};

const trace = compileGraphWalk({
  events: [
    { line: 2, locals: { u: 0, disc: [0, -1, -1, -1], low: [0, -1, -1, -1] }, frames: [{ frameId: 'f1', functionName: 'dfs', status: 'active', arguments: { u: 0 } }] },
    { line: 3, locals: { u: 1, disc: [0, 1, -1, -1], low: [0, 1, -1, -1] }, frames: [{ frameId: 'f1', functionName: 'dfs', status: 'waiting', arguments: { u: 0 } }, { frameId: 'f2', functionName: 'dfs', status: 'active', arguments: { u: 1 } }] },
    { line: 3, locals: { u: 2, disc: [0, 1, 2, -1], low: [0, 1, 2, -1] }, frames: [{ frameId: 'f1', functionName: 'dfs', status: 'waiting', arguments: { u: 0 } }, { frameId: 'f2', functionName: 'dfs', status: 'active', arguments: { u: 2 } }] },
    { line: 4, locals: { u: 1, disc: [0, 1, 2, -1], low: [0, 0, 2, -1] }, frames: [{ frameId: 'f1', functionName: 'dfs', status: 'waiting', arguments: { u: 0 } }, { frameId: 'f2', functionName: 'dfs', status: 'active', arguments: { u: 1 } }] },
  ],
  result: [[0, 1]],
  code: 'a\nb\nc\nd',
  graph: { nodes: [{ id: '0' }, { id: '1' }, { id: '2' }, { id: '3' }], edges: [{ from: '0', to: '1' }, { from: '1', to: '2' }, { from: '2', to: '3' }], directed: false },
  lens: { current: 'u' },
});

test('the handwritten spec resolves fully against a real trace — every badge, every column, per node', () => {
  const frame = trace.steps.filter((s) => s.nodeState && s.frames).at(-1); // richest step
  const writtenNodes = Object.keys(frame.nodeState);
  assert.ok(writtenNodes.length >= 2);
  for (const panel of SPEC.panels) {
    for (const badge of panel.nodeBadges ?? []) {
      for (const id of writtenNodes) {
        const r = resolveBinding(badge.binding, frame, { context: { node: { id } }, expect: 'scalar' });
        assert.equal(r.status, 'resolved', `${panel.type}/${badge.label} on node ${id}: ${r.reason ?? ''}`);
        assert.ok(typeof r.value === 'number', 'engine value, never AI text');
      }
    }
    for (const col of panel.columns ?? []) {
      const r = resolveBinding(col.binding, frame, { context: { node: { id: writtenNodes[0] } }, expect: 'scalar' });
      assert.equal(r.status, 'resolved', `column ${col.label}`);
    }
  }
});

test('unreached nodes resolve MISSING (never a fake 0), call-stack binds to real frames, literals are clean', () => {
  const frame = trace.steps.filter((s) => s.nodeState && s.frames).at(-1);
  const ghost = resolveBinding(SPEC.panels[0].nodeBadges[0].binding, frame, { context: { node: { id: '3' } } });
  assert.equal(ghost.status, 'missing', 'node 3 was never reached — the badge stays absent, not invented');
  const stack = resolveBinding(SPEC.panels[1].binding, frame, { expect: 'list' });
  assert.equal(stack.status, 'resolved');
  assert.deepEqual(stack.value, ['waiting', 'active']);
  for (const p of SPEC.panels) {
    if (typeof p.content === 'string') {
      assert.deepEqual(ungroundedNumbers(p.content, 'bridges via low/disc', { entityIds: ['0', '1', '2', '3'] }), [], 'concept card carries no ungrounded numbers');
    }
  }
});

test('bridge_test: the compare op computes the bridge verdict from recorded disc/low — never authored', () => {
  const frame = trace.steps.filter((s) => s.nodeState && s.frames).at(-1);
  // low[1] (child side) > disc[0] (parent side)? With low[1]=0, disc[0]=0 -> NOT a bridge here.
  const verdict = resolveBinding({
    op: 'compare', operator: '>',
    left: { op: 'lookup', collection: 'nodeState', key: '$child.id', field: 'low' },
    right: { op: 'lookup', collection: 'nodeState', key: '$parent.id', field: 'disc' },
  }, frame, { context: { child: { id: '1' }, parent: { id: '0' } } });
  assert.equal(verdict.status, 'resolved');
  assert.equal(verdict.value, false);
  // The annotation gate: a "when" condition binds to typed events — bridge_confirmed only
  // fires when such an event EXISTS on the frame; here none does, so the mark never draws.
  const anyBridgeEvent = (frame.events ?? []).some((e) => e.semanticRole === 'bridge_confirmed');
  assert.equal(anyBridgeEvent, false, 'no bridge event on this step — the teacher-circle stays off');
});

test('wrong-entity and runtime-literal rejections: the spec cannot reach outside the structure', () => {
  const frame = trace.steps.filter((s) => s.nodeState && s.frames).at(-1);
  // A binding keyed to an entity that is not a node of THIS graph resolves missing.
  const alien = resolveBinding({ op: 'lookup', collection: 'nodeState', key: '99', field: 'low' }, frame);
  assert.equal(alien.status, 'missing');
  // A Director sentence carrying a runtime value as a literal is named by the classifier.
  assert.deepEqual(
    ungroundedNumbers('here low becomes 77', 'six servers, seven connections', { entityIds: ['0', '1', '2', '3'] }),
    ['77'],
  );
});
