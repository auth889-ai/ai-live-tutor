import assert from 'node:assert/strict';
import test from 'node:test';

import { compileGraphWalk } from '../../../lib/execution/trace/graph-walk/compiler.js';

const GRAPH = {
  nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
  edges: [
    { from: 'A', to: 'B' }, { from: 'A', to: 'C' },
    { from: 'C', to: 'B' }, { from: 'B', to: 'D' },
  ],
  directed: true,
};

const CODE = 'import heapq\ndef dijkstra(g, start):\n    dist = {start: 0}\n    pq = [(0, start)]\n    visited = set()\n    while pq:\n        d, u = heapq.heappop(pq)\n        pass\n    return dist';

// Real settrace-shaped events of a Dijkstra run: A relaxes B(4)/C(1); C improves B to 3;
// B discovers D(6). The lens derives take / relax old->new / finalize from these diffs alone.
const EVENTS = [
  { line: 3, locals: { dist: { A: 0 }, pq: [[0, 'A']], visited: [] } },
  { line: 7, locals: { u: 'A', dist: { A: 0 }, pq: [], visited: [] } },
  { line: 8, locals: { u: 'A', dist: { A: 0, B: 4, C: 1 }, pq: [[4, 'B'], [1, 'C']], visited: ['A'] } },
  { line: 7, locals: { u: 'C', dist: { A: 0, B: 3, C: 1 }, pq: [[4, 'B'], [3, 'B']], visited: ['A', 'C'] } },
  { line: 7, locals: { u: 'B', dist: { A: 0, B: 3, C: 1, D: 6 }, pq: [[6, 'D']], visited: ['A', 'C', 'B'] } },
];

test('Dijkstra through the lens: take, relax old->new, finalize, distance table, sorted pq', () => {
  const trace = compileGraphWalk({
    events: EVENTS, result: { A: 0, B: 3, C: 1, D: 6 }, code: CODE,
    entry: "dijkstra(g, 'A')", graph: GRAPH,
    lens: { current: 'u', dist: 'dist', visited: 'visited', pq: 'pq' },
  });

  // Frame beat first: the run is announced before anything moves.
  assert.match(trace.steps[0].explanation, /We run dijkstra\(g, 'A'\).*recorded from the real run/s);

  // The take beat quotes the REAL tentative distance and explains why this node goes next.
  const takeC = trace.steps.find((s) => /C is taken/.test(s.explanation));
  assert.ok(takeC, 'extract-min narrated');
  assert.match(takeC.explanation, /tentative distance is 1.*smallest/s);
  assert.equal(takeC.graph.current, 'C');

  // The relaxation beat: old -> new with the why, and the edge lights up.
  const relax = trace.steps.find((s) => /better than the 4 we knew before/.test(s.explanation));
  assert.ok(relax, 'improvement relaxation narrated with old and new values');
  assert.deepEqual(relax.activeEdge, ['C', 'B'], 'the relaxed edge is the active edge');

  // First-discovery relaxations read differently from improvements.
  assert.ok(trace.steps.some((s) => /reach B for the first time.*becomes 4/s.test(s.explanation)));

  // Finalize: the invariant, taught.
  assert.ok(trace.steps.some((s) => /A is now FINALIZED.*never improve again/s.test(s.explanation)));

  // The distance table IS the trace table: one column per node, first-seen order.
  const rowed = trace.steps.filter((s) => s.traceRow);
  assert.ok(rowed.length >= 4);
  const lastRow = rowed.at(-1).traceRow;
  assert.equal(lastRow.B, 3, 'the table carries the REAL final distances');
  assert.equal(lastRow.D, 6);

  // heapq is a raw list — the frontier renders SORTED so index 0 is honestly "next".
  const withPq = trace.steps.find((s) => Array.isArray(s.queue) && s.queue.length === 2 && s.queue[0].startsWith('3'));
  assert.ok(withPq, 'pq shows min first even though the raw heap list was [[4,B],[3,B]]');

  // Terminal beat reads the processing order back out of the walk.
  assert.match(trace.steps.at(-1).explanation, /A → C → B.*earned by a relaxation/s);

  for (const s of trace.steps) assert.ok(s.explanation.length > 60, 'tutor voice, never stubs');
});

test('union-find through the lens: self-roots then merges, no current node required', () => {
  const trace = compileGraphWalk({
    events: [
      { line: 2, locals: { parent: { A: 'A', B: 'B' } } },
      { line: 3, locals: { parent: { A: 'A', B: 'A' } } },
    ],
    result: 1, code: 'a\nb\nc',
    graph: { nodes: [{ id: 'A' }, { id: 'B' }], edges: [], directed: false },
    lens: { parent: 'parent' },
  });
  assert.ok(trace.steps.some((s) => /A starts as its own root.*lone set/s.test(s.explanation)));
  assert.ok(trace.steps.some((s) => /Union: B's root becomes A.*merge/s.test(s.explanation)));
});

test('honest failures: no lens, no events, lens names that never match', () => {
  assert.throws(
    () => compileGraphWalk({ events: EVENTS, result: 1, code: CODE, graph: GRAPH, lens: {} }),
    /needs a lens/,
  );
  assert.throws(
    () => compileGraphWalk({ events: [], result: 1, code: CODE, graph: GRAPH, lens: { current: 'u' } }),
    /no events/,
  );
  // A lens var that never appears now fails EARLIER, at behavior validation, with a repair
  // message that prescribes auto — strictly better than the old vague "no state change".
  assert.throws(
    () => compileGraphWalk({
      events: [{ line: 2, locals: { x: 1 } }], result: 1, code: 'a\nb', graph: GRAPH, lens: { current: 'nope' },
    }),
    /declared lens roles match the recorded behavior.*"auto"/s,
  );
});
