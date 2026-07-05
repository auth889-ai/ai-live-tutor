import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSceneManifest } from '../../../lib/generation/manifest/scene-manifest.js';
import { buildTextSourcePack } from '../../../lib/source-pack/build/source-pack.js';

const sourcePack = buildTextSourcePack(
  'Nested loops print patterns. The outer loop controls the number of rows and the inner loop controls the number of columns in each row.',
);
const chunkId = sourcePack.chunks[0].id;

function validManifest() {
  return {
    sceneId: 'sc_001',
    sourcePackId: sourcePack.id,
    layout: 'teacher_notebook_code',
    objects: [
      {
        id: 'obj_rules',
        objectType: 'nested_loop_rules',
        renderHint: 'list',
        region: 'notebook_area',
        lineNumber: 0,
        content: { items: ['Outer loop -> rows', 'Inner loop -> columns'] },
        sourceRef: { chunkId },
      },
      {
        id: 'obj_code',
        objectType: 'worked_code_example',
        renderHint: 'code',
        region: 'code_panel',
        lineNumber: 0,
        content: 'for (int i = 1; i <= 4; i++) { for (int j = 1; j <= 4; j++) { cout << "*"; } cout << endl; }',
        sourceRef: { chunkId },
      },
    ],
    voiceLines: [
      { id: 'vl_1', text: 'Two rules control every pattern.', targetObjectId: 'obj_rules', sourceRef: { chunkId } },
      { id: 'vl_2', text: 'Watch the loops build the square.', targetObjectId: 'obj_code' },
    ],
    timeline: {
      sceneId: 'sc_001',
      timingSource: 'reconciled',
      audio: { url: 'oss://forever/audio/sc_001.mp3', durationMs: 9000 },
      actions: [
        { id: 'a1', kind: 'point', startMs: 0, durationMs: 800, targetObjectId: 'obj_rules' },
        { id: 'a2', kind: 'speech', startMs: 200, durationMs: 3000, voiceLineId: 'vl_1' },
        { id: 'a3', kind: 'write', startMs: 400, durationMs: 2500, targetObjectId: 'obj_rules' },
        { id: 'a4', kind: 'highlight', startMs: 3300, durationMs: 600, targetObjectId: 'obj_code' },
        { id: 'a5', kind: 'speech', startMs: 3400, durationMs: 2600, voiceLineId: 'vl_2' },
      ],
    },
    quiz: {
      questions: [
        {
          id: 'q1',
          prompt: 'Which loop controls the number of rows?',
          choices: ['The outer loop', 'The inner loop'],
          answerIndex: 0,
          workedAnswer: 'The outer loop runs once per row; each full pass of the inner loop prints one row.',
          sourceRef: { chunkId },
        },
      ],
    },
    notebookPage: {
      id: 'np_001',
      sceneId: 'sc_001',
      title: 'Nested Loops in Patterns',
      sections: [{ objectId: 'obj_rules', renderHint: 'list', content: { items: ['Outer loop -> rows'] } }],
      keyTakeaways: ['Outer loop counts rows, inner loop counts columns.'],
    },
  };
}

test('a complete, reconciled, source-grounded scene manifest passes the storage gate', () => {
  validateSceneManifest(validManifest(), { sourcePack });
});

test('provisional timing cannot be stored — reconcile first', () => {
  const manifest = validManifest();
  manifest.timeline.timingSource = 'provisional';
  delete manifest.timeline.audio;
  assert.throws(() => validateSceneManifest(manifest, { sourcePack }), /provisional timing/);
});

test('provisional timing is allowed on the blackboard before TTS', () => {
  const manifest = validManifest();
  manifest.timeline.timingSource = 'provisional';
  delete manifest.timeline.audio;
  validateSceneManifest(manifest, { sourcePack, requireReconciled: false });
});

test('a board claim citing a chunk missing from the SourcePack is rejected', () => {
  const manifest = validManifest();
  manifest.objects[0].sourceRef = { chunkId: 'chunk_9999' };
  assert.throws(() => validateSceneManifest(manifest, { sourcePack }), /missing chunk/);
});

test('a quiz question without a worked answer is rejected', () => {
  const manifest = validManifest();
  manifest.quiz.questions[0].workedAnswer = '';
  assert.throws(() => validateSceneManifest(manifest, { sourcePack }), /workedAnswer/);
});

test('timeline and manifest must agree on the scene', () => {
  const manifest = validManifest();
  manifest.timeline.sceneId = 'sc_999';
  assert.throws(() => validateSceneManifest(manifest, { sourcePack }), /does not match manifest.sceneId/);
});
