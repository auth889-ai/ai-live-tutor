import assert from 'node:assert/strict';
import test from 'node:test';

import { detectNodeStateVars, createNodeStateTracker, readNodeKeyed } from '../../../lib/execution/trace/graph-walk/node-state.js';
import { compileGraphWalk } from '../../../lib/execution/trace/graph-walk/compiler.js';
import { validateExecutionTrace } from '../../../lib/board/execution/execution-trace.js';
import { resolveTraceStep } from '../../../lib/board/diagrams/graph-view-model.js';

const IDS = new Set(['0', '1', '2']);

test('readNodeKeyed: node-keyed dicts and full-width arrays parse, everything else is null', () => {
  assert.deepEqual(readNodeKeyed({ 0: 5, 2: 7 }, IDS), { 0: 5, 2: 7 });
  assert.deepEqual(readNodeKeyed([4, -1, null], IDS), { 0: 4, 1: -1, 2: null });
  assert.equal(readNodeKeyed({ 0: 5, X: 7 }, IDS), null, 'a non-node key disqualifies');
  assert.equal(readNodeKeyed([4, 2], IDS), null, 'partial-width arrays are not node-indexed');
  assert.equal(readNodeKeyed({ 0: [1, 2] }, IDS), null, 'non-scalar values disqualify');
  assert.equal(readNodeKeyed('x', IDS), null);
});

// Tarjan-shaped run: disc/low as [-1]*n arrays, written as the DFS reaches each node,
// low rewritten on backtrack. The detector must find BOTH, exclude the lens var, and the
// sentinel rule must hide unreached nodes.
const TARJAN_EVENTS = [
  { line: 2, locals: { u: 0, disc: [0, -1, -1], low: [0, -1, -1] } },
  { line: 3, locals: { u: 1, disc: [0, 1, -1], low: [0, 1, -1] } },
  { line: 3, locals: { u: 2, disc: [0, 1, 2], low: [0, 1, 2] } },
  { line: 4, locals: { u: 2, disc: [0, 1, 2], low: [0, 1, 0] } },
  { line: 4, locals: { u: 1, disc: [0, 1, 2], low: [0, 0, 0] } },
];

test('detectNodeStateVars: finds disc/low with the -1 sentinel, excludes lens vars and static config', () => {
  const events = TARJAN_EVENTS.map((e) => ({ ...e, locals: { ...e.locals, names: { 0: 'a', 1: 'b', 2: 'c' } } }));
  const found = detectNodeStateVars(events, { ids: IDS, exclude: new Set(['u']) });
  const names = found.map((f) => f.name);
  assert.ok(names.includes('disc') && names.includes('low'), `disc+low detected, got ${names}`);
  assert.equal(found.find((f) => f.name === 'disc').sentinel, '-1', 'the init marker is inferred even when the first snapshot already has one written node');
  assert.ok(!names.includes('u'), 'excluded lens var never claimed');
  assert.ok(!names.includes('names'), 'a dict that never changes is config, not state');
});

test('tracker: the sentinel hides unreached nodes — values appear only once written', () => {
  const tracker = createNodeStateTracker([{ name: 'disc', sentinel: '-1' }], IDS);
  tracker.update({ disc: [-1, -1, -1] });
  assert.deepEqual(tracker.snapshot(), {}, 'nothing written yet — the drawing stays clean');
  const writes = tracker.update({ disc: [0, -1, -1] });
  assert.deepEqual(writes, [{ varName: 'disc', node: '0', oldValue: undefined, newValue: 0 }]);
  assert.deepEqual(tracker.snapshot(), { 0: { disc: 0 } }, 'unreached nodes stay unlabeled');
});

test('compileGraphWalk carries nodeState per step and narrates the low-rewrite beat', () => {
  const trace = compileGraphWalk({
    events: TARJAN_EVENTS,
    result: [[1, 2]],
    code: 'def f(adj):\n    a\n    b\n    c\n    return 1',
    graph: {
      nodes: [{ id: '0' }, { id: '1' }, { id: '2' }],
      edges: [{ from: '0', to: '1' }, { from: '1', to: '2' }, { from: '2', to: '0' }],
      directed: false,
    },
    lens: { current: 'u' },
  });
  const withState = trace.steps.filter((s) => s.nodeState);
  assert.ok(withState.length >= 3, 'steps carry the nodeState channel');
  const last = withState.at(-1).nodeState;
  assert.deepEqual(last['1'], { disc: 1, low: 0 }, 'final labels hold the REAL recorded values');
  assert.ok(
    trace.steps.some((s) => /low\[2\] rewrites 2 → 0/.test(s.explanation)),
    'the backtrack low-update is narrated old → new like a relaxation',
  );
  assert.ok(
    trace.steps.some((s) => /disc\[0\] gets its first value: 0/.test(s.explanation)),
    'first writes are narrated as first values',
  );
});

test('validator: nodeState pointing at a missing node throws (never a lying label)', () => {
  assert.throws(() => validateExecutionTrace({
    language: 'python',
    code: 'a\nb',
    views: { graph: { nodes: [{ id: 'A' }], edges: [] } },
    steps: [{ line: 1, explanation: 'x'.repeat(70), graph: { current: null, visited: [] }, nodeState: { GHOST: { disc: 1 } } }],
  }, 't'), /missing node "GHOST"/);
});

test('resolveTraceStep exposes nodeState and the previous step map for change-flash', () => {
  const state = resolveTraceStep({
    content: {
      nodes: [{ id: '0' }],
      edges: [],
      trace: [
        { note: 'a', current: '0', nodeState: { 0: { low: 2 } } },
        { note: 'b', current: '0', nodeState: { 0: { low: 0 } } },
      ],
    },
    activeStep: 1,
  });
  assert.deepEqual(state.nodeState, { 0: { low: 0 } });
  assert.deepEqual(state.prevNodeState, { 0: { low: 2 } });
});
