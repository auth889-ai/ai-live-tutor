import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgressiveLessonWriter } from '../../lib/queue/progressive-lesson.js';

function writerWith(saves, extra = {}) {
  return createProgressiveLessonWriter({
    lessonId: 'lesson_x',
    sourcePackId: 'sp_x',
    ownerId: 'u1',
    save: async (id, lesson, opts) => saves.push({ id, lesson: structuredClone(lesson), opts }),
    ...extra,
  });
}

test('playable count is the contiguous prefix, never the raw scene count', async () => {
  const saves = [];
  const writer = writerWith(saves);
  await writer.recordPlan({ lessonTitle: 'T', briefs: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] });

  let r = await writer.recordScene(2, { sceneId: 'sc_03' });
  assert.deepEqual([r.before, r.after], [0, 0]); // sc_03 alone is not watchable in order
  r = await writer.recordScene(0, { sceneId: 'sc_01' });
  assert.deepEqual([r.before, r.after], [0, 1]); // first-playable moment: exactly here
  r = await writer.recordScene(1, { sceneId: 'sc_02' });
  assert.deepEqual([r.before, r.after], [1, 3]); // the gap closed -> whole prefix opens

  assert.equal(writer.readyCount(), 3);
  assert.equal(writer.playableCount(), 3);
});

test('partial saves are ordered building docs; a failing save never breaks the build', async () => {
  const saves = [];
  const writer = writerWith(saves);
  await writer.recordPlan({ lessonTitle: 'T', briefs: [{ title: 'a', pedagogicalRole: 'hook' }, { title: 'b', pedagogicalRole: 'recap' }] });
  await writer.recordScene(1, { sceneId: 'sc_02' });
  await writer.recordScene(0, { sceneId: 'sc_01' });
  await writer.flush();

  assert.ok(saves.every((s) => s.lesson.status === 'building' && s.id === 'lesson_x' && s.opts.ownerId === 'u1'));
  // Scenes always stored sorted by index, each carrying its sceneIndex.
  assert.deepEqual(saves.at(-1).lesson.scenes.map((s) => s.sceneIndex), [0, 1]);
  assert.deepEqual(saves.at(-1).lesson.plannedScenes, [
    { title: 'a', pedagogicalRole: 'hook' },
    { title: 'b', pedagogicalRole: 'recap' },
  ]);

  // A store hiccup is logged, not thrown — the next scene's save catches playback up.
  const flaky = createProgressiveLessonWriter({
    lessonId: 'lesson_y', sourcePackId: 'sp_y', ownerId: null,
    save: async () => { throw new Error('db blinked'); },
  });
  await flaky.recordPlan({ lessonTitle: 'T', briefs: [] });
  await assert.doesNotReject(flaky.recordScene(0, { sceneId: 'sc_01' }));
});

test('a course lesson carries the Dean title and courseRef in every partial save', async () => {
  const saves = [];
  const writer = writerWith(saves, {
    outlineLesson: { id: 'ep_01_l_01', title: 'Dean Title' },
    episode: { id: 'ep_01', title: 'Episode One' },
    courseId: 'course_z',
  });
  await writer.recordPlan({ lessonTitle: 'Generator Title', briefs: [{ title: 'a' }] });

  const doc = saves[0].lesson;
  assert.equal(doc.lessonTitle, 'Dean Title'); // the student-facing title wins
  assert.deepEqual(doc.courseRef, { courseId: 'course_z', episodeId: 'ep_01', outlineLessonId: 'ep_01_l_01', episodeTitle: 'Episode One' });
});
