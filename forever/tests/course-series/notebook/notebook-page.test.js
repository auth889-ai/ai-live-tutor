import assert from 'node:assert/strict';
import test from 'node:test';

import { validateNotebookPage } from '../../../lib/course-series/notebook/notebook-page.js';

const objects = [{ id: 'obj_rules' }, { id: 'obj_code' }];

function validPage() {
  return {
    id: 'np_001',
    sceneId: 'sc_001',
    title: 'Nested Loops in Patterns',
    sections: [
      { objectId: 'obj_rules', renderHint: 'list', content: { items: ['Outer loop controls rows'] } },
      { objectId: 'obj_code', renderHint: 'code', content: 'for (int i = 1; i <= 4; i++) { ... }' },
    ],
    keyTakeaways: ['The outer loop counts rows; the inner loop counts columns.'],
  };
}

test('a notebook page compiled from board objects passes', () => {
  validateNotebookPage(validPage(), objects);
});

test('a section referencing a missing board object is rejected — notebook and lesson may never drift', () => {
  const page = validPage();
  page.sections[0].objectId = 'obj_ghost';
  assert.throws(() => validateNotebookPage(page, objects), /missing board object/);
});

test('a notebook page without key takeaways is rejected', () => {
  const page = validPage();
  page.keyTakeaways = [];
  assert.throws(() => validateNotebookPage(page, objects), /keyTakeaways/);
});
