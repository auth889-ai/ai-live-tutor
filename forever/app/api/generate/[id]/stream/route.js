// GET /api/generate/:id/stream -> Server-Sent Events of live job progress. Emits one "progress"
// event per poll (phase + percent + scene counts) and a final "done" or "error" event, then
// closes. Backend-agnostic: it polls getLessonJob, so it works identically over BullMQ+Redis
// (worker updates job.progress) and the in-process backend. The browser renders a real progress
// bar from these events instead of a fake spinner.

import { getLessonJob } from '../../../../../lib/queue/lesson-queue.js';
import { isTerminal } from '../../../../../lib/queue/job-contract.js';

export const dynamic = 'force-dynamic';

const POLL_MS = 1000;
const MAX_MS = 20 * 60 * 1000; // stop streaming after 20 min — a job this long has failed

export async function GET(_request, { params }) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const started = Date.now();
      let lastPhase = null;
      let lastPercent = -1;

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const job = await getLessonJob(id);
          if (!job) {
            send('error', { error: 'Unknown job' });
            break;
          }
          const p = job.progress;
          // Only push when something actually changed — keeps the stream quiet and cheap.
          if (p && (p.phase !== lastPhase || p.percent !== lastPercent)) {
            lastPhase = p.phase;
            lastPercent = p.percent;
            send('progress', p);
          }
          if (job.state === 'completed') {
            send('done', job.result ?? {});
            break;
          }
          if (job.state === 'failed' || (p && isTerminal(p.phase) && p.phase === 'failed')) {
            send('error', { error: job.error ?? 'Job failed' });
            break;
          }
          if (Date.now() - started > MAX_MS) {
            send('error', { error: 'Timed out waiting for the job' });
            break;
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch (error) {
        send('error', { error: String(error?.message || error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
