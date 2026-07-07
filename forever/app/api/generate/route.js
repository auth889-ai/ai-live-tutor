// POST /api/generate { text } -> ENQUEUES a lesson-generation job and returns { jobId } at once
// (HTTP 202). A full lesson is ~8 minutes of agent-society work — far too long to hold a
// request open — so the browser polls GET /api/generate/:id or subscribes to /stream for live
// progress, then loads the finished lesson from /api/lessons/:id. In production the job runs in
// a separate BullMQ worker; locally it runs in-process. Same code path either way.

import { enqueueLesson } from '../../../lib/queue/lesson-queue.js';
import { validateJobInput } from '../../../lib/queue/job-contract.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON { text }' }, { status: 400 });
  }

  let input;
  try {
    input = validateJobInput(body);
  } catch (error) {
    return Response.json({ error: String(error.message || error) }, { status: 400 });
  }

  const { jobId } = await enqueueLesson(input);
  return Response.json({ jobId }, { status: 202 });
}
