// BFS graph dry-run proof — the trace/graph.png mockup's EXACT content: BFS level by level
// on a lettered graph with a live queue. The graph-lens cockpit's first real test.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
Breadth-first search (BFS) explores a graph level by level using a queue. Consider this
undirected graph of seven nodes: A connects to B and D; B connects to C and D; C connects to
F; D connects to E; E connects to C and G; F connects to G. Starting from A, BFS works like
ripples spreading on a pond: visit A first, then everything one edge away (B, D), then
everything two edges away (C, E), and so on until every reachable node is seen.

The queue is the engine. Start by enqueuing A and marking it visited. Then repeat: dequeue
the front node, and enqueue every unvisited neighbor, marking each visited AS you enqueue it
— not when you dequeue it. From A the queue goes [B, D]; dequeue B, enqueue C giving [D, C];
dequeue D, enqueue E giving [C, E]; dequeue C, enqueue F; dequeue E, enqueue G; and the visit
order comes out A, B, D, C, E, F, G.

def bfs(adj, start):
    from collections import deque
    visited = {start}
    queue = deque([start])
    order = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for neighbor in adj[node]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return order

adj = {"A":["B","D"],"B":["A","C","D"],"C":["B","F","E"],"D":["A","B","E"],"E":["D","C","G"],"F":["C","G"],"G":["E","F"]}
print(bfs(adj, "A"))

Two classic mistakes: marking nodes visited when DEQUEUING instead of when enqueuing lets the
same node enter the queue twice; and using a stack instead of a queue silently turns BFS into
DFS. BFS visits every vertex and edge once, so the time complexity is O(V + E), and in an
unweighted graph the first time you reach a node is via a shortest path from the start.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[bfs-demo] enqueued job ${jobId}`);
let last = ''; const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | ${p.lessonId ?? '-'} | ${p.message}` : '…';
  if (line !== last) { last = line; console.log(`[bfs-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); }
  if (job.state === 'completed') { console.log('[bfs-demo] DONE:', JSON.stringify(job.result)); process.exit(0); }
  if (job.state === 'failed') { console.log('[bfs-demo] FAILED:', JSON.stringify(job.error ?? job)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
