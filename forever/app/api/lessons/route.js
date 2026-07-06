// GET /api/lessons -> list stored lesson ids (for the library / dashboard).

import { listLessonIds } from '../../../lib/storage/lesson-store.js';

export async function GET() {
  return Response.json({ lessons: await listLessonIds() });
}
