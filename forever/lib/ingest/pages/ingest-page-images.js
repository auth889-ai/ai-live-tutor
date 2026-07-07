// Vision-first ingest: a folder of PDF page images -> a multimodal SourcePack, using
// qwen3.7-plus to READ each page (text + diagrams). No MinerU needed — ideal for
// slide/diagram-heavy PDFs the old server already rendered per page. Each page's vision
// reading becomes a text chunk; each page image is a figure asset the tutor teaches FROM.

import { readdir, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { describeImage } from '../../orchestration/agents/vision/describe-image.js';
import { buildMultimodalSourcePack } from '../../source-pack/build/multimodal-source-pack.js';

export async function ingestPageImages(pageDir, { title, publicDir = 'public', urlBase = '/pdf-pages', maxPages = 8, env = process.env } = {}) {
  const id = path.basename(pageDir).replace(/[^a-z0-9]/gi, '').slice(0, 20) || 'doc';
  const outDir = path.join(publicDir, 'pdf-pages', id);
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(pageDir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().slice(0, maxPages);
  if (files.length === 0) throw new Error(`No page images in ${pageDir}`);

  const chunks = [];
  const assets = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const src = path.join(pageDir, file);
    let seen;
    try {
      seen = await describeImage({ imagePath: src, mime: file.endsWith('.png') ? 'image/png' : 'image/jpeg', env });
    } catch {
      continue; // page unreadable by vision — skip it
    }
    await copyFile(src, path.join(outDir, file));
    const url = `${urlBase}/${id}/${file}`;
    chunks.push(`Page ${i + 1}: ${seen.whatItShows}`);
    assets.push({ id: `fig_${String(i + 1).padStart(3, '0')}`, kind: 'figure', url, caption: seen.caption, whatItShows: seen.whatItShows, page: i + 1 });
  }
  if (chunks.length === 0) throw new Error('Vision could not read any page');

  return buildMultimodalSourcePack({
    title: title || id,
    text: chunks.join('\n\n'),
    images: assets,
    documentType: 'pdf',
  });
}
