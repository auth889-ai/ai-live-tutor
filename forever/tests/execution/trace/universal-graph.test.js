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
