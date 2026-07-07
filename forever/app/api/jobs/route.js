// POST /api/jobs { text } -> create a lesson-generation JOB, return { jobId } at once (HTTP 202).
// A full lesson is ~8 minutes of agent-society work — too long to hold a request open — so the
// client tracks GET /api/jobs/:id (or subscribes to /api/jobs/:id/events) for live progress, then
// loads the finished lesson from /api/lessons/:id. In production the job runs in a separate BullMQ
// worker; locally it runs in-process. Same code path either way.
//
// "jobs" is the async-work resource; "lessons" is the finished-output resource — kept distinct.

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
