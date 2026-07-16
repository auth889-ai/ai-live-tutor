// REAL-APP proof driver for LC1192 (Tarjan bridges — the reference-mockup problem). This
// script is a KEYBOARD SUBSTITUTE: it pastes the problem text into the SAME enqueueLesson API
// the Studio paste-box calls — nothing else. Every scene, board, narration and dry-run step
// is authored by the AI society + execution engine at build time; there is no lesson JSON
// anywhere in this file. Paste the same text in the Studio and you get the same pipeline.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
LeetCode 1466: Reorder Routes to Make All Paths Lead to the City Zero. There are n cities
and n-1 directed roads forming a tree when directions are ignored. Reorder the minimum number
of roads so every city can reach city 0. Solution: DFS from 0 over the undirected tree; count
edges whose original direction points AWAY from 0 (those must be reversed).

def min_reorder(n, connections):
    adj = {i: [] for i in range(n)}
    forward = set()
    for a, b in connections:
        adj[a].append(b)
        adj[b].append(a)
        forward.add((a, b))
    visited = []
    count = [0]
    def dfs(u):
        visited.append(u)
        for v in adj[u]:
            if v not in visited:
                if (u, v) in forward:
                    count[0] += 1
                dfs(v)
    dfs(0)
    return count[0]

print(min_reorder(6, [[0,1],[1,3],[2,3],[4,0],[4,5]]))  # 3

Common mistakes: forgetting the reverse adjacency (the tree must be walked ignoring
direction), counting edges toward 0 instead of away, and revisiting the parent.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[unseen-demo] enqueued job ${jobId}`);
let last = ''; const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | ${p.lessonId ?? '-'} | ${p.message}` : '…';
  if (line !== last) { last = line; console.log(`[unseen-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); }
  if (job.state === 'completed') { console.log('[unseen-demo] DONE:', JSON.stringify(job.result)); process.exit(0); }
  if (job.state === 'failed') { console.log('[unseen-demo] FAILED:', JSON.stringify(job.error ?? job)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
