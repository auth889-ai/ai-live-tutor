import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCourseOutline } from '../../../lib/course-series/outline/course-outline.js';

function validCourseOutline() {
  return {
    id: 'course_001',
    title: 'Machine Learning Regression Course',
    audience: 'beginner Python students',
    sourcePackId: 'sp_001',
    episodes: [
      {
        id: 'ep_001',
        title: 'Polynomial Regression',
        objective: 'Explain why linear regression fails on curved data and how polynomial features fix it.',
        estimatedMinutes: 45,
        quizQuestionCount: 5,
        lessons: [
          {
            id: 'ls_001',
            title: 'Why straight lines fail',
            lessonType: 'concept',
            estimatedMinutes: 6,
            scenes: [
              { id: 'sc_001', title: 'The curved salary data', estimatedSeconds: 150, sourceChunkIds: ['chunk_0001'] },
              { id: 'sc_002', title: 'Underfitting visualized', estimatedSeconds: 180, sourceChunkIds: ['chunk_0002'] },
            ],
          },
          {
            id: 'ls_002',
            title: 'Step 1 - Building the polynomial model',
            lessonType: 'build',
            estimatedMinutes: 8,
            scenes: [
              { id: 'sc_003', title: 'Adding squared features', estimatedSeconds: 200, sourceChunkIds: ['chunk_0002'] },
              { id: 'sc_004', title: 'Fitting and predicting', estimatedSeconds: 240, sourceChunkIds: ['chunk_0003'] },
            ],
          },
          {
            id: 'ls_003',
            title: 'Visualizing the fitted curve',
            lessonType: 'see_it',
            estimatedMinutes: 5,
            scenes: [
              { id: 'sc_005', title: 'Real vs predicted plot', estimatedSeconds: 240, sourceChunkIds: ['chunk_0003'] },
            ],
          },
        ],
      },
    ],
  };
}

test('a three-tier Udemy-calibrated outline passes', () => {
  validateCourseOutline(validCourseOutline());
});

test('episode duration must match a real course section (30-90 minutes)', () => {
  const outline = validCourseOutline();
  outline.episodes[0].estimatedMinutes = 10;
  assert.throws(() => validateCourseOutline(outline), /30-90 minutes/);
});

test('an episode must open with a concept lesson before any practice', () => {
  const outline = validCourseOutline();
  outline.episodes[0].lessons[0].lessonType = 'build';
  assert.throws(() => validateCourseOutline(outline), /must open with a concept lesson/);
});

test('an episode must close with a quiz of 3-8 questions', () => {
  const outline = validCourseOutline();
  outline.episodes[0].quizQuestionCount = 0;
  assert.throws(() => validateCourseOutline(outline), /quiz of 3-8 questions/);
});

test('a lesson beyond 12 minutes requires a stated justification', () => {
  const outline = validCourseOutline();
  outline.episodes[0].lessons[1].estimatedMinutes = 15;
  assert.throws(() => validateCourseOutline(outline), /longFormJustification/);
});

test('scenes must reference source chunks', () => {
  const outline = validCourseOutline();
  outline.episodes[0].lessons[0].scenes[0].sourceChunkIds = [];
  assert.throws(() => validateCourseOutline(outline), /reference source chunks/);
});

test('scene durations must stay inside the lesson budget', () => {
  const outline = validCourseOutline();
  outline.episodes[0].lessons[2].scenes[0].estimatedSeconds = 300;
  outline.episodes[0].lessons[2].scenes.push({
    id: 'sc_006',
    title: 'Overflow scene',
    estimatedSeconds: 300,
    sourceChunkIds: ['chunk_0003'],
  });
  assert.throws(() => validateCourseOutline(outline), /exceed the lesson budget/);
});
