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
