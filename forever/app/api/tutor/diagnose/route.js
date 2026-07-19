// /api/tutor/diagnose — the adaptive tutoring endpoint: a wrong answer in -> a targeted
// diagnosis + re-teach out. The 2-sigma tutor move (respond to THIS student's error),
// served live because it depends on the actual answer and cannot be pre-generated.
import { diagnoseWrongAnswer } from '../../../../lib/orchestration/agents/tutor/diagnose.js';
import { loadLesson } from '../../../../lib/storage/lesson-store.js';

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad request' }, { status: 400 }); }
  const { question, correctAnswer, studentAnswer, concept, lessonId } = body ?? {};
  if (!question || typeof correctAnswer === 'undefined' || typeof studentAnswer === 'undefined') {
    return Response.json({ error: 'question, correctAnswer, studentAnswer required' }, { status: 400 });
  }
  let domain = 'general';
  try { const lesson = lessonId ? await loadLesson(lessonId) : null; domain = lesson?.domain ?? lesson?.payload?.domain ?? 'general'; } catch { /* default */ }
  try {
    const result = await diagnoseWrongAnswer({ question, correctAnswer, studentAnswer, concept, domain });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
