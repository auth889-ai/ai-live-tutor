// LC-proof driver: one real LeetCode problem through the full pipeline — the "correct graph
// for any of 4000" demonstration the user asked to SEE, not read about.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
LeetCode 200: Number of Islands. Given an m x n grid of '1' (land) and '0' (water), count the
islands — groups of adjacent land cells connected horizontally or vertically. The classic
solution is flood fill: scan every cell; when you find unvisited land, that is a NEW island —
increment the count and run a DFS that sinks the whole island by marking every connected land
cell visited, so it is never counted again.

def numIslands(grid):
    rows, cols = len(grid), len(grid[0])
    count = 0
    def sink(r, c):
        if r < 0 or r >= rows or c < 0 or c >= cols or grid[r][c] != '1':
            return
        grid[r][c] = 'X'
        sink(r + 1, c); sink(r - 1, c); sink(r, c + 1); sink(r, c - 1)
    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == '1':
                count += 1
                sink(r, c)
    return count

grid = [["1","1","0","0"],["1","0","0","1"],["0","0","1","1"]]
print(numIslands(grid))  # 3

The common mistakes: forgetting to mark cells visited (infinite recursion), counting every land
cell as an island instead of flood-filling, and checking bounds after indexing instead of before.
Time complexity is O(rows*cols): every cell is visited a constant number of times.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[lc-demo] enqueued job ${jobId}`);
let last = ''; const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | ${p.lessonId ?? '-'} | ${p.message}` : '…';
  if (line !== last) { last = line; console.log(`[lc-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); }
  if (job.state === 'completed') { console.log('[lc-demo] DONE:', JSON.stringify(job.result)); process.exit(0); }
  if (job.state === 'failed') { console.log('[lc-demo] FAILED:', JSON.stringify(job.error ?? job)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
