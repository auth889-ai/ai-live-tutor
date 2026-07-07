// GET /api/lessons/:id -> a stored lesson manifest (consumed by the player / export).
// Privacy: an owned lesson is only returned to its owner — anyone else gets the same 404 as a
// missing lesson (no existence probing).

import { loadLesson } from '../../../../lib/storage/lesson-store.js';
import { sessionFromRequest } from '../../../../lib/auth/session.js';

export async function GET(request, { params }) {
  const { id } = await params;
  const session = sessionFromRequest(request);
  const lesson = await loadLesson(id, { forUser: session?.userId ?? null });
  if (!lesson) return Response.json({ error: 'Lesson not found' }, { status: 404 });
  return Response.json(lesson);
}
