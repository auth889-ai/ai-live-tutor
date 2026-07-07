// GET /api/jobs/:id/events -> Server-Sent Events of live job progress (consumed by the browser's
// EventSource). Emits a "progress" event per change (phase + percent + scene counts) and a final
// "done" or "error" event, then closes. Backend-agnostic: it polls getLessonJob, so it works
// identically over BullMQ+Redis (worker updates job.progress) and the in-process backend. The
// browser renders a real progress bar from these events instead of a fake spinner.

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
      let warnedNoWorker = false;
      const NO_WORKER_MS = 8000; // if still queued after this, no worker is consuming

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
          // Guard against the silent "0% forever" hang: if the job is still waiting/queued after
          // a few seconds, no worker is picking it up — tell the user instead of spinning.
          if (!warnedNoWorker && (job.state === 'waiting' || p?.phase === 'queued') && Date.now() - started > NO_WORKER_MS) {
            warnedNoWorker = true;
            send('progress', { phase: 'queued', percent: 0, message: 'Still queued — is the worker running? Start it with: npm run worker' });
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
