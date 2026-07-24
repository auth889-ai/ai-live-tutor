// POST /api/lessons/:id/ask { question, sceneId? } -> the lesson's teacher answers the
// student's question (Ask-the-Tutor). Privacy identical to the lesson itself: an owned
// lesson answers only its owner; ownerless lessons answer anyone. Source chunks come from
// the parent course when the lesson belongs to one (real grounding, not vibes).

import { loadLesson } from '../../../../../lib/storage/lesson-store.js';
import { loadCourse } from '../../../../../lib/storage/course-store.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';
import { answerQuestion } from '../../../../../lib/orchestration/agents/tutor/answer-question.js';

export async function POST(request, { params }) {
  const { id } = await params;
  const session = sessionFromRequest(request);
  const lesson = await loadLesson(id, { forUser: session?.userId ?? null });
  if (!lesson) return Response.json({ error: 'Lesson not found' }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON: { question, sceneId? }' }, { status: 400 });
  }
  const question = String(body.question ?? '').trim();
  if (question.length < 3 || question.length > 600) {
    return Response.json({ error: 'Ask a real question (3-600 characters)' }, { status: 400 });
  }

  // Grounding material: the parent course carries the source pack for course lessons.
  let chunks = [];
  if (lesson.courseRef?.courseId) {
    const course = await loadCourse(lesson.courseRef.courseId, { forUser: session?.userId ?? null }).catch(() => null);
    chunks = course?.sourcePack?.chunks ?? [];
  }

  try {
    const { answer, grounding, followUp } = await answerQuestion({
      lesson,
      sceneId: String(body.sceneId ?? ''),
      question,
      chunks,
    });
    // VOICED ANSWER: the tutor SPEAKS its explanation (same voice as the lesson). Returned
    // as a data URL — Q&A clips are ephemeral (no store cleanup), and the per-text TTS
    // cache still deduplicates repeat questions. Voice failure never blocks the text answer.
    let audio = null;
    if (process.env.DISABLE_TTS !== '1' && body.voice !== false) {
      try {
        const { pickSynth } = await import('../../../../../lib/tts/voice-lesson.js');
        const speech = [answer, followUp].filter(Boolean).join(' ');
        const clip = await pickSynth()({ text: speech.slice(0, 2500) });
        if (clip?.bytes?.length) audio = `data:audio/mpeg;base64,${Buffer.from(clip.bytes).toString('base64')}`;
      } catch (error) {
        console.error(`[ask] answer voicing failed (text answer still served): ${String(error?.message).slice(0, 120)}`);
      }
    }
    return Response.json({ answer, grounding, followUp, ...(audio ? { audio } : {}) });
  } catch (error) {
    return Response.json({ error: 'The tutor could not answer right now — try again.', detail: String(error?.message).slice(0, 200) }, { status: 502 });
  }
}
