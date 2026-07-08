import assert from 'node:assert/strict';
import test from 'node:test';

import { generateLessonFromText } from '../../../lib/generation/lesson/generate-lesson.js';

const TEXT =
  'Alpha is the first idea in the topic and explains the basic starting point clearly. ' +
  'Beta is the second idea and builds directly on alpha with a concrete worked example for the learner.';

test('a lesson decomposes into ordered scenes, each generated from its focused chunks', async () => {
  const lesson = await generateLessonFromText(TEXT, {
    agents: {
      routeDomain: async () => ({ domain: 'general', usage: null }),
      designPedagogy: async ({ sourcePack }) => ({
        lessonTitle: 'Alpha and Beta',
        scenes: [
          { title: 'Alpha', pedagogicalRole: 'intuition', directive: 'Explain alpha.', focusChunkIds: [sourcePack.chunks[0].id] },
          { title: 'Beta', pedagogicalRole: 'worked_example', directive: 'Show beta with an example.', focusChunkIds: [sourcePack.chunks[0].id] },
        ],
        usage: null,
      }),
      generateScene: async (focused, { sceneId }) => ({
        scene: {
          sceneId,
          layout: 'teacher_notebook_code',
          objects: [{ id: 'o1', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'x', sourceRef: { chunkId: focused.chunks[0].id } }],
          voiceLines: [{ id: 'v1', text: 'Line.', targetObjectId: 'o1' }],
        },
        timeline: { sceneId, timingSource: 'provisional', actions: [] },
        durationMs: 5000,
        reviewRounds: 0,
      }),
    },
  });

  assert.equal(lesson.lessonTitle, 'Alpha and Beta');
  assert.equal(lesson.scenes.length, 2);
  assert.deepEqual(lesson.scenes.map((s) => s.title), ['Alpha', 'Beta']);
  assert.deepEqual(lesson.scenes.map((s) => s.sceneId), ['sc_01', 'sc_02']);
});

test('second chance: scenes lost to a flaky provider window are retried and recovered IN ORDER; real contract failures stay dropped', async () => {
  const attempts = {};
  const lesson = await generateLessonFromText(TEXT, {
    agents: {
      routeDomain: async () => ({ domain: 'general', usage: null }),
      designPedagogy: async ({ sourcePack }) => ({
        lessonTitle: 'Flaky Window',
        scenes: ['One', 'Two', 'Three'].map((title) => ({
          title, pedagogicalRole: 'intuition', directive: 'x', focusChunkIds: [sourcePack.chunks[0].id],
        })),
        usage: null,
      }),
      generateScene: async (focused, { sceneId }) => {
        attempts[sceneId] = (attempts[sceneId] ?? 0) + 1;
        // sc_02 dies once with a transient abort (recoverable); sc_03 fails its contract (not retried).
        if (sceneId === 'sc_02' && attempts[sceneId] === 1) throw new Error('This operation was aborted');
        if (sceneId === 'sc_03') throw new Error('Board Director failed contract validation after repair');
        return {
          scene: { sceneId, layout: 'teacher_notebook_code', objects: [{ id: 'o1', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'x', sourceRef: { chunkId: focused.chunks[0].id } }], voiceLines: [{ id: 'v1', text: 'Line.', targetObjectId: 'o1' }] },
          timeline: { sceneId, timingSource: 'provisional', actions: [] },
          durationMs: 5000,
          reviewRounds: 0,
        };
      },
    },
  });

  assert.deepEqual(lesson.scenes.map((s) => s.title), ['One', 'Two'], 'aborted scene recovered, in brief order');
  assert.equal(attempts.sc_02, 2, 'transient failure got its second chance');
  assert.equal(attempts.sc_03, 1, 'contract failure was NOT retried');
  assert.equal(lesson.skippedScenes, 1);
  assert.match(lesson.skippedSceneReasons[0].reason, /contract validation/);
});

test('coding material is architected by the Coding Instructor, not the general Teacher', async () => {
  const planners = [];
  const fakeScene = async (_focused, { sceneId }) => ({
    scene: { sceneId, layout: 'teacher_notebook_code', objects: [], voiceLines: [] },
    timeline: { sceneId, timingSource: 'provisional', actions: [] },
    durationMs: 1000,
    reviewRounds: 0,
  });
  const plan = (name) => async ({ sourcePack }) => {
    planners.push(name);
    return {
      lessonTitle: name,
      scenes: [{ title: 'S', pedagogicalRole: 'dry_run', directive: 'd', focusChunkIds: [sourcePack.chunks[0].id] }],
      usage: null,
    };
  };

  const coding = await generateLessonFromText(TEXT, {
    agents: { routeDomain: async () => ({ domain: 'dsa' }), designCodingLesson: plan('instructor'), generateScene: fakeScene },
  });
  assert.equal(coding.lessonTitle, 'instructor');

  await generateLessonFromText(TEXT, {
    agents: { routeDomain: async () => ({ domain: 'ml_ai' }), designPedagogy: plan('teacher'), generateScene: fakeScene },
  });
  assert.deepEqual(planners, ['instructor', 'teacher']);
});
