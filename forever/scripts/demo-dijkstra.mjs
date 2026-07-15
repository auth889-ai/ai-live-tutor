// End-to-end weighted-graph proof (LC743 Network Delay Time / Dijkstra) through the REAL app.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
LeetCode 743: Network Delay Time. A signal starts at node k and travels along directed,
weighted edges; times[i] = (u, v, w) means the signal takes w milliseconds to go from u to v.
How long until every node has received the signal? This is single-source shortest paths on a
weighted graph — Dijkstra's algorithm.

Dijkstra grows a frontier of settled nodes. Keep a distance map starting at infinity for every
node except the source (distance 0), and a min-heap of (distance, node) candidates. Repeatedly
pop the closest candidate; if it is stale (a shorter route was already found), skip it.
Otherwise RELAX every outgoing edge: if going through this node makes a neighbor closer,
update the neighbor's distance and push the better candidate into the heap.

import heapq
def network_delay(times, n, k):
    adj = {i: [] for i in range(1, n + 1)}
    for u, v, w in times:
        adj[u].append((v, w))
    dist = {i: float('inf') for i in range(1, n + 1)}
    dist[k] = 0
    heap = [(0, k)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w
                heapq.heappush(heap, (dist[v], v))
    answer = max(dist.values())
    return answer if answer != float('inf') else -1

print(network_delay([(2,1,1),(2,3,1),(3,4,1)], 4, 2))  # 2

Watch the relaxations: from node 2 the signal reaches 1 and 3 in 1ms; through 3 it reaches 4
at 2ms. The classic mistakes: forgetting the stale-entry skip (d > dist[u]) which makes the
heap re-process outdated candidates, relaxing with the OLD distance instead of the popped one,
and using Dijkstra with negative weights where it silently breaks. Complexity is
O((V + E) log V) because every edge can push one heap entry.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[dijkstra-demo] enqueued job ${jobId}`);
let last = ''; const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | ${p.lessonId ?? '-'} | ${p.message}` : '…';
  if (line !== last) { last = line; console.log(`[dijkstra-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); }
  if (job.state === 'completed') { console.log('[dijkstra-demo] DONE:', JSON.stringify(job.result)); process.exit(0); }
  if (job.state === 'failed') { console.log('[dijkstra-demo] FAILED:', JSON.stringify(job.error ?? job)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
