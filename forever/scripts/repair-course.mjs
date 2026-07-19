// COURSE REPAIR PASS — thin caller of the pipeline's own self-repair module
// (lib/generation/gate/lesson-repair.js): gate -> executed-evidence number fixes ->
// misconception scene -> re-gate. Saves only when violations DECREASE.
//
//   node scripts/repair-course.mjs <courseId> [onlyLessonId]

import 'dotenv/config';
import { loadCourse } from '../lib/storage/course-store.js';
import { lessonsCollection } from '../lib/storage/db.js';
import { gateLesson } from '../lib/generation/gate/lesson-gate.js';
import { repairLessonPayload } from '../lib/generation/gate/lesson-repair.js';
import { mapWithConcurrency } from '../lib/util/concurrency.js';

const courseId = process.argv[2];
const onlyLesson = process.argv[3] ?? null;
const course = await loadCourse(courseId);
const col = await lessonsCollection();
const sourceText = (course.sourcePack?.chunks ?? []).map((c) => c.text).join(' ');

const lessonIds = Object.values(course.lessonLinks ?? {}).map((x) => x.lessonId)
  .filter((id) => !onlyLesson || id === onlyLesson);

await mapWithConcurrency(lessonIds, Number(process.env.REPAIR_CONCURRENCY || 4), async (lessonId) => {
  const doc = await col.findOne({ _id: lessonId });
  if (!doc?.payload) return;
  const payload = doc.payload;
  const pre = gateLesson(payload, { sourceText, domain: doc.payload?.domain ?? null });
  if (pre.ok) { console.log(`[ok] ${doc.title}`); return; }
  const numViol = pre.violations.filter((v) => v.rule === 'number-unsourced');
  const beatViol = pre.violations.filter((v) => v.rule === 'beat-missing' && /misconception/.test(v.detail));
  console.log(`[repair] ${String(doc.title).slice(0, 50)} | ${pre.violations.length} violations (${numViol.length} unsourced numbers, misconception missing: ${beatViol.length > 0})`);

  const { before, after, changed } = await repairLessonPayload(payload, {
    sourceText, domain: doc.payload?.domain ?? 'data_db', lessonTitle: doc.title,
  });
  if (changed) {
    await col.updateOne({ _id: lessonId }, { $set: { payload, voiced: false } });
    console.log(`  saved: ${before.violations.length} -> ${after.violations.length} violations${after.ok ? ' (GATE CLEAN)' : ''}`);
  } else {
    console.log(`  NOT saved: ${before.violations.length} -> ${after.violations.length} (no improvement)`);
  }
});
process.exit(0);
