// Lesson-generation queue — ONE interface, two backends. Production uses BullMQ + Redis (set
// REDIS_URL); local dev and tests use an in-process runner (no infrastructure). The API route
// and status/SSE endpoints call this and never know which backend is live, so shipping to
// production is a config change (REDIS_URL) not a code change.
//
//   enqueueLesson({ text })  -> { jobId }        (returns instantly; work runs in the background)
//   getLessonJob(jobId)      -> { id, state, progress, result, error } | null

import { createRequire } from 'node:module';

import { createInProcessQueue } from './backends/in-process.js';

const require = createRequire(import.meta.url);
let singleton = null;

export function lessonQueue() {
  if (singleton) return singleton;
  if (process.env.REDIS_URL) {
    // Lazy: only pull in BullMQ/ioredis when Redis is actually configured, so local/test runs
    // never touch them. createBullQueue is required on demand to avoid a hard dependency here.
    const { createBullQueue } = require('./backends/bullmq.js');
    singleton = createBullQueue({ redisUrl: process.env.REDIS_URL });
  } else {
    singleton = createInProcessQueue();
  }
  return singleton;
}

// async so the same call works for both backends (BullMQ's add/getJob are async; the
// in-process backend returns plain values that await through unchanged).
export async function enqueueLesson(input) {
  return lessonQueue().enqueue(input);
}

export async function getLessonJob(jobId) {
  return lessonQueue().getJob(jobId);
}

// Readiness for /api/health — Redis reachability + worker liveness (or in-process).
export async function getQueueHealth() {
  const queue = lessonQueue();
  return queue.health ? queue.health() : { backend: queue.backend };
}

// Test seam: reset the memoized backend so a suite can inject its own.
export function __setLessonQueue(queue) {
  singleton = queue;
}
