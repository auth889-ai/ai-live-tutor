// Course-level coverage: every chunk of the SourcePack owned by >=1 lesson — "never skip
// a single word" enforced at the Dean, deterministically.

import assert from 'node:assert/strict';
import test from 'node:test';
import { repairCourseCoverage } from '../../../lib/orchestration/agents/planning/dean.js';

const outline = () => ({
  episodes: [
    { title: 'Ep1', lessons: [
      { id: 'l1', title: 'Star schema and fact tables', focusChunkIds: ['chunk_0001'] },
      { id: 'l2', title: 'Normalization trade-offs', focusChunkIds: ['chunk_0002'] },
    ] },
  ],
});

test('unassigned chunks join vocab-matching lessons; true orphans get deep-dive lessons', () => {
  const sp = { chunks: [
    { id: 'chunk_0001', text: 'fact tables hold measures' },
    { id: 'chunk_0002', text: 'normalization removes redundancy' },
    { id: 'chunk_0003', text: 'the star schema joins fact tables to dimension tables by keys' },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `chunk_zz${i}`, text: `completely unrelated appendix prose about zebra migration ${i}` })),
  ] };
  const o = outline();
  repairCourseCoverage(o, sp);
  const l1 = o.episodes[0].lessons[0];
  assert.ok(l1.focusChunkIds.includes('chunk_0003'), 'vocab match joins the schema lesson');
  const deepDives = o.episodes[0].lessons.filter((l) => l.title.startsWith('Deep Dive'));
  assert.equal(deepDives.length, 2); // 8 orphans / 6 per lesson
  const owned = new Set(o.episodes.flatMap((e) => e.lessons.flatMap((l) => l.focusChunkIds)));
  assert.ok(sp.chunks.every((c) => owned.has(c.id)), 'NOTHING from the source is skipped');
});

test('fully covered outlines are untouched', () => {
  const o = outline();
  repairCourseCoverage(o, { chunks: [{ id: 'chunk_0001', text: 'x' }, { id: 'chunk_0002', text: 'y' }] });
  assert.equal(o.episodes[0].lessons.length, 2);
});
