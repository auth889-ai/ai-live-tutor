// Ask-the-Tutor answer SCENE (no tokens): retrieval is pure; the scene path runs the REAL
// generateSceneFromSourcePack plumbing with the society stubbed — proving the question
// becomes a brief, the brief becomes a reviewed board, narration binds, and a playable
// scene comes back. DISABLE_TTS=1 keeps it silent/free (voicing is covered by tts tests).

import assert from 'node:assert/strict';
import test from 'node:test';
import { answerWithScene, retrieveQuestionChunks } from '../../../lib/orchestration/agents/tutor/answer-scene.js';

process.env.DISABLE_TTS = '1';

const chunks = [
  { id: 'chunk_0001', text: 'A star schema has one fact table and several dimension tables joined by foreign keys.' },
  { id: 'chunk_0002', text: 'Normalization removes redundancy by splitting data across tables.' },
  { id: 'chunk_0003', text: 'Indexes speed up lookups at the cost of slower writes.' },
  { id: 'chunk_0004', text: 'OLTP systems favor normalized schemas; OLAP favors denormalized ones.' },
  { id: 'chunk_0005', text: 'Completely unrelated text about cooking pasta al dente.' },
];

test('retrieveQuestionChunks ranks by shared words and keeps a groundable minimum', () => {
  const top = retrieveQuestionChunks('Why does normalization remove redundancy in tables?', chunks);
  assert.equal(top[0].id, 'chunk_0002'); // best lexical match first
  assert.ok(top.length >= 4); // auditor always gets material
  // A question matching nothing still returns a groundable floor, never an empty set.
  assert.ok(retrieveQuestionChunks('zzz qqq', chunks).length >= 4);
});

test('a question becomes a reviewed, narrated, playable scene through the real pipeline', async () => {
  const lesson = { lessonTitle: 'DB Design', sourcePackId: 'sp_asktest0001' };
  const seen = { briefDirective: null };
  const { scene } = await answerWithScene({
    lesson,
    question: 'What exactly joins the fact table to a dimension table?',
    sourcePack: null, // no course pack -> rebuilt from chunks (the fallback path)
    chunks,
    agents: {
      runGroundingReview: async ({ brief }) => {
        seen.briefDirective = brief.directive;
        return {
          objects: [{ id: 'obj_a', objectType: 'concept', renderHint: 'text', region: 'notebook_area', content: 'FK joins fact to dimension', sourceRef: 'chunk_0001' }],
          transcript: [], usages: [], rounds: 1,
        };
      },
      writeVoice: async ({ objects }) => ({
        voiceLines: [{ id: 'vl_1', text: 'The foreign key is the bridge.', targetObjectId: objects[0].id }],
        usage: null,
      }),
    },
  });
  assert.match(seen.briefDirective, /What exactly joins the fact table/); // the question drives the brief
  assert.match(seen.briefDirective, /Stay strictly inside what the source chunks support/);
  assert.equal(scene.pedagogicalRole, 'qa');
  assert.match(scene.title, /Your question:/);
  assert.equal(scene.objects.length, 1);
  assert.equal(scene.voiceLines[0].targetObjectId, 'obj_a'); // narration bound to the board
  assert.equal(scene.audioUrl, undefined); // DISABLE_TTS -> silent scene, manual clock
});

test('a lesson with no source material refuses honestly', async () => {
  await assert.rejects(
    () => answerWithScene({ lesson: { lessonTitle: 'X', sourcePackId: 'sp_x' }, question: 'anything?', sourcePack: null, chunks: [] }),
    /no source material/,
  );
});
