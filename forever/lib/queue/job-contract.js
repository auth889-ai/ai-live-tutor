// Lesson-generation job contract (pure, tested). The shared shape between the API (producer),
// the worker (consumer), and the browser (progress stream) — so all three agree without
// importing each other. One job = "turn this text into a full lesson", ~8 minutes of agent
// society work; too long for a request, so it runs as a background job with live progress.

export const JOB_NAME = 'generate-lesson';

// The worker refreshes this Redis key on a short TTL; /api/health reads it to know a worker is
// alive (this is what makes a "no worker -> 0% forever" state observable instead of silent).
export const WORKER_HEARTBEAT_KEY = 'forever:worker:heartbeat';

// Lifecycle phases the browser can render as a real progress bar (not a fake spinner).
export const PHASES = Object.freeze(['queued', 'routing', 'planning', 'generating', 'voicing', 'saving', 'done', 'failed']);

// Coarse percent floor per phase; generation fills 30->70 and voicing 70->92 as scenes complete.
const PHASE_FLOOR = Object.freeze({ queued: 0, routing: 5, planning: 15, generating: 30, voicing: 70, saving: 92, done: 100, failed: 100 });

// Phases whose percent interpolates per-scene toward the NEXT phase's floor.
const PHASE_SPAN_END = Object.freeze({ generating: 'voicing', voicing: 'saving' });

// A job's material is a TYPED input spec — { type: text|pdf|url|image, ... } — matching the
// source-pack dispatcher. Legacy { text } bodies normalize to the text type so old callers
// keep working. File paths are resolved by the SERVER from the caller's own uploads (a raw
// client path is never trusted); ownerId likewise comes from the verified session only.
export function validateJobInput(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('job input must be an object');
  const ownerId = typeof raw.ownerId === 'string' && raw.ownerId.trim() ? raw.ownerId : null;
  const spec = raw.input && typeof raw.input === 'object'
    ? raw.input
    : typeof raw.text === 'string' ? { type: 'text', text: raw.text } : null;
  if (!spec) throw new Error('job needs an input: { type: text|pdf|url|image, ... }');

  // course: true on any material spec = build a FULL course (Dean outline + first lesson)
  // instead of a single lesson. Boolean-coerced here so the worker never sees junk.
  const course = spec.course === true;

  if (spec.type === 'text') {
    const text = (spec.text || '').trim();
    if (text.length < 60) throw new Error('job input needs at least 60 characters of learning material');
    const title = (spec.title || '').trim();
    return { input: { type: 'text', text, course, ...(title ? { title } : {}) }, ownerId };
  }
  if (spec.type === 'pdf' || spec.type === 'image') {
    const path = (spec.path || '').trim();
    if (!path) throw new Error(`${spec.type} input needs an uploaded file`);
    const text = (spec.text || '').trim();
    return { input: { type: spec.type, path, course, ...(text ? { text } : {}) }, ownerId };
  }
  if (spec.type === 'url') {
    let url;
    try {
      url = new URL(String(spec.url || ''));
    } catch {
      throw new Error('url input needs a valid web address');
    }
    if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) URLs are supported');
    return { input: { type: 'url', url: url.href, course }, ownerId };
  }
  // Generate ONE lesson of an existing course on demand (the library shows Generate buttons).
  if (spec.type === 'course-lesson') {
    const courseId = (spec.courseId || '').trim();
    const outlineLessonId = (spec.outlineLessonId || '').trim();
    if (!courseId || !outlineLessonId) throw new Error('course-lesson input needs courseId and outlineLessonId');
    return { input: { type: 'course-lesson', courseId, outlineLessonId }, ownerId };
  }
  throw new Error(`Unknown input type: ${spec.type}`);
}

// Build a normalized progress object. During "generating" and "voicing" the percent
// interpolates across scenes so the bar advances as each scene finishes (real progress).
export function makeProgress({ phase, message = '', sceneDone = 0, sceneTotal = 0, lessonId = null }) {
  if (!PHASES.includes(phase)) throw new Error(`unknown job phase: ${phase}`);
  let percent = PHASE_FLOOR[phase];
  if (PHASE_SPAN_END[phase] && sceneTotal > 0) {
    const span = PHASE_FLOOR[PHASE_SPAN_END[phase]] - PHASE_FLOOR[phase];
    percent = PHASE_FLOOR[phase] + Math.round((Math.min(sceneDone, sceneTotal) / sceneTotal) * span);
  }
  return { phase, percent, message, sceneDone, sceneTotal, lessonId };
}

export function isTerminal(phase) {
  return phase === 'done' || phase === 'failed';
}
