// In-process queue backend — runs jobs on the local event loop, no Redis required. Used for
// local dev and tests so the whole async flow (enqueue -> progress -> result) works and is
// deterministically testable without infrastructure. Same interface as the BullMQ backend, so
// the API/route code is identical whether or not Redis is configured (the lesson-store seam,
// applied to the queue).

import { processLessonJob } from '../lesson-processor.js';
import { makeProgress } from '../job-contract.js';

export function createInProcessQueue({ process = processLessonJob } = {}) {
  const jobs = new Map(); // jobId -> { id, state, progress, result, error }
  let counter = 0;

  function enqueue(input, { deps } = {}) {
    const jobId = `job_${(counter += 1)}_${Date.now().toString(36)}`;
    const job = { id: jobId, state: 'waiting', progress: makeProgress({ phase: 'queued', message: 'Queued' }), result: null, error: null };
    jobs.set(jobId, job);
    // Defer so enqueue returns immediately, exactly like a real queue hands work to a worker.
    queueMicrotask(async () => {
      job.state = 'active';
      try {
        job.result = await process(input, { report: (progress) => { job.progress = progress; }, deps });
        job.state = 'completed';
      } catch (error) {
        job.state = 'failed';
        job.error = String(error?.message || error);
        job.progress = makeProgress({ phase: 'failed', message: job.error });
      }
    });
    return { jobId };
  }

  function getJob(jobId) {
    const job = jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async function health() {
    // No external deps and the "worker" is this same process, so it's ready whenever the app is.
    return { backend: 'in-process', redis: 'n/a', worker: 'in-process' };
  }

  async function close() {
    jobs.clear();
  }

  return { enqueue, getJob, health, close, backend: 'in-process' };
}
