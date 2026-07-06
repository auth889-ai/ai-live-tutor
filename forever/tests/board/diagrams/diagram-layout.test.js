import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutDiagram, DIAGRAM_TYPES } from '../../../lib/board/diagrams/diagram-layout.js';

const region = { x: 40, y: 60, w: 820, h: 300 };

test('flowchart lays out one box per step, connected by arrows, inside the region', () => {
  const shapes = layoutDiagram({ diagramType: 'flowchart', steps: ['Create', 'Write', 'Run', 'Verify', 'Commit'] }, region);
  const boxes = shapes.filter((s) => s.kind === 'box');
  const arrows = shapes.filter((s) => s.kind === 'arrow');
  assert.equal(boxes.length, 5);
  assert.equal(arrows.length, 4); // n-1 connectors
  for (const box of boxes) {
    assert.ok(box.x >= region.x && box.x + box.w <= region.x + region.w + 1, 'box stays in region width');
    assert.equal(box.label.length > 0, true);
  }
});

test('cycle adds a return arrow back to the first step', () => {
  const flow = layoutDiagram({ diagramType: 'flowchart', steps: ['A', 'B', 'C'] }, region).filter((s) => s.kind === 'arrow').length;
  const cyc = layoutDiagram({ diagramType: 'cycle', steps: ['A', 'B', 'C'] }, region).filter((s) => s.kind === 'arrow').length;
  assert.ok(cyc > flow, 'cycle has more arrows (the loop back)');
});

test('tree places the root above its children with connecting arrows', () => {
  const shapes = layoutDiagram(
    { diagramType: 'tree', root: { label: 'Migration', children: [{ label: 'Definition' }, { label: 'Workflow' }, { label: 'Rollback' }] } },
    region,
  );
  const boxes = shapes.filter((s) => s.kind === 'box');
  assert.equal(boxes.length, 4); // root + 3 children
  const root = boxes[0];
  const child = boxes[1];
  assert.ok(child.y > root.y, 'children sit below the root');
});

test('comparison renders column headers and row values', () => {
  const shapes = layoutDiagram(
    { diagramType: 'comparison', columns: ['Manual', 'Migration'], rows: [{ label: 'Repeatable', values: ['No', 'Yes'] }] },
    region,
  );
  const texts = shapes.filter((s) => s.kind === 'text').map((s) => s.text);
  assert.ok(texts.includes('Manual') && texts.includes('Migration') && texts.includes('Yes'));
});

test('layout is deterministic and rejects unknown types / empty data', () => {
  const spec = { diagramType: 'flowchart', steps: ['A', 'B'] };
  assert.deepEqual(layoutDiagram(spec, region), layoutDiagram(spec, region));
  assert.throws(() => layoutDiagram({ diagramType: 'mindmap', steps: [] }, region), /Unknown diagramType/);
  assert.throws(() => layoutDiagram({ diagramType: 'flowchart', steps: [] }, region), /needs steps/);
  assert.ok(DIAGRAM_TYPES.includes('tree'));
});
