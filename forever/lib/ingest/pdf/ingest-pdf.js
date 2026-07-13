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

// MinerU bboxes are [x1, y1, x2, y2] normalized 0-1000 (page coordinates); forever's bbox
// convention everywhere is fractional {x, y, w, h} in 0-1 (image-content.js validates it).
function normalizeBbox(b) {
  if (!Array.isArray(b) || b.length !== 4) return undefined;
  const [x1, y1, x2, y2] = b.map((v) => Math.min(Math.max(Number(v) / 1000, 0), 1));
  if (!(x2 > x1) || !(y2 > y1)) return undefined;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

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
  // cost). The document's OWN caption (content_list, the OpenMAIC harvest) wins when
  // present — a real author caption beats a vision guess AND keeps the figure teachable
  // even when vision is unavailable. Vision still adds whatItShows depth where it runs.
  const maxFigures = Number(env.PDF_MAX_VISION_FIGURES || 8);
  const describedFigures = [];
  for (const img of images.slice(0, maxFigures)) {
    let caption = img.sourceCaption ?? '';
    let whatItShows = '';
    try {
      const seen = await describeImage({ imagePath: img.path });
      caption = caption || seen.caption;
      whatItShows = seen.whatItShows;
    } catch {
      // vision unavailable — the content_list caption (if any) still carries the figure
    }
    describedFigures.push({ id: img.id, kind: 'figure', url: img.path, caption, whatItShows, ...(img.page ? { page: img.page } : {}), ...(img.bbox ? { bbox: normalizeBbox(img.bbox) } : {}) });
  }

  return buildMultimodalSourcePack({
    title: path.basename(pdfPath, path.extname(pdfPath)),
    text,
    images: [
      ...describedFigures,
      // Beyond the vision budget, content_list captions STILL make figures teachable.
      ...images.slice(maxFigures).map((img) => ({
        id: img.id, kind: 'figure', url: img.path, caption: img.sourceCaption ?? '',
        ...(img.page ? { page: img.page } : {}), ...(img.bbox ? { bbox: normalizeBbox(img.bbox) } : {}),
      })),
      ...pages.map((p) => ({ id: `page_${String(p.page).padStart(3, '0')}`, kind: 'page', url: p.path, page: p.page })),
    ],
    documentType: 'pdf',
  });
}
