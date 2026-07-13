// Unpack a MinerU result zip: extract it, read the markdown (the structured text of the
// PDF), and list the extracted figures ENRICHED from content_list.json — MinerU already
// tells us each figure's page, bbox (0-1000 normalized) and the document's OWN captions
// (the OpenMAIC harvest, read from their mineru-parser at source). Real author captions
// beat vision guesses and arrive free; bbox gives aspect + future region zoom. Glob-only
// fallback when content_list is absent, so older results keep working.

import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export async function unpackMineru(zipPath, outDir) {
  await runUnzip(zipPath, outDir);
  const files = await walk(outDir);

  // The main markdown is the largest .md file MinerU produced.
  const mdFiles = files.filter((f) => f.toLowerCase().endsWith('.md'));
  if (mdFiles.length === 0) throw new Error('MinerU result contained no markdown');
  let markdownPath = mdFiles[0];
  let best = 0;
  for (const f of mdFiles) {
    const size = (await stat(f)).size;
    if (size > best) {
      best = size;
      markdownPath = f;
    }
  }
  const markdown = await readFile(markdownPath, 'utf8');

  const meta = await readContentListMeta(files);
  const images = files
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .map((f, index) => {
      const m = meta.get(path.basename(f));
      return {
        id: `fig_${String(index + 1).padStart(3, '0')}`,
        kind: 'figure',
        path: f,
        name: path.basename(f),
        ...(m?.page ? { page: m.page } : {}),
        ...(m?.bbox ? { bbox: m.bbox } : {}),
        ...(m?.caption ? { sourceCaption: m.caption } : {}),
      };
    });

  return { markdown, images };
}

// content_list.json: MinerU's structured inventory. For images we harvest
// { page_idx, bbox [x1,y1,x2,y2] in 0-1000, image_caption[] } keyed by basename
// (the images dict and content_list disagree about the "images/" prefix — index both,
// same trick as OpenMAIC's parser).
async function readContentListMeta(files) {
  const meta = new Map();
  const listPath = files.find((f) => f.toLowerCase().endsWith('content_list.json'));
  if (!listPath) return meta;
  let list;
  try {
    list = JSON.parse(await readFile(listPath, 'utf8'));
  } catch {
    return meta; // malformed inventory -> figures stay glob-only, never a failed ingest
  }
  if (!Array.isArray(list)) return meta;
  for (const item of list) {
    if (item?.type !== 'image' || !item.img_path) continue;
    const caption = Array.isArray(item.image_caption)
      ? item.image_caption.map((c) => String(c).trim()).filter(Boolean).join(' ')
      : '';
    const entry = {
      page: Number.isInteger(item.page_idx) ? item.page_idx + 1 : undefined,
      bbox: Array.isArray(item.bbox) && item.bbox.length === 4 ? item.bbox : undefined,
      caption: caption || undefined,
    };
    meta.set(path.basename(String(item.img_path)), entry);
  }
  return meta;
}

function runUnzip(zipPath, outDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-o', zipPath, '-d', outDir]);
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`unzip failed: ${stderr.slice(0, 200)}`))));
  });
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
