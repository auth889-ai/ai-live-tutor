// Vision agent: SEE a figure/page image (qwen3.7-plus multimodal) and explain it so the
// tutor can teach FROM it. Returns a caption, what it shows, a teaching note — and (the
// depth upgrade, research: transcribe-first inventory) a full TRANSCRIPT of visible text
// plus a COMPONENT inventory with located boxes. The inventory is what makes shallow
// one-line figure teaching structurally impossible downstream: the Board Director teaches
// per component and names parts exactly; grounding uses the same names as anchors.
// Honest failure — never invents a description of an image it couldn't read.

import { readFile } from 'node:fs/promises';
import { callQwenVisionJson } from '../../../qwen/vision.js';
import { bboxFromModelAnswer } from './ground-annotations.js';

const COMPONENT_KINDS = new Set(['label', 'box', 'arrow', 'axis', 'node', 'region', 'symbol', 'other']);
const MAX_COMPONENTS = 24;

// Pure parse of the model's component list -> [{label, kind, bbox{x,y,w,h}}], fractional
// coords via the MEASURED 0-1000 convention (scripts/calibrate-vision-grounding.mjs).
// Malformed/unlocatable entries are dropped, never guessed; capped so a pathological
// answer cannot flood the SourcePack.
export function parseComponents(raw) {
  if (!Array.isArray(raw)) return [];
  const components = [];
  for (const entry of raw) {
    const label = String(entry?.label ?? '').trim();
    const bbox = bboxFromModelAnswer(entry?.bbox_2d);
    if (!label || !bbox) continue;
    const kind = COMPONENT_KINDS.has(entry?.kind) ? entry.kind : 'other';
    components.push({ label: label.slice(0, 80), kind, bbox });
    if (components.length >= MAX_COMPONENTS) break;
  }
  return components;
}

export async function describeImage({ imagePath, imageBytes, mime = 'image/png' }) {
  const bytes = imageBytes ?? (await readFile(imagePath));
  const base64 = Buffer.from(bytes).toString('base64');

  const system = `You are the Vision agent of an AI tutor. Look at the image (a figure/diagram/page from
learning material) and inventory it so a teacher can teach EVERY part of it. Output ONLY JSON:
{"caption": "one-line label",
 "whatItShows": "2-3 sentences: what the image depicts and its key parts/relationships",
 "teachingNote": "one sentence: how a teacher would use this image to explain the concept",
 "transcript": "ALL text visible in the image, transcribed verbatim (labels, axis titles, legends, numbers); empty string if none",
 "components": [{"label": "short name of the part (use its visible text when it has any)",
                 "kind": "label"|"box"|"arrow"|"axis"|"node"|"region"|"symbol"|"other",
                 "bbox_2d": [x1, y1, x2, y2]}]}
List EVERY distinct labeled part, box, arrow, axis and region as a component (up to ${MAX_COMPONENTS}) —
bbox_2d coordinates normalized to the 0-1000 range (0,0 = top-left, 1000,1000 = bottom-right), tight
around the part. Describe ONLY what is actually visible; if the image is decorative or unreadable, say
so in caption and return empty transcript/components.`;

  const { json, usage } = await callQwenVisionJson({
    agent: 'vision_describe',
    system,
    user: 'Inventory and describe this image for teaching.',
    images: [{ base64, mime }],
    maxTokens: 3000, // dense diagrams: transcript + up to 24 located components need room
  });
  return {
    caption: String(json.caption || '').trim(),
    whatItShows: String(json.whatItShows || '').trim(),
    teachingNote: String(json.teachingNote || '').trim(),
    transcript: String(json.transcript || '').trim(),
    components: parseComponents(json.components),
    usage,
  };
}
