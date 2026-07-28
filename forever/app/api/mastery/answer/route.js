// POST /api/mastery/answer { lessonId, questionId, skillId, correct } -> { mastery, route }
// The BKT runtime endpoint: a judged quiz answer updates the student's per-skill mastery
// (skillId = the source chunk the question teaches, from the quiz object's
// sourceRef.chunkId) and returns the deterministic route the player acts on:
// reteach | guided_practice | faded_practice | transfer. Session-scoped like every data
// route (/api/study pattern): the record belongs to the signed-in student, always keyed
// by their own userId — never a caller-supplied one.

import { sessionFromRequest } from '../../../../lib/auth/session.js';
import { recordAnswer } from '../../../../lib/mastery/store.js';

export async function POST(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const skillId = String(body.skillId ?? '').trim();
  if (!skillId) {
    return Response.json({ error: 'skillId is required — the source chunk id this question targets' }, { status: 400 });
  }
  if (typeof body.correct !== 'boolean') {
    return Response.json({ error: 'correct must be a boolean — the judged answer, not the raw choice' }, { status: 400 });
  }

  try {
    const result = await recordAnswer({
      userId: session.userId,
      lessonId: body.lessonId ? String(body.lessonId).slice(0, 200) : null,
      questionId: body.questionId ? String(body.questionId).slice(0, 200) : null,
      skillId: skillId.slice(0, 200),
      correct: body.correct,
    });
    return Response.json({ mastery: result.mastery, route: result.route, attempts: result.attempts });
  } catch (error) {
    return Response.json({ error: 'could not record the answer', detail: String(error?.message).slice(0, 200) }, { status: 500 });
  }
}
