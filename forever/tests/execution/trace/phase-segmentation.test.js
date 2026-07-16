import assert from 'node:assert/strict';
import test from 'node:test';

import { compileGraphWalk } from '../../../lib/execution/trace/graph-walk/compiler.js';

// External review, verified live: the adjacency-BUILD loop (`for u, v in edges`) was narrated
// as the traversal — "Now 3 is taken out of the frontier" before the frontier existed — and
// the loop's leftover u was claimed as the first take after the build. Build events must feed
// trackers silently; the first REAL take is the algorithm's own.
const GRAPH = { nodes: [{ id: '1' }, { id: '2' }, { id: '3' }], edges: [{ from: '2', to: '1' }, { from: '2', to: '3' }], directed: true };
const EVENTS = [
  // BUILD phase: adj gains members while u/v iterate the edge list (u=2 then 2 again, v moves)
  { line: 2, locals: { adj: { 1: [], 2: [], 3: [] }, u: 2, v: 1 } },
  { line: 2, locals: { adj: { 1: [], 2: ['1'], 3: [] }, u: 2, v: 3 } },
  { line: 3, locals: { adj: { 1: [], 2: ['1', '3'], 3: [] }, u: 2, v: 3 } },
  // INITIALIZE: dist appears (stale u=2 still in locals)
  { line: 4, locals: { adj: { 1: [], 2: ['1', '3'], 3: [] }, u: 2, v: 3, dist: { 2: 0 } } },
  // WALK: the real first take (u=2 from the frontier) then a relaxation
  { line: 6, locals: { adj: { 1: [], 2: ['1', '3'], 3: [] }, u: 2, dist: { 2: 0 }, visited: ['2'] } },
  { line: 7, locals: { adj: { 1: [], 2: ['1', '3'], 3: [] }, u: 2, dist: { 2: 0, 1: 1, 3: 1 }, visited: ['2'] } },
];

test('build-loop events claim no teaching moments; the stale loop variable is not a take', () => {
  const trace = compileGraphWalk({
    events: EVENTS, result: 1, code: 'a\nb\nc\nd\ne\nf\ng',
    graph: GRAPH, lens: { current: 'u', dist: 'dist', visited: 'visited' },
  });
  // No step narrates a take during the build; the dist init reads as the table STARTING,
  // never as a relaxation "through" the stale build-loop u.
  const takeSteps = trace.steps.filter((s) => / is taken /.test(s.explanation));
  assert.ok(!trace.steps.some((s) => /Through 2 we reach 2/.test(s.explanation)), 'no self-relaxation nonsense');
  const init = trace.steps.find((s) => /table starts with 2 = 0/.test(s.explanation));
  assert.ok(init, 'dist init narrated as the table starting (not attributed to a stale current)');
  assert.equal(init.graph.current, null, 'no red ring on a node the algorithm never took');
  // The relaxations to 1 and 3 come from the REAL walk step and light only DECLARED edges.
  const relax = trace.steps.find((s) => Array.isArray(s.activeEdge));
  assert.ok(relax, 'a real relaxation lights an edge (finalization claims the seeded current)');
  // And every lit edge is a declared one (membership law).
  const declared = new Set(['2>1', '1>2', '2>3', '3>2']);
  for (const s of trace.steps) {
    if (Array.isArray(s.activeEdge)) assert.ok(declared.has(`${s.activeEdge[0]}>${s.activeEdge[1]}`), 'activeEdge is a declared edge');
  }
  assert.ok(takeSteps.length <= 1, 'at most the single real take is narrated');
});

test('validator rejects an activeEdge between nodes that share no declared edge', async () => {
  const { validateExecutionTrace } = await import('../../../lib/board/execution/execution-trace.js');
  assert.throws(() => validateExecutionTrace({
    language: 'python', code: 'a\nb',
    views: { graph: { nodes: [{ id: '1' }, { id: '2' }, { id: '3' }], edges: [{ from: '1', to: '2' }] } },
    steps: [{ line: 1, explanation: 'x'.repeat(70), graph: { current: null, visited: [] }, activeEdge: ['3', '1'] }],
  }, 't'), /not a declared edge/);
});
