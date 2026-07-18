// POST /api/notebooks/capture — the Xournal++ pattern (AudioElement.timestamp ->
// startPlayback(file, timestamp)), lesson-sized: one keystroke in the player saves THIS
// teaching moment into the lesson's own notebook — scene, narration time, and the exact
// sentence being spoken ride along, and the block links back to replay that second.

import { listNotebooksFor, createNotebook, addBlock } from '../../../../lib/storage/notebook-store.js';
import { sessionFromRequest } from '../../../../lib/auth/session.js';
import { bumpDay } from '../../../../lib/storage/study-store.js';

export async function POST(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const lessonId = String(body.lessonId ?? '');
  if (!lessonId) return Response.json({ error: 'lessonId required' }, { status: 400 });
  const lessonTitle = String(body.lessonTitle ?? lessonId).slice(0, 160);
  const sceneIndex = Number.isInteger(body.sceneIndex) ? body.sceneIndex : 0;
  const tMs = Math.max(0, Math.round(Number(body.tMs) || 0));

  // One notebook per lesson, auto-created on first capture — the student never files anything.
  const mine = await listNotebooksFor(session.userId);
  let notebook = mine.find((n) => String(n.title).trim().toLowerCase() === lessonTitle.trim().toLowerCase());
  if (!notebook) notebook = await createNotebook({ userId: session.userId, title: lessonTitle, intent: 'course notes — captured moments from the lesson' });
  if (!notebook) return Response.json({ error: 'notebooks need the database' }, { status: 503 });

  const mins = Math.floor(tMs / 60000);
  const secs = Math.floor((tMs % 60000) / 1000);
  const block = await addBlock({
    userId: session.userId,
    notebookId: notebook._id,
    type: 'moment',
    title: `Scene ${sceneIndex + 1}${body.sceneTitle ? ` — ${String(body.sceneTitle).slice(0, 100)}` : ''} · ${mins}:${String(secs).padStart(2, '0')}`,
    content: String(body.note ?? '').slice(0, 2000),
    transcript: String(body.context ?? '').slice(0, 500),
    url: `/course/${lessonId}?scene=${sceneIndex}&t=${tMs}`,
    source: 'captured',
    trust: 'user',
    origin: lessonTitle,
  });
  await bumpDay(session.userId, 'notebook').catch(() => {});
  return Response.json({ notebookId: notebook._id, block }, { status: 201 });
}
