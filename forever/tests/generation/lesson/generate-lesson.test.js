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

test('the society debate transcript survives assembly onto each stored scene (the Audit Trail a judge can see)', async () => {
  const lesson = await generateLessonFromText(TEXT, {
    agents: {
      routeDomain: async () => ({ domain: 'general', usage: null }),
      designPedagogy: async ({ sourcePack }) => ({
        lessonTitle: 'Grounded',
        scenes: [{ title: 'Only', pedagogicalRole: 'intuition', directive: 'x', focusChunkIds: [sourcePack.chunks[0].id] }],
        usage: null,
      }),
      generateScene: async (focused, { sceneId }) => ({
        scene: { sceneId, layout: 'teacher_notebook_code', objects: [{ id: 'o1', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'x', sourceRef: { chunkId: focused.chunks[0].id } }], voiceLines: [] },
        timeline: { sceneId, timingSource: 'provisional', actions: [] },
        durationMs: 5000,
        reviewRounds: 1,
        // What the real review loop returns: proposal -> objection -> verdict.
        transcript: [
          { id: `msg_propose_${sceneId}`, kind: 'proposal', fromRole: 'board_director', sceneId, body: 'Proposed a board of 3 objects.' },
          { id: `msg_verdict_${sceneId}`, kind: 'verdict', fromRole: 'arbiter', sceneId, body: 'Arbiter ruling: 1 objection overruled.', verdict: { decision: 'accept', binding: true } },
        ],
      }),
    },
  });

  const [scene] = lesson.scenes;
  assert.equal(scene.transcript.length, 2, 'the debate transcript is carried onto the stored scene');
  assert.deepEqual(scene.transcript.map((m) => m.kind), ['proposal', 'verdict']);
  assert.equal(scene.transcript.at(-1).fromRole, 'arbiter', 'the binding verdict is preserved for the audit trail');
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

// Long enough to chunk into several pieces — a drop must orphan material the other scenes
// do NOT own, which is the only way to exercise the coverage/replacement ladder.
const MULTI_CHUNK_TEXT = Array.from({ length: 8 }, (_, i) =>
  `Topic number ${i} introduces a distinct principle that the learner must understand before moving on, `
  + 'and it explains the reasoning behind that principle with a concrete worked example drawn from practice.').join(' ');

// HARD RULES MUST NOT STOP GENERATION (external audit 2026-07-28, GPT question #2): the
// contract gates decide what PUBLISHES, never whether the lesson can be built. A scene that
// fails a real teaching rule drops loudly, its orphaned material is regenerated by the
// replacement pass, and the lesson ships with coverage recomputed from what SURVIVED.
// Generation continues; publishing fails closed. Those are two different laws.
test('a hard-rule rejection drops the scene, the replacement pass re-covers its material, and the lesson still ships', async () => {
  const seen = [];
  const lesson = await generateLessonFromText(MULTI_CHUNK_TEXT, {
    agents: {
      routeDomain: async () => ({ domain: 'general', usage: null }),
      designPedagogy: async ({ sourcePack }) => ({
        lessonTitle: 'Rules Do Not Stop The Build',
        // Each scene owns a DIFFERENT chunk, so a drop creates a real coverage hole.
        scenes: sourcePack.chunks.slice(0, 2).map((chunk, i) => ({
          title: ['Alpha', 'Beta'][i],
          pedagogicalRole: 'intuition',
          directive: 'x',
          focusChunkIds: [chunk.id],
        })),
        usage: null,
      }),
      generateScene: async (focused, { sceneId, brief }) => {
        seen.push({ sceneId, title: brief?.title, chunkIds: focused.chunks.map((c) => c.id) });
        // sc_02 is killed by a REAL quality rule (not a flaky provider) — never retried as
        // transient, and the beat rescue does not apply to a plain intuition scene.
        if (sceneId === 'sc_02') {
          throw new Error('Voice Writer failed contract validation after repair: no mechanism move declared');
        }
        return {
          scene: { sceneId, layout: 'teacher_notebook_code', objects: [{ id: 'o1', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'x', sourceRef: { chunkId: focused.chunks[0].id } }], voiceLines: [{ id: 'v1', text: 'Line.', targetObjectId: 'o1' }] },
          timeline: { sceneId, timingSource: 'provisional', actions: [] },
          durationMs: 5000,
          reviewRounds: 0,
        };
      },
    },
  });

  // 1. The lesson SHIPPED — a hard rule never aborts the build.
  assert.ok(lesson.scenes.length >= 2, `the lesson still ships with content: ${lesson.scenes.length} scenes`);
  // 2. The rejection was loud and diagnosable, never silent.
  assert.equal(lesson.skippedScenes, 1);
  assert.match(lesson.skippedSceneReasons[0].reason, /no mechanism move declared/, 'the failing RULE is named in the manifest');
  assert.equal(lesson.skippedSceneReasons[0].title, 'Beta');
  // 3. The replacement pass regenerated the orphaned chunk under a fresh brief.
  const replacement = lesson.scenes.find((s) => /What the Source Also Says/.test(s.title));
  assert.ok(replacement, `the dropped scene's material came back as a replacement scene: ${lesson.scenes.map((s) => s.title).join(', ')}`);
  const orphaned = seen.find((s) => s.sceneId === 'sc_02').chunkIds;
  const replacementRun = seen.find((s) => /What the Source Also Says/.test(s.title ?? ''));
  assert.deepEqual(replacementRun.chunkIds, orphaned, 'the replacement teaches exactly the chunk the rule-failure orphaned');
  // 4. Coverage is recomputed from what SURVIVED — the hole is closed, not merely reported.
  assert.deepEqual(lesson.coverage.lostChunks, [], 'no chunk is left behind after the replacement pass');
  assert.equal(lesson.coverage.survivedChunks, lesson.coverage.plannedChunks);
});

test('a rule failure that repeats through every pass is recorded as an honest hole, still without aborting the lesson', async () => {
  // Same rejection, but the replacement scene fails the rule too. The lesson STILL ships;
  // the uncovered chunk becomes a recorded coverage hole for the gate to fail closed on.
  const lesson = await generateLessonFromText(MULTI_CHUNK_TEXT, {
    agents: {
      routeDomain: async () => ({ domain: 'general', usage: null }),
      designPedagogy: async ({ sourcePack }) => ({
        lessonTitle: 'Honest Hole',
        scenes: sourcePack.chunks.slice(0, 2).map((chunk, i) => ({
          title: ['Alpha', 'Beta'][i], pedagogicalRole: 'intuition', directive: 'x', focusChunkIds: [chunk.id],
        })),
        usage: null,
      }),
      generateScene: async (focused, { sceneId }) => {
        if (sceneId !== 'sc_01') throw new Error('Voice Writer failed contract validation after repair: no mechanism move declared');
        return {
          scene: { sceneId, layout: 'teacher_notebook_code', objects: [{ id: 'o1', objectType: 't', renderHint: 'text', region: 'notebook_area', content: 'x', sourceRef: { chunkId: focused.chunks[0].id } }], voiceLines: [{ id: 'v1', text: 'Line.', targetObjectId: 'o1' }] },
          timeline: { sceneId, timingSource: 'provisional', actions: [] },
          durationMs: 5000,
          reviewRounds: 0,
        };
      },
    },
  });

  assert.equal(lesson.scenes.length, 1, 'the surviving scene still ships');
  assert.ok(lesson.skippedScenes >= 2, 'both the original and its replacement are recorded as dropped');
  assert.equal(lesson.coverage.lostChunks.length, 1, 'the uncovered chunk is reported honestly, not papered over');
  assert.ok(lesson.coverage.lostChunks[0].about.length > 0, 'the hole names WHAT went untaught, for the gate and the UI');
  assert.ok(lesson.coverage.survivedChunks < lesson.coverage.plannedChunks);
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
