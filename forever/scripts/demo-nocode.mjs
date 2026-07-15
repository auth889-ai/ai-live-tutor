// THE NO-CODE PROOF: the student pastes ONLY a problem statement — no solution, no code.
// The AI must author the solution code itself, and the sandbox must run what the AI wrote.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
LeetCode 121: Best Time to Buy and Sell Stock. You are given an array of prices where
prices[i] is the price of a stock on day i. You want to maximize profit by choosing a single
day to buy and a different later day to sell. Return the maximum profit you can achieve; if
no profit is possible, return 0. For example, with prices [7, 1, 5, 3, 6, 4] the answer is 5:
buy on day 2 at price 1, sell on day 5 at price 6. With falling prices like [7, 6, 4, 3, 1]
the answer is 0 — never buy at all. A common beginner mistake is picking the global minimum
and global maximum without checking that the buy day comes BEFORE the sell day.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[nocode-demo] enqueued job ${jobId}`);
let last = ''; const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | ${p.lessonId ?? '-'} | ${p.message}` : '…';
  if (line !== last) { last = line; console.log(`[nocode-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); }
  if (job.state === 'completed') { console.log('[nocode-demo] DONE:', JSON.stringify(job.result)); process.exit(0); }
  if (job.state === 'failed') { console.log('[nocode-demo] FAILED:', JSON.stringify(job.error ?? job)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
