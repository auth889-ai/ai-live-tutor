// Vision-input image prep (one job): Qwen-VL localization is only reliable when the long
// side sits inside ~480-2560px (official DashScope/Qwen-VL guidance — beyond 2560 the
// grounding boxes drift). PDF page renders regularly exceed that, so every image is
// downscaled to <=2560 long side BEFORE any vision call. No coordinate remap is needed:
// the model answers in 0-1000 normalized space (measured, scripts/calibrate-vision-
// grounding.mjs), so fractional bboxes remain valid on the ORIGINAL image. Unparseable
// bytes pass through untouched — the vision call itself is the judge of readability.

import sharp from 'sharp';
import { imageDimensions } from './image-size.js';

export const MAX_VISION_SIDE = 2560;

export async function prepareImageForVision(bytes, mime = 'image/png') {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const dims = imageDimensions(buffer);
  if (!dims || Math.max(dims.width, dims.height) <= MAX_VISION_SIDE) {
    return { bytes: buffer, mime, width: dims?.width ?? null, height: dims?.height ?? null, scaled: false };
  }
  const scale = MAX_VISION_SIDE / Math.max(dims.width, dims.height);
  const width = Math.max(1, Math.round(dims.width * scale));
  const height = Math.max(1, Math.round(dims.height * scale));
  const pipeline = sharp(buffer).resize(width, height);
  const isPng = mime === 'image/png';
  const out = await (isPng ? pipeline.png() : pipeline.jpeg({ quality: 90 })).toBuffer();
  return { bytes: out, mime: isPng ? 'image/png' : 'image/jpeg', width, height, scaled: true };
}

// Crop a fractional {x,y,w,h} region expanded by `pad` (fraction of the box on each side)
// for crop-then-verify: the verifier looks at a focused view around a predicted mark.
// Returns the crop bytes plus the crop's own fractional window {x,y,w,h} in ORIGINAL image
// space, so a bbox re-grounded inside the crop maps back:
//   original = window.x + cropFraction.x * window.w  (same for y/w/h).
export async function cropAroundBbox(bytes, bbox, { pad = 0.5, mime = 'image/png' } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const dims = imageDimensions(buffer);
  if (!dims || !bbox) return null;
  const x1 = Math.max(0, bbox.x - bbox.w * pad);
  const y1 = Math.max(0, bbox.y - bbox.h * pad);
  const x2 = Math.min(1, bbox.x + bbox.w * (1 + pad));
  const y2 = Math.min(1, bbox.y + bbox.h * (1 + pad));
  // Degenerate region (would be <8px before any clamping): nothing meaningful to verify.
  if ((x2 - x1) * dims.width < 8 || (y2 - y1) * dims.height < 8) return null;
  const left = Math.floor(x1 * dims.width);
  const top = Math.floor(y1 * dims.height);
  const width = Math.min(dims.width - left, Math.ceil((x2 - x1) * dims.width));
  const height = Math.min(dims.height - top, Math.ceil((y2 - y1) * dims.height));
  const isPng = mime === 'image/png';
  const pipeline = sharp(buffer).extract({ left, top, width, height });
  const out = await (isPng ? pipeline.png() : pipeline.jpeg({ quality: 90 })).toBuffer();
  return {
    bytes: out,
    mime: isPng ? 'image/png' : 'image/jpeg',
    window: { x: left / dims.width, y: top / dims.height, w: width / dims.width, h: height / dims.height },
  };
}

// Map a fractional bbox measured INSIDE a crop back to original-image space.
export function bboxFromCropSpace(bbox, window) {
  if (!bbox || !window) return null;
  return {
    x: window.x + bbox.x * window.w,
    y: window.y + bbox.y * window.h,
    w: bbox.w * window.w,
    h: bbox.h * window.h,
  };
}
