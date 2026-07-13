// PDF-lesson demo driver (scratch tool, safe to delete): enqueue ONE ownerless lesson
// from a PDF file through the REAL queue + worker (MinerU parse -> figures + captions ->
// source-figures-first board -> gates), printing progress like demo-progressive.mjs.
// Usage: node --env-file=.env scripts/demo-pdf.mjs "/abs/path/to/file.pdf"
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const pdfPath = process.argv[2];
if (!pdfPath) throw new Error('usage: demo-pdf.mjs <pdf path>');

const { jobId } = await enqueueLesson({ input: { type: 'pdf', path: pdfPath }, ownerId: null });
console.log(`[demo-pdf] enqueued job ${jobId} for ${pdfPath}`);

let last = '';
const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | scenesReady=${p.scenesReady ?? 0} | ${p.message}` : '(no progress yet)';
  if (line !== last) {
    last = line;
    console.log(`[demo-pdf +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`);
  }
  if (job.state === 'completed') {
    console.log(`[demo-pdf] DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(job.result));
    break;
  }
  if (job.state === 'failed') {
    console.error(`[demo-pdf] FAILED: ${job.error}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
process.exit(0);
