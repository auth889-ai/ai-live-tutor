// image-prep: vision inputs stay inside Qwen-VL's reliable range (<=2560 long side), and
// crop-verify geometry maps between crop space and original space losslessly.

import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { prepareImageForVision, cropAroundBbox, bboxFromCropSpace, MAX_VISION_SIDE } from '../../lib/util/image-prep.js';
import { imageDimensions } from '../../lib/util/image-size.js';

test('oversized images downscale to <=2560 long side, aspect preserved; small ones untouched', async () => {
  const big = await sharp({ create: { width: 3600, height: 1800, channels: 3, background: 'white' } }).png().toBuffer();
  const prepped = await prepareImageForVision(big, 'image/png');
  assert.equal(prepped.scaled, true);
  const dims = imageDimensions(prepped.bytes);
  assert.equal(Math.max(dims.width, dims.height), MAX_VISION_SIDE);
  assert.ok(Math.abs(dims.width / dims.height - 2) < 0.01); // aspect ratio held
  const small = await sharp({ create: { width: 800, height: 600, channels: 3, background: 'white' } }).png().toBuffer();
  const untouched = await prepareImageForVision(small, 'image/png');
  assert.equal(untouched.scaled, false);
  assert.equal(untouched.bytes, small); // same buffer, no re-encode
});

test('cropAroundBbox windows are exact and bboxFromCropSpace maps back to original space', async () => {
  const img = await sharp({ create: { width: 1000, height: 500, channels: 3, background: 'white' } }).png().toBuffer();
  const crop = await cropAroundBbox(img, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, { pad: 0.5, mime: 'image/png' });
  assert.ok(crop);
  // window covers the padded region, clamped to the image
  assert.ok(crop.window.x <= 0.3 + 1e-6 && crop.window.x + crop.window.w >= 0.7 - 1e-2);
  // a bbox found at the crop's center maps back to the original center of the region
  const back = bboxFromCropSpace({ x: 0.45, y: 0.45, w: 0.1, h: 0.1 }, crop.window);
  assert.ok(Math.abs((back.x + back.w / 2) - (crop.window.x + crop.window.w / 2)) < 0.02);
  // degenerate boxes refuse honestly
  assert.equal(await cropAroundBbox(img, { x: 0.5, y: 0.5, w: 0.0001, h: 0.0001 }, { pad: 0, mime: 'image/png' }), null);
});
