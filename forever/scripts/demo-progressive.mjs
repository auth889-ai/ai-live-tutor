// Progressive-playback demo driver (scratch tool, safe to delete): enqueue ONE ownerless
// text lesson through the REAL queue + worker, then print each progress event with its
// scenesReady count so the moment "watchable before finished" happens is visible in logs.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
Supply and demand is the engine of every market. Demand is the quantity of a good buyers
are willing to purchase at each price; it slopes downward because higher prices push
marginal buyers out. Supply is the quantity sellers offer at each price; it slopes upward
because higher prices make more production profitable. The market clears where the two
curves cross: the equilibrium price and quantity. When a news event raises buyers'
willingness to pay — say a heat wave and ice cream — the demand curve shifts right: at
every price, buyers want more. Price rises along the unchanged supply curve to a new
equilibrium with a higher price and higher quantity. A cost shock — sugar prices doubling —
shifts supply left instead: price rises but quantity falls. Students confuse movement
ALONG a curve (caused by price) with a SHIFT of the curve (caused by anything other than
price); that single distinction resolves most confusion. Price ceilings set below
equilibrium create shortages: quantity demanded exceeds quantity supplied and non-price
rationing appears, like queues.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[demo] enqueued job ${jobId} at ${new Date().toISOString()}`);

let last = '';
const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | scenesReady=${p.scenesReady ?? 0} | lessonId=${p.lessonId ?? '-'} | ${p.message}` : '(no progress yet)';
  if (line !== last) {
    last = line;
    console.log(`[demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`);
  }
  if (job.state === 'completed') {
    console.log(`[demo] DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(job.result));
    break;
  }
  if (job.state === 'failed') {
    console.error(`[demo] FAILED: ${job.error}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
process.exit(0);
