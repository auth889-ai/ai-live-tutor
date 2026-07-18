// POST /api/notebooks/[id]/cover — the user's own photo as the notebook cover:
// resolve the upload, copy it into public, point notebook.cover at it. No AI involved.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { updateNotebook } from '../../../../../lib/storage/notebook-store.js';
import { resolveUpload } from '../../../../../lib/storage/upload-store.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const resolved = await resolveUpload(session.userId, String(body.uploadId ?? ''));
  if (!resolved) return Response.json({ error: 'upload not found' }, { status: 400 });
  const bytes = await readFile(resolved);
  const outDir = path.join('public', 'images', 'notebooks');
  await mkdir(outDir, { recursive: true });
  const ext = (body.fileName ?? '').toLowerCase().endsWith('.webp') ? 'webp' : (body.fileName ?? '').toLowerCase().match(/\.jpe?g$/) ? 'jpg' : 'png';
  const file = `cover_${id.slice(4, 12)}_${Date.now()}.${ext}`;
  await writeFile(path.join(outDir, file), bytes);
  const cover = `/images/notebooks/${file}`;
  const ok = await updateNotebook(session.userId, id, { cover });
  if (!ok) return Response.json({ error: 'notebook not found' }, { status: 404 });
  return Response.json({ cover });
}
