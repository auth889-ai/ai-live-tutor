// End-to-end 2-D DP proof (LC62 Unique Paths) through the REAL app pipeline.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
LeetCode 62: Unique Paths. A robot stands on the top-left cell of an m x n grid and can only
move right or down. How many distinct paths reach the bottom-right corner? The insight: the
number of ways to reach any cell equals the ways to reach the cell ABOVE it plus the ways to
reach the cell to its LEFT — because those are the only two places a robot could have come
from. That single sentence is the whole dynamic program.

Build a dp table where dp[i][j] counts paths to cell (i, j). Every cell in the first row and
first column is 1: there is exactly one way to slide straight across or straight down. Then
fill row by row: dp[i][j] = dp[i-1][j] + dp[i][j-1]. For a 3 x 4 grid the table fills to
[[1,1,1,1],[1,2,3,4],[1,3,6,10]] and the answer is dp[2][3] = 10.

def unique_paths(m, n):
    dp = [[1] * n for _ in range(m)]
    for i in range(1, m):
        for j in range(1, n):
            dp[i][j] = dp[i - 1][j] + dp[i][j - 1]
    return dp[m - 1][n - 1]

print(unique_paths(3, 4))  # 10

The classic mistakes: filling cells before their dependencies exist (the fill ORDER is the
correctness guarantee — a cell may only be computed from already-filled neighbours), forgetting
that the first row and column are base cases, and mixing up m and n. Time complexity is
O(m*n): every cell is computed exactly once from two lookups.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[dp-demo] enqueued job ${jobId}`);
let last = ''; const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | ${p.lessonId ?? '-'} | ${p.message}` : '…';
  if (line !== last) { last = line; console.log(`[dp-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); }
  if (job.state === 'completed') { console.log('[dp-demo] DONE:', JSON.stringify(job.result)); process.exit(0); }
  if (job.state === 'failed') { console.log('[dp-demo] FAILED:', JSON.stringify(job.error ?? job)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
