import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

import { assembleUniversalProgram, parseUniversalEvents } from '../../../lib/execution/trace/universal/recorder.js';

// PHASE 3 (review roadmap): queue/heap/set operations are DIRECT events — BFS and Dijkstra
// semantics come from what executed, never from snapshot reconstruction.

const run = (code, entry) => {
  const source = assembleUniversalProgram({ code, entry });
  const stdout = execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15000 });
  return parseUniversalEvents(stdout);
};

test('BFS records popleft/append/add as operations with values', () => {
  const code = ['from collections import deque', 'def bfs(adj, start):', '    order = []', '    seen = {start}', '    q = deque([start])', '    while q:', '        u = q.popleft()', '        order.append(u)', '        for v in adj[u]:', '            if v not in seen:', '                seen.add(v)', '                q.append(v)', '    return order'].join('\n');
  const rec = run(code, 'bfs({0: [1, 2], 1: [3], 2: [3], 3: []}, 0)');
  const ops = rec.collops ?? [];
  const pops = ops.filter((o) => o.n === 'q' && o.op === 'popleft');
  const pushes = ops.filter((o) => o.n === 'q' && o.op === 'append');
  const adds = ops.filter((o) => o.n === 'seen' && o.op === 'add');
  assert.equal(pops.length, 4, 'every dequeue is an event');
  assert.equal(pops[0].ret, 0, 'the popped VALUE is recorded');
  assert.equal(pushes.length, 3, 'every enqueue is an event');
  assert.equal(adds.length, 3, 'every visited-add is an event');
});

test('Dijkstra records heappush/heappop with the real items', () => {
  const code = ['import heapq', 'def dij(adj, start):', '    dist = {n: float("inf") for n in adj}', '    dist[start] = 0', '    pq = [(0, start)]', '    while pq:', '        d, u = heapq.heappop(pq)', '        if d > dist[u]:', '            continue', '        for v, w in adj[u]:', '            nd = d + w', '            if nd < dist[v]:', '                dist[v] = nd', '                heapq.heappush(pq, (nd, v))', '    return dist'].join('\n');
  const rec = run(code, 'dij({0: [(1, 4), (2, 1)], 1: [(3, 1)], 2: [(1, 2), (3, 5)], 3: []}, 0)');
  const ops = (rec.collops ?? []).filter((o) => o.n === 'pq');
  const pops = ops.filter((o) => o.op === 'heappop');
  const pushes = ops.filter((o) => o.op === 'heappush');
  assert.ok(pops.length >= 3, 'heap pops recorded');
  assert.deepEqual(pops[0].ret, [0, 0], 'the popped heap entry is the real item');
  assert.ok(pushes.length >= 3, 'heap pushes recorded');
  assert.ok(pushes.every((o) => Array.isArray(o.arg)), 'pushed items recorded');
});
