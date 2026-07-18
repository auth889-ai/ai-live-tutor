// /api/notebooks — the Sankofa-pattern notebook library. GET = the signed-in user's notebook
// cards (owner-scoped in the data layer). POST = create one. Design contract:
// notes/research/notebook-sankofa-plan-18jul.md.

import { createNotebook, listNotebooksFor } from '../../../lib/storage/notebook-store.js';
import { sessionFromRequest } from '../../../lib/auth/session.js';

export async function GET(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const notebooks = await listNotebooksFor(session.userId);
  return Response.json({
    notebooks: notebooks.map((n) => ({
      id: n._id, title: n.title, intent: n.intent, blockCount: n.blockCount ?? 0,
      cover: n.cover, generatedCourseId: n.generatedCourseId, lastGeneratedJobId: n.lastGeneratedJobId,
      updatedAt: n.updatedAt, createdAt: n.createdAt,
    })),
  });
}

export async function POST(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const doc = await createNotebook({ userId: session.userId, title: body.title, intent: body.intent });
  if (!doc) return Response.json({ error: 'notebooks need the database' }, { status: 503 });
  return Response.json({ id: doc._id }, { status: 201 });
}
