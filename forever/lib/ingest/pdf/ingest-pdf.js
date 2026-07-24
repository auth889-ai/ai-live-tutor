// PDF -> multimodal SourcePack. Orchestrates: MinerU parse (text + figures) -> unpack ->
// clean markdown -> multimodal SourcePack (text chunks + image assets). Slice 1 teaches
// from the text; the figure assets are carried for the vision pass (slice 2).

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { parsePdfWithMineru } from './mineru.js';
import { unpackMineru } from './unpack-mineru.js';
import { renderPageImages } from './page-images.js';
import { cleanMarkdown } from './clean-markdown.js';
import { describeImage } from '../../orchestration/agents/vision/describe-image.js';
import { buildMultimodalSourcePack } from '../../source-pack/build/multimodal-source-pack.js';
import { mapWithConcurrency } from '../../util/concurrency.js';

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

  // MINERU REUSE (deterministic cache): the SAME pdf bytes parse to the SAME result, so a
  // prior successful parse (result zip + content-hash marker) is reused instead of
  // re-spending API quota — and ingest keeps working through MinerU outages/token expiry
  // (live-caught 2026-07-24: token expired mid-sprint, every PDF ingest died). A dir
  // without a marker but WITH a zip predates this cache: the dir is keyed by the upload's
  // own filename, so its zip IS that file's parse — adopt it and write the marker.
  const hash = createHash('sha1').update(bytes).digest('hex');
  const markerPath = path.join(outDir, 'mineru.sha1');
  const cachedZip = path.join(outDir, 'mineru.zip');
  let zipPath = null;
  const marker = await readFile(markerPath, 'utf8').catch(() => null);
  const zipExists = await access(cachedZip).then(() => true, () => false);
  if (zipExists && (marker?.trim() === hash || marker === null)) {
    zipPath = cachedZip;
    if (marker === null) await writeFile(markerPath, hash);
    console.error(`[ingest] reusing prior MinerU parse for ${path.basename(pdfPath)} (sha1 ${hash.slice(0, 10)}…) — no API call`);
  } else {
    ({ zipPath } = await parsePdfWithMineru(bytes, { fileName: path.basename(pdfPath), outDir, env }));
    await writeFile(markerPath, hash);
  }
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

  // Vision pass: SEE each figure so the tutor can teach FROM it. IN PARALLEL (live-caught:
  // 24 figures described one-by-one crawled for ~20 minutes; figures are independent).
  // The document's OWN caption (content_list, the OpenMAIC harvest) wins when present —
  // a real author caption beats a vision guess AND keeps the figure teachable even when
  // vision is unavailable. Vision still adds whatItShows depth where it runs.
  const maxFigures = Number(env.PDF_MAX_VISION_FIGURES || 8);
  const describedFigures = await mapWithConcurrency(images.slice(0, maxFigures), 4, async (img) => {
    let caption = img.sourceCaption ?? '';
    let whatItShows = '';
    let transcript = '';
    let components = [];
    // ONE retry, then a page-anchored fallback caption: a silently-failed description used
    // to ERASE the figure from the whole pipeline (live-caught: the snowflake-schema
    // diagram never reached the Teacher while its star-schema sibling did — the comparison
    // scene shipped half-blind).
    for (let attempt = 0; attempt < 2 && !whatItShows; attempt += 1) {
      try {
        const seen = await describeImage({ imagePath: img.path });
        caption = caption || seen.caption;
        whatItShows = seen.whatItShows;
        transcript = seen.transcript ?? '';
        components = seen.components ?? [];
      } catch {
        // vision unavailable this attempt
      }
    }
    if (!caption.trim()) caption = `Source figure on page ${img.page ?? '?'} (undescribed — teach it from the surrounding source text)`;
    return {
      id: img.id, kind: 'figure', url: img.path, caption, whatItShows,
      ...(transcript ? { transcript } : {}),
      ...(components.length ? { components } : {}),
      ...(img.page ? { page: img.page } : {}), ...(img.bbox ? { bbox: normalizeBbox(img.bbox) } : {}),
    };
  }).then((settled) => settled.map((r, i) => (r.status === 'fulfilled'
    ? r.value
    : { id: images[i].id, kind: 'figure', url: images[i].path, caption: images[i].sourceCaption || `Source figure on page ${images[i].page ?? '?'}`, ...(images[i].page ? { page: images[i].page } : {}) })));

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
