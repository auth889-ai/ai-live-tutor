import assert from 'node:assert/strict';
import test from 'node:test';

import { validateQuizContent } from '../../../lib/board/quiz/quiz-content.js';

function validQuiz() {
  return {
    question: 'Which loop controls the number of rows?',
    choices: ['The outer loop', 'The inner loop'],
    answerIndex: 0,
    explanation: 'The outer loop runs once per row; the inner loop fills each row.',
  };
}

test('a complete quiz passes', () => {
  validateQuizContent(validQuiz());
});

test('rejects fewer than 2 choices', () => {
  const q = { ...validQuiz(), choices: ['only one'] };
  assert.throws(() => validateQuizContent(q), /at least 2 choices/);
});

test('rejects an answerIndex out of range', () => {
  const q = { ...validQuiz(), answerIndex: 5 };
  assert.throws(() => validateQuizContent(q), /index into choices/);
});

test('rejects a quiz with no explanation (a quiz teaches)', () => {
  const q = { ...validQuiz(), explanation: '' };
  assert.throws(() => validateQuizContent(q), /needs an explanation/);
});
