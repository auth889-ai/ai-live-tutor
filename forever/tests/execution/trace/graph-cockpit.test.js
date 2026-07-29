// BFS TEACHING COCKPIT + HARD INVARIANTS (correctness lock, 2026-07-28): the graph-walk
// compiler's {queue, dequeued, enqueued, level} step fields are derived ONLY from recorded
// queue operations (collops), and three laws are ENFORCED, not hoped for:
//   1. dequeue order === recorded execution order
//   2. a node is marked visited only at its recorded discovery
//   3. every inspected edge exists in the recorded adjacency
// A recording that violates any of them is corrupted evidence — the compiler throws instead
// of narrating from it.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { compileGraphWalk } from '../../../lib/execution/trace/graph-walk/compiler.js';
import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectGraphAdjacency, compileGraphAdjacency } from '../../../lib/execution/trace/universal/lenses/graph-adjacency.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const GRAPH = {
  nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
  edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }],
  directed: true,
};
const CODE = 'a\nb\nc\nd\ne';

test('BFS cockpit end-to-end: dequeued/enqueued/level/queue ride the take steps, all from recorded queue ops', () => {
  const bfs = [
    'from collections import deque',
    'def bfs(adj, start):',
    '    visited = [start]',
    '    q = deque([start])',
    '    order = []',
    '    while q:',
    '        u = q.popleft()',
    '        order.append(u)',
    '        for v in adj[u]:',
    '            if v not in visited:',
    '                visited.append(v)',
    '                q.append(v)',
    '    return order',
    "g = {'A': ['B', 'C'], 'B': ['A', 'D'], 'C': ['A'], 'D': ['B']}",
  ].join('\n');
  const rec = record({ code: bfs, entry: "bfs(g, 'A')" });
  const plan = detectGraphAdjacency(rec, { code: bfs });
  assert.ok(plan, 'the walked graph is recognized');
  const trace = compileGraphAdjacency({ recording: rec, plan, code: bfs, entry: "bfs(g, 'A')" });

  const takes = trace.steps.filter((s) => s.cockpit?.dequeued !== undefined);
  assert.deepEqual(takes.map((s) => s.cockpit.dequeued), ['A', 'B', 'C', 'D'], 'the cockpit follows the recorded dequeue order exactly');
  assert.deepEqual(takes[0].cockpit.enqueued, ['B', 'C'], "A's processing enqueues its two undiscovered neighbours — recorded appends, not re-simulation");
  assert.deepEqual(takes.map((s) => s.cockpit.level), [0, 1, 1, 2], 'BFS levels derive from seed + recorded enqueue attribution');
  assert.ok(takes.every((s) => Array.isArray(s.cockpit.queue)), 'current queue contents ride each take step');
  assert.deepEqual(takes[1].cockpit.queue, ['C'], 'after B is dequeued, C is what remains waiting');
  assert.match(takes[0].explanation, /take A from the front of the queue; its neighbours B, C join/, 'the narration gains the queue beat');
});

test('no queue-op evidence -> no cockpit: a heap-driven walk (Dijkstra) claims nothing', () => {
  const dijkstra = [
    'import heapq',
    'def dijkstra(adj, start):',
    '    dist = {u: 999 for u in adj}',
    '    dist[start] = 0',
    '    pq = [(0, start)]',
    '    while pq:',
    '        d, u = heapq.heappop(pq)',
    '        if d > dist[u]:',
    '            continue',
    '        for v, w in adj[u]:',
    '            if d + w < dist[v]:',
    '                dist[v] = d + w',
    '                heapq.heappush(pq, (dist[v], v))',
    '    return dist',
    "g = {'A': [('B', 4), ('C', 8)], 'B': [('C', 3)], 'C': []}",
  ].join('\n');
  const rec = record({ code: dijkstra, entry: "dijkstra(g, 'A')" });
  const plan = detectGraphAdjacency(rec, { code: dijkstra });
  const trace = compileGraphAdjacency({ recording: rec, plan, code: dijkstra, entry: "dijkstra(g, 'A')" });
  assert.ok(trace.steps.every((s) => s.cockpit === undefined), 'a priority queue is not a FIFO story — no BFS cockpit is claimed');
});

test('HARD INVARIANT 1: dequeue order must equal recorded execution order — a mismatch throws', () => {
  const events = [
    { line: 1, locals: { q: ['A'], visited: ['A'] } },
    { line: 2, locals: { u: 'A', q: [], visited: ['A'] } },
    { line: 3, locals: { u: 'A', q: ['B', 'C'], visited: ['A', 'B', 'C'] } },
    { line: 4, locals: { u: 'C', q: ['B'], visited: ['A', 'B', 'C'] } }, // execution says C…
  ];
  const collops = [
    { at: 0, q: 1, n: 'q', op: 'popleft', ret: 'A' },
    { at: 1, q: 2, n: 'q', op: 'append', arg: 'B' },
    { at: 1, q: 3, n: 'q', op: 'append', arg: 'C' },
    { at: 2, q: 4, n: 'q', op: 'popleft', ret: 'B' }, // …but the queue released B
  ];
  assert.throws(
    () => compileGraphWalk({ events, result: true, code: CODE, graph: GRAPH, lens: { current: 'u', queue: 'q', visited: 'visited' }, collops }),
    /dequeue order releases B at position 2, but execution processed C/,
  );
});

test('HARD INVARIANT 2: a node in the visited set with no recorded discovery op throws', () => {
  const events = [
    { line: 1, locals: { q: ['A'], visited: ['A'] } },
    { line: 2, locals: { u: 'A', q: [], visited: ['A'] } },
    { line: 3, locals: { u: 'A', q: ['B'], visited: ['A', 'B', 'C'] } }, // C was never discovered
  ];
  const collops = [
    { at: 0, q: 1, n: 'q', op: 'popleft', ret: 'A' },
    { at: 1, q: 2, n: 'q', op: 'append', arg: 'B' },
    { at: 1, q: 3, n: 'visited', op: 'append', arg: 'B' }, // B's discovery IS recorded; C has none
  ];
  assert.throws(
    () => compileGraphWalk({ events, result: true, code: CODE, graph: GRAPH, lens: { current: 'u', queue: 'q', visited: 'visited' }, collops }),
    /C appears in the visited set with no recorded discovery/,
  );
});

test('HARD INVARIANT 3: an enqueue across a non-existent edge throws (in any orientation)', () => {
  const events = [
    { line: 1, locals: { q: ['A'], visited: ['A'] } },
    { line: 2, locals: { u: 'A', q: [], visited: ['A'] } },
    { line: 3, locals: { u: 'A', q: ['C'], visited: ['A', 'C'] } },
  ];
  const collops = [
    { at: 0, q: 1, n: 'q', op: 'popleft', ret: 'A' },
    { at: 1, q: 2, n: 'q', op: 'append', arg: 'C' }, // no A-C edge in this graph
  ];
  const graph = { nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], edges: [{ from: 'A', to: 'B' }], directed: true };
  assert.throws(
    () => compileGraphWalk({ events, result: true, code: CODE, graph, lens: { current: 'u', queue: 'q', visited: 'visited' }, collops }),
    /C was enqueued while processing A, but no edge between A and C exists/,
  );
});

const KAHN = [
  'from collections import deque',
  'def can_finish(n, pres):',
  '    adj = {i: [] for i in range(n)}',
  '    indeg = [0] * n',
  '    for a, b in pres:',
  '        adj[b].append(a)',
  '        indeg[a] += 1',
  '    q = deque(i for i in range(n) if indeg[i] == 0)',
  '    done = 0',
  '    while q:',
  '        u = q.popleft()',
  '        done += 1',
  '        for v in adj[u]:',
  '            indeg[v] -= 1',
  '            if indeg[v] == 0:',
  '                q.append(v)',
  '    return done == n',
].join('\n');

test('KAHN COCKPIT on a DAG (real run): indegree/topoOrder/dropped ride the steps; full strip, no cycle claim', () => {
  const entry = 'can_finish(3, [[1, 0], [2, 1]])';
  const rec = record({ code: KAHN, entry });
  const plan = detectGraphAdjacency(rec, { code: KAHN });
  assert.ok(plan?.roles?.indegree, 'the indegree countdown is recognized');
  const trace = compileGraphAdjacency({ recording: rec, plan, code: KAHN, entry });

  const withIndeg = trace.steps.filter((s) => s.cockpit?.indegree);
  assert.ok(withIndeg.length > 0, 'the live indegree table rides the cockpit');
  const drop = trace.steps.find((s) => Array.isArray(s.cockpit?.dropped));
  assert.ok(drop, 'recorded countdowns surface as dropped entries');
  assert.equal(drop.cockpit.dropped[0].node, '1', 'the first satisfied edge points at node 1');
  assert.equal(drop.cockpit.dropped[0].from, '0', "attributed to node 0's processing — the claimed current, never a guess");
  assert.deepEqual(trace.steps.at(-1).cockpit.topoOrder, ['0', '1', '2'], 'the full topological strip reaches the close');
  assert.equal(trace.steps.at(-1).cockpit.cycleDetected, undefined, 'a DAG earns no cycle flag');
  assert.ok(trace.steps.every((s) => s.phase !== 'cycle'), 'no cycle phase step on a DAG');
});

test('KAHN CYCLE GATE (real run): a cyclic graph flags cycleDetected, emits the cycle phase step, shows the partial order', () => {
  // 0 -> 1, 0 -> 2 schedule fine; 3 <-> 4 wait on each other forever.
  const entry = 'can_finish(5, [[1, 0], [2, 0], [3, 4], [4, 3]])';
  const rec = record({ code: KAHN, entry });
  const plan = detectGraphAdjacency(rec, { code: KAHN });
  assert.ok(plan?.roles?.indegree, 'the indegree countdown is recognized on the cyclic run too');
  const trace = compileGraphAdjacency({ recording: rec, plan, code: KAHN, entry });

  const cyc = trace.steps.find((s) => s.phase === 'cycle');
  assert.ok(cyc, 'a distinct cycle-phase step is emitted');
  assert.equal(cyc.cockpit.cycleDetected, true);
  assert.deepEqual(cyc.cockpit.topoOrder, ['0', '1', '2'], 'the partial order is shown, not hidden');
  assert.match(cyc.explanation, /CYCLE DETECTED.*only 3 of 5 nodes.*3, 4/s, 'the leftover nodes are named');
  assert.ok(cyc.events.some((e) => e.semanticRole === 'cycle_detected'), 'the typed cycle event rides the step');
  assert.equal(trace.steps.at(-1).cockpit.cycleDetected, true, 'the final step carries the flag');
  assert.match(trace.steps.at(-1).explanation, /false/i, 'the real answer still reaches the close');
});

test('KAHN PURE CYCLE (real run): zero takes — no node ever reaches indegree 0, and the gate still fires', () => {
  // 0 -> 1 -> 2 -> 0: the queue is born empty, the while loop never runs. The old gate
  // required at least one take, making the WORST cycle the one invisible case (external
  // audit 2026-07-28, verified live: the close claimed "The walk is complete").
  const entry = 'can_finish(3, [[1, 0], [2, 1], [0, 2]])';
  const rec = record({ code: KAHN, entry });
  const plan = detectGraphAdjacency(rec, { code: KAHN });
  assert.ok(plan?.roles?.indegree, 'the indegree table is recognized WITHOUT countdowns — its peak matches the recorded adjacency');
  assert.equal(plan.roles.queue, 'q', 'the always-empty queue is recognized as the frontier');
  const trace = compileGraphAdjacency({ recording: rec, plan, code: KAHN, entry });

  const cyc = trace.steps.find((s) => s.phase === 'cycle');
  assert.ok(cyc, 'the cycle-phase step is emitted with zero takes');
  assert.equal(cyc.cockpit.cycleDetected, true);
  assert.deepEqual(cyc.cockpit.topoOrder, [], 'no node was ever scheduled — the strip is honestly empty');
  assert.match(cyc.explanation, /not one of the 3 nodes starts at indegree 0/, 'the zero-take story is told as such');
  assert.match(cyc.explanation, /0, 1, 2/, 'every waiting node is named');
  assert.equal(trace.steps.at(-1).cockpit.cycleDetected, true, 'the final step carries the flag');
  assert.doesNotMatch(trace.steps.at(-1).explanation, /walk is complete/i, 'the close no longer reads like a completed walk');
});

test('KAHN SELF-LOOP (real run): one take, one countdown — the gate fires and the real walker wins the role', () => {
  // 0 -> 1 plus 1 -> 1: node 1 waits on itself forever. Locks two live-caught bugs at once:
  // the single countdown was below the old >=2-drop indegree law, and the build loop's `b`
  // outranked the walker `u` on set-overlap (u only ever held one node).
  const entry = 'can_finish(2, [[1, 0], [1, 1]])';
  const rec = record({ code: KAHN, entry });
  const plan = detectGraphAdjacency(rec, { code: KAHN });
  assert.equal(plan?.roles?.current, 'u', 'release alignment names the true walker, not the build variable');
  assert.ok(plan?.roles?.indegree, 'one countdown + adjacency-peak evidence is enough');
  const trace = compileGraphAdjacency({ recording: rec, plan, code: KAHN, entry });

  const cyc = trace.steps.find((s) => s.phase === 'cycle');
  assert.ok(cyc, 'the cycle-phase step is emitted');
  assert.deepEqual(cyc.cockpit.topoOrder, ['0'], 'the schedulable prefix is shown');
  assert.match(cyc.explanation, /only 1 of 2 nodes/, 'the counts are honest');
  assert.equal(trace.steps.at(-1).cockpit.cycleDetected, true);
});

test('KAHN DISCONNECTED CYCLIC COMPONENT (real run): the acyclic part schedules, the cyclic island is caught', () => {
  // 0 -> 1 schedules fine; 2 <-> 3 is an untouched island that never reaches the queue.
  const entry = 'can_finish(4, [[1, 0], [2, 3], [3, 2]])';
  const rec = record({ code: KAHN, entry });
  const plan = detectGraphAdjacency(rec, { code: KAHN });
  assert.ok(plan?.roles?.indegree, 'the indegree table is recognized from a single recorded countdown');
  const trace = compileGraphAdjacency({ recording: rec, plan, code: KAHN, entry });

  const cyc = trace.steps.find((s) => s.phase === 'cycle');
  assert.ok(cyc, 'the cycle-phase step is emitted');
  assert.deepEqual(cyc.cockpit.topoOrder, ['0', '1'], 'the acyclic component is fully scheduled first');
  assert.match(cyc.explanation, /2, 3/, 'the cyclic island is named');
  assert.equal(trace.steps.at(-1).cockpit.cycleDetected, true);
});

test('KAHN EARLY BREAK (real run): a drained queue after an interrupted run is NOT claimed as a cycle', () => {
  // Chain 0 -> 1 -> 2, but the loop breaks after the first take, before relaxing 0's
  // out-edge. One of three nodes scheduled, queue empty — yet claiming CYCLE would be a lie.
  // Kahn's proof needs the countdown work DONE: recorded drops must equal the scheduled
  // nodes' total out-degree, and here they do not (0 recorded vs 1 owed).
  const KAHN_BREAK = KAHN.replace("        done += 1\n", "        done += 1\n        if done == 1:\n            break\n");
  assert.notEqual(KAHN_BREAK, KAHN, 'the break was actually inserted');
  const entry = 'can_finish(3, [[1, 0], [2, 1]])';
  const rec = record({ code: KAHN_BREAK, entry });
  const plan = detectGraphAdjacency(rec, { code: KAHN_BREAK });
  const trace = compileGraphAdjacency({ recording: rec, plan, code: KAHN_BREAK, entry });
  assert.ok(trace.steps.every((s) => s.phase !== 'cycle'), 'no cycle step on an interrupted run');
  assert.equal(trace.steps.at(-1).cockpit?.cycleDetected, undefined, 'no cycle flag on the close either');
});

test('clean synthetic run passes all three invariants and carries the cockpit', () => {
  const events = [
    { line: 1, locals: { q: ['A'], visited: ['A'] } },
    { line: 2, locals: { u: 'A', q: [], visited: ['A'] } },
    { line: 3, locals: { u: 'A', q: ['B', 'C'], visited: ['A', 'B', 'C'] } },
    { line: 4, locals: { u: 'B', q: ['C'], visited: ['A', 'B', 'C'] } },
    { line: 5, locals: { u: 'C', q: [], visited: ['A', 'B', 'C'] } },
  ];
  const collops = [
    { at: 0, q: 1, n: 'q', op: 'popleft', ret: 'A' },
    { at: 1, q: 2, n: 'q', op: 'append', arg: 'B' },
    { at: 1, q: 3, n: 'visited', op: 'append', arg: 'B' },
    { at: 1, q: 4, n: 'q', op: 'append', arg: 'C' },
    { at: 1, q: 5, n: 'visited', op: 'append', arg: 'C' },
    { at: 2, q: 6, n: 'q', op: 'popleft', ret: 'B' },
    { at: 3, q: 7, n: 'q', op: 'popleft', ret: 'C' },
  ];
  const trace = compileGraphWalk({ events, result: ['A', 'B', 'C'], code: CODE, graph: GRAPH, lens: { current: 'u', queue: 'q', visited: 'visited' }, collops });
  const takes = trace.steps.filter((s) => s.cockpit?.dequeued !== undefined);
  assert.deepEqual(takes.map((s) => s.cockpit.dequeued), ['A', 'B', 'C']);
  assert.deepEqual(takes.map((s) => s.cockpit.level), [0, 1, 1]);
});
