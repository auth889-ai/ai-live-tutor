import assert from 'node:assert/strict';
import test from 'node:test';

import { answerQuestion } from '../../../lib/orchestration/agents/tutor/answer-question.js';

const lesson = {
  lessonTitle: 'Database Denormalization',
  domain: 'architecture',
  scenes: [
    { sceneId: 'sc_01', title: 'The Join Explosion Problem', objects: [{ renderHint: 'text', content: 'Six tables, five JOINs' }], voiceLines: [{ text: 'Every report joins six tables.' }] },
    { sceneId: 'sc_02', title: 'Star Schema', objects: [], voiceLines: [] },
  ],
};

test('the tutor answers in the LESSON\'S register, sees the current scene, and returns dual outputs (Aegis pattern)', async () => {
  let sent = null;
  const { answer, grounding, followUp } = await answerQuestion({
    lesson,
    sceneId: 'sc_01',
    question: 'Why are JOINs slow here?',
    chunks: [{ text: 'The report query joins Sale, Product, Category…' }],
    call: async ({ system, user, schema }) => {
      sent = { system, user: JSON.parse(user), schema };
      return { json: { answer: 'Because each JOIN multiplies row lookups…', grounding: 'current scene board + chunk 1', followUp: 'What happens with a 7th table?' }, usage: null };
    },
  });

  assert.match(sent.system, /architecture Teacher/); // specialist register, not generic
  assert.equal(sent.user.currentScene.title, 'The Join Explosion Problem');
  assert.equal(sent.user.sourceChunks.length, 1);
  assert.ok(sent.schema); // zod-enforced structured output (never a bare call)
  assert.match(answer, /JOIN/);
  assert.match(grounding, /scene|chunk/);
  assert.match(followUp, /7th table/);
});
