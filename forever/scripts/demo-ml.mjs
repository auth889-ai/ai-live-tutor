// ML-teacher hardening driver (scratch tool, safe to delete): enqueue ONE logistic-regression
// lesson through the REAL queue + worker — the first of the 14 one-by-one teacher proofs.
// What this run must demonstrate (checked after completion, not asserted):
//   1. the Teacher plans a MANIPULABLE scene (threshold/steepness — the cause-effect idea)
//   2. the domain-aware Pedagogy Critic audits against the Ng gate (math-before-intuition etc.)
//   3. the society transcript lands on every stored scene (the Audit Trail)
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
Spam filtering is the classic first classification problem. Start from a tiny dataset a
person can read: six emails, each with two features — the number of suspicious words
(like "free", "winner", "urgent") and the number of links — and a label, spam or not spam.
An email with 7 suspicious words and 4 links is spam; one with 0 suspicious words and 1
link is not. Logistic regression turns a weighted score of these features into a
probability using the sigmoid function: P(spam) = 1 / (1 + e^(-z)), where z = w1*words +
w2*links + b. The sigmoid squashes any score into the range 0 to 1: a score of 0 gives
probability 0.5, large positive scores approach 1, large negative scores approach 0. The
steepness of the transition depends on the weights: larger weights make the curve sharper,
so the model becomes more confident near the boundary. Training finds the weights that
minimize log loss on the labeled examples, moving them step by step with gradient descent;
the learning rate controls the step size, and a rate set too high makes the loss oscillate
instead of falling. After training, a decision threshold converts probability into a
verdict: the default 0.5 marks an email spam when P(spam) exceeds one half. The threshold
is a business decision, not a mathematical one. Lowering it to 0.3 catches more spam
(higher recall) but flags more legitimate mail (lower precision, more false positives);
raising it to 0.7 does the opposite — fewer false alarms, more spam slipping through
(false negatives). The confusion matrix makes the trade visible: true positives, false
positives, false negatives, true negatives, counted on held-out test emails the model
never saw during training. Accuracy alone misleads when classes are imbalanced: if only 2
of 100 emails are spam, a filter that marks everything "not spam" scores 98% accuracy
while catching nothing — which is why precision and recall, not accuracy, are the metrics
that matter here.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[ml-demo] enqueued job ${jobId} at ${new Date().toISOString()}`);

let last = '';
const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | scenesReady=${p.scenesReady ?? 0} | lessonId=${p.lessonId ?? '-'} | ${p.message}` : '(no progress yet)';
  if (line !== last) {
    last = line;
    console.log(`[ml-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`);
  }
  if (job.state === 'completed') {
    console.log(`[ml-demo] DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(job.result));
    process.exit(0);
  }
  if (job.state === 'failed') {
    console.log(`[ml-demo] FAILED in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(job.error ?? job));
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
