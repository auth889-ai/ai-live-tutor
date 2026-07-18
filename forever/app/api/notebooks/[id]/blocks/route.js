// /api/notebooks/[id]/blocks — append one typed block per input. Link blocks are enriched
// server-side (extractReadableText -> title + content, trust: 'extracted'); uploads arrive as
// uploadId from the existing /api/uploads. Every write owner-scoped in the store.

import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';

import { addBlock } from '../../../../../lib/storage/notebook-store.js';
import { ingestUrl } from '../../../../../lib/ingest/url/ingest-url.js';
import { resolveUpload } from '../../../../../lib/storage/upload-store.js';
import { parsePdfWithMineru } from '../../../../../lib/ingest/pdf/mineru.js';
import { unpackMineru } from '../../../../../lib/ingest/pdf/unpack-mineru.js';
import { cleanMarkdown } from '../../../../../lib/ingest/pdf/clean-markdown.js';
import { describeImage } from '../../../../../lib/orchestration/agents/vision/describe-image.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const spec = {
    userId: session.userId,
    notebookId: id,
    type: body.type,
    content: body.content ?? '',
    url: body.url ?? null,
    uploadId: body.uploadId ?? null,
    mediaType: body.mediaType ?? null,
    transcript: body.transcript ?? null,
    source: body.source ?? 'typed',
    origin: body.origin ?? null,
    title: body.title ?? null,
    trust: body.trust ?? 'user',
  };
  // Link blocks: fetch + extract the readable text so the notebook (and the course generator)
  // holds the actual content, provenance marked 'extracted' — never pretending the user wrote it.
  if (body.type === 'link' && body.url) {
    try {
      const ingested = await ingestUrl(String(body.url));
      spec.content = String(ingested?.text ?? '').slice(0, 20000);
      spec.title = spec.title ?? ingested?.title ?? null;
      spec.origin = new URL(String(body.url)).hostname;
      spec.trust = 'extracted';
      spec.source = 'url';
    } catch (e) {
      return Response.json({ error: `could not read that link: ${String(e.message ?? e).slice(0, 140)}` }, { status: 422 });
    }
  }
  // PDF blocks: the SAME MinerU extraction the course pipeline trusts (text only here) —
  // content arrives as readable markdown, provenance 'extracted'. Takes a minute; honest UX.
  if (body.type === 'pdf' && body.uploadId) {
    const resolved = await resolveUpload(session.userId, body.uploadId);
    if (!resolved) return Response.json({ error: 'upload not found' }, { status: 400 });
    try {
      const outDir = path.join('.data', 'ingest', `nb_${Date.now()}`);
      await mkdir(outDir, { recursive: true });
      const bytes = await readFile(resolved);
      const { zipPath } = await parsePdfWithMineru(bytes, { fileName: path.basename(resolved), outDir });
      const { markdown } = await unpackMineru(zipPath, outDir);
      const text = cleanMarkdown(markdown);
      if (text.length < 40) throw new Error('the PDF produced too little text');
      spec.content = text.slice(0, 20000);
      spec.title = spec.title ?? body.fileName ?? 'PDF';
      spec.origin = body.fileName ?? 'pdf upload';
      spec.trust = 'extracted';
      spec.source = 'upload';
    } catch (e) {
      return Response.json({ error: `could not read that PDF: ${String(e.message ?? e).slice(0, 140)}` }, { status: 422 });
    }
  }
  // Image blocks: the Vision agent describes the figure so the notebook holds teachable text,
  // clearly marked 'extracted' — the pixels stay in the upload store.
  if (body.type === 'image' && body.uploadId) {
    const resolved = await resolveUpload(session.userId, body.uploadId);
    if (!resolved) return Response.json({ error: 'upload not found' }, { status: 400 });
    try {
      const seen = await describeImage({ imagePath: resolved, mime: body.mediaType ?? 'image/png' });
      const d = seen?.json ?? seen ?? {};
      spec.content = [d.caption, d.whatItShows, d.keyDetails].filter(Boolean).join('\n\n').slice(0, 20000) || 'image (no description available)';
      spec.title = spec.title ?? d.caption ?? body.fileName ?? 'Image';
      spec.origin = body.fileName ?? 'image upload';
      spec.trust = 'extracted';
      spec.source = 'upload';
    } catch (e) {
      return Response.json({ error: `could not read that image: ${String(e.message ?? e).slice(0, 140)}` }, { status: 422 });
    }
  }
  try {
    const doc = await addBlock(spec);
    if (!doc) return Response.json({ error: 'notebook not found' }, { status: 404 });
    return Response.json({ block: doc }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e.message ?? e) }, { status: 400 });
  }
}
