// GET /api/jobs/:id -> current job status { id, state, progress, result, error }. The client
// polls this (or subscribes to /api/jobs/:id/events) after POST /api/jobs. When state is
// "completed", result.lessonId points at the finished lesson to load from /api/lessons/:id.

import { getLessonJob } from '../../../../lib/queue/lesson-queue.js';

export async function GET(_request, { params }) {
  const { id } = await params;
  const job = await getLessonJob(id);
  if (!job) return Response.json({ error: 'Unknown job' }, { status: 404 });
  return Response.json(job);
}
