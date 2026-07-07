import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJobInput, makeProgress, isTerminal, PHASES } from '../../lib/queue/job-contract.js';
import { processLessonJob, lessonIdFor } from '../../lib/queue/lesson-processor.js';
import { createInProcessQueue } from '../../lib/queue/backends/in-process.js';

// --- job contract ---

test('validateJobInput requires 60+ characters of material', () => {
  assert.throws(() => validateJobInput({ text: 'too short' }), /at least 60 characters/);
  const ok = validateJobInput({ text: 'x'.repeat(60) });
  assert.equal(ok.text.length, 60);
});

test('makeProgress interpolates the scene span during generation', () => {
  assert.equal(makeProgress({ phase: 'queued' }).percent, 0);
  assert.equal(makeProgress({ phase: 'generating', sceneDone: 0, sceneTotal: 8 }).percent, 30);
  assert.equal(makeProgress({ phase: 'generating', sceneDone: 4, sceneTotal: 8 }).percent, 61); // 30 + 0.5*62
  assert.equal(makeProgress({ phase: 'generating', sceneDone: 8, sceneTotal: 8 }).percent, 92);
  assert.equal(makeProgress({ phase: 'done' }).percent, 100);
});

test('makeProgress rejects an unknown phase; isTerminal flags done/failed', () => {
  assert.throws(() => makeProgress({ phase: 'levitating' }), /unknown job phase/);
  assert.ok(isTerminal('done') && isTerminal('failed'));
  assert.ok(!isTerminal('generating'));
  assert.equal(PHASES[0], 'queued');
});

// --- processor (injected society + store) ---

test('processLessonJob forwards society progress and returns a saved lesson id', async () => {
  const saved = {};
  const progress = [];
  const fakeLesson = { sourcePackId: 'sp_ABC123', lessonTitle: 'Binary Search', scenes: [{}, {}], skippedScenes: 0 };
  const result = await processLessonJob(
    { text: 'x'.repeat(80) },
    {
      report: (p) => progress.push(p),
      deps: {
        generate: async (_text, { onProgress }) => {
          onProgress({ phase: 'planning', message: 'planning' });
          onProgress({ phase: 'generating', sceneDone: 2, sceneTotal: 2 });
          return fakeLesson;
        },
        save: async (id, lesson) => { saved[id] = lesson; },
      },
    },
  );

  assert.equal(result.lessonId, lessonIdFor('sp_ABC123'));
  assert.equal(result.scenes, 2);
  assert.equal(saved[result.lessonId], fakeLesson);
  assert.equal(progress.at(-1).phase, 'done');
  assert.ok(progress.some((p) => p.phase === 'generating' && p.percent === 92));
});

// --- in-process backend (the full async flow) ---

async function waitForTerminal(queue, jobId) {
  for (let i = 0; i < 200; i += 1) {
    const job = queue.getJob(jobId);
    if (job && (job.state === 'completed' || job.state === 'failed')) return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job did not finish');
}

test('enqueue returns instantly, then the job runs to completion in the background', async () => {
  const queue = createInProcessQueue({
    process: async (input, { report }) => {
      report(makeProgress({ phase: 'generating', sceneDone: 1, sceneTotal: 1 }));
      return { lessonId: 'lesson_x', scenes: 1 };
    },
  });
  const { jobId } = queue.enqueue({ text: 'x'.repeat(80) });
  assert.equal(queue.getJob(jobId).state, 'waiting'); // hasn't run yet — returned immediately

  const done = await waitForTerminal(queue, jobId);
  assert.equal(done.state, 'completed');
  assert.equal(done.result.lessonId, 'lesson_x');
});

test('a failing job is captured as failed with an error message, not a throw', async () => {
  const queue = createInProcessQueue({
    process: async () => { throw new Error('society exploded'); },
  });
  const { jobId } = queue.enqueue({ text: 'x'.repeat(80) });
  const done = await waitForTerminal(queue, jobId);
  assert.equal(done.state, 'failed');
  assert.match(done.error, /society exploded/);
  assert.equal(done.progress.phase, 'failed');
});
