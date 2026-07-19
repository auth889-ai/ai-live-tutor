import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseWrongAnswer } from '../../lib/orchestration/agents/tutor/diagnose.js';

test('diagnosis returns the four adaptive fields from the model', async () => {
  const call = async ({ system, user }) => {
    assert.ok(/misconception/.test(system), 'prompt asks for misconception diagnosis');
    assert.ok(/STUDENT'S ANSWER/.test(user), 'the student answer is sent');
    return { json: { misconception: 'divided instead of multiplied', explanation: 'Revenue is price times quantity.', followUp: 'What is 12 x 80?', encouragement: 'Right setup, one slip.' } };
  };
  const r = await diagnoseWrongAnswer({ question: 'revenue at price 12, qty 80?', correctAnswer: 960, studentAnswer: 0.15, concept: 'revenue', domain: 'economics', call });
  assert.equal(r.misconception, 'divided instead of multiplied');
  assert.ok(r.followUp.includes('12'));
  assert.ok(r.encouragement.length > 0);
});

test('the student answer and correct answer both reach the model', async () => {
  let seen = '';
  const call = async ({ user }) => { seen = user; return { json: {} }; };
  await diagnoseWrongAnswer({ question: 'q', correctAnswer: 42, studentAnswer: 7, call });
  assert.ok(seen.includes('42') && seen.includes('7'));
});
