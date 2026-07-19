import assert from 'node:assert/strict';
import test from 'node:test';

import { generateLessonFromText } from '../../lib/generation/lesson/generate-lesson.js';
import { repairLessonPayload } from '../../lib/generation/gate/lesson-repair.js';

const TEXT =
  'Alpha is the first idea in the topic and explains the basic starting point clearly. ' +
  'Beta is the second idea and builds directly on alpha with a concrete worked example for the learner.';

const MIS_SCENE = {
  sceneId: 'sc_misconception',
  title: 'Not what you think',
  pedagogicalRole: 'misconception',
  layout: 'teacher_notebook_code',
  objects: [{ id: 'misconception_card', objectType: 'misconception card', renderHint: 'callout', region: 'notebook_area', content: { claim: 'x', why_wrong: 'y', correction: 'z' } }],
  voiceLines: [{ id: 'mis_1', text: 'Many believe alpha replaces beta — the worked example shows both are needed.', targetObjectId: 'misconception_card' }],
  timeline: { sceneId: 'sc_misconception', timingSource: 'provisional', actions: [{ id: 'act_mis', kind: 'point', startMs: 0, durationMs: 600, targetObjectId: 'misconception_card' }] },
  durationMs: 8000,
};

const scene = (sceneId, role) => ({
  sceneId,
  title: role,
  pedagogicalRole: role,
  layout: 'teacher_notebook_code',
  objects: [{ id: 'o1', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'alpha explains the basic starting point', sourceRef: { chunkId: 'c1' } }],
  voiceLines: [{ id: 'v1', text: 'What does alpha explain? The basic starting point, clearly.', targetObjectId: 'o1' }],
  timeline: { sceneId, timingSource: 'provisional', actions: [{ id: 'a1', kind: 'point', startMs: 0, durationMs: 500, targetObjectId: 'o1' }] },
  durationMs: 5000,
});

test('self-repair writes the missing misconception scene through the injected chain and the gate improves', async () => {
  const payload = { scenes: ['worked_example', 'checkpoint', 'recap'].map((r, i) => scene(`sc_0${i + 1}`, r)) };
  const calls = [];
  const { before, after, changed } = await repairLessonPayload(payload, {
    sourceText: TEXT,
    domain: 'ml_ai',
    lessonTitle: 'Alpha',
    env: {},
    agents: { runAgentChain: async ({ agent }) => { calls.push(agent); return { json: MIS_SCENE }; } },
    log: () => {},
  });
  assert.ok(before.violations.some((v) => v.rule === 'beat-missing'));
  assert.equal(calls.includes('beat-scene-writer'), true);
  assert.equal(changed, true);
  assert.equal(after.violations.filter((v) => v.rule === 'beat-missing' && /misconception/.test(v.detail)).length, 0);
  assert.equal(payload.scenes.some((s) => s.pedagogicalRole === 'misconception'), true);
});

test('a required-beat scene killed by a NON-transient failure is rescued with one extra attempt', async () => {
  let recapTries = 0;
  const lesson = await generateLessonFromText(TEXT, {
    agents: {
      routeDomain: async () => ({ domain: 'general', usage: null }),
      designPedagogy: async ({ sourcePack }) => ({
        lessonTitle: 'Rescue',
        scenes: [
          { title: 'Intro', pedagogicalRole: 'intuition', directive: 'x', focusChunkIds: [sourcePack.chunks[0].id] },
          { title: 'Recap', pedagogicalRole: 'recap', directive: 'x', focusChunkIds: [sourcePack.chunks[0].id] },
        ],
        usage: null,
      }),
      generateScene: async (focused, { sceneId, brief }) => {
        const title = brief.title;
        if (title === 'Recap') {
          recapTries += 1;
          // an honest quality refusal, NOT a transient provider error
          if (recapTries === 1) throw new Error('could not reach grounded consensus in 3 rounds');
        }
        return {
          scene: { sceneId, title, layout: 'teacher_notebook_code', objects: [{ id: 'o1', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'x', sourceRef: { chunkId: focused.chunks[0].id } }], voiceLines: [] },
          timeline: { sceneId, timingSource: 'provisional', actions: [] },
          durationMs: 5000,
          reviewRounds: 0,
        };
      },
    },
  });
  assert.equal(recapTries, 2);
  assert.equal(lesson.scenes.length, 2);
  assert.equal(lesson.scenes.some((s) => s.pedagogicalRole === 'recap'), true);
});

test('a NON-beat scene killed by a quality refusal stays dropped (no blind retries)', async () => {
  let introTries = 0;
  const lesson = await generateLessonFromText(TEXT, {
    agents: {
      routeDomain: async () => ({ domain: 'general', usage: null }),
      designPedagogy: async ({ sourcePack }) => ({
        lessonTitle: 'No blind retry',
        scenes: [
          { title: 'Intro', pedagogicalRole: 'intuition', directive: 'x', focusChunkIds: [sourcePack.chunks[0].id] },
          { title: 'Close', pedagogicalRole: 'recap', directive: 'x', focusChunkIds: [sourcePack.chunks[0].id] },
        ],
        usage: null,
      }),
      generateScene: async (focused, { sceneId, brief }) => {
        const title = brief.title;
        if (title === 'Intro') {
          introTries += 1;
          throw new Error('could not reach grounded consensus in 3 rounds');
        }
        return {
          scene: { sceneId, title, layout: 'teacher_notebook_code', objects: [{ id: 'o1', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'x', sourceRef: { chunkId: focused.chunks[0].id } }], voiceLines: [] },
          timeline: { sceneId, timingSource: 'provisional', actions: [] },
          durationMs: 5000,
          reviewRounds: 0,
        };
      },
    },
  });
  assert.equal(introTries, 1);
  assert.equal(lesson.skippedScenes, 1);
});
