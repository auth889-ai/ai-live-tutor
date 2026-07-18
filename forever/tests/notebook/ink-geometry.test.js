import assert from 'node:assert/strict';
import test from 'node:test';

import { W, H, lassoContains, itemInLasso, selectionBounds, moveItem, scaleItem, rotateItem } from '../../lib/notebook/ink-geometry.js';

// A lasso polygon: the square (0.2,0.2)-(0.6,0.6), drawn as 4 corners.
const SQUARE = [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6], [0.2, 0.6]];

// --- lassoContains: LassoSelector::contains (Selector.cpp:230), even-odd ray casting ---

test('a point inside the lasso polygon is contained, one outside is not', () => {
  assert.equal(lassoContains(SQUARE, 0.4, 0.4), true);
  assert.equal(lassoContains(SQUARE, 0.7, 0.4), false);
  assert.equal(lassoContains(SQUARE, 0.4, 0.1), false);
});

test('a degenerate lasso of two points contains nothing (their <=2 guard)', () => {
  assert.equal(lassoContains([[0.1, 0.1], [0.5, 0.5]], 0.3, 0.3), false);
});

test('even-odd rule: a point inside the notch of a concave lasso is outside', () => {
  // U-shape: the gap between the two prongs is NOT selected
  const u = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.6, 0.9], [0.6, 0.3], [0.4, 0.3], [0.4, 0.9], [0.1, 0.9]];
  assert.equal(lassoContains(u, 0.5, 0.7), false); // in the notch
  assert.equal(lassoContains(u, 0.2, 0.7), true);  // in the left prong
});

// --- itemInLasso: Stroke::isInSelection (Stroke.cpp:235) — EVERY point must be inside ---

test('a stroke is selected only when all of its points fall inside the lasso', () => {
  const inside = { kind: 'stroke', points: [0.3, 0.3, 0.4, 0.4, 0.5, 0.5], width: 3 };
  const partly = { kind: 'stroke', points: [0.3, 0.3, 0.4, 0.4, 0.7, 0.7], width: 3 };
  assert.equal(itemInLasso(inside, SQUARE), true);
  assert.equal(itemInLasso(partly, SQUARE), false);
});

test('shapes select by both endpoints, text by its anchor', () => {
  assert.equal(itemInLasso({ kind: 'shape', shape: 'rect', x1: 0.25, y1: 0.25, x2: 0.55, y2: 0.55, width: 2 }, SQUARE), true);
  assert.equal(itemInLasso({ kind: 'shape', shape: 'line', x1: 0.25, y1: 0.25, x2: 0.65, y2: 0.55, width: 2 }, SQUARE), false);
  assert.equal(itemInLasso({ kind: 'text', x: 0.3, y: 0.3, text: 'hi' }, SQUARE), true);
});

// --- selectionBounds ---

test('selection bounds wrap every control point of every selected item', () => {
  const b = selectionBounds([
    { kind: 'stroke', points: [0.3, 0.4, 0.5, 0.2], width: 3 },
    { kind: 'text', x: 0.6, y: 0.5, text: 'x' },
  ]);
  assert.deepEqual([b.x, b.y], [0.3, 0.2]);
  assert.ok(Math.abs(b.w - 0.3) < 1e-12 && Math.abs(b.h - 0.3) < 1e-12);
});

// --- moveItem / scaleItem: Element::scale(x0, y0, fx, fy, ...) (Element.h:58) ---

test('moving translates every point; scaling is anchored like Element::scale', () => {
  const moved = moveItem({ kind: 'stroke', points: [0.3, 0.3, 0.5, 0.5], width: 3 }, 0.1, -0.1);
  [0.4, 0.2, 0.6, 0.4].forEach((v, i) => assert.ok(Math.abs(moved.points[i] - v) < 1e-12));
  // scale x2 about anchor (0.2, 0.2): 0.3 -> 0.2 + 0.1*2 = 0.4
  const scaled = scaleItem({ kind: 'stroke', points: [0.3, 0.3], width: 4 }, 0.2, 0.2, 2, 2);
  scaled.points.forEach((v) => assert.ok(Math.abs(v - 0.4) < 1e-12));
  // stroke width follows fz = sqrt(fx*fy), Stroke::scale's rule
  assert.equal(scaled.width, 8);
});

test('scaling text resizes its font by the same fz factor', () => {
  const t = scaleItem({ kind: 'text', x: 0.4, y: 0.4, text: 'k', size: 20 }, 0.4, 0.4, 2, 2);
  assert.equal(t.size, 40);
});

// --- rotateItem: Element::rotate(x0, y0, th) (Element.h:59), about the selection centre ---

test('rotation happens in pixel space: 90° sends a rightward offset straight down, undistorted', () => {
  // point 100px right of centre (0.5, 0.5)
  const it = { kind: 'stroke', points: [0.5 + 100 / W, 0.5], width: 3 };
  const r = rotateItem(it, 0.5, 0.5, Math.PI / 2);
  assert.ok(Math.abs(r.points[0] - 0.5) < 1e-9, 'x returns to centre');
  assert.ok(Math.abs(r.points[1] - (0.5 + 100 / H)) < 1e-9, '100px right becomes 100px down');
});

test('rect and text carry rotation in `rot` and their centre orbits the selection centre', () => {
  const rect = { kind: 'shape', shape: 'rect', x1: 0.5, y1: 0.5, x2: 0.6, y2: 0.6, width: 2 };
  const r = rotateItem(rect, 0.5, 0.5, Math.PI / 4);
  assert.ok(Math.abs(r.rot - Math.PI / 4) < 1e-12);
  // the rect stays the same SIZE (only its centre moved + rot set)
  assert.ok(Math.abs((r.x2 - r.x1) - 0.1) < 1e-12 && Math.abs((r.y2 - r.y1) - 0.1) < 1e-12);
  const t = rotateItem({ kind: 'text', x: 0.5, y: 0.5, text: 'k', rot: 0.1 }, 0.4, 0.4, 0.2);
  assert.ok(Math.abs(t.rot - 0.3) < 1e-12, 'rotation accumulates');
});

test('a full 360° rotation brings every point home (inverse sanity)', () => {
  const it = { kind: 'stroke', points: [0.31, 0.62, 0.77, 0.18], width: 3 };
  let r = it;
  for (let k = 0; k < 4; k += 1) r = rotateItem(r, 0.5, 0.5, Math.PI / 2);
  r.points.forEach((v, i) => assert.ok(Math.abs(v - it.points[i]) < 1e-9));
});
