import assert from 'node:assert/strict';
import test from 'node:test';

import { markSpec, ellipsePerimeter, lineLength } from '../../../lib/board/annotations/annotation-geometry.js';

const W = 800; const H = 600;

test('every teaching verb maps to a drawable pixel-space spec with a stroke length for draw-on', () => {
  const bbox = { x: 0.25, y: 0.25, w: 0.5, h: 0.25 };
  const enc = markSpec({ verb: 'encircle', bbox }, W, H);
  assert.equal(enc.kind, 'ellipse');
  assert.equal(Math.round(enc.cx), 400);
  assert.ok(enc.length > 0, 'ellipse carries its perimeter so the pen can draw it');
  const und = markSpec({ verb: 'underline', bbox }, W, H);
  assert.equal(und.kind, 'line');
  assert.equal(Math.round(und.length), 400, 'underline length = bbox pixel width');
  const cross = markSpec({ verb: 'cross_out', bbox }, W, H);
  assert.equal(cross.kind, 'cross');
  assert.ok(cross.points2, 'cross has both strokes');
  const arrow = markSpec({ verb: 'arrow', bbox, text: 'here' }, W, H);
  assert.equal(arrow.kind, 'arrow');
  assert.equal(arrow.text, 'here');
  assert.ok(arrow.length > 0);
  assert.equal(markSpec({ verb: 'highlight', bbox }, W, H).kind, 'rect');
  assert.equal(markSpec({ verb: 'pointer', bbox }, W, H).kind, 'dot');
  assert.equal(markSpec({ verb: 'label', bbox, text: 'axon' }, W, H).text, 'axon');
});

test('a malformed mark is dropped, never guessed (a wrong pointer teaches worse than none)', () => {
  assert.equal(markSpec({ verb: 'encircle', bbox: { x: 'a', y: 0, w: 1, h: 1 } }, W, H), null);
  assert.equal(markSpec({ verb: 'encircle' }, W, H), null);
  assert.equal(markSpec({ verb: 'hologram', bbox: { x: 0, y: 0, w: 1, h: 1 } }, W, H), null);
});

test('geometry helpers are honest math', () => {
  assert.equal(Math.round(ellipsePerimeter(100, 100)), 628, 'circle case = 2πr');
  assert.equal(lineLength([0, 0, 3, 4]), 5, 'pythagoras');
});
