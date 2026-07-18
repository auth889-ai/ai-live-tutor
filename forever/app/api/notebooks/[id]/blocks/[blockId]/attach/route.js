// POST /api/notebooks/[id]/blocks/[blockId]/attach — a note carries its OWN material:
// {kind: 'link', url} — page text extracted, grounds synthesis
// {kind: 'pdf' | 'image', uploadId, fileName} — pdf text extracted; image copied to public
//   and described by the Vision agent, so the attachment feeds the AI, not just the eye.

import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

import { addAttachment, setAttachmentMeta } from '../../../../../../../lib/storage/notebook-store.js';
import { ingestUrl } from '../../../../../../../lib/ingest/url/ingest-url.js';
import { resolveUpload } from '../../../../../../../lib/storage/upload-store.js';
import { parsePdfWithMineru } from '../../../../../../../lib/ingest/pdf/mineru.js';
import { unpackMineru } from '../../../../../../../lib/ingest/pdf/unpack-mineru.js';
import { cleanMarkdown } from '../../../../../../../lib/ingest/pdf/clean-markdown.js';
import { describeImage } from '../../../../../../../lib/orchestration/agents/vision/describe-image.js';
import { sessionFromRequest } from '../../../../../../../lib/auth/session.js';

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id, blockId } = await params;
  const body = await request.json().catch(() => ({}));
  const kind = body.kind;

  try {
    if (kind === 'link' && body.url) {
      const ingested = await ingestUrl(String(body.url));
      const att = await addAttachment(session.userId, id, blockId, {
        kind: 'link', url: String(body.url), title: ingested?.title ?? new URL(String(body.url)).hostname,
        content: String(ingested?.text ?? '').slice(0, 8000),
      });
      if (!att) return Response.json({ error: 'block not found' }, { status: 404 });
      return Response.json({ attachment: att }, { status: 201 });
    }
    if ((kind === 'pdf' || kind === 'image') && body.uploadId) {
      const resolved = await resolveUpload(session.userId, body.uploadId);
      if (!resolved) return Response.json({ error: 'upload not found' }, { status: 400 });
      if (kind === 'pdf') {
        const outDir = path.join('.data', 'ingest', `att_${Date.now()}`);
        await mkdir(outDir, { recursive: true });
        const bytes = await readFile(resolved);
        const { zipPath } = await parsePdfWithMineru(bytes, { fileName: path.basename(resolved), outDir });
        const { markdown } = await unpackMineru(zipPath, outDir);
        const att = await addAttachment(session.userId, id, blockId, {
          kind: 'pdf', title: body.fileName ?? 'PDF', content: cleanMarkdown(markdown).slice(0, 8000),
        });
        if (!att) return Response.json({ error: 'block not found' }, { status: 404 });
        return Response.json({ attachment: att }, { status: 201 });
      }
      // image: serve a public copy + let the Vision agent write what it shows
      const bytes = await readFile(resolved);
      const outDir = path.join('public', 'images', 'notebooks');
      await mkdir(outDir, { recursive: true });
      const ext = (body.fileName ?? '').toLowerCase().endsWith('.webp') ? 'webp' : (body.fileName ?? '').toLowerCase().match(/\.jpe?g$/) ? 'jpg' : 'png';
      const file = `att_${Date.now()}.${ext}`;
      await writeFile(path.join(outDir, file), bytes);
      let described = '';
      try {
        const seen = await describeImage({ imagePath: resolved, mime: body.mediaType ?? 'image/png' });
        const d = seen?.json ?? seen ?? {};
        described = [d.caption, d.whatItShows, d.keyDetails].filter(Boolean).join('\n\n').slice(0, 8000);
      } catch { /* the image still attaches; description is enrichment */ }
      const att = await addAttachment(session.userId, id, blockId, {
        kind: 'image', url: `/images/notebooks/${file}`, title: body.fileName ?? 'Image', content: described,
      });
      if (!att) return Response.json({ error: 'block not found' }, { status: 404 });
      return Response.json({ attachment: att }, { status: 201 });
    }
    return Response.json({ error: 'send {kind: link, url} or {kind: pdf|image, uploadId}' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e.message ?? e).slice(0, 200) }, { status: 422 });
  }
}

export async function PATCH(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id, blockId } = await params;
  const body = await request.json().catch(() => ({}));
  const ok = await setAttachmentMeta(session.userId, id, blockId, String(body.attachmentId ?? ''), { placement: body.placement, size: body.size });
  if (!ok) return Response.json({ error: 'attachment not found' }, { status: 404 });
  return Response.json({ ok: true });
}
