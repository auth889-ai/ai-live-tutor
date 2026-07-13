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

test('the recap killer: 1-indexed lineNumber is clamped into the region (10 -> 9 in a 10-line area)', () => {
  const out = coerceBoardObjects([
    { id: 'recap_note', renderHint: 'callout', region: 'notebook_area', lineNumber: 10, content: { variant: 'recap', body: 'x' } },
    { id: 'title', renderHint: 'text', region: 'notebook_area', lineNumber: 3, content: 'fine as-is' },
  ], { layout: 'teacher_notebook_code' });
  assert.equal(out[0].lineNumber, 9, 'overflowing line clamped to the last slot');
  assert.equal(out[1].lineNumber, 3, 'in-range line untouched');
});

test('the motivate/intuition killer: an unsourced object in a teaching-device scene becomes a LABELED analogy', () => {
  const brief = { pedagogicalRole: 'motivate' };
  const out = coerceBoardObjects([
    { id: 'hook', renderHint: 'callout', content: { variant: 'analogy', body: 'lockers' } },
    { id: 'fact', renderHint: 'text', content: 'real claim', sourceRef: { chunkId: 'ch_1' } },
  ], { brief });
  assert.equal(out[0].grounding, 'analogy', 'unlabeled analogy gets its honest label, scene survives');
  assert.equal(out[1].grounding, undefined, 'sourced facts stay sourced');
  const [strict] = coerceBoardObjects([{ id: 'claim', renderHint: 'text', content: 'x' }], { brief: { pedagogicalRole: 'explain' } });
  assert.equal(strict.grounding, undefined, 'outside teaching-device roles a missing sourceRef still fails the contract');
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

test('mermaid keyword written AS the diagramType is relabeled to the mermaid shape (live: killed 5/9 scenes)', () => {
  const [chart, structured] = coerceBoardObjects([
    { id: 'c1', objectType: 'diagram', renderHint: 'diagram', region: 'notebook', sourceRef: { chunkId: 'chunk_0001' },
      content: { diagramType: 'xychart', code: 'xychart-beta\n  y-axis "P" [0, 6]\n  line "D" [6, 0]' } },
    // no code -> NOT coerced (nothing safe to relabel); goes to LLM repair instead
    { id: 'c2', objectType: 'diagram', renderHint: 'diagram', region: 'notebook', sourceRef: { chunkId: 'chunk_0001' },
      content: { diagramType: 'xychart', axes: { x: 'Q', y: 'P' } } },
  ]);
  assert.equal(chart.content.diagramType, 'mermaid');
  assert.match(chart.content.code, /^xychart-beta/);
  assert.equal(structured.content.diagramType, 'xychart');
});

test('an unsourced TITLE text object becomes decorative instead of dropping the scene (live: killed 2/9)', () => {
  const [title, fact] = coerceBoardObjects([
    { id: 'title', objectType: 'text', renderHint: 'text', region: 'notebook', content: 'Heat Wave Hits' },
    { id: 'claim_1', objectType: 'text', renderHint: 'text', region: 'notebook', content: 'Demand rose 40%' },
  ], { brief: { pedagogicalRole: 'worked_example' } });
  assert.equal(title.decorative, true);
  assert.equal(fact.decorative, undefined); // real claims still need source proof
});

test('chart axes auto-extend to cover the model_s own data — modest overshoot only (live: [350,0] on a 0-300 axis)', () => {
  const [chart, absurd] = coerceBoardObjects([
    { id: 'ch1', objectType: 'chart', renderHint: 'chart', region: 'notebook', sourceRef: { chunkId: 'chunk_0001' },
      content: { xAxis: { label: 'Q', min: 0, max: 300 }, yAxis: { label: 'P', min: 0, max: 6 },
        series: [{ id: 'd', label: 'Demand', points: [[0, 6], [350, 0]] }] } },
    { id: 'ch2', objectType: 'chart', renderHint: 'chart', region: 'notebook', sourceRef: { chunkId: 'chunk_0001' },
      content: { xAxis: { label: 'Q', min: 0, max: 300 }, yAxis: { label: 'P', min: 0, max: 6 },
        series: [{ id: 'd', label: 'Demand', points: [[0, 6], [90000, 0]] }] } },
  ]);
  assert.equal(chart.content.xAxis.max, 350); // window widened to fit the curve
  assert.equal(chart.content.yAxis.max, 6);   // untouched axis stays
  assert.equal(absurd.content.xAxis.max, 300); // wildly wrong data -> left for repair
});

test('title coercion matches objectType-declared titles too (live: objectType "scene_title" died for a sourceRef)', () => {
  // worked_example is NOT a teaching-device role, so the title path itself must fire.
  const [byType] = coerceBoardObjects([
    { id: 'obj_1', objectType: 'scene_title', renderHint: 'text', region: 'notebook', content: 'The Food Truck Challenge' },
  ], { brief: { pedagogicalRole: 'worked_example' } });
  assert.equal(byType.decorative, true);
  // In a device role the analogy label lands first — either way the scene survives.
  const [inPractice] = coerceBoardObjects([
    { id: 'obj_1', objectType: 'scene_title', renderHint: 'text', region: 'notebook', content: 'Practice time' },
  ], { brief: { pedagogicalRole: 'practice' } });
  assert.ok(inPractice.grounding === 'analogy' || inPractice.decorative === true);
});
