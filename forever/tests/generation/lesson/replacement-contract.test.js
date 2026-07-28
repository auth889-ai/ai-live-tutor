// REPAIR SCENES PASS THE SAME CONTRACT (external audit): a targeted-replacement scene —
// the brand-new brief generate-lesson creates for content lost to failures — walks the
// REAL scene pipeline (generateSceneFromSourcePack -> writeVoice), so the typed teaching
// contract binds it exactly like a first-pass scene. These tests drive the replacement
// pass with the real pipeline (only the model + review loop stubbed via injected deps)
// and prove: (a) a replacement whose narration never declares the contract is REJECTED,
// (b) a contract-honest replacement ships WITH its teachingMoves surviving onto the
// stored lesson scene, and (c) writeVoice received the REAL chunk texts, not an empty
// sourcePack (empty chunks would silence per-chunk coverage and chunk binding).

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTextSourcePack } from '../../../lib/source-pack/build/source-pack.js';
import { generateLessonFromSourcePack } from '../../../lib/generation/lesson/generate-lesson.js';
import { generateSceneFromSourcePack } from '../../../lib/generation/scene/generate-scene.js';
import { writeVoice } from '../../../lib/orchestration/agents/authoring/voice-writer.js';

const TEXT =
  'A binary heap keeps its smallest element at the root of the tree. Insert places the new value at ' +
  'the last leaf and bubbles it upward until the order property holds. Extract removes the root, moves ' +
  'the last leaf to the top, and sinks it downward by swapping with the smaller child.';

// Narration deep enough for the intuition-role floors (8+ lines, 220+ words, 3/5 moves,
// diversity, keyterm coverage) — the contract is the ONLY dial these tests turn.
const GOOD_LINES = [
  { id: 'v1', text: 'A binary heap is a tree that always keeps its smallest element sitting at the root, so the minimum is available the moment you ask for it.', targetObjectId: 'obj_note' },
  { id: 'v2', text: 'For example, suppose we insert the value 3 into a heap whose root currently holds 5; the new entry starts at the last leaf position.', targetObjectId: 'obj_note' },
  { id: 'v3', text: 'Insert places the new value at the last leaf and bubbles it upward, because a child smaller than its parent breaks the order property.', targetObjectId: 'obj_note' },
  { id: 'v4', text: 'That upward bubbling stops exactly when the parent is no longer larger, which means the order property holds again for every level.', targetObjectId: 'obj_note' },
  { id: 'v5', text: 'Extract removes the root, moves the last leaf to the top, and then sinks that entry downward by swapping with the smaller child each step.', targetObjectId: 'obj_note' },
  { id: 'v6', text: 'Pause and predict: after we extract the smallest element, which entry do you expect to find at the root next?', targetObjectId: 'obj_note' },
  { id: 'v7', text: 'A common mistake is swapping with the larger child during the sink, and that tempting shortcut quietly destroys the heap shape below.', targetObjectId: 'obj_note' },
  { id: 'v8', text: 'So the whole structure earns its speed because every operation only walks one path between the root and a leaf, never the entire tree.', targetObjectId: 'obj_note' },
  { id: 'v9', text: 'Notice that the binary shape stays perfectly balanced during insert and extract, and that balance is the reason both operations stay logarithmic in cost.', targetObjectId: 'obj_note' },
  { id: 'v10', text: 'Keep the picture of bubbles rising and stones sinking, and the smallest element resting on top will feel natural rather than memorized.', targetObjectId: 'obj_note' },
];
const GOOD_MOVES = [
  { type: 'definition', voiceLineIds: ['v1'], chunkId: 'chunk_0001' },
  { type: 'concrete_example', voiceLineIds: ['v2'], chunkId: 'chunk_0001' },
  { type: 'mechanism', voiceLineIds: ['v3'], chunkId: 'chunk_0001' },
  { type: 'learner_check', voiceLineIds: ['v6'], chunkId: 'chunk_0001' },
];

// The scene pipeline with ONLY the model-facing agents stubbed: the review loop hands
// back a fixed board, and the Voice Writer runs FOR REAL against a stubbed model chain —
// so every validator (depth, coverage, typed contract) genuinely executes.
function realSceneAgent({ voiceJson, seen }) {
  return (pack, options) => generateSceneFromSourcePack(pack, {
    ...options,
    agents: {
      runGroundingReview: async ({ sceneId, sourcePack }) => ({
        objects: [{ id: 'obj_note', objectType: 'tutor_note', renderHint: 'text', region: 'notebook_area', content: 'Heaps', sourceRef: { chunkId: sourcePack.chunks[0].id } }],
        transcript: [], usages: [], rounds: 1,
      }),
      writeVoice: (args) => writeVoice(args, {
        runAgentChain: async ({ user }) => {
          seen.push(JSON.parse(user));
          return { json: voiceJson(), usage: null };
        },
      }),
    },
  });
}

function lessonAgents({ voiceJson, seen, doomedAttempts }) {
  const sceneAgent = realSceneAgent({ voiceJson, seen });
  return {
    routeDomain: async () => ({ domain: 'general', usage: null }),
    designPedagogy: async ({ sourcePack }) => ({
      lessonTitle: 'Heap Lesson',
      scenes: [{ title: 'Doomed', pedagogicalRole: 'intuition', directive: 'x', focusChunkIds: [sourcePack.chunks[0].id] }],
      usage: null,
    }),
    generateScene: async (pack, options) => {
      if (options.brief.title === 'Doomed') {
        doomedAttempts.count += 1;
        throw new Error('Board Director failed contract validation after repair');
      }
      return sceneAgent(pack, options);
    },
  };
}

test('a targeted-replacement scene that never declares the typed contract is REJECTED by the real pipeline', async () => {
  const seen = [];
  const doomedAttempts = { count: 0 };
  await assert.rejects(
    generateLessonFromSourcePack(buildTextSourcePack(TEXT), {
      agents: lessonAgents({ voiceJson: () => ({ voiceLines: GOOD_LINES }), seen, doomedAttempts }),
    }),
    /Every scene failed to generate/,
  );
  // The doomed original died on pass 1 and its one coverage-rescue retry.
  assert.equal(doomedAttempts.count, 2);
  // The replacement pass DID reach writeVoice — with the REAL chunk, not an empty pack —
  // and failed on the contract, not on missing material.
  assert.ok(seen.length >= 1, 'the replacement scene reached the Voice Writer');
  for (const call of seen) {
    assert.equal(call.sourceChunks.length, 1);
    assert.equal(call.sourceChunks[0].id, 'chunk_0001');
    assert.match(call.sourceChunks[0].text, /binary heap/);
  }
});

test('a contract-honest replacement scene ships, and its teachingMoves survive onto the stored lesson scene', async () => {
  const seen = [];
  const doomedAttempts = { count: 0 };
  const lesson = await generateLessonFromSourcePack(buildTextSourcePack(TEXT), {
    agents: lessonAgents({ voiceJson: () => ({ voiceLines: GOOD_LINES, teachingMoves: GOOD_MOVES }), seen, doomedAttempts }),
  });

  assert.equal(lesson.scenes.length, 1);
  const [scene] = lesson.scenes;
  assert.match(scene.title, /What the Source Also Says/);
  assert.equal(scene.pedagogicalRole, 'intuition');
  assert.equal(scene.voiceLines.length, GOOD_LINES.length);
  // The declared contract is STORED on the flattened lesson scene (auditors read the
  // declaration, not a regex guess) — previously dropped for every lesson-level scene.
  assert.deepEqual(scene.teachingMoves, GOOD_MOVES);
  // The original scene still failed honestly and is recorded as skipped.
  assert.equal(lesson.skippedScenes, 1);
  assert.match(lesson.skippedSceneReasons[0].title, /Doomed/);
});
