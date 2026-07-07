// Lesson-generation WORKER — a SEPARATE process from the Next.js API (so a worker crash can't
// take the API down, and generation scales by running more of these). Run it with:
//   node --env-file=.env lib/queue/worker.js     (or: npm run worker)
// It consumes JOB_NAME jobs, runs the agent society via the shared processor, and reports live
// progress with job.updateProgress() so the browser can render a real progress bar over SSE.

import { Worker } from 'bullmq';
import IORedis from 'ioredis';

import { JOB_NAME } from './job-contract.js';
import { processLessonJob } from './lesson-processor.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('[worker] REDIS_URL is required to run the worker'); // honest failure, no silent no-op
  process.exit(1);
}

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const concurrency = Number(process.env.WORKER_CONCURRENCY || 2);

const worker = new Worker(
  JOB_NAME,
  async (job) => processLessonJob(job.data, { report: (progress) => job.updateProgress(progress) }),
  { connection, concurrency },
);

worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed: ${err?.message}`));
// Without an error listener BullMQ can stop processing on an emitted error — always attach one.
worker.on('error', (err) => console.error(`[worker] error: ${err?.message}`));

async function shutdown(signal) {
  console.log(`[worker] ${signal} received — closing gracefully (finishing in-flight jobs)`);
  await worker.close(); // stops taking new jobs, waits for active ones
  await connection.quit();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`[worker] listening on "${JOB_NAME}" with concurrency ${concurrency}`);
