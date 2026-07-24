// Image pixel dimensions from raw bytes (pure, no deps): PNG + JPEG only — the two formats
// MinerU emits for PDF figures. Note: grounding no longer normalizes by these dims — the
// vision model was MEASURED (scripts/calibrate-vision-grounding.mjs, 2026-07-24) to answer
// in 0-1000 normalized space regardless of prompt; real dims remain useful for size checks
// (Qwen-VL localization degrades beyond 2560px). Returns null for anything unparseable —
// the caller degrades honestly rather than guessing a scale.

export function imageDimensions(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  // PNG: 8-byte signature, then IHDR: width @16, height @20 (big-endian).
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  // JPEG: scan markers for SOF0/1/2 (0xC0/0xC1/0xC2): height @+5, width @+7.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) { offset += 1; continue; }
      const marker = b[offset + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
      }
      const length = b.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

// Model bbox -> fractional {x,y,w,h}. Defensive on convention: values in (0,1] are already
// fractional; otherwise they are pixels in the stated width/height space. Clamped; a box
// with no area returns null (the caller drops the mark — never a guessed point).
export function toFractionalBbox(bbox2d, width, height) {
  if (!Array.isArray(bbox2d) || bbox2d.length !== 4 || !width || !height) return null;
  const nums = bbox2d.map(Number);
  if (nums.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const fractional = nums.every((v) => v <= 1);
  const [x1, y1, x2, y2] = fractional
    ? nums
    : [nums[0] / width, nums[1] / height, nums[2] / width, nums[3] / height];
  const cx1 = Math.min(Math.max(x1, 0), 1);
  const cy1 = Math.min(Math.max(y1, 0), 1);
  const cx2 = Math.min(Math.max(x2, 0), 1);
  const cy2 = Math.min(Math.max(y2, 0), 1);
  if (!(cx2 > cx1) || !(cy2 > cy1)) return null;
  return { x: cx1, y: cy1, w: cx2 - cx1, h: cy2 - cy1 };
}

// Intersection-over-union of two fractional {x,y,w,h} boxes — the agreement test for
// double-grounding: two independent vision passes must land on the same region or the mark
// is dropped as unverifiable (drawn-wrong teaches worse than absent).
export function bboxIoU(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

// Average two agreeing boxes (the consensus mark).
export function bboxMean(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2, h: (a.h + b.h) / 2 };
}
