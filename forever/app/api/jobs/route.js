// POST /api/jobs { text } -> create a lesson-generation JOB, return { jobId } at once (HTTP 202).
// A full lesson is ~8 minutes of agent-society work — too long to hold a request open — so the
// client tracks GET /api/jobs/:id (or subscribes to /api/jobs/:id/events) for live progress, then
// loads the finished lesson from /api/lessons/:id. In production the job runs in a separate BullMQ
// worker; locally it runs in-process. Same code path either way.
//
// "jobs" is the async-work resource; "lessons" is the finished-output resource — kept distinct.

import { enqueueLesson } from '../../../lib/queue/lesson-queue.js';
import { validateJobInput } from '../../../lib/queue/job-contract.js';
import { sessionFromRequest } from '../../../lib/auth/session.js';
import { resolveUpload } from '../../../lib/storage/upload-store.js';

export async function POST(request) {
  // Auth is enforced IN the route (never middleware-only). Generation costs real tokens, and the
  // resulting lesson must belong to someone.
  const session = sessionFromRequest(request);
  if (!session) return Response.json({ error: 'Sign in to generate a course' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON: { input: { type, ... } } or { text }' }, { status: 400 });
  }

  // Typed input spec ({ input: { type: text|pdf|url|image } }); bare { text } still accepted.
  const spec = body.input && typeof body.input === 'object'
    ? { ...body.input }
    : typeof body.text === 'string' ? { type: 'text', text: body.text } : null;
  if (!spec) return Response.json({ error: 'Provide { input: { type: text|pdf|url|image, ... } }' }, { status: 400 });

  // An uploadId resolves ONLY inside the caller's own upload store — cross-user file
  // access is structurally impossible, and raw client paths are never accepted.
  delete spec.path;
  if (spec.uploadId) {
    const resolved = await resolveUpload(session.userId, spec.uploadId);
    if (!resolved) return Response.json({ error: 'Upload not found — upload the file first' }, { status: 400 });
    spec.path = resolved;
    delete spec.uploadId;
  }

  let input;
  try {
    // ownerId comes from the verified session — a client-supplied ownerId is ignored.
    input = validateJobInput({ input: spec, ownerId: session.userId });
  } catch (error) {
    return Response.json({ error: String(error.message || error) }, { status: 400 });
  }

  const { jobId } = await enqueueLesson(input, { priority: 1 }); // a user is WAITING on this one
  return Response.json({ jobId }, { status: 202 });
}
