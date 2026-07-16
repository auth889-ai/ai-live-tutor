import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { traceUniversal } from '../../lib/execution/trace/universal/trace.js';
import { channelInventory, channelSignature } from '../../lib/orchestration/agents/authoring/cockpit-director.js';

// C6 SURVIVAL TESTS (reviewer contract): a composition keys on the CHANNEL SIGNATURE, never
// the problem title. Same algorithm + new input -> same signature (spec survives, resolver
// injects new values). Different implementation of the SAME problem -> different signature
// (a cached spec must regenerate or fall back — never blind reuse).

const exec = async ({ source }) => ({ stdout: execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 20000 }), stderr: '', timedOut: false });

const TARJAN = `def critical_connections(n, connections):
    adj = {i: [] for i in range(n)}
    for u, v in connections:
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [-1] * n
    bridges = []
    time = [0]
    def dfs(u, parent):
        disc[u] = low[u] = time[0]
        time[0] += 1
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    bridges.append([u, v])
            elif v != parent:
                low[u] = min(low[u], disc[v])
    dfs(0, -1)
    return bridges`;

const DIJKSTRA_HEAP = `import heapq
def sp(n, edges, src):
    adj = {i: [] for i in range(n)}
    for u, v, w in edges:
        adj[u].append((v, w))
    dist = {src: 0}
    pq = [(0, src)]
    visited = []
    while pq:
        d, u = heapq.heappop(pq)
        if u in visited:
            continue
        visited.append(u)
        for v, w in adj[u]:
            if d + w < dist.get(v, 10**9):
                dist[v] = d + w
                heapq.heappush(pq, (dist[v], v))
    return dist`;

const DIJKSTRA_ARRAY = `def sp(n, edges, src):
    adj = {i: [] for i in range(n)}
    for u, v, w in edges:
        adj[u].append((v, w))
    dist = {src: 0}
    visited = []
    while len(visited) < n:
        u = None
        best = 10**9
        for cand in range(n):
            if cand not in visited and dist.get(cand, 10**9) < best:
                best = dist.get(cand, 10**9)
                u = cand
        if u is None:
            break
        visited.append(u)
        for v, w in adj[u]:
            if best + w < dist.get(v, 10**9):
                dist[v] = best + w
    return dist`;

test('changed input: same Tarjan, different graph -> SAME channel signature, DIFFERENT values', async () => {
  const a = await traceUniversal({ code: TARJAN, entry: 'critical_connections(6, [[0,1],[1,2],[2,0],[1,3],[3,4],[4,5],[5,3]])', language: 'python', exec });
  const b = await traceUniversal({ code: TARJAN, entry: 'critical_connections(8, [[0,1],[1,2],[2,0],[2,5],[5,3],[3,4],[4,5],[5,6],[6,7],[6,5]])', language: 'python', exec });
  const sigA = channelSignature(channelInventory(a.trace));
  const sigB = channelSignature(channelInventory(b.trace));
  assert.equal(sigA, sigB, 'the composition survives an input change');
  const lastA = JSON.stringify(a.trace.steps.at(-1).nodeState);
  const lastB = JSON.stringify(b.trace.steps.at(-1).nodeState);
  assert.notEqual(lastA, lastB, 'but every value is the NEW run\'s');
});

test('changed implementation: heap vs array Dijkstra -> DIFFERENT signatures (no blind spec reuse)', async () => {
  const heap = await traceUniversal({ code: DIJKSTRA_HEAP, entry: 'sp(4, [(0,1,4),(0,2,1),(2,1,1),(1,3,2)], 0)', language: 'python', exec });
  const arr = await traceUniversal({ code: DIJKSTRA_ARRAY, entry: 'sp(4, [(0,1,4),(0,2,1),(2,1,1),(1,3,2)], 0)', language: 'python', exec });
  const invHeap = channelInventory(heap.trace);
  const invArr = channelInventory(arr.trace);
  assert.equal(invHeap.hasQueue, true, 'the heap version carries a frontier panel channel');
  assert.notEqual(channelSignature(invHeap), channelSignature(invArr), 'same problem, different implementation -> the Director must regenerate');
});
