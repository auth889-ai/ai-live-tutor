import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../../app/api/generate/route.js';
import { GET } from '../../app/api/generate/[id]/route.js';
import { createInProcessQueue } from '../../lib/queue/backends/in-process.js';
import { __setLessonQueue } from '../../lib/queue/lesson-queue.js';
import { makeProgress } from '../../lib/queue/job-contract.js';

function jsonRequest(body) {
  return new Request('http://test/api/generate', { method: 'POST', body: JSON.stringify(body) });
}

test('POST rejects material under 60 chars with 400', async () => {
  __setLessonQueue(createInProcessQueue({ process: async () => ({ lessonId: 'x' }) }));
  const res = await POST(jsonRequest({ text: 'too short' }));
  assert.equal(res.status, 400);
});

test('POST enqueues and returns 202 { jobId }; GET polls it to completion', async () => {
  __setLessonQueue(
    createInProcessQueue({
      process: async (_input, { report }) => {
        report(makeProgress({ phase: 'generating', sceneDone: 3, sceneTotal: 3 }));
        return { lessonId: 'lesson_demo', lessonTitle: 'Demo', scenes: 3 };
      },
    }),
  );

  const res = await POST(jsonRequest({ text: 'x'.repeat(80) }));
  assert.equal(res.status, 202);
  const { jobId } = await res.json();
  assert.ok(jobId);

  let job;
  for (let i = 0; i < 200; i += 1) {
    const statusRes = await GET(new Request('http://test'), { params: Promise.resolve({ id: jobId }) });
    job = await statusRes.json();
    if (job.state === 'completed' || job.state === 'failed') break;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(job.state, 'completed');
  assert.equal(job.result.lessonId, 'lesson_demo');
});

test('GET returns 404 for an unknown job id', async () => {
  __setLessonQueue(createInProcessQueue({ process: async () => ({}) }));
  const res = await GET(new Request('http://test'), { params: Promise.resolve({ id: 'nope' }) });
  assert.equal(res.status, 404);
});
