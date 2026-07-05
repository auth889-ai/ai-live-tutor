import assert from 'node:assert/strict';
import test from 'node:test';

import { LAYOUT_REGIONS, getRegionLinePosition, validateRegionLine } from '../../../lib/board/layout/layout-regions.js';

test('Forever exposes named teaching regions instead of raw agent coordinates', () => {
  assert.ok(LAYOUT_REGIONS.teacher_notebook);
  assert.ok(LAYOUT_REGIONS.teacher_notebook_code);
  assert.ok(LAYOUT_REGIONS.teacher_diagram_source);
});

test('region line validation rejects overflow', () => {
  assert.throws(() => validateRegionLine('teacher_notebook', 'notebook_body', 99), /exceeds maxLines/);
});

test('region line position is computed by renderer contract', () => {
  const position = getRegionLinePosition('teacher_notebook', 'notebook_body', 2);
  assert.equal(position.x, 40);
  assert.equal(position.y, 192);
  assert.equal(position.w, 820);
});

