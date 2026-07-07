import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJobInput, makeProgress, isTerminal, PHASES } from '../../lib/queue/job-contract.js';
import { processLessonJob, lessonIdFor } from '../../lib/queue/lesson-processor.js';
import { createInProcessQueue } from '../../lib/queue/backends/in-process.js';

// --- job contract ---

test('validateJobInput requires 60+ characters of material (legacy {text} normalizes)', () => {
  assert.throws(() => validateJobInput({ text: 'too short' }), /at least 60 characters/);
  const ok = validateJobInput({ text: 'x'.repeat(60) });
  assert.equal(ok.input.type, 'text');
  assert.equal(ok.input.text.length, 60);
});

test('validateJobInput accepts every typed input and rejects malformed ones', () => {
  const pdf = validateJobInput({ input: { type: 'pdf', path: '.data/uploads/u1/up_a.pdf' }, ownerId: 'u1' });
  assert.deepEqual(pdf, { input: { type: 'pdf', path: '.data/uploads/u1/up_a.pdf', course: false }, ownerId: 'u1' });

  // course mode + on-demand course lessons
  const course = validateJobInput({ input: { type: 'text', text: 'y'.repeat(80), course: true } });
  assert.equal(course.input.course, true);
  const cl = validateJobInput({ input: { type: 'course-lesson', courseId: 'course_x', outlineLessonId: 'ep_01_l_02' }, ownerId: 'u1' });
  assert.deepEqual(cl.input, { type: 'course-lesson', courseId: 'course_x', outlineLessonId: 'ep_01_l_02' });
  assert.throws(() => validateJobInput({ input: { type: 'course-lesson', courseId: 'course_x' } }), /needs courseId and outlineLessonId/);

  const image = validateJobInput({ input: { type: 'image', path: '/up/b.png', text: 'context notes' } });
  assert.equal(image.input.text, 'context notes');

  const url = validateJobInput({ input: { type: 'url', url: 'https://example.com/a?b=1' } });
  assert.equal(url.input.url, 'https://example.com/a?b=1');

  assert.throws(() => validateJobInput({ input: { type: 'pdf' } }), /needs an uploaded file/);
  assert.throws(() => validateJobInput({ input: { type: 'url', url: 'not a url' } }), /valid web address/);
  assert.throws(() => validateJobInput({ input: { type: 'url', url: 'ftp://x.com/f' } }), /Only http\(s\)/);
  assert.throws(() => validateJobInput({ input: { type: 'video' } }), /Unknown input type/);
  assert.throws(() => validateJobInput({}), /needs an input/);
});

test('makeProgress interpolates the scene span during generation and voicing', () => {
  assert.equal(makeProgress({ phase: 'queued' }).percent, 0);
  assert.equal(makeProgress({ phase: 'generating', sceneDone: 0, sceneTotal: 8 }).percent, 30);
  assert.equal(makeProgress({ phase: 'generating', sceneDone: 4, sceneTotal: 8 }).percent, 50); // 30 + 0.5*40
  assert.equal(makeProgress({ phase: 'generating', sceneDone: 8, sceneTotal: 8 }).percent, 70);
  assert.equal(makeProgress({ phase: 'voicing', sceneDone: 0, sceneTotal: 0 }).percent, 70);
  assert.equal(makeProgress({ phase: 'voicing', sceneDone: 1, sceneTotal: 2 }).percent, 81); // 70 + 0.5*22
  assert.equal(makeProgress({ phase: 'voicing', sceneDone: 2, sceneTotal: 2 }).percent, 92);
  assert.equal(makeProgress({ phase: 'done' }).percent, 100);
});

test('makeProgress rejects an unknown phase; isTerminal flags done/failed', () => {
  assert.throws(() => makeProgress({ phase: 'levitating' }), /unknown job phase/);
  assert.ok(isTerminal('done') && isTerminal('failed'));
  assert.ok(!isTerminal('generating'));
  assert.equal(PHASES[0], 'queued');
});

// --- processor (injected society + store) ---

test('processLessonJob generates, VOICES, and saves the voiced lesson (not the silent one)', async () => {
  const saved = {};
  const progress = [];
  const fakeLesson = { sourcePackId: 'sp_ABC123', lessonTitle: 'Binary Search', scenes: [{}, {}], skippedScenes: 0 };
  const fakeVoiced = { ...fakeLesson, voiced: true };
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
        voice: async (lesson, { onProgress }) => {
          assert.equal(lesson, fakeLesson);
          onProgress({ sceneDone: 1, sceneTotal: 2 });
          onProgress({ sceneDone: 2, sceneTotal: 2 });
          return fakeVoiced;
        },
        publishAssets: async (lesson) => lesson,
        save: async (id, lesson) => { saved[id] = lesson; },
      },
    },
  );

  assert.equal(result.lessonId, lessonIdFor('sp_ABC123'));
  assert.equal(result.scenes, 2);
  assert.equal(result.voiced, true);
  assert.equal(saved[result.lessonId], fakeVoiced); // the VOICED lesson is what persists
  assert.equal(progress.at(-1).phase, 'done');
  assert.ok(progress.some((p) => p.phase === 'generating' && p.percent === 70));
  assert.ok(progress.some((p) => p.phase === 'voicing' && p.percent === 81)); // real per-scene voicing progress
  assert.ok(progress.some((p) => p.phase === 'voicing' && p.percent === 92));
});

test('processLessonJob honours the explicit DISABLE_TTS=1 dev opt-out (never a silent default)', async () => {
  const saved = {};
  const fakeLesson = { sourcePackId: 'sp_QUIET1', lessonTitle: 'Q', scenes: [{}], skippedScenes: 0 };
  const result = await processLessonJob(
    { text: 'x'.repeat(80) },
    {
      deps: {
        generate: async () => fakeLesson,
        voice: async () => { throw new Error('voice must NOT be called when DISABLE_TTS=1'); },
        publishAssets: async (lesson) => lesson,
        save: async (id, lesson) => { saved[id] = lesson; },
        env: { DISABLE_TTS: '1' },
      },
    },
  );
  assert.equal(result.voiced, false);
  assert.equal(saved[result.lessonId], fakeLesson);
});

test('course mode: Dean outline -> course saved -> FIRST lesson generated and linked', async () => {
  const saved = {};
  const outline = {
    title: 'BFS Course',
    episodes: [{
      id: 'ep_01', title: 'Fundamentals', estimatedMinutes: 40, quizQuestionCount: 3,
      lessons: [
        { id: 'ep_01_l_01', title: 'Why BFS', lessonType: 'concept', estimatedMinutes: 8, focusChunkIds: ['chunk_0001'] },
        { id: 'ep_01_l_02', title: 'Dry Run', lessonType: 'see_it', estimatedMinutes: 9, focusChunkIds: ['chunk_0001'] },
      ],
    }],
  };
  const links = [];
  const result = await processLessonJob(
    { input: { type: 'text', text: 'x'.repeat(80), course: true }, ownerId: 'u1' },
    {
      deps: {
        designCourseOutline: async () => ({ outline, usage: null }),
        generate: async (pack) => ({ sourcePackId: pack.id, lessonTitle: 'generated title', scenes: [{ durationMs: 1000 }] }),
        voice: async (l) => l,
        publishAssets: async (l) => l,
        saveCourse: async (id, course) => { saved[id] = course; },
        linkCourseLesson: async (id, outlineLessonId, lessonId) => links.push({ id, outlineLessonId, lessonId }),
        save: async (id, lesson) => { saved[id] = lesson; },
        env: { DISABLE_TTS: '1' },
      },
    },
  );

  assert.equal(result.courseTitle, 'BFS Course');
  assert.equal(result.lessonsPlanned, 2);
  assert.equal(links.length, 1);
  assert.equal(links[0].outlineLessonId, 'ep_01_l_01');
  assert.equal(result.firstLessonId, links[0].lessonId);
  const firstLesson = saved[links[0].lessonId];
  assert.equal(firstLesson.lessonTitle, 'Why BFS'); // the Dean's title wins in a course
  assert.equal(firstLesson.courseRef.courseId, result.courseId);
});

test('course-lesson mode: generates ONE more lesson of an existing course, owner-scoped', async () => {
  const outline = {
    title: 'C', episodes: [{ id: 'ep_01', title: 'E', estimatedMinutes: 40, quizQuestionCount: 3,
      lessons: [{ id: 'ep_01_l_02', title: 'Dry Run', lessonType: 'see_it', estimatedMinutes: 9, focusChunkIds: ['chunk_0001'] }] }],
  };
  const sourcePack = {
    id: 'sp_c1', title: 'T',
    documents: [{ id: 'src_1', type: 'text', title: 'T', metadata: {} }],
    chunks: [{ id: 'chunk_0001', sourceId: 'src_1', text: 'material', sourceRef: 'r', tokenEstimate: 1, orderIndex: 0, metadata: {} }],
  };
  const links = [];
  const result = await processLessonJob(
    { input: { type: 'course-lesson', courseId: 'course_c1', outlineLessonId: 'ep_01_l_02' }, ownerId: 'u1' },
    {
      deps: {
        loadCourse: async (id, { forUser }) => {
          assert.equal(forUser, 'u1'); // privacy: loaded as the owner
          return { outline, sourcePack, lessonLinks: {} };
        },
        generate: async (pack) => ({ sourcePackId: pack.id, lessonTitle: 'g', scenes: [{ durationMs: 1000 }] }),
        voice: async (l) => l,
        publishAssets: async (l) => l,
        linkCourseLesson: async (id, outlineLessonId, lessonId) => links.push({ outlineLessonId, lessonId }),
        save: async () => {},
        env: { DISABLE_TTS: '1' },
      },
    },
  );
  assert.equal(result.outlineLessonId, 'ep_01_l_02');
  assert.equal(links[0].lessonId, result.lessonId);
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
