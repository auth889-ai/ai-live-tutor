// GET /api/lessons/:id -> a stored lesson manifest (consumed by the player / export).

import { loadLesson } from '../../../../lib/storage/lesson-store.js';

export async function GET(_request, { params }) {
  const { id } = await params;
  const lesson = await loadLesson(id);
  if (!lesson) return Response.json({ error: 'Lesson not found' }, { status: 404 });
  return Response.json(lesson);
}
