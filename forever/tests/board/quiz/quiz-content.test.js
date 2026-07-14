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

test('descriptive scenario questions: scenario + detailed model answer + rubric required', () => {
  validateQuizContent({
    kind: 'descriptive',
    scenario: 'Your report joins 6 tables and takes 150ms; management wants dashboards under 20ms.',
    question: 'Design the denormalization: what do you copy where, and what new risk appears?',
    modelAnswer: 'Copy product name and category into the sales fact table so the dashboard query reads one table. Queries drop to ~15ms because the JOINs disappear. The new risk is update anomalies: when a product is renamed, every copied row must be updated, so writes get slower and a sync job or trigger is needed.',
    rubricPoints: ['names WHICH columns are copied and where', 'explains WHY reads get faster (JOINs eliminated)', 'names the update-anomaly risk and a mitigation'],
  });
  assert.throws(() => validateQuizContent({ kind: 'descriptive', question: 'q', scenario: 's', modelAnswer: 'too short', rubricPoints: ['a', 'b'] }), /detailed "modelAnswer"/);
  assert.throws(() => validateQuizContent({ kind: 'descriptive', question: 'q', modelAnswer: 'x'.repeat(100), rubricPoints: ['a', 'b'] }), /needs a "scenario"/);
  assert.throws(() => validateQuizContent({ kind: 'descriptive', question: 'q', scenario: 's', modelAnswer: 'x'.repeat(100), rubricPoints: ['only one'] }), /rubricPoints/);
});
