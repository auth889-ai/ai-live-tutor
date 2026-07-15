import assert from 'node:assert/strict';
import test from 'node:test';

import { imageDimensions, toFractionalBbox } from '../../lib/util/image-size.js';

test('reads PNG dimensions from the IHDR header', () => {
  // Minimal PNG: signature + IHDR chunk declaring 640x480.
  const b = Buffer.alloc(26);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(480, 20);
  assert.deepEqual(imageDimensions(b), { width: 640, height: 480 });
});

test('unparseable bytes return null — the caller degrades honestly, never guesses a scale', () => {
  assert.equal(imageDimensions(Buffer.from([1, 2, 3])), null);
});

test('toFractionalBbox: ABSOLUTE PIXEL boxes normalize by real dimensions (the accuracy fix)', () => {
  // Qwen-VL answers in pixels of a 1000x800 image: a box at the right-middle.
  const box = toFractionalBbox([500, 400, 750, 600], 1000, 800);
  assert.deepEqual(box, { x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
});

test('toFractionalBbox: already-fractional output is accepted as-is (defensive on convention)', () => {
  const box = toFractionalBbox([0.1, 0.2, 0.4, 0.5], 1000, 800);
  assert.ok(Math.abs(box.x - 0.1) < 1e-9 && Math.abs(box.w - 0.3) < 1e-9);
});

test('a zero-area or malformed box returns null (drop the mark, never a fake point)', () => {
  assert.equal(toFractionalBbox([500, 400, 500, 600], 1000, 800), null); // x2==x1
  assert.equal(toFractionalBbox([1, 2, 3], 1000, 800), null);
  assert.equal(toFractionalBbox([500, 400, 750, 600], 0, 0), null);
});
