// Image -> SourcePack. The vision agent (Qwen-VL) READS the image — caption + what it
// actually shows — and that real reading (plus any context text the user typed) becomes the
// teaching material, with the image itself carried as an asset so the board can display it.
// Honest failure: if vision can't extract enough to teach from, the job fails with a clear
// message — we never invent content an image doesn't contain.

import { describeImage } from '../../orchestration/agents/vision/describe-image.js';
import { buildMultimodalSourcePack } from '../../source-pack/build/multimodal-source-pack.js';

export async function ingestImage(imagePath, { contextText = '', deps = {} } = {}) {
  const see = deps.describeImage ?? describeImage;
  const seen = await see({ imagePath });

  const text = [contextText.trim(), seen.caption, seen.whatItShows].filter(Boolean).join('\n\n');
  if (text.length < 40) {
    throw new Error('The image (plus your notes) gave too little material to teach from — add some context text');
  }

  return buildMultimodalSourcePack({
    title: (seen.caption || 'Image lesson').slice(0, 80),
    text,
    images: [{ id: 'asset_001', kind: 'figure', url: imagePath, caption: seen.caption, whatItShows: seen.whatItShows }],
    documentType: 'image',
  });
}
