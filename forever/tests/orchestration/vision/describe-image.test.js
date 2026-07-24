// parseComponents: the inventory pass's pure half. Components feed BOTH the depth pipeline
// (per-part teaching) and grounding anchors, so malformed model output must die here —
// a bad component that slipped through would become a wrong anchor box.

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseComponents } from '../../../lib/orchestration/agents/vision/describe-image.js';

test('valid components parse to fractional bboxes via the measured 0-1000 convention', () => {
  const components = parseComponents([
    { label: 'fact table', kind: 'box', bbox_2d: [250, 250, 500, 500] },
    { label: 'x axis', kind: 'axis', bbox_2d: [0, 900, 1000, 950] },
  ]);
  assert.equal(components.length, 2);
  assert.deepEqual(components[0].bbox, { x: 0.25, y: 0.25, w: 0.25, h: 0.25 });
  assert.equal(components[1].kind, 'axis');
});

test('malformed entries are dropped, unknown kinds coerce to other, labels are capped', () => {
  const components = parseComponents([
    { label: '', bbox_2d: [0, 0, 100, 100] },            // no label
    { label: 'ghost' },                                    // no bbox
    { label: 'zero', bbox_2d: [10, 10, 10, 300] },         // zero-area
    { label: 'legend', kind: 'hologram', bbox_2d: [0, 0, 100, 100] },
    { label: 'x'.repeat(200), kind: 'box', bbox_2d: [0, 0, 50, 50] },
  ]);
  assert.equal(components.length, 2);
  assert.equal(components[0].kind, 'other');
  assert.equal(components[1].label.length, 80);
});

test('a flood of components is capped, non-arrays return empty', () => {
  const flood = Array.from({ length: 100 }, (_, i) => ({ label: `part ${i}`, kind: 'node', bbox_2d: [i, i, i + 10, i + 10] }));
  assert.equal(parseComponents(flood).length, 24);
  assert.deepEqual(parseComponents(null), []);
  assert.deepEqual(parseComponents('nope'), []);
});
