// REAL-APP proof driver for LC1192 (Tarjan bridges — the reference-mockup problem). This
// script is a KEYBOARD SUBSTITUTE: it pastes the problem text into the SAME enqueueLesson API
// the Studio paste-box calls — nothing else. Every scene, board, narration and dry-run step
// is authored by the AI society + execution engine at build time; there is no lesson JSON
// anywhere in this file. Paste the same text in the Studio and you get the same pipeline.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
LeetCode 847: Shortest Path Visiting All Nodes. Given an undirected connected graph of n
nodes labeled 0..n-1, return the length of the shortest path visiting every node; start
anywhere, revisits allowed. Classic solution: BFS over (node, mask) states where mask is a
bitmask of visited nodes, started from every node simultaneously; the first state whose mask
covers all nodes gives the answer.

from collections import deque
def shortest_path_length(graph):
    n = len(graph)
    target = (1 << n) - 1
    q = deque((i, 1 << i) for i in range(n))
    seen = [(i, 1 << i) for i in range(n)]
    dist = 0
    while q:
        for _ in range(len(q)):
            node, mask = q.popleft()
            if mask == target:
                return dist
            for nei in graph[node]:
                nmask = mask | (1 << nei)
                if (nei, nmask) not in seen:
                    seen.append((nei, nmask))
                    q.append((nei, nmask))
        dist += 1
    return 0

print(shortest_path_length([[1,2,3],[0],[0],[0]]))  # 4

Common mistakes: tracking visited by node only (states are node+mask pairs), forgetting the
multi-source start, and returning before completing the level count.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[bitmask-demo] enqueued job ${jobId}`);
let last = ''; const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | ${p.lessonId ?? '-'} | ${p.message}` : '…';
  if (line !== last) { last = line; console.log(`[bitmask-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); }
  if (job.state === 'completed') { console.log('[bitmask-demo] DONE:', JSON.stringify(job.result)); process.exit(0); }
  if (job.state === 'failed') { console.log('[bitmask-demo] FAILED:', JSON.stringify(job.error ?? job)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
