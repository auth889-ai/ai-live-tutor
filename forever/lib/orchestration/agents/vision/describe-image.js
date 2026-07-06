// Vision agent: SEE a figure/page image (qwen3.7-plus multimodal) and explain it so the
// tutor can teach FROM it. Returns a caption, what it shows, and a teaching note. Honest
// failure — never invents a description of an image it couldn't read.

import { readFile } from 'node:fs/promises';
import { callQwenVisionJson } from '../../../qwen/vision.js';

export async function describeImage({ imagePath, imageBytes, mime = 'image/png' }) {
  const bytes = imageBytes ?? (await readFile(imagePath));
  const base64 = Buffer.from(bytes).toString('base64');

  const system = `You are the Vision agent of an AI tutor. Look at the image (a figure/diagram/page from
learning material) and explain it so a teacher can teach FROM it. Output ONLY JSON:
{"caption": "one-line label", "whatItShows": "2-3 sentences: what the image depicts and its key parts/relationships",
 "teachingNote": "one sentence: how a teacher would use this image to explain the concept"}
Describe ONLY what is actually visible; if it is decorative or unreadable, say so in caption.`;

  const { json, usage } = await callQwenVisionJson({
    agent: 'vision_describe',
    system,
    user: 'Describe this image for teaching.',
    images: [{ base64, mime }],
  });
  return {
    caption: String(json.caption || '').trim(),
    whatItShows: String(json.whatItShows || '').trim(),
    teachingNote: String(json.teachingNote || '').trim(),
    usage,
  };
}
