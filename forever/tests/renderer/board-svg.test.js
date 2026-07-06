import assert from 'node:assert/strict';
import test from 'node:test';

import { renderBoardSvg, seedFrom } from '../../packages/@forever/renderer/src/board-svg.js';
import { boardStateAt } from '../../lib/playback/engine/action-engine.js';

const scene = {
  layout: 'teacher_notebook_code',
  objects: [
    {
      id: 'obj_title',
      objectType: 'lesson_title',
      renderHint: 'text',
      region: 'notebook_area',
      lineNumber: 0,
      content: 'Nested Loops in Patterns',
      sourceRef: { chunkId: 'chunk_0001' },
    },
    {
      id: 'obj_rules',
      objectType: 'nested_loop_rules',
      renderHint: 'list',
      region: 'notebook_area',
      lineNumber: 2,
      content: { items: ['Outer loop controls rows', 'Inner loop controls columns'] },
      sourceRef: { chunkId: 'chunk_0001' },
    },
    {
      id: 'obj_code',
      objectType: 'worked_code_example',
      renderHint: 'code',
      region: 'code_panel',
      content: 'for (int i = 1; i <= 4; i++) {\n  cout << "*";\n}',
      output: '* * * *',
      sourceRef: { chunkId: 'chunk_0001' },
    },
  ],
};

const timeline = {
  sceneId: 'sc_001',
  timingSource: 'provisional',
  actions: [
    { id: 'a1', kind: 'point', startMs: 0, durationMs: 500, targetObjectId: 'obj_title' },
    { id: 'a2', kind: 'write', startMs: 0, durationMs: 1000, targetObjectId: 'obj_title' },
    { id: 'a3', kind: 'write', startMs: 1500, durationMs: 2000, targetObjectId: 'obj_rules' },
    { id: 'a4', kind: 'highlight', startMs: 4000, durationMs: 1000, targetObjectId: 'obj_rules' },
    { id: 'a5', kind: 'reveal_code', startMs: 5000, durationMs: 900, targetObjectId: 'obj_code' },
    { id: 'a6', kind: 'show_output', startMs: 6500, durationMs: 300, targetObjectId: 'obj_code' },
  ],
};

function svgAt(tMs) {
  return renderBoardSvg(scene, boardStateAt(timeline, tMs));
}

test('an empty clock renders an empty paper board', () => {
  const svg = renderBoardSvg(scene, boardStateAt({ ...timeline, actions: [{ id: 'a0', kind: 'point', startMs: 0, durationMs: 100, targetObjectId: 'obj_title' }] }, 0));
  assert.ok(svg.includes('<svg'));
  assert.ok(!svg.includes('Nested Loops'));
});

test('half-written text reveals roughly half the words', () => {
  const svg = svgAt(500); // 50% through a 4-word title
  assert.ok(svg.includes('Nested Loops'));
  assert.ok(!svg.includes('Patterns'));
});

test('completed writing shows everything, with a rough underline for titles', () => {
  const svg = svgAt(1200);
  assert.ok(svg.includes('Nested Loops in Patterns'));
  assert.ok(svg.includes('<path d="M')); // seeded rough.js underline strokes
});

test('list items render as bullet lines in the region', () => {
  const svg = svgAt(4000);
  assert.ok(svg.includes('• Outer loop controls rows'));
  assert.ok(svg.includes('• Inner loop controls columns'));
});

test('highlight draws a chip behind the highlighted object only while active', () => {
  assert.ok(svgAt(4200).includes('data-highlight="obj_rules"'));
  assert.ok(!svgAt(5500).includes('data-highlight="obj_rules"'));
});

test('the pointer rests on its last target', () => {
  assert.ok(svgAt(4000).includes('data-pointer="obj_title"'));
});

test('code reveals line by line and real output appears after show_output', () => {
  const mid = svgAt(5300); // 1 of 3 code lines
  assert.ok(mid.includes('for (int i = 1'));
  assert.ok(!mid.includes('* * * *'));
  const done = svgAt(7000);
  assert.ok(done.includes('* * * *'));
});

test('rendering is fully deterministic — same time, identical SVG string', () => {
  assert.equal(svgAt(4321), svgAt(4321));
});

test('unsupported render hints fail loudly instead of drawing blanks', () => {
  const badScene = { ...scene, objects: [{ ...scene.objects[0], renderHint: 'math' }] };
  assert.throws(() => renderBoardSvg(badScene, boardStateAt(timeline, 1200)), /does not support renderHint/);
});

test('seeds derive stably from object ids', () => {
  assert.equal(seedFrom('obj_title'), seedFrom('obj_title'));
  assert.notEqual(seedFrom('obj_title'), seedFrom('obj_rules'));
});

test('renders a flowchart diagram as rough boxes with arrows', () => {
  const diagramScene = {
    layout: 'teacher_notebook',
    objects: [{
      id: 'obj_flow', objectType: 'migration_workflow', renderHint: 'diagram',
      region: 'notebook_body', lineNumber: 0,
      content: { diagramType: 'flowchart', steps: ['Create', 'Write', 'Run', 'Commit'] },
      sourceRef: { chunkId: 'chunk_0001' },
    }],
    voiceLines: [],
    timeline: { sceneId: 's', timingSource: 'provisional', actions: [
      { id: 'a1', kind: 'write', startMs: 0, durationMs: 1000, targetObjectId: 'obj_flow' },
    ] },
  };
  const svg = renderBoardSvg(diagramScene, boardStateAt(diagramScene.timeline, 1000));
  assert.ok(svg.includes('Create') && svg.includes('Commit'));
  assert.ok(svg.includes('marker-end'), 'flowchart has arrows');
});
