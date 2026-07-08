// Lesson-generation WORKER — a SEPARATE process from the Next.js API (so a worker crash can't
// take the API down, and generation scales by running more of these). Run it with:
//   node --env-file=.env lib/queue/worker.js     (or: npm run worker)
// It consumes JOB_NAME jobs, runs the agent society via the shared processor, and reports live
// progress with job.updateProgress() so the browser can render a real progress bar over SSE.

import { Worker } from 'bullmq';
import IORedis from 'ioredis';

import { JOB_NAME, WORKER_HEARTBEAT_KEY } from './job-contract.js';
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
  {
    connection,
    concurrency,
    // Long-AI-job lock tuning (measured 2026-07-08: a 20-minute lesson died to "job stalled
    // more than allowable limit" after ONE >30s renewal miss on the DEFAULT 30s lock). A long
    // lock plus stall forgiveness means a transient event-loop or Redis hiccup costs nothing;
    // a genuinely dead worker still gets its jobs re-queued (idempotent lessonIds make the
    // retry overwrite the same lesson).
    lockDuration: 120_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,
  },
);

// Heartbeat: refresh a short-TTL key so /api/health can tell a worker is alive. If the worker
// dies, the key expires and health flips to worker:down — no more silent "0% forever".
const beat = () => connection.set(WORKER_HEARTBEAT_KEY, String(Date.now()), 'EX', 30).catch(() => {});
beat();
const heartbeat = setInterval(beat, 10_000);
heartbeat.unref?.();

worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed: ${err?.message}`));
// Without an error listener BullMQ can stop processing on an emitted error — always attach one.
worker.on('error', (err) => console.error(`[worker] error: ${err?.message}`));

async function shutdown(signal) {
  console.log(`[worker] ${signal} received — closing (drain timeout ${DRAIN_TIMEOUT_MS / 1000}s)`);
  clearInterval(heartbeat);
  // Graceful close waits for active jobs — but lessons run for MINUTES, and an unbounded
  // wait deadlocks restarts (node --watch, deploys) into a half-dead worker. Bounded drain:
  // after the timeout, force-close. Safe because the processor is IDEMPOTENT and BullMQ
  // re-queues stalled jobs — the retried job overwrites the same lesson.
  await Promise.race([
    worker.close(),
    new Promise((resolve) => setTimeout(resolve, DRAIN_TIMEOUT_MS)).then(() => {
      console.log('[worker] drain timeout — force closing (stalled jobs will be retried)');
      return worker.close(true);
    }),
  ]);
  await connection.quit().catch(() => {});
  process.exit(0);
}
const DRAIN_TIMEOUT_MS = Number(process.env.WORKER_DRAIN_TIMEOUT_MS || 10_000);
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`[worker] listening on "${JOB_NAME}" with concurrency ${concurrency}`);
