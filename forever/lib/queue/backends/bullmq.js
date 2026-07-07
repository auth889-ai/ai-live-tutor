// BullMQ + Redis queue backend — the PRODUCTION path (active when REDIS_URL is set). Produces
// jobs onto a Redis-backed queue that a separate worker process (lib/queue/worker.js) consumes,
// so an ~8-minute generation never blocks an API request and survives an API restart.
//
// Production settings baked in per BullMQ's "going to production" guide:
//  - ioredis maxRetriesPerRequest: null (required, or blocking commands break the worker)
//  - attempts + exponential backoff (transient society/API failures retry)
//  - removeOnComplete/Fail TTLs (a busy queue would otherwise fill Redis with old jobs)

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { JOB_NAME } from '../job-contract.js';

const JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 500 }, // keep a day / last 500
  removeOnFail: { age: 60 * 60 * 24 },
};

export function createBullQueue({ redisUrl }) {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(JOB_NAME, { connection });

  async function enqueue(input) {
    const job = await queue.add(JOB_NAME, input, JOB_OPTS);
    return { jobId: String(job.id) };
  }

  async function getJob(jobId) {
    const job = await queue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState(); // waiting | active | completed | failed | delayed
    return {
      id: String(job.id),
      state,
      progress: typeof job.progress === 'object' ? job.progress : null,
      result: job.returnvalue ?? null,
      error: job.failedReason ?? null,
    };
  }

  async function close() {
    await queue.close();
    await connection.quit();
  }

  return { enqueue, getJob, close, backend: 'bullmq' };
}
