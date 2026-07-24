// DEV-ONLY live grounding probe: /api/dev/ground-live — runs the REAL Forever pipeline
// (describeImage inventory -> groundAnnotations with anchor rescue) on a REAL ingested PDF
// figure, fresh on every request. Nothing canned: the marks you see are what the vision
// agents produce right now. Used by /dev/annotations?live=1. Refuses to run in production
// (it spends vision tokens and reads .data) — this is a workbench, not product surface.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { describeImage } from '../../../../lib/orchestration/agents/vision/describe-image.js';
import { groundAnnotations } from '../../../../lib/orchestration/agents/vision/ground-annotations.js';

const VERBS = ['encircle', 'arrow', 'label'];

async function newestIngestFigure() {
  const root = '.data/ingest';
  const dirs = [];
  for (const name of await readdir(root).catch(() => [])) {
    const imagesDir = path.join(root, name, 'images');
    const info = await stat(imagesDir).catch(() => null);
    if (info?.isDirectory()) dirs.push({ imagesDir, mtime: info.mtimeMs });
  }
  dirs.sort((a, b) => b.mtime - a.mtime);
  for (const { imagesDir } of dirs) {
    const files = (await readdir(imagesDir)).filter((f) => /\.(png|jpe?g)$/i.test(f));
    // Prefer a mid-document figure (cover images are often decorative).
    if (files.length) return path.join(imagesDir, files[Math.min(1, files.length - 1)]);
  }
  return null;
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') return Response.json({ error: 'dev only' }, { status: 404 });

  const imagePath = await newestIngestFigure();
  if (!imagePath) return Response.json({ error: 'no ingested figures found in .data/ingest' }, { status: 404 });
  const mime = /\.png$/i.test(imagePath) ? 'image/png' : 'image/jpeg';

  // Pass 1 — REAL inventory (transcript + located components).
  const seen = await describeImage({ imagePath, mime });
  if (!seen.components.length) {
    return Response.json({ error: `vision found no components in ${path.basename(imagePath)} — pick another figure`, caption: seen.caption }, { status: 422 });
  }

  // Pass 2 — REAL grounding of intents DERIVED from the figure's own inventory (the same
  // "use the exact part names" contract the Board Director follows).
  const intents = seen.components.slice(0, 4).map((component, i) => ({
    verb: VERBS[i % VERBS.length],
    text: component.label,
  }));
  const { annotations, dropped, usage } = await groundAnnotations({
    imagePath, mime, annotations: intents, anchors: seen.components,
  });

  const bytes = await readFile(imagePath);
  return Response.json({
    content: {
      url: `data:${mime};base64,${bytes.toString('base64')}`,
      alt: seen.caption,
      caption: `LIVE from the real pipeline just now: ${path.basename(imagePath)} — ${annotations.length} grounded, ${dropped.length} dropped`,
      annotations,
    },
    whatItShows: seen.whatItShows,
    transcript: seen.transcript,
    components: seen.components,
    dropped,
    usage,
  });
}
