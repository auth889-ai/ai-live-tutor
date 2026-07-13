// TRUE end-to-end test of PROGRESSIVE PLAYBACK (no tokens, no Redis): real HTTP route
// handlers, real queue backend, real processor, real progressive writer, real filesystem
// lesson store — only the agent society is stubbed, and the stub PAUSES mid-generation so
// the test can observe what a student would see at that exact moment: a building lesson
// whose first scene is already watchable while the rest are still being written.

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

const sceneShaped = (n, title) => ({
  sceneId: `sc_0${n}`, title, pedagogicalRole: 'concept', layout: 'single',
  objects: [], voiceLines: [], timeline: { actions: [] }, durationMs: 1000, reviewRounds: 0,
});

test('E2E: a building lesson is watchable via /api/lessons/:id BEFORE the job completes, then flips to ready', async () => {
  // The stub society: plans 3 scenes, delivers scene 1, then HOLDS until the test has
  // inspected the mid-build state — exactly a slow provider window, minus the tokens.
  let releaseRest;
  const restGate = new Promise((resolve) => { releaseRest = resolve; });
  const generate = async (pack, { onPlan, onScene }) => {
    await onPlan({ lessonTitle: 'Progressive Demo', briefs: [{ title: 'One', pedagogicalRole: 'hook' }, { title: 'Two', pedagogicalRole: 'concept' }, { title: 'Three', pedagogicalRole: 'recap' }] });
    const s1 = await onScene(sceneShaped(1, 'One'), 0);
    await restGate;
    const s2 = await onScene(sceneShaped(2, 'Two'), 1);
    const s3 = await onScene(sceneShaped(3, 'Three'), 2);
    return { sourcePackId: pack.id, lessonTitle: 'Progressive Demo', scenes: [s1, s2, s3], skippedScenes: 0 };
  };
  __setLessonQueue(
    createInProcessQueue({
      process: (input, { report }) =>
        processLessonJob(input, { report, deps: { generate, env: { DISABLE_TTS: '1' }, findTopicImage: async () => null } }),
    }),
  );

  // 1) enqueue via the real route, signed in
  const postRes = await POST(
    new Request('http://test/api/jobs', { method: 'POST', body: JSON.stringify({ text: 'y'.repeat(120) }), headers: { cookie: cookieFor('user_alice') } }),
  );
  assert.equal(postRes.status, 202);
  const { jobId } = await postRes.json();

  // 2) poll the real job route until the progress stream says "1 scene ready to watch"
  let progress;
  for (let i = 0; i < 300; i += 1) {
    const res = await getJob(new Request('http://test'), { params: Promise.resolve({ id: jobId }) });
    ({ progress } = await res.json());
    if (progress?.scenesReady >= 1) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(progress.scenesReady, 1, 'progress must announce the first watchable scene');
  assert.ok(progress.lessonId, 'progress must carry the lesson URL id for the Watch-now link');
  const lessonId = progress.lessonId;

  // 3) THE POINT: /course/:id's data source already serves a playable lesson MID-BUILD
  const midRes = await getLesson(new Request('http://test', { headers: { cookie: cookieFor('user_alice') } }), { params: Promise.resolve({ id: lessonId }) });
  assert.equal(midRes.status, 200);
  const midLesson = await midRes.json();
  assert.equal(midLesson.status, 'building');
  assert.deepEqual(midLesson.plannedScenes.map((s) => s.title), ['One', 'Two', 'Three']);
  assert.equal(midLesson.scenes.length, 1); // scene 1 watchable; scenes 2-3 still "writing…"
  assert.equal(midLesson.scenes[0].sceneIndex, 0);
  assert.equal(midLesson.scenes[0].sceneId, 'sc_01');

  // 3b) PRIVACY holds mid-build too: the partial doc is owner-scoped like the final one
  const asBob = await getLesson(new Request('http://test', { headers: { cookie: cookieFor('user_bob') } }), { params: Promise.resolve({ id: lessonId }) });
  assert.equal(asBob.status, 404);

  // 4) release the society; the job completes; the SAME url now serves the ready lesson
  releaseRest();
  let job;
  for (let i = 0; i < 300; i += 1) {
    const res = await getJob(new Request('http://test'), { params: Promise.resolve({ id: jobId }) });
    job = await res.json();
    if (job.state === 'completed' || job.state === 'failed') break;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(job.state, 'completed', `job failed: ${job.error ?? ''}`);
  assert.equal(job.result.lessonId, lessonId); // Watch-now link and final link are the SAME url

  const finalRes = await getLesson(new Request('http://test', { headers: { cookie: cookieFor('user_alice') } }), { params: Promise.resolve({ id: lessonId }) });
  const finalLesson = await finalRes.json();
  assert.equal(finalLesson.status, 'ready');
  assert.equal(finalLesson.scenes.length, 3);
  assert.equal(finalLesson.plannedScenes, undefined); // building bookkeeping is gone
  assert.equal(finalLesson.scenes[0].sceneIndex, undefined);

  // cleanup the real file this E2E wrote
  await rm(`.data/lessons/${lessonId}.json`, { force: true });
});
