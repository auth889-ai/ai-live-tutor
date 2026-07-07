// GET /api/courses/:id -> a stored course (outline + lesson links), owner-scoped: someone
// else's course 404s exactly like a missing one. The embedded sourcePack stays server-side.

import { loadCourse } from '../../../../lib/storage/course-store.js';
import { sessionFromRequest } from '../../../../lib/auth/session.js';

export async function GET(request, { params }) {
  const { id } = await params;
  const session = sessionFromRequest(request);
  const course = await loadCourse(id, { forUser: session?.userId ?? null });
  if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });
  const { sourcePack, ...publicCourse } = course; // material stays private to the pipeline
  return Response.json(publicCourse);
}
