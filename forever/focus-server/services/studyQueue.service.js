/**
 * Lightweight in-memory AI/signal job queue for Feature 1.
 *
 * Keeps extension batch requests fast by returning accepted jobs immediately.
 * Replace with BullMQ + Redis later for multi-instance production.
 */

const jobs = new Map();
const queue = [];

let running = 0;

const MAX_CONCURRENCY = Number(process.env.STUDY_QUEUE_CONCURRENCY || 2);

function makeId() {
  return `study_job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    deviceId: job.payload?.deviceId || "",
    userId: job.payload?.userId || "",
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error || "",

    resultSummary: job.result
      ? {
          usedAi: Boolean(job.result.usedAi),
          monitoringActive: job.result.monitoringActive,
          activityId:
            job.result.activity?._id?.toString?.() ||
            job.result.activity?.id ||
            "",
        }
      : null,
  };
}

async function runNext() {
  if (running >= MAX_CONCURRENCY) return;

  const job = queue.shift();
  if (!job) return;

  running += 1;
  job.status = "running";
  job.startedAt = new Date().toISOString();

  try {
    job.result = await job.handler(job.payload);
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = error.message || "Job failed";
  } finally {
    job.finishedAt = new Date().toISOString();
    running -= 1;
    setImmediate(runNext);
  }
}

export function enqueueStudySignalJob(payload, handler) {
  const job = {
    id: makeId(),
    payload,
    handler,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: "",
  };

  jobs.set(job.id, job);
  queue.push(job);

  setImmediate(runNext);

  return publicJob(job);
}

export function getStudyJob(jobId) {
  const job = jobs.get(jobId);
  return job ? publicJob(job) : null;
}

export function listStudyJobs({ deviceId = "", limit = 50 } = {}) {
  return Array.from(jobs.values())
    .filter((job) => !deviceId || job.payload?.deviceId === deviceId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Number(limit || 50))
    .map(publicJob);
}