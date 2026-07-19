// FULL-COURSE REGENERATION through the elite stack (user order: one full course at a time).
// For every lesson in the course outline: backup old payload -> regenerate via the domain
// specialist (data_db routes to the new DB teacher) -> DISABLE_TTS honored (no ElevenLabs)
// -> gate verdict logged per lesson. Sequential (Qwen rate-safety), resumable (skips
// lessons already regenerated this run-tag unless FORCE=1).
//
//   DISABLE_TTS=1 node scripts/regenerate-course.mjs course_sp84f7ca7fedef

import 'dotenv/config';
// batch runs blow LangSmith's monthly trace cap and spam 429s — tracing off here
process.env.LANGCHAIN_TRACING_V2 = 'false';
process.env.LANGSMITH_TRACING = 'false';
import { loadCourse } from '../lib/storage/course-store.js';
import { lessonsCollection } from '../lib/storage/db.js';
import { processLessonJob } from '../lib/queue/lesson-processor.js';
import { gateLesson, buildRepairNote } from '../lib/generation/gate/lesson-gate.js';

const courseId = process.argv[2];
if (!courseId) { console.error('usage: node scripts/regenerate-course.mjs <courseId>'); process.exit(1); }
const RUN_TAG = 'elite-regen-20jul';

const course = await loadCourse(courseId);
if (!course) { console.error('course not found'); process.exit(1); }
const ownerId = course.ownerId ?? null;
const only = (process.env.ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const lessons = (course.outline?.episodes ?? []).flatMap((ep) => ep.lessons.map((l) => ({ ep, l })))
  .filter(({ l }) => !only.length || only.includes(l.id));
console.log(`[regen] course ${courseId}: ${lessons.length} lessons | TTS disabled: ${process.env.DISABLE_TTS === '1'}`);

const col = await lessonsCollection();
const sourceText = (course.sourcePack?.chunks ?? []).map((c) => c.text).join(' ');

let done = 0;
const results = [];
for (const { ep, l } of lessons) {
  const linked = course.lessonLinks?.[l.id]?.lessonId;
  try {
    if (linked) {
      const existing = await col.findOne({ _id: linked }, { projection: { [`backups.${RUN_TAG}`]: 1, payload: 1 } });
      if (existing?.backups?.[RUN_TAG] && process.env.FORCE !== '1' && !only.length) {
        done += 1;
        console.log(`[${done}/${lessons.length}] ${String(l.title ?? l.id).slice(0, 48)} | SKIP (already regenerated this run-tag)`);
        results.push({ lesson: l.id, skipped: true });
        continue;
      } else if (existing?.payload) {
        await col.updateOne({ _id: linked }, { $set: { [`backups.${RUN_TAG}`]: existing.payload } });
      }
    }
    const t0 = Date.now();
    const out = await processLessonJob(
      { input: { type: 'course-lesson', courseId, outlineLessonId: l.id }, ownerId },
      { report: () => {} },
    );
    const doc = await col.findOne({ _id: out.lessonId }, { projection: { payload: 1, title: 1 } });
    const verdict = gateLesson(doc.payload, { sourceText });
    done += 1;
    const line = `[${done}/${lessons.length}] ${String(l.title ?? l.id).slice(0, 48)} | ${Math.round((Date.now() - t0) / 1000)}s | gate: ${verdict.ok ? 'PASS' : verdict.violations.length + ' violations'}`;
    console.log(line);
    if (!verdict.ok) console.log(buildRepairNote(verdict.violations).split('\n').slice(0, 6).map((x) => '    ' + x).join('\n'));
    results.push({ lesson: l.id, ok: verdict.ok, violations: verdict.violations.length });
  } catch (e) {
    done += 1;
    console.log(`[${done}/${lessons.length}] ${String(l.title ?? l.id).slice(0, 48)} | ERROR: ${String(e.message).slice(0, 120)}`);
    results.push({ lesson: l.id, error: String(e.message).slice(0, 200) });
  }
}
const pass = results.filter((r) => r.ok).length;
const errs = results.filter((r) => r.error).length;
console.log(`\n[regen] COMPLETE: ${pass}/${results.length} gate-clean, ${errs} errors, ${results.length - pass - errs} with violations`);
process.exit(0);
