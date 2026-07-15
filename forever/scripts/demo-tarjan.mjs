// REAL-APP proof driver for LC1192 (Tarjan bridges — the reference-mockup problem). This
// script is a KEYBOARD SUBSTITUTE: it pastes the problem text into the SAME enqueueLesson API
// the Studio paste-box calls — nothing else. Every scene, board, narration and dry-run step
// is authored by the AI society + execution engine at build time; there is no lesson JSON
// anywhere in this file. Paste the same text in the Studio and you get the same pipeline.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
LeetCode 1192: Critical Connections in a Network. There are n servers numbered 0..n-1 connected
by undirected connections. A critical connection (bridge) is an edge that, if removed, splits
the network. Return all critical connections. The classic solution is Tarjan's bridge-finding
DFS: give every node a discovery time disc[u], track low[u] = the earliest discovery time
reachable from u's subtree using at most one back edge, and an edge (u,v) is a bridge exactly
when low[v] > disc[u].

def critical_connections(n, connections):
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
    return bridges

print(critical_connections(6, [[0,1],[1,2],[2,0],[1,3],[3,4],[4,5],[5,3]]))  # [[1, 3]]

Common mistakes: comparing low[v] > disc[u] with >= (parallel edges), forgetting the parent
check so the tree edge itself looks like a back edge, and updating low with low[v] on back
edges instead of disc[v]. Complexity O(V + E) — one DFS.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[tarjan-demo] enqueued job ${jobId}`);
let last = ''; const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | ${p.lessonId ?? '-'} | ${p.message}` : '…';
  if (line !== last) { last = line; console.log(`[tarjan-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); }
  if (job.state === 'completed') { console.log('[tarjan-demo] DONE:', JSON.stringify(job.result)); process.exit(0); }
  if (job.state === 'failed') { console.log('[tarjan-demo] FAILED:', JSON.stringify(job.error ?? job)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
