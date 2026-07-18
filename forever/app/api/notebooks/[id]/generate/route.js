// /api/notebooks/[id]/generate — the notebook's payoff: your collected blocks become a course.
// Assembles the text-bearing blocks and enqueues the SAME lesson-generation job the studio uses
// (one pipeline, no parallel path); the notebook keeps a backlink to the job for progress UI.

import { getNotebook, setGeneration, assembleNotebookText } from '../../../../../lib/storage/notebook-store.js';
import { enqueueLesson } from '../../../../../lib/queue/lesson-queue.js';
import { validateJobInput } from '../../../../../lib/queue/job-contract.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const found = await getNotebook(session.userId, id);
  if (!found) return Response.json({ error: 'not found' }, { status: 404 });

  const text = assembleNotebookText(found.blocks);
  if (text.trim().length < 60) {
    return Response.json({ error: `This notebook holds ${text.trim().length} characters of text — add a few more notes (60+ characters) and the course generator has enough to teach from.` }, { status: 422 });
  }

  let jobId;
  try {
    const input = validateJobInput({
      input: { type: 'text', text, title: found.notebook.title, course: body.course === true },
      ownerId: session.userId,
    });
    ({ jobId } = await enqueueLesson(input));
  } catch (e) {
    return Response.json({ error: String(e.message ?? e) }, { status: 400 });
  }
  await setGeneration(session.userId, id, { jobId });
  return Response.json({ jobId }, { status: 202 });
}
