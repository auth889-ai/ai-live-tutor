import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectGraphAdjacency, compileGraphAdjacency } from '../../../lib/execution/trace/universal/lenses/graph-adjacency.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const COURSE_SCHEDULE = [
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

test('Course Schedule: adjacency, current, queue AND indegree all found from behavior', () => {
  const rec = record({ code: COURSE_SCHEDULE, entry: 'can_finish(3, [[1, 0], [2, 1]])' });
  const plan = detectGraphAdjacency(rec, { code: COURSE_SCHEDULE });
  assert.ok(plan, 'the walked graph is recognized');
  assert.equal(plan.adjName, 'adj');
  assert.equal(plan.graph.nodes.length, 3);
  assert.deepEqual(plan.graph.edges, [{ from: '0', to: '1' }, { from: '1', to: '2' }]);
  assert.equal(plan.graph.directed, true, 'prerequisites point one way');
  assert.equal(plan.roles.current, 'u', 'u subscripts adj and only holds node ids');
  assert.equal(plan.roles.queue, 'q', 'the frontier breathes and popleft says FIFO');
  assert.equal(plan.roles.indegree, 'indeg', 'the countdown list is recognized by its drops');

  const trace = compileGraphAdjacency({ recording: rec, plan, code: COURSE_SCHEDULE, entry: 'can_finish(3, [[1, 0], [2, 1]])' });
  assert.equal(trace.views.graph.nodes.length, 3, 'the graph is DRAWN, not just the queue');
  const take = trace.steps.find((s) => s.graph?.current === '0');
  assert.ok(take, 'taking node 0 is a visible moment');
  const drop = trace.steps.find((s) => /indegree|drops|free to/i.test(s.explanation));
  assert.ok(drop, 'indegree countdowns are narrated');
  assert.ok(trace.steps.some((s) => Array.isArray(s.queue)), 'the frontier panel rides along');
  assert.match(trace.steps.at(-1).explanation, /true/i, 'the real answer reaches the close');
});

test('BFS visit order: visited accumulates on the drawn graph in REAL order', () => {
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
    "g = {'A': ['B', 'C'], 'B': ['A'], 'C': ['A']}",
  ].join('\n');
  const rec = record({ code: bfs, entry: "bfs(g, 'A')" });
  const plan = detectGraphAdjacency(rec, { code: bfs });
  assert.ok(plan, 'a lettered graph works the same as a numbered one');
  assert.equal(plan.graph.directed, false, 'symmetric adjacency renders undirected');
  assert.equal(plan.roles.visited, 'visited');

  const trace = compileGraphAdjacency({ recording: rec, plan, code: bfs, entry: "bfs(g, 'A')" });
  const finalVisited = trace.steps.at(-1).graph.visited;
  assert.deepEqual(finalVisited, ['A', 'B', 'C'], 'finalize order is the recorded event order');
});

test('weighted adjacency {u: [(v, w)]}: idiomatic LC Dijkstra draws its graph, weights on edges', () => {
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
  assert.ok(plan, 'the weighted idiom is recognized');
  assert.equal(plan.graph.nodes.length, 3);
  const bc = plan.graph.edges.find((e) => e.from === 'B' && e.to === 'C');
  assert.equal(bc?.weight, 3, 'weights ride the edges');
  assert.equal(plan.roles.dist, 'dist', 'the relaxation table is found');
  assert.equal(plan.roles.pq, 'pq', 'heappush in the code marks the frontier as a priority queue');

  const trace = compileGraphAdjacency({ recording: rec, plan, code: dijkstra, entry: "dijkstra(g, 'A')" });
  const relax = trace.steps.find((s) => /improv|relax|drops from|999/i.test(s.explanation));
  assert.ok(relax, 'relaxations are narrated from the real dist table');
  assert.ok(trace.steps.some((s) => s.traceRow), 'the dist table rides as trace rows — the table Striver draws');
});

test('adjacency as list-of-lists: ragged, append-only, in-range -> a graph, NOT a grid', () => {
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
    'g = [[1, 2], [0], [0]]',
  ].join('\n');
  const rec = record({ code: bfs, entry: 'bfs(g, 0)' });
  const plan = detectGraphAdjacency(rec, { code: bfs });
  assert.ok(plan, 'the list idiom is recognized');
  assert.deepEqual(plan.graph.nodes.map((n) => n.id), ['0', '1', '2']);
  assert.equal(plan.graph.directed, false, 'symmetric list adjacency renders undirected');
  const plans = detectLenses(rec, { code: bfs });
  assert.equal(plans[0]?.lens, 'graph-adjacency');
});

test('the grid boundary holds: rectangles and in-place rewrites stay OUT of the graph family', () => {
  const readOnly = record({
    code: 'def count(m):\n    total = 0\n    for r in range(len(m)):\n        for c in range(len(m[0])):\n            total += m[r][c]\n    return total',
    entry: 'count([[0, 1], [1, 0]])',
  });
  assert.equal(detectGraphAdjacency(readOnly, { code: '' }), null, 'a rectangle of ints >= 2 wide is grid territory even when its values are in range');

  const intervalish = record({
    code: 'def spans(pairs):\n    total = 0\n    for a, b in pairs:\n        total += b - a\n    return total',
    entry: 'spans([[1, 3], [2, 6]])',
  });
  assert.equal(detectGraphAdjacency(intervalish, { code: '' }), null, 'a list of value pairs (intervals) is not an adjacency');
});

test('boundaries hold: non-graph dicts refuse, and the graph outranks its own queue and counters', () => {
  const twoSum = record({
    code: 'def two_sum(arr, t):\n    seen = {}\n    for i in range(len(arr)):\n        if t - arr[i] in seen:\n            return [seen[t - arr[i]], i]\n        seen[arr[i]] = i\n    return []',
    entry: 'two_sum([2, 7, 11], 9)',
  });
  assert.equal(detectGraphAdjacency(twoSum, { code: '' }), null, 'a value dict is not an adjacency');

  const rec = record({ code: COURSE_SCHEDULE, entry: 'can_finish(3, [[1, 0], [2, 1]])' });
  const plans = detectLenses(rec, { code: COURSE_SCHEDULE });
  assert.equal(plans[0]?.lens, 'graph-adjacency', 'Course Schedule now shows the GRAPH first');
  assert.ok(plans.some((p) => p.lens === 'collection-ops'), 'the queue remains a runner-up lens');
});
