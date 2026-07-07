import assert from 'node:assert/strict';
import test from 'node:test';

import { generateSceneFromSourcePack } from '../../../lib/generation/scene/generate-scene.js';
import { buildTextSourcePack } from '../../../lib/source-pack/build/source-pack.js';

const sourcePack = buildTextSourcePack(
  'Binary search halves a sorted array each step: low, high, mid = (low+high)/2, compare arr[mid] to target.',
);

// Stubs for the heavy agents so the test is deterministic and spends no tokens.
const fakeReview = async () => ({
  objects: [{ id: 'obj_title', objectType: 'scene_title', renderHint: 'text', region: 'notebook_body', lineNumber: 1, content: 'Dry Run', sourceRef: { chunkId: sourcePack.chunks[0].id } }],
  transcript: [],
  usages: [],
  rounds: 0,
});
const fakeVoice = async ({ objects }) => ({
  voiceLines: objects.map((o, i) => ({ id: `v_${i}`, text: `narrate ${o.id}`, targetObjectId: o.id })),
  usage: null,
});
const fakeTrace = async () => ({
  trace: {
    language: 'python',
    code: 'def bs(a,t):\n  lo,hi=0,len(a)-1\n  while lo<=hi:\n    mid=(lo+hi)//2',
    views: { array: { values: [1, 3, 5, 7, 9, 11, 13] } },
    steps: [
      { line: 4, explanation: 'mid=3, arr[3]=7 < 11, go right', array: { current: 3, pointers: { lo: 0, mid: 3, hi: 6 } } },
      { line: 4, explanation: 'mid=5, arr[5]=11 found', array: { current: 5, pointers: { lo: 4, mid: 5, hi: 6 } } },
    ],
  },
  usage: null,
});

test('a dry_run scene attaches an ExecutionTrace as an "algorithm" object', async () => {
  const scene = await generateSceneFromSourcePack(sourcePack, {
    sceneId: 'sc_1',
    brief: { title: 'Dry Run', pedagogicalRole: 'dry_run', directive: 'dry run binary search' },
    agents: { runGroundingReview: fakeReview, writeVoice: fakeVoice, traceExecution: fakeTrace },
  });
  const algo = scene.scene.objects.find((o) => o.renderHint === 'algorithm');
  assert.ok(algo, 'an algorithm object was attached');
  assert.equal(algo.content.steps.length, 2);
});

test('narration is generated FROM the trace steps — words guaranteed to match the animation', async () => {
  const scene = await generateSceneFromSourcePack(sourcePack, {
    sceneId: 'sc_1',
    brief: { title: 'Dry Run', pedagogicalRole: 'dry_run', directive: 'dry run binary search' },
    agents: { runGroundingReview: fakeReview, writeVoice: fakeVoice, traceExecution: fakeTrace },
  });
  const algo = scene.scene.objects.find((o) => o.renderHint === 'algorithm');
  const algoLines = scene.scene.voiceLines.filter((v) => v.targetObjectId === algo.id);
  assert.equal(algoLines.length, 2); // one line per trace step
  assert.ok(algoLines.every((v, i) => v.traceStep === i)); // tagged in order
  // the spoken text IS the step's explanation -> cannot drift
  assert.ok(algoLines.every((v) => v.text === algo.content.steps[v.traceStep].explanation));
});

test('a non-dry_run scene attaches no algorithm object (tracer not called)', async () => {
  let traced = false;
  const scene = await generateSceneFromSourcePack(sourcePack, {
    sceneId: 'sc_1',
    brief: { title: 'Intuition', pedagogicalRole: 'intuition', directive: 'explain' },
    agents: { runGroundingReview: fakeReview, writeVoice: fakeVoice, traceExecution: async () => { traced = true; return null; } },
  });
  assert.ok(!scene.scene.objects.some((o) => o.renderHint === 'algorithm'));
  assert.equal(traced, false);
});
