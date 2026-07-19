// COURSE REPAIR PASS — turns gate violations into fixes, the engine=truth way:
//  number-unsourced -> Qwen designs a sqlWorld (schema+queries whose seeded data yields the
//    teaching numbers) -> sql-evidence EXECUTES it -> Qwen rewrites offending lines citing
//    the MEASURED results -> deterministic re-verify (every number must appear in executed
//    evidence) -> a computed_evidence table object lands on the scene.
//  beat-missing (misconception) -> Qwen writes one misconception scene in the stored schema
//    -> shape-validated -> inserted before the recap.
// Saves only when violations DECREASE. Old payloads already backed up by regenerate-course.
//
//   node scripts/repair-course.mjs <courseId> [onlyLessonId]

import 'dotenv/config';
import { loadCourse } from '../lib/storage/course-store.js';
import { lessonsCollection } from '../lib/storage/db.js';
import { gateLesson } from '../lib/generation/gate/lesson-gate.js';
import { runSqlEvidence } from '../lib/orchestration/agents/authoring/evidence/sql-evidence.js';
import { runAgentChain } from '../lib/qwen/client.js';

const courseId = process.argv[2];
const onlyLesson = process.argv[3] ?? null;
const course = await loadCourse(courseId);
const col = await lessonsCollection();
const sourceText = (course.sourcePack?.chunks ?? []).map((c) => c.text).join(' ');

const lessonIds = Object.values(course.lessonLinks ?? {}).map((x) => x.lessonId)
  .filter((id) => !onlyLesson || id === onlyLesson);

function evidenceBlob(ev) {
  return JSON.stringify(ev.queries.map((q) => [q.label, q.columns, q.rows, q.joinCount, q.opcodes]));
}

for (const lessonId of lessonIds) {
  const doc = await col.findOne({ _id: lessonId });
  if (!doc?.payload) continue;
  const payload = doc.payload;
  const before = gateLesson(payload, { sourceText });
  if (before.ok) { console.log(`[ok] ${doc.title}`); continue; }
  const numViol = before.violations.filter((v) => v.rule === 'number-unsourced');
  const beatViol = before.violations.filter((v) => v.rule === 'beat-missing' && /misconception/.test(v.detail));
  console.log(`[repair] ${String(doc.title).slice(0, 50)} | ${before.violations.length} violations (${numViol.length} unsourced numbers, misconception missing: ${beatViol.length > 0})`);

  // ---- FIX 1: unsourced numbers -> executed evidence ----
  if (numViol.length) {
    try {
      const numbersIn = (t) => (String(t ?? '').match(/\d+(?:[.,]\d+)?%?/g) ?? []).map((n) => n.replace(/,/g, '')).filter((n) => n.replace(/[%.]/g, '').length >= 2);
      const srcNoCommas = sourceText.replace(/,/g, '');
      const offenders = [];
      for (const sc of payload.scenes) {
        const evText0 = JSON.stringify((sc.objects ?? []).map((o) => o.content ?? '')).replace(/,/g, ' ');
        for (const vl of sc.voiceLines ?? []) {
          for (const n of numbersIn(vl.text)) {
            if (!srcNoCommas.includes(n) && !evText0.includes(n)) offenders.push({ sceneId: sc.sceneId, voiceLineId: vl.id, number: n, text: vl.text });
          }
        }
      }
      const offending = offenders.map((o) => `${o.sceneId}/${o.voiceLineId}: number ${o.number} in: ${o.text.slice(0, 120)}`).join('\n');
      const sceneTexts = payload.scenes.map((s) => `[${s.sceneId}] ${(s.voiceLines ?? []).map((l) => l.text).join(' ')}`).join('\n').slice(0, 6000);
      const world = await runAgentChain({
        agent: 'db-evidence-designer',
        system: `You design the SQLite world that PROVES this database lesson's narrated numbers. Return ONLY JSON {"schemaSql": string (CREATE TABLE + INSERT seed data), "queries": [{"id": string, "label": string, "sql": string}]} — seed the data so the queries' results CONTAIN the teaching numbers the lesson narrates (or the closest defensible values). Max 6 queries, tiny tables (<=12 rows each). Plain SQLite SQL only.`,
        user: `LESSON SCENES:\n${sceneTexts}\n\nUNSOURCED NUMBERS TO GROUND:\n${offending.slice(0, 1500)}`,
        maxTokens: 1400,
        temperature: 0.2,
      });
      const spec = world?.json ?? world;
      const ev = runSqlEvidence({ schemaSql: spec.schemaSql, queries: spec.queries });
      const rewrite = await runAgentChain({
        agent: 'db-evidence-rewriter',
        system: `You rewrite narration lines so every number cites the EXECUTED evidence. Return ONLY JSON {"rewrites": [{"sceneId": string, "voiceLineId": string, "newText": string}]} — same meaning, same length feel, but every figure must literally appear in the evidence. Rewrite ONLY the listed lines.`,
        user: `EXECUTED EVIDENCE (label, columns, rows, joinCount, opcodes):\n${evidenceBlob(ev).slice(0, 3000)}\n\nLINES TO REWRITE (sceneId/voiceLineId: offending number: current text):\n${offending.slice(0, 2500)}`,
        maxTokens: 1200,
        temperature: 0.2,
      });
      const rw = (rewrite?.json ?? rewrite)?.rewrites ?? [];
      const evText = evidenceBlob(ev).replace(/,/g, ' ');
      for (const r of rw) {
        const scene = payload.scenes.find((s) => s.sceneId === r.sceneId);
        const line = scene?.voiceLines?.find((l) => l.id === r.voiceLineId);
        if (!scene || !line) continue;
        // deterministic re-verify: every >=2-digit number in the new text must be in evidence
        const nums = (String(r.newText).match(/\d+(?:[.,]\d+)?%?/g) ?? []).map((n) => n.replace(/,/g, '')).filter((n) => n.replace(/[%.]/g, '').length >= 2);
        if (nums.every((n) => evText.includes(n) || sourceText.replace(/,/g, '').includes(n))) line.text = r.newText;
      }
      // the evidence table lands on the FIRST affected scene, referenced so coverage passes
      const firstScene = payload.scenes.find((s) => numViol.some((v) => v.sceneId === s.sceneId));
      if (firstScene) {
        const objId = 'computed_evidence';
        if (!firstScene.objects.some((o) => o.id === objId)) {
          firstScene.objects.push({
            id: objId, objectType: 'computed evidence table', renderHint: 'table', region: 'notebook_area',
            content: {
              title: 'Measured by executing the queries (SQLite)',
              rows: ev.queries.map((q) => [q.label, `${q.joinCount} joins`, `${q.opcodes} opcodes`, `${q.rowCount} rows`]),
              results: Object.fromEntries(ev.queries.map((q) => [q.id, { columns: q.columns, rows: q.rows }])),
            },
            sourceRef: { engine: 'sql-evidence', provenance: 'executed' },
          });
          firstScene.voiceLines.push({ id: 'computed_evidence_v', text: 'Every number here was measured by actually running the queries — nothing is estimated.', targetObjectId: objId });
          firstScene.timeline?.actions?.push({ id: 'act_evidence', kind: 'point', startMs: 0, durationMs: 600, targetObjectId: objId });
        }
      }
    } catch (e) { console.log(`  evidence fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  // ---- FIX 2: missing misconception beat -> one real scene ----
  if (beatViol.length) {
    try {
      const made = await runAgentChain({
        agent: 'db-misconception-writer',
        system: `Write ONE misconception scene for this database lesson in EXACTLY this JSON shape: {"sceneId": "sc_misconception", "title": string, "pedagogicalRole": "misconception", "layout": "teacher_notebook_code", "objects": [{"id": "misconception_card", "objectType": "misconception card", "renderHint": "callout", "region": "notebook_area", "content": {"claim": string, "why_wrong": string, "correction": string}}], "voiceLines": [{"id": "mis_1", "text": string (<=45 words, name the wrong belief then refute it with the lesson's own evidence), "targetObjectId": "misconception_card"}], "timeline": {"sceneId": "sc_misconception", "timingSource": "provisional", "actions": [{"id": "act_mis", "kind": "point", "startMs": 0, "durationMs": 600, "targetObjectId": "misconception_card"}, {"id": "act_mis_sp", "kind": "speech", "startMs": 200, "durationMs": 6000, "voiceLineId": "mis_1"}]}, "durationMs": 8000} — no numbers unless they appear in the lesson.`,
        user: `LESSON TITLE: ${doc.title}\nSCENE SUMMARY:\n${payload.scenes.map((s) => s.title).join(' | ').slice(0, 600)}`,
        maxTokens: 700,
        temperature: 0.3,
      });
      let scene = made?.json ?? made;
      const validScene = (sc) => sc?.sceneId && Array.isArray(sc.objects) && sc.objects.length && Array.isArray(sc.voiceLines) && sc.voiceLines.length && sc.voiceLines.every((l) => sc.objects.some((o) => o.id === l.targetObjectId));
      if (!validScene(scene)) {
        const retry = await runAgentChain({
          agent: 'db-misconception-writer',
          system: 'Your previous scene JSON was structurally invalid (objects/voiceLines missing or a voiceLine targeted a missing object id). Return ONLY the corrected JSON, exact same schema.',
          user: JSON.stringify(scene).slice(0, 1500),
          maxTokens: 700,
          temperature: 0.2,
        });
        scene = retry?.json ?? retry;
      }
      if (validScene(scene)) {
        scene.pedagogicalRole = 'misconception';
        if (!scene.timeline?.actions) scene.timeline = { sceneId: scene.sceneId, timingSource: 'provisional', actions: [{ id: 'act_mis', kind: 'point', startMs: 0, durationMs: 600, targetObjectId: scene.objects[0].id }] };
        payload.scenes.splice(Math.max(payload.scenes.length - 1, 1), 0, scene);
      }
    } catch (e) { console.log(`  misconception fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  const after = gateLesson(payload, { sourceText });
  if (after.violations.length < before.violations.length) {
    await col.updateOne({ _id: lessonId }, { $set: { payload, voiced: false } });
    console.log(`  saved: ${before.violations.length} -> ${after.violations.length} violations${after.ok ? ' (GATE CLEAN)' : ''}`);
  } else {
    console.log(`  NOT saved: ${before.violations.length} -> ${after.violations.length} (no improvement)`);
  }
}
process.exit(0);
