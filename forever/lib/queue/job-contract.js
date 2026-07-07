// Lesson-generation job contract (pure, tested). The shared shape between the API (producer),
// the worker (consumer), and the browser (progress stream) — so all three agree without
// importing each other. One job = "turn this text into a full lesson", ~8 minutes of agent
// society work; too long for a request, so it runs as a background job with live progress.

export const JOB_NAME = 'generate-lesson';

// Lifecycle phases the browser can render as a real progress bar (not a fake spinner).
export const PHASES = Object.freeze(['queued', 'routing', 'planning', 'generating', 'saving', 'done', 'failed']);

// Coarse percent floor per phase; scene generation fills 30->90 as scenes complete.
const PHASE_FLOOR = Object.freeze({ queued: 0, routing: 5, planning: 15, generating: 30, saving: 92, done: 100, failed: 100 });

export function validateJobInput(input) {
  if (!input || typeof input !== 'object') throw new Error('job input must be an object');
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length < 60) throw new Error('job input needs at least 60 characters of learning material');
  return { text };
}

// Build a normalized progress object. During "generating" the percent interpolates across
// scenes so the bar advances as each scene finishes (real progress, from the society).
export function makeProgress({ phase, message = '', sceneDone = 0, sceneTotal = 0, lessonId = null }) {
  if (!PHASES.includes(phase)) throw new Error(`unknown job phase: ${phase}`);
  let percent = PHASE_FLOOR[phase];
  if (phase === 'generating' && sceneTotal > 0) {
    const span = PHASE_FLOOR.saving - PHASE_FLOOR.generating; // 30 -> 92
    percent = PHASE_FLOOR.generating + Math.round((Math.min(sceneDone, sceneTotal) / sceneTotal) * span);
  }
  return { phase, percent, message, sceneDone, sceneTotal, lessonId };
}

export function isTerminal(phase) {
  return phase === 'done' || phase === 'failed';
}
