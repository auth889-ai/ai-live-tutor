// POST /api/lessons/:id/ask-scene { question, sceneId? } — the student's question becomes
// a FRESH interactive board scene (the full society pipeline: retrieve → plan → board →
// grounded marks → narration → voice → review gates). Privacy identical to the lesson.
// This is the heavyweight sibling of /ask (text+voice answer): expect 1-3 minutes.

import { loadLesson } from '../../../../../lib/storage/lesson-store.js';
import { loadCourse } from '../../../../../lib/storage/course-store.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';
import { answerWithScene } from '../../../../../lib/orchestration/agents/tutor/answer-scene.js';

export const maxDuration = 300;

export async function POST(request, { params }) {
  const { id } = await params;
  const session = sessionFromRequest(request);
  const lesson = await loadLesson(id, { forUser: session?.userId ?? null });
  if (!lesson) return Response.json({ error: 'Lesson not found' }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Body must be JSON: { question }' }, { status: 400 }); }
  const question = String(body.question ?? '').trim();
  if (question.length < 3 || question.length > 600) {
    return Response.json({ error: 'Ask a real question (3-600 characters)' }, { status: 400 });
  }

  let sourcePack = null;
  let chunks = [];
  if (lesson.courseRef?.courseId) {
    const course = await loadCourse(lesson.courseRef.courseId, { forUser: session?.userId ?? null }).catch(() => null);
    sourcePack = course?.sourcePack ?? null;
    chunks = sourcePack?.chunks ?? [];
  }

  try {
    const { scene } = await answerWithScene({
      lesson,
      question,
      sourcePack,
      chunks,
      domain: lesson.domain ?? 'general',
    });
    return Response.json({ scene });
  } catch (error) {
    return Response.json({ error: `The tutor could not build a scene for this question: ${String(error?.message).slice(0, 200)}` }, { status: 502 });
  }
}
