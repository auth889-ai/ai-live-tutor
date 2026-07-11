import assert from 'node:assert/strict';
import test from 'node:test';

import { coerceBoardObjects } from '../../../lib/orchestration/agents/authoring/board-coercion.js';

test('the measured killer: comparison row arity is padded/trimmed, never dropped', () => {
  // The exact production failure: columns demand 3 values, the model wrote 2.
  const [o] = coerceBoardObjects([{
    id: 'complexity_comparison', renderHint: 'diagram',
    content: { diagramType: 'comparison', columns: ['Brute Force', 'Optimal', 'Why'], rows: [
      { label: 'Time', values: ['O(k^n * n * k^n)', 'O(k^n)'] },
      { label: 'Space', values: ['O(1)', 'O(k^n)', 'visited set', 'EXTRA CELL'] },
    ] },
  }]);
  assert.deepEqual(o.content.rows[0].values, ['O(k^n * n * k^n)', 'O(k^n)', ''], 'short row padded with a visibly empty cell');
  assert.equal(o.content.rows[1].values.length, 3, 'long row trimmed to the columns');
});

test('cell text stuffed under arbitrary keys is GATHERED into values, in order', () => {
  const [o] = coerceBoardObjects([{
    id: 'x', renderHint: 'table',
    content: { columns: ['Naive', 'Overlap'], rows: [
      { label: 'String', naive: '00011011', overlap: '00110' },
    ] },
  }]);
  assert.deepEqual(o.content.rows[0].values, ['00011011', '00110']);
  assert.ok(!('naive' in o.content.rows[0]), 'stray keys are removed after gathering');
});

test('renderHint synonyms map to the legal vocabulary; legal hints untouched', () => {
  const out = coerceBoardObjects([
    { id: 'a', renderHint: 'flowchart', content: {} },
    { id: 'b', renderHint: 'equation', content: {} },
    { id: 'c', renderHint: 'algorithm', content: {} },
  ]);
  assert.equal(out[0].renderHint, 'diagram');
  assert.equal(out[1].renderHint, 'math');
  assert.equal(out[2].renderHint, 'algorithm');
});

test('list items become strings; junk entries and null objects never crash the pass', () => {
  const out = coerceBoardObjects([
    null,
    { id: 'l', renderHint: 'list', content: { items: [1, 'two', { text: 'three' }] } },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].content.items, ['1', 'two', 'three']);
});

test('values as an OBJECT of cells (second production slip) converts to an array in order', () => {
  const [o] = coerceBoardObjects([{
    id: 'x', renderHint: 'table',
    content: { columns: ['Brute', 'Graph', 'Why'], rows: [
      { label: 'Time', values: { brute: 'O(n!)', graph: 'O(E)', why: 'each edge once' } },
    ] },
  }]);
  assert.deepEqual(o.content.rows[0].values, ['O(n!)', 'O(E)', 'each edge once']);
});
