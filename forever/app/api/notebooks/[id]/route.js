// /api/notebooks/[id] — one notebook with its typed blocks (owner-checked), metadata edits,
// delete (cascades to blocks in the store).

import { getNotebook, updateNotebook, deleteNotebook, listBacklinks } from '../../../../lib/storage/notebook-store.js';
import { sessionFromRequest } from '../../../../lib/auth/session.js';

export async function GET(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const found = await getNotebook(session.userId, id);
  if (!found) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ ...found, backlinks: await listBacklinks(session.userId, id) });
}

export async function PATCH(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const ok = await updateNotebook(session.userId, id, body);
  return ok ? Response.json({ ok: true }) : Response.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const ok = await deleteNotebook(session.userId, id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: 'not found' }, { status: 404 });
}
