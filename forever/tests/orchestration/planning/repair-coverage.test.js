// Coverage guarantee: every source figure and chunk is OWNED by a scene — "explain ALL
// things from the input" as a deterministic repair, not a hope.

import assert from 'node:assert/strict';
import test from 'node:test';
import { repairCoverage } from '../../../lib/orchestration/agents/planning/teacher.js';

const mkScenes = () => ([
  { title: 'Star schema basics', pedagogicalRole: 'intuition', directive: 'teach the star schema fact table with dimensions', focusChunkIds: ['chunk_0001'], focusFigureIds: ['fig_001'] },
  { title: 'Normalization trade-offs', pedagogicalRole: 'visualize', directive: 'normalization vs denormalization costs', focusChunkIds: ['chunk_0002'], focusFigureIds: [] },
  { title: 'Recap', pedagogicalRole: 'recap', directive: 'summarize', focusChunkIds: ['chunk_0001'], focusFigureIds: [] },
]);

test('unassigned figure joins the scene whose story matches its caption', () => {
  const scenes = mkScenes();
  repairCoverage(scenes, {
    figures: [
      { figureId: 'fig_001', caption: 'star schema' },
      { figureId: 'fig_002', caption: 'Normalization levels diagram', whatItShows: 'normalization forms' },
    ],
    chunkIds: new Set(['chunk_0001', 'chunk_0002']),
  });
  assert.ok(scenes[1].focusFigureIds.includes('fig_002'));
  assert.match(scenes[1].directive, /ALSO place and teach/);
  assert.equal(scenes.length, 3); // matched -> no new scene
});

test('homeless figures get capped walkthrough scenes, overflow attaches round-robin', () => {
  const scenes = mkScenes();
  const figures = Array.from({ length: 6 }, (_, i) => ({ figureId: `fig_x${i}`, caption: `unrelated chart ${i} about zebras` }));
  repairCoverage(scenes, { figures, chunkIds: new Set(['chunk_0001']) });
  const walkthroughs = scenes.filter((s) => s.title.startsWith('The Figure, Explained'));
  assert.equal(walkthroughs.length, 3); // MAX_ADDED_FIGURE_SCENES
  assert.ok(walkthroughs.every((s) => s.pedagogicalRole === 'visualize' && s.focusFigureIds.length === 1));
  // the other 3 figures still got owners (round-robin onto content scenes)
  const owned = new Set(scenes.flatMap((s) => s.focusFigureIds));
  assert.ok(figures.every((f) => owned.has(f.figureId)), 'nothing from the document is dropped');
  // walkthrough scenes sit before the recap tail
  assert.ok(scenes.findIndex((s) => s.title.startsWith('The Figure')) < scenes.findIndex((s) => s.pedagogicalRole === 'recap'));
});

test('uncovered chunks fold into the recap', () => {
  const scenes = mkScenes();
  repairCoverage(scenes, { figures: [], chunkIds: new Set(['chunk_0001', 'chunk_0002', 'chunk_0003', 'chunk_0004']) });
  const recap = scenes.find((s) => s.pedagogicalRole === 'recap');
  assert.ok(recap.focusChunkIds.includes('chunk_0003') && recap.focusChunkIds.includes('chunk_0004'));
});
