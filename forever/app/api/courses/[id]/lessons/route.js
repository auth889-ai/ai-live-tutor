// POST /api/courses/:id/lessons { outlineLessonId } -> enqueue generation of ONE more
// lesson of this course (202 + jobId, same job machinery as everything else). Ownership is
// enforced by loading the course AS the caller before enqueueing.

import { enqueueLesson } from '../../../../../lib/queue/lesson-queue.js';
import { validateJobInput } from '../../../../../lib/queue/job-contract.js';
import { loadCourse } from '../../../../../lib/storage/course-store.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';

export async function POST(request, { params }) {
  const { id } = await params;
  const session = sessionFromRequest(request);
  if (!session) return Response.json({ error: 'Sign in to generate lessons' }, { status: 401 });

  const course = await loadCourse(id, { forUser: session.userId });
  if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON { outlineLessonId }' }, { status: 400 });
  }

  let input;
  try {
    input = validateJobInput({
      input: { type: 'course-lesson', courseId: id, outlineLessonId: body.outlineLessonId },
      ownerId: session.userId,
    });
  } catch (error) {
    return Response.json({ error: String(error.message || error) }, { status: 400 });
  }

  const { jobId } = await enqueueLesson(input);
  return Response.json({ jobId }, { status: 202 });
}
