// TRACK 3 EVIDENCE — measurable gain of the AGENT SOCIETY over a SINGLE-AGENT baseline.
// Same source material, same lesson brief, same deterministic judge (the lesson gate):
//   baseline  = ONE Qwen call writes the whole lesson payload in the stored schema
//   society   = the shipped lesson built by Dean -> teacher -> per-scene proposal ->
//               grounding objections -> arbiter verdict -> gate + self-repair
// The gate is zero-token and deterministic, so the comparison cannot flatter either side.
//
//   node scripts/society-vs-single.mjs <courseId> <outlineLessonId> [more ids...]

import 'dotenv/config';
import { loadCourse } from '../lib/storage/course-store.js';
import { lessonsCollection } from '../lib/storage/db.js';
import { focusSourcePack } from '../lib/source-pack/build/focus-source-pack.js';
import { gateLesson, REQUIRED_BEATS, ROLE_ALIASES } from '../lib/generation/gate/lesson-gate.js';
import { runAgentChain } from '../lib/qwen/client.js';

const [courseId, ...outlineIds] = process.argv.slice(2);
const course = await loadCourse(courseId);
const col = await lessonsCollection();
const sourceText = (course.sourcePack?.chunks ?? []).map((c) => c.text).join(' ');

const beatsCovered = (payload) => {
  const roles = new Set((payload.scenes ?? []).map((s) => String(s.pedagogicalRole ?? '')));
  return REQUIRED_BEATS.filter((b) => (ROLE_ALIASES[b] ?? [b]).some((a) => [...roles].some((r) => r.includes(a)))).length;
};

const rows = [];
for (const outlineId of outlineIds) {
  const lesson = (course.outline?.episodes ?? []).flatMap((ep) => ep.lessons).find((l) => l.id === outlineId);
  const linked = course.lessonLinks?.[outlineId]?.lessonId;
  if (!lesson || !linked) { console.log(`skip ${outlineId}: not found/linked`); continue; }
  const pack = lesson.focusChunkIds?.length ? focusSourcePack(course.sourcePack, lesson.focusChunkIds) : course.sourcePack;
  const chunksText = (pack.chunks ?? []).map((c) => `[${c.id}] ${c.text}`).join('\n').slice(0, 9000);

  // ---- SINGLE-AGENT BASELINE: one model, one call, full lesson ----
  const t0 = Date.now();
  const out = await runAgentChain({
    agent: 'single-agent-baseline',
    system: `You are a complete course-lesson author. In ONE response produce the ENTIRE lesson payload JSON: {"scenes": [{"sceneId": string, "title": string, "pedagogicalRole": one of "motivate|intuition|worked_example|misconception|checkpoint|recap", "layout": "teacher_notebook_code", "objects": [{"id", "objectType", "renderHint", "region": "notebook_area", "content", "sourceRef": {"chunkId": one of the given chunk ids}}], "voiceLines": [{"id", "text", "targetObjectId"}], "timeline": {"sceneId", "timingSource": "provisional", "actions": [{"id", "kind": "point|speech", "startMs", "durationMs", "targetObjectId"?, "voiceLineId"?}]}, "durationMs": number}]} — 5 to 8 scenes, cover a worked example, a misconception, a checkpoint and a recap, ground every object in a real chunkId, keep voice lines under 60 words, and use only numbers that appear in the source.`,
    user: `LESSON: ${lesson.title}\nOBJECTIVE: ${lesson.objective ?? ''}\n\nSOURCE CHUNKS:\n${chunksText}`,
    maxTokens: 8000,
    temperature: 0.4,
  });
  const baselineMs = Date.now() - t0;
  const baseline = (out?.json ?? out) || {};
  const gB = gateLesson(baseline, { sourceText });

  // ---- AGENT SOCIETY: the shipped lesson (already built by the full pipeline) ----
  const doc = await col.findOne({ _id: linked });
  const gS = gateLesson(doc.payload, { sourceText });
  const transcripts = (doc.payload.scenes ?? []).reduce((n, s) => n + (s.transcript?.length ?? 0), 0);

  rows.push({
    lesson: lesson.title,
    baseline: { violations: gB.violations.length, scenes: baseline.scenes?.length ?? 0, beats: `${beatsCovered(baseline)}/${REQUIRED_BEATS.length}`, seconds: Math.round(baselineMs / 1000) },
    society: { violations: gS.violations.length, scenes: doc.payload.scenes?.length ?? 0, beats: `${beatsCovered(doc.payload)}/${REQUIRED_BEATS.length}`, debateMessages: transcripts },
  });
  const r = rows.at(-1);
  console.log(`\n=== ${r.lesson}`);
  console.log(`  single agent : ${r.baseline.violations} gate violations | ${r.baseline.scenes} scenes | beats ${r.baseline.beats} | ${r.baseline.seconds}s`);
  console.log(`  agent society: ${r.society.violations} gate violations | ${r.society.scenes} scenes | beats ${r.society.beats} | ${r.society.debateMessages} stored debate messages`);
  if (gB.violations.length) console.log(`  baseline violation rules: ${[...new Set(gB.violations.map((v) => v.rule))].join(', ')}`);
}

if (rows.length) {
  const avg = (f) => (rows.reduce((n, r) => n + f(r), 0) / rows.length).toFixed(1);
  console.log(`\n[RESULT] avg gate violations — single agent: ${avg((r) => r.baseline.violations)} vs agent society: ${avg((r) => r.society.violations)} (n=${rows.length} lessons, same source, same deterministic judge)`);
}
process.exit(0);
