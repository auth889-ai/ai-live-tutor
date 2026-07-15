// Annotation grounding agent (one job): the Board Director writes annotation INTENTS
// (encircle X, label Y) but it is a text model that has never seen the image — its bboxes
// are guesses, which is why marks landed on the wrong parts (live user report: "it cannot
// point at the correct thing"). This agent LOOKS at the pixels (Qwen-VL) and returns the
// real box for each intent: bbox_2d [x1,y1,x2,y2] normalized 0-1000 (the model's native
// grounding format) -> converted to forever's fractional {x,y,w,h}. Honest failure per
// mark: an intent the model cannot locate is DROPPED (never a made-up box), and the whole
// pass degrades to the unannotated image if vision is unavailable.

import { readFile } from 'node:fs/promises';
import { callQwenVisionJson } from '../../../qwen/vision.js';
import { imageDimensions, toFractionalBbox } from '../../../util/image-size.js';

export async function groundAnnotations({ imagePath, imageBytes, mime = 'image/jpeg', annotations }) {
  if (!annotations?.length) return { annotations: [], usage: null };
  const bytes = imageBytes ?? (await readFile(imagePath));
  const base64 = Buffer.from(bytes).toString('base64');
  // COORDINATE CONVENTION FIX (live user report: "it cannot make correct point"): current
  // Qwen-VL (2.5/3) is TRAINED to return ABSOLUTE PIXEL bboxes — the old prompt demanded
  // 0-1000-normalized and divided by 1000, so whenever the model answered in its native
  // pixels every mark landed scaled/shifted. Now we read the image's REAL dimensions, state
  // them in the prompt (anchoring the model's output space), and normalize by them —
  // defensively accepting fractional output too (toFractionalBbox handles both).
  const dims = imageDimensions(bytes);
  const sizeLine = dims
    ? `The image is exactly ${dims.width} pixels wide and ${dims.height} pixels tall. Report each bounding box as "bbox_2d": [x1, y1, x2, y2] in ABSOLUTE PIXEL coordinates within that ${dims.width}x${dims.height} space`
    : 'Report each bounding box as "bbox_2d": [x1, y1, x2, y2] normalized to 0-1 fractions of the image width/height';

  const system = `You are the Vision Grounding agent of an AI tutor. You are given an image and a list of
teaching marks a teacher wants to draw on it. For EACH mark, locate the exact region in the image.
${sizeLine} (x1<x2, y1<y2, tight around the named part). Output ONLY JSON:
{"marks":[{"index": <the mark's index from the input>, "bbox_2d": [x1,y1,x2,y2], "found": true|false}]}
Report "found": false for any mark whose target is NOT actually visible in the image — never guess a box.`;

  const user = JSON.stringify({
    marks: annotations.map((a, index) => ({ index, verb: a.verb, target: a.text ?? a.alt ?? '' })),
  });

  const { json, usage } = await callQwenVisionJson({
    agent: 'vision_ground',
    system,
    user,
    images: [{ base64, mime }],
  });

  // Normalize by the REAL dimensions when known; fall back to 0-1000 only when the header
  // could not be read (legacy behaviour). toFractionalBbox accepts pixel OR fractional output.
  const width = dims?.width ?? 1000;
  const height = dims?.height ?? 1000;
  const byIndex = new Map();
  for (const mark of Array.isArray(json.marks) ? json.marks : []) {
    if (mark?.found !== true) continue;
    const bbox = toFractionalBbox(mark.bbox_2d, width, height);
    if (bbox) byIndex.set(Number(mark.index), bbox);
  }

  const grounded = [];
  const dropped = [];
  annotations.forEach((annotation, index) => {
    const bbox = byIndex.get(index);
    if (bbox) grounded.push({ ...annotation, bbox });
    else dropped.push(annotation.text ?? annotation.verb);
  });
  return { annotations: grounded, dropped, usage };
}
