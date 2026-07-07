// TRUE end-to-end test of the generation LOOP (no tokens, no Redis): it drives the real HTTP
// route handlers, the real queue backend, the real processor, and the real filesystem lesson
// store — only the agent society is stubbed (so it's deterministic and free). This is the test
// that proves "paste text -> job -> worker -> saved lesson -> playable" actually works, which
// the unit tests alone didn't cover.

import assert from 'node:assert/strict';
import test from 'node:test';
import { rm } from 'node:fs/promises';

import { POST } from '../../app/api/jobs/route.js';
import { GET as getJob } from '../../app/api/jobs/[id]/route.js';
import { GET as getLesson } from '../../app/api/lessons/[id]/route.js';
import { createInProcessQueue } from '../../lib/queue/backends/in-process.js';
import { __setLessonQueue } from '../../lib/queue/lesson-queue.js';
import { processLessonJob } from '../../lib/queue/lesson-processor.js';
import { createSessionToken, SESSION_COOKIE } from '../../lib/auth/session.js';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'e2e-test-secret';
const cookieFor = (userId) => `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken({ userId, email: `${userId}@t.co` }))}`;

// A stubbed society: returns a real-shaped lesson instantly (no LLM calls).
const fakeLesson = {
  sourcePackId: 'e2eDEMO0001',
  lessonTitle: 'Properties of a Binary Tree',
  scenes: [
    { sceneId: 'sc_01', title: 'Levels', objects: [], voiceLines: [], timeline: { actions: [] }, durationMs: 1000 },
    { sceneId: 'sc_02', title: 'Height', objects: [], voiceLines: [], timeline: { actions: [] }, durationMs: 1000 },
  ],
  skippedScenes: 0,
};

test('E2E: POST /api/jobs -> worker processes -> lesson is saved and loadable via /api/lessons/:id', async () => {
  // Wire the queue to the REAL processor, injecting only the fake society + real store.
  __setLessonQueue(
    createInProcessQueue({
      process: (input, { report }) =>
        processLessonJob(input, { report, deps: { generate: async () => fakeLesson } }),
    }),
  );

  // 1) enqueue via the real route, as a signed-in user (generation is private)
  const postRes = await POST(
    new Request('http://test/api/jobs', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(120) }), headers: { cookie: cookieFor('user_alice') } }),
  );
  assert.equal(postRes.status, 202);
  const { jobId } = await postRes.json();

  // 2) poll the real status route until the worker finishes
  let job;
  for (let i = 0; i < 300; i += 1) {
    const res = await getJob(new Request('http://test'), { params: Promise.resolve({ id: jobId }) });
    job = await res.json();
    if (job.state === 'completed' || job.state === 'failed') break;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(job.state, 'completed', `job failed: ${job.error ?? ''}`);
  const lessonId = job.result.lessonId;
  assert.ok(lessonId);

  // 3) the lesson is persisted UNDER ITS OWNER and served back to them
  const lessonRes = await getLesson(new Request('http://test', { headers: { cookie: cookieFor('user_alice') } }), { params: Promise.resolve({ id: lessonId }) });
  assert.equal(lessonRes.status, 200);
  const lesson = await lessonRes.json();
  assert.equal(lesson.lessonTitle, 'Properties of a Binary Tree');
  assert.equal(lesson.scenes.length, 2);
  assert.equal(lesson.ownerId, 'user_alice');

  // 4) PRIVACY: another user (and a signed-out visitor) gets 404 for the same lesson
  const asBob = await getLesson(new Request('http://test', { headers: { cookie: cookieFor('user_bob') } }), { params: Promise.resolve({ id: lessonId }) });
  assert.equal(asBob.status, 404);
  const signedOut = await getLesson(new Request('http://test'), { params: Promise.resolve({ id: lessonId }) });
  assert.equal(signedOut.status, 404);

  // cleanup the real file this E2E wrote
  await rm(`.data/lessons/${lessonId}.json`, { force: true });
});
