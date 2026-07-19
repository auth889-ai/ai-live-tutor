// BUILD A FULL COURSE INLINE (no worker): material file -> Dean outline -> course saved ->
// every lesson generated SEQUENTIALLY through the elite stack (domain teacher, scene
// society, in-pipeline gate + self-repair). The queue fan-out is stubbed so this runs
// standalone; the stored course is identical to a worker-built one.
//
//   DISABLE_TTS=1 node scripts/build-course.mjs docs/materials/economics-supply-demand.md
//
// Resumable: rerunning skips outline lessons whose lesson doc already exists with scenes.

import 'dotenv/config';
// batch runs blow LangSmith's monthly trace cap and spam 429s — tracing off here
process.env.LANGCHAIN_TRACING_V2 = 'false';
process.env.LANGSMITH_TRACING = 'false';
import { readFileSync } from 'node:fs';
import { processLessonJob } from '../lib/queue/lesson-processor.js';
import { loadCourse } from '../lib/storage/course-store.js';
import { lessonsCollection } from '../lib/storage/db.js';
import { gateLesson } from '../lib/generation/gate/lesson-gate.js';

const materialPath = process.argv[2];
if (!materialPath) { console.error('usage: node scripts/build-course.mjs <material.md> [existingCourseId]'); process.exit(1); }
let courseId = process.argv[3] ?? null;

if (!courseId) {
  const text = readFileSync(materialPath, 'utf8');
  const created = await processLessonJob(
    { input: { type: 'text', text, course: true }, ownerId: null },
    {
      report: (p) => { if (p.phase) console.log(`[dean] ${p.phase}: ${p.message ?? ''}`); },
      deps: { enqueue: async (_job, opts) => ({ jobId: `inline-${opts?.jobId ?? 'x'}` }) },
    },
  );
  courseId = created.courseId;
  console.log(`[course] ${courseId} "${created.courseTitle}" — ${created.lessonsPlanned} lessons planned`);
}

const course = await loadCourse(courseId);
const col = await lessonsCollection();
const sourceText = (course.sourcePack?.chunks ?? []).map((c) => c.text).join(' ');
const lessons = (course.outline?.episodes ?? []).flatMap((ep) => ep.lessons);

let done = 0;
for (const l of lessons) {
  done += 1;
  try {
    const linked = course.lessonLinks?.[l.id]?.lessonId;
    if (linked) {
      const existing = await col.findOne({ _id: linked }, { projection: { 'payload.scenes': 1, status: 1 } });
      if (existing?.payload?.scenes?.length && existing.status === 'ready' && process.env.FORCE !== '1') {
        console.log(`[${done}/${lessons.length}] ${String(l.title).slice(0, 48)} | SKIP (already built)`);
        continue;
      }
    }
    const t0 = Date.now();
    const out = await processLessonJob(
      { input: { type: 'course-lesson', courseId, outlineLessonId: l.id }, ownerId: course.ownerId ?? null },
      { report: () => {} },
    );
    const doc = await col.findOne({ _id: out.lessonId }, { projection: { payload: 1 } });
    const verdict = gateLesson(doc.payload, { sourceText });
    console.log(`[${done}/${lessons.length}] ${String(l.title).slice(0, 48)} | ${Math.round((Date.now() - t0) / 1000)}s | gate: ${verdict.ok ? 'PASS' : verdict.violations.length + ' violations'} | stored gate: ${JSON.stringify(doc.payload.gate ?? null)}`);
  } catch (e) {
    console.log(`[${done}/${lessons.length}] ${String(l.title).slice(0, 48)} | ERROR: ${String(e.message).slice(0, 120)}`);
  }
}
console.log('[course] build pass complete');
process.exit(0);
