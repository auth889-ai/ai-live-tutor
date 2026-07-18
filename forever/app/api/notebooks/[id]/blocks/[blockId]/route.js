// /api/notebooks/[id]/blocks/[blockId] — edit (content/title/seq) or remove one block.

import { updateBlock, removeBlock, rebuildBlockLinks, removeBlockLinks } from '../../../../../../lib/storage/notebook-store.js';
import { sessionFromRequest } from '../../../../../../lib/auth/session.js';

export async function PATCH(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id, blockId } = await params;
  const body = await request.json().catch(() => ({}));
  const ok = await updateBlock(session.userId, id, blockId, body);
  if (ok && body.content !== undefined) {
    await rebuildBlockLinks({ userId: session.userId, notebookId: id, blockId, text: String(body.content) }).catch(() => {});
  }
  return ok ? Response.json({ ok: true }) : Response.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id, blockId } = await params;
  const ok = await removeBlock(session.userId, id, blockId);
  if (ok) await removeBlockLinks(session.userId, blockId).catch(() => {});
  return ok ? Response.json({ ok: true }) : Response.json({ error: 'not found' }, { status: 404 });
}
