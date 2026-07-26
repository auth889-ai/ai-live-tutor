// Post-drop coverage (audit #4): the manifest records what SURVIVED, and holes are loud.

import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSurvivedCoverage } from '../../../lib/generation/lesson/generate-lesson.js';

const briefs = [
  { title: 'A', focusChunkIds: ['chunk_0001', 'chunk_0002'], focusFigureIds: ['fig_001'] },
  { title: 'B', focusChunkIds: ['chunk_0003'], focusFigureIds: ['fig_002'] },
  { title: 'C', focusChunkIds: ['chunk_0002'], focusFigureIds: [] },
];
const sourcePack = { chunks: [{ id: 'chunk_0003', text: 'denormalization trades redundancy for speed' }] };

test('dropped scenes leave recorded holes; surviving overlap keeps chunks covered', () => {
  // scene B dropped (results[1] = null): fig_002 and chunk_0003 are lost; chunk_0002 survives via C
  const coverage = computeSurvivedCoverage(briefs, [{}, null, {}], sourcePack);
  assert.equal(coverage.plannedFigures, 2);
  assert.equal(coverage.survivedFigures, 1);
  assert.deepEqual(coverage.lostFigures, ['fig_002']);
  assert.equal(coverage.lostChunks.length, 1);
  assert.equal(coverage.lostChunks[0].id, 'chunk_0003');
  assert.match(coverage.lostChunks[0].about, /denormalization/);
});

test('no drops -> no holes', () => {
  const coverage = computeSurvivedCoverage(briefs, [{}, {}, {}], sourcePack);
  assert.equal(coverage.lostFigures.length + coverage.lostChunks.length, 0);
});
