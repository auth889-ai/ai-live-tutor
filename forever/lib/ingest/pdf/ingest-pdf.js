// PDF -> multimodal SourcePack. Orchestrates: MinerU parse (text + figures) -> unpack ->
// clean markdown -> multimodal SourcePack (text chunks + image assets). Slice 1 teaches
// from the text; the figure assets are carried for the vision pass (slice 2).

import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { parsePdfWithMineru } from './mineru.js';
import { unpackMineru } from './unpack-mineru.js';
import { renderPageImages } from './page-images.js';
import { cleanMarkdown } from './clean-markdown.js';
import { describeImage } from '../../orchestration/agents/vision/describe-image.js';
import { buildMultimodalSourcePack } from '../../source-pack/build/multimodal-source-pack.js';

export async function ingestPdf(pdfPath, { workDir = '.data/ingest', env = process.env } = {}) {
  const bytes = await readFile(pdfPath);
  const id = path.basename(pdfPath).replace(/[^a-z0-9]/gi, '').slice(0, 20) || 'doc';
  const outDir = path.join(workDir, id);
  await mkdir(outDir, { recursive: true });

  const { zipPath } = await parsePdfWithMineru(bytes, { fileName: path.basename(pdfPath), outDir, env });
  const { markdown, images } = await unpackMineru(zipPath, outDir);

  // Full-page PNGs (image in context) alongside MinerU's isolated figures — both feed the
  // vision pass (slice 2) so the tutor can teach from the PDF's pictures, not just its text.
  let pages = [];
  try {
    pages = await renderPageImages(pdfPath, { outDir: path.join(outDir, 'pages') });
  } catch {
    // page render is a bonus; MinerU text + figures still work without it
  }

  const text = cleanMarkdown(markdown);
  if (text.length < 40) throw new Error('PDF produced too little text to teach from');

  // Vision pass: SEE each figure so the tutor can teach FROM it (bounded to avoid runaway
  // cost). A figure that can't be described is kept without a caption (not offered to teach).
  const maxFigures = Number(env.PDF_MAX_VISION_FIGURES || 8);
  const describedFigures = [];
  for (const img of images.slice(0, maxFigures)) {
    let caption = '';
    let whatItShows = '';
    try {
      const seen = await describeImage({ imagePath: img.path });
      caption = seen.caption;
      whatItShows = seen.whatItShows;
    } catch {
      // vision unavailable for this figure — keep it uncaptioned
    }
    describedFigures.push({ id: img.id, kind: 'figure', url: img.path, caption, whatItShows });
  }

  return buildMultimodalSourcePack({
    title: path.basename(pdfPath, path.extname(pdfPath)),
    text,
    images: [
      ...describedFigures,
      ...images.slice(maxFigures).map((img) => ({ id: img.id, kind: 'figure', url: img.path, caption: '' })),
      ...pages.map((p) => ({ id: `page_${String(p.page).padStart(3, '0')}`, kind: 'page', url: p.path, page: p.page })),
    ],
    documentType: 'pdf',
  });
}
