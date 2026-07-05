import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCourseOutline } from '../../lib/course-series/course-outline.js';

function validCourseOutline() {
  return {
    id: 'course_001',
    title: 'Machine Learning Regression Course',
    audience: 'beginner Python students',
    sourcePackId: 'sp_001',
    episodes: [
      {
        id: 'ep_001',
        title: 'Understanding Polynomial Regression',
        objective: 'Explain why linear regression can fail on curved data.',
        estimatedMinutes: 6,
        scenes: [
          {
            id: 'sc_001',
            title: 'Why straight lines fail',
            kind: 'motivate',
            objective: 'Show the problem visually.',
            estimatedSeconds: 90,
            sourceChunkIds: ['chunk_001'],
          },
          {
            id: 'sc_002',
            title: 'Polynomial feature idea',
            kind: 'explain',
            objective: 'Explain x squared and x cubed features.',
            estimatedSeconds: 120,
            sourceChunkIds: ['chunk_002'],
          },
          {
            id: 'sc_003',
            title: 'Quick checkpoint',
            kind: 'quiz',
            objective: 'Check the learner understands why features changed.',
            estimatedSeconds: 60,
            sourceChunkIds: ['chunk_002'],
          },
        ],
      },
    ],
  };
}

test('valid Udemy-style course outline passes', () => {
  validateCourseOutline(validCourseOutline());
});

test('episode duration must be a real course lesson size', () => {
  const outline = validCourseOutline();
  outline.episodes[0].estimatedMinutes = 1;
  assert.throws(() => validateCourseOutline(outline), /5-30 minutes/);
});

test('scene must reference source chunks', () => {
  const outline = validCourseOutline();
  outline.episodes[0].scenes[0].sourceChunkIds = [];
  assert.throws(() => validateCourseOutline(outline), /reference source chunks/);
});

