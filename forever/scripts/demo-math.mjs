// Math-teacher proof driver (scratch tool, safe to delete): one quadratics/derivative lesson
// through the REAL queue + worker — teacher 3 of the 14 one-by-one proofs. Checked after
// completion: (1) 3B1B register obeyed (question-first, NEVER formula-first — the math gate),
// (2) a manipulable on the cause-effect scene (coefficient/slope), (3) transcripts everywhere,
// (4) any tree/flowchart drawn dynamically renders via React Flow (the user's correctness ask).
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
Why does a ball thrown upward trace the same curve as a satellite dish's cross-section? Both
are parabolas: the graph of y = ax^2 + bx + c. The coefficient a controls the shape: a positive
a opens the parabola upward, a negative a flips it to open downward, and the closer a gets to
zero the flatter the curve becomes. At a = 0 the parabola degenerates into a straight line.
Try one concrete case: y = x^2 at x = 3 gives 9, at x = -3 also 9 — the curve is symmetric
around its vertex, the lowest (or highest) point. The vertex of y = ax^2 + bx + c sits at
x = -b/(2a), which for y = x^2 - 4x + 3 means x = 2, y = -1.
The derivative answers a different question: how fast is y changing at each x? For y = x^2 the
slope at any point is 2x — at x = 3 the curve climbs at rate 6, at x = 0 it is momentarily
flat, at x = -3 it falls at rate 6. The derivative of a parabola is always a straight line,
which is why constant acceleration (gravity) produces parabolic motion: acceleration is the
derivative of velocity, and velocity is the derivative of position. Students often believe the
derivative at a point is the same as the function's value there — but y = x^2 at x = 1 has
value 1 while its slope is 2; the two answer different questions entirely. A second common
mistake: thinking a negative derivative means the function is negative, when it only means the
function is DECREASING — y = x^2 - 4x + 3 is positive at x = 0 yet falling at rate -4.
To find where a parabola stops falling and starts rising, set the derivative to zero:
2x - 4 = 0 gives x = 2, exactly the vertex. This is the seed of optimization: minima and
maxima live where the slope vanishes.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[math-demo] enqueued job ${jobId} at ${new Date().toISOString()}`);

let last = '';
const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | scenesReady=${p.scenesReady ?? 0} | lessonId=${p.lessonId ?? '-'} | ${p.message}` : '(no progress yet)';
  if (line !== last) {
    last = line;
    console.log(`[math-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`);
  }
  if (job.state === 'completed') {
    console.log(`[math-demo] DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(job.result));
    process.exit(0);
  }
  if (job.state === 'failed') {
    console.log(`[math-demo] FAILED:`, JSON.stringify(job.error ?? job));
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
