// Physics teacher proof (4 of 14): projectile motion, Mazur-shaped — the staked-prediction
// register's flagship case. Verified after: PRETEST/prediction first, manipulable placed
// (angle or velocity), physics gate firing, misconception CHALLENGED with evidence.
import { enqueueLesson, getLessonJob } from '../lib/queue/lesson-queue.js';

const MATERIAL = `
Here is a bet almost everyone loses. Stand on a table. At the same instant, drop one ball
straight down and throw an identical ball perfectly horizontally. Which hits the ground
first? Most people say the dropped ball — the thrown one "has farther to travel." They land
at exactly the same instant, and the reason is the deepest idea in projectile motion:
horizontal and vertical motion are completely independent. Gravity pulls both balls down
identically; the thrown ball's sideways speed does nothing to its fall.

Projectile motion separates into two independent components. Horizontally there is no force
(ignoring air resistance), so horizontal velocity never changes: x = vx * t. Vertically,
gravity accelerates the object downward at g = 9.8 m/s^2, so vy(t) = vy0 - g*t and
y = vy0*t - 4.9*t^2. The path these two produce together is a parabola.

Take a concrete launch: speed 20 m/s at 30 degrees above horizontal. The components are
vx = 20*cos(30) = 17.32 m/s and vy0 = 20*sin(30) = 10 m/s exactly. The ball rises until
vy = 0 at t = 10/9.8 = 1.02 s, reaching apex height vy0^2/(2g) = 100/19.6 = 5.1 m. By
symmetry it lands at t = 2.04 s, having covered range = 17.32 * 2.04 = 35.3 m. At the apex
the VELOCITY is horizontal (17.32 m/s) but the ACCELERATION is still 9.8 m/s^2 straight
down — the second classic misconception is believing acceleration is zero at the top, when
gravity never stops acting for a single instant.

What changes the flight? Increase the launch angle and the flight lasts longer but the
horizontal speed drops; 45 degrees gives the maximum range on flat ground (with air
resistance the real optimum is lower, nearer 35 degrees for a thrown ball). Increase launch
speed and the range grows with the SQUARE of the speed — double the speed, four times the
range, because both the flight time and the horizontal velocity double. On the Moon, with
g = 1.6 m/s^2, the same 20 m/s throw at 30 degrees stays up 12.5 s and lands 216 m away —
same physics, smaller g.

Units are the guardrail: velocities in m/s, acceleration in m/s^2, positions in meters. Any
equation whose left and right sides disagree in units is wrong before you compute a single
number.
`.trim();

const { jobId } = await enqueueLesson({ input: { type: 'text', text: MATERIAL }, ownerId: null });
console.log(`[physics-demo] enqueued job ${jobId}`);
let last = ''; const t0 = Date.now();
for (;;) {
  const job = await getLessonJob(jobId);
  if (!job) throw new Error('job vanished');
  const p = job.progress;
  const line = p ? `${p.phase} ${p.percent}% | ${p.lessonId ?? '-'} | ${p.message}` : '…';
  if (line !== last) { last = line; console.log(`[physics-demo +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); }
  if (job.state === 'completed') { console.log('[physics-demo] DONE:', JSON.stringify(job.result)); process.exit(0); }
  if (job.state === 'failed') { console.log('[physics-demo] FAILED:', JSON.stringify(job.error ?? job)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
