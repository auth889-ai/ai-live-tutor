// POST /api/generate  { text } -> generates a lesson via the agent society, stores it,
// returns { id }. Synchronous for now; Phase 4 converts this to a queued BullMQ job with
// an SSE progress stream (ARCHITECTURE.md §4) so the browser doesn't hold a long request.

import { generateLessonFromText } from '../../../lib/generation/lesson/generate-lesson.js';
import { saveLesson } from '../../../lib/storage/lesson-store.js';

export const maxDuration = 300;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON { text }' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 60) {
    return Response.json({ error: 'Provide at least 60 characters of learning material' }, { status: 400 });
  }

  try {
    const lesson = await generateLessonFromText(text);
    const id = `lesson_${lesson.sourcePackId.replace(/[^a-z0-9]/gi, '').slice(0, 16)}`;
    await saveLesson(id, lesson);
    return Response.json({ id, lessonTitle: lesson.lessonTitle, scenes: lesson.scenes.length });
  } catch (error) {
    // Honest failure — no fake lesson is ever returned.
    return Response.json({ error: String(error.message || error) }, { status: 500 });
  }
}
