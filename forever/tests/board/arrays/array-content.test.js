import assert from 'node:assert/strict';
import test from 'node:test';

import { validateArrayContent } from '../../../lib/board/arrays/array-content.js';
import { validateDiagramContent } from '../../../lib/board/diagrams/diagram-content.js';

test('accepts an array with a binary-search dry-run trace', () => {
  const content = validateArrayContent({
    diagramType: 'array',
    values: ['1', '3', '5', '7', '9', '11', '13'],
    trace: [
      { note: 'mid=3 -> 7, target 11 bigger, go right', current: 3, pointers: { low: 0, mid: 3, high: 6 } },
      { note: 'mid=5 -> 11, found', current: 5, eliminated: [0, 1, 2, 3], pointers: { low: 4, mid: 5, high: 6 } },
    ],
  });
  assert.equal(content.trace.length, 2);
});

test('array flows through the diagram-content validator by diagramType', () => {
  validateDiagramContent({ diagramType: 'array', values: ['4', '2', '7'] });
});

test('rejects an array with no values', () => {
  assert.throws(() => validateArrayContent({ diagramType: 'array', values: [] }), /non-empty values/);
});

test('rejects a trace step without a note', () => {
  assert.throws(
    () => validateArrayContent({ diagramType: 'array', values: ['1', '2'], trace: [{ current: 0 }] }),
    /trace step 0 needs a note/,
  );
});

test('rejects out-of-bounds current, pointer, or eliminated indices', () => {
  const base = { diagramType: 'array', values: ['1', '2', '3'] };
  assert.throws(() => validateArrayContent({ ...base, trace: [{ note: 'x', current: 9 }] }), /current index is out of bounds/);
  assert.throws(() => validateArrayContent({ ...base, trace: [{ note: 'x', pointers: { mid: 9 } }] }), /pointer index out of bounds/);
  assert.throws(() => validateArrayContent({ ...base, trace: [{ note: 'x', eliminated: [9] }] }), /eliminated index out of bounds/);
});

test('rejects an empty trace array', () => {
  assert.throws(() => validateArrayContent({ diagramType: 'array', values: ['1'], trace: [] }), /trace must be a non-empty array/);
});
