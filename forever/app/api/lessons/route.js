// GET /api/lessons -> the SIGNED-IN user's lesson ids (their library). Privacy: scoped to the
// session's user in the data layer; other users' lessons are invisible.

import { listLessonIds } from '../../../lib/storage/lesson-store.js';
import { sessionFromRequest } from '../../../lib/auth/session.js';

export async function GET(request) {
  const session = sessionFromRequest(request);
  return Response.json({ lessons: await listLessonIds({ forUser: session?.userId ?? null }) });
}
