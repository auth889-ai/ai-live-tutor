// Vision grounding CALIBRATION PROBE (live, ~3 tiny vision calls).
// Question it answers, once per model id: in WHICH coordinate space does our DashScope
// vision model actually return bbox_2d?
//   (a) absolute pixels in the ORIGINAL image space  (what ground-annotations.js assumes)
//   (b) 0-1000 normalized                            (official Qwen3-VL convention)
//   (c) 0-1 fractions
// Method: generate a synthetic image with two shapes at KNOWN bboxes (asymmetric canvas so
// scale/space errors cannot cancel out), ask for their boxes under three prompt styles, and
// score every answer under all three interpretations by IoU against ground truth.
// Run: node --env-file=.env scripts/calibrate-vision-grounding.mjs
// No repo code is changed by this script — it only reports. The fix lands in
// lib/orchestration/agents/vision/ground-annotations.js based on the verdict.

import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callQwenVisionJson } from '../lib/qwen/vision.js';

const W = 1200;
const H = 800;
// Ground truth in ORIGINAL pixel space (fractions computed from these).
const TRUTH = {
  'red square': { x1: 300, y1: 200, x2: 450, y2: 320 },
  'blue circle': { x1: 840, y1: 540, x2: 960, y2: 660 },
};

async function makeImage() {
  const dir = await mkdtemp(join(tmpdir(), 'forever-calib-'));
  const path = join(dir, 'calibration.png');
  execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
img = Image.new('RGB', (${W}, ${H}), 'white')
d = ImageDraw.Draw(img)
d.rectangle([300, 200, 450, 320], fill='red')
d.ellipse([840, 540, 960, 660], fill='blue')
img.save(sys.argv[1])
`, path]);
  return path;
}

const asFraction = {
  pixels: (b) => ({ x: b[0] / W, y: b[1] / H, w: (b[2] - b[0]) / W, h: (b[3] - b[1]) / H }),
  thousand: (b) => ({ x: b[0] / 1000, y: b[1] / 1000, w: (b[2] - b[0]) / 1000, h: (b[3] - b[1]) / 1000 }),
  fraction: (b) => ({ x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }),
};

function iouVsTruth(frac, truthPx) {
  const t = { x: truthPx.x1 / W, y: truthPx.y1 / H, w: (truthPx.x2 - truthPx.x1) / W, h: (truthPx.y2 - truthPx.y1) / H };
  const ix = Math.max(0, Math.min(frac.x + frac.w, t.x + t.w) - Math.max(frac.x, t.x));
  const iy = Math.max(0, Math.min(frac.y + frac.h, t.y + t.h) - Math.max(frac.y, t.y));
  const inter = ix * iy;
  const union = frac.w * frac.h + t.w * t.h - inter;
  return union > 0 ? inter / union : 0;
}

const PROMPTS = {
  production_pixels: `You are a vision grounding agent. The image is exactly ${W} pixels wide and ${H} pixels tall. Locate each requested target. Report each bounding box as "bbox_2d": [x1, y1, x2, y2] in ABSOLUTE PIXEL coordinates within that ${W}x${H} space. Output ONLY JSON: {"imageWidth": <width as you see it>, "imageHeight": <height as you see it>, "marks":[{"index":<input index>,"bbox_2d":[x1,y1,x2,y2],"found":true|false}]}`,
  native_unstated: `You are a vision grounding agent. Locate each requested target in the image. Report each bounding box as "bbox_2d": [x1, y1, x2, y2] in your standard output format. Output ONLY JSON: {"imageWidth": <width as you see it>, "imageHeight": <height as you see it>, "marks":[{"index":<input index>,"bbox_2d":[x1,y1,x2,y2],"found":true|false}]}`,
  explicit_thousand: `You are a vision grounding agent. Locate each requested target in the image. Report each bounding box as "bbox_2d": [x1, y1, x2, y2] with coordinates normalized to the 0-1000 range (0,0 = top-left, 1000,1000 = bottom-right of the image). Output ONLY JSON: {"imageWidth": <width as you see it>, "imageHeight": <height as you see it>, "marks":[{"index":<input index>,"bbox_2d":[x1,y1,x2,y2],"found":true|false}]}`,
};

const targets = Object.keys(TRUTH);
const user = JSON.stringify({ marks: targets.map((t, index) => ({ index, verb: 'encircle', target: t })) });

const path = await makeImage();
const base64 = Buffer.from(await readFile(path)).toString('base64');
const model = process.env.MODEL_VISION || 'qwen3.7-plus';
console.log(`Calibration image: ${path} (${W}x${H})`);
console.log(`Model: ${model}\n`);

const results = await Promise.all(Object.entries(PROMPTS).map(async ([name, system]) => {
  try {
    const { json } = await callQwenVisionJson({ agent: `calib_${name}`, system, user, images: [{ base64, mime: 'image/png' }] });
    return [name, json];
  } catch (error) {
    return [name, { error: String(error.message).slice(0, 200) }];
  }
}));

const tally = { pixels: 0, thousand: 0, fraction: 0 };
for (const [name, json] of results) {
  console.log(`── ${name} ──`);
  if (json.error) { console.log(`  ERROR: ${json.error}\n`); continue; }
  console.log(`  model self-reported size: ${json.imageWidth}x${json.imageHeight} (real: ${W}x${H})`);
  for (const mark of json.marks ?? []) {
    const target = targets[mark.index];
    const truth = TRUTH[target];
    if (!truth || mark.found !== true || !Array.isArray(mark.bbox_2d)) { console.log(`  ${target}: not found / malformed`); continue; }
    const scores = Object.fromEntries(Object.entries(asFraction).map(([space, conv]) => [space, iouVsTruth(conv(mark.bbox_2d), truth)]));
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (best[1] >= 0.5) tally[best[0]] += 1;
    console.log(`  ${target}: bbox_2d=[${mark.bbox_2d}]  IoU as-pixels=${scores.pixels.toFixed(3)}  as-0-1000=${scores.thousand.toFixed(3)}  as-fraction=${scores.fraction.toFixed(3)}  → ${best[1] >= 0.5 ? best[0] : 'NO interpretation fits (IoU<0.5)'}`);
  }
  console.log('');
}

console.log('════ VERDICT ════');
const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
console.log(`votes: ${JSON.stringify(tally)}`);
if (winner[1] === 0) console.log('No coordinate space fit ANY answer — model cannot ground on this image; investigate before touching normalization.');
else console.log(`Model answers land in: ${winner[0].toUpperCase()} space. ground-annotations.js must normalize from ${winner[0]}.`);
