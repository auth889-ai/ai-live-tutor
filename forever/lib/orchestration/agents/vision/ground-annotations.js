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

export async function groundAnnotations({ imagePath, imageBytes, mime = 'image/jpeg', annotations }) {
  if (!annotations?.length) return { annotations: [], usage: null };
  const bytes = imageBytes ?? (await readFile(imagePath));
  const base64 = Buffer.from(bytes).toString('base64');

  const system = `You are the Vision Grounding agent of an AI tutor. You are given an image and a list of
teaching marks a teacher wants to draw on it. For EACH mark, locate the exact region in the image and
report its bounding box as "bbox_2d": [x1, y1, x2, y2] with every value normalized to 0-1000
(x1<x2, y1<y2, tight around the named part). Output ONLY JSON:
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

  const byIndex = new Map();
  for (const mark of Array.isArray(json.marks) ? json.marks : []) {
    if (mark?.found !== true || !Array.isArray(mark.bbox_2d) || mark.bbox_2d.length !== 4) continue;
    const [x1, y1, x2, y2] = mark.bbox_2d.map((v) => Math.min(Math.max(Number(v) / 1000, 0), 1));
    if (!(x2 > x1) || !(y2 > y1)) continue;
    byIndex.set(Number(mark.index), { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
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
