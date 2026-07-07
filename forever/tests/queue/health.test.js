import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../../app/api/health/route.js';
import { createInProcessQueue } from '../../lib/queue/backends/in-process.js';
import { __setLessonQueue } from '../../lib/queue/lesson-queue.js';

test('GET /api/health reports ok for the in-process backend', async () => {
  __setLessonQueue(createInProcessQueue({ process: async () => ({}) }));
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.queue.backend, 'in-process');
});

test('GET /api/health reports 503 degraded when Redis is down', async () => {
  // Simulate a bullmq-style backend whose Redis is unreachable and no worker is checked in.
  __setLessonQueue({ backend: 'bullmq', health: async () => ({ backend: 'bullmq', redis: 'down', worker: 'down' }) });
  const res = await GET();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
});

test('GET /api/health reports ok when Redis is up and a worker is alive', async () => {
  __setLessonQueue({ backend: 'bullmq', health: async () => ({ backend: 'bullmq', redis: 'up', worker: 'up' }) });
  const res = await GET();
  assert.equal(res.status, 200);
});
