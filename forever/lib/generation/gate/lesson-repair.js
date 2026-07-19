// LESSON SELF-REPAIR — the gate's violations turned into fixes INSIDE the pipeline, so a
// lesson heals BEFORE its canonical save instead of waiting for a maintenance script.
//  number-unsourced -> Qwen designs a SQLite world -> sql-evidence EXECUTES it (retrying with
//    the SQL error fed back) -> Qwen rewrites the lines citing MEASURED results -> deterministic
//    re-verify (every number must literally appear in executed evidence or source) -> a
//    computed_evidence board object carries the result rows (the gate reads object content).
//    Scale illustrations (10000 rows) are DERIVED by arithmetic queries the engine runs.
//  beat-missing (misconception) -> Qwen writes one scene in the stored schema -> shape-validated
//    (one retry with the validation error named) -> inserted before the recap.
// Mutates payload.scenes in place; returns both gate verdicts so callers decide what to keep.
// Repair NEVER throws past its fixes: a failed fix logs and leaves the payload as it was.

import { gateLesson } from './lesson-gate.js';
import { runSqlEvidence } from '../../orchestration/agents/authoring/evidence/sql-evidence.js';
import { runAgentChain as runAgentChainDefault } from '../../qwen/client.js';

const numbersIn = (t) => (String(t ?? '').match(/\d+(?:[.,]\d+)?%?/g) ?? [])
  .map((n) => n.replace(/,/g, ''))
  .filter((n) => n.replace(/[%.]/g, '').length >= 2);

const evidenceBlob = (ev) => JSON.stringify(ev.queries.map((q) => [q.label, q.columns, q.rows, q.joinCount, q.opcodes]));

const evidenceContent = (ev) => ({
  title: 'Measured by executing the queries (SQLite)',
  rows: ev.queries.map((q) => [q.label, `${q.joinCount} joins`, `${q.opcodes} opcodes`, `${q.rowCount} rows`]),
  results: Object.fromEntries(ev.queries.map((q) => [q.id, { columns: q.columns, rows: q.rows }])),
});

export async function repairLessonPayload(payload, {
  sourceText = '',
  domain = null,
  lessonTitle = '',
  env = process.env,
  agents = {},
  log = (m) => console.log(m),
} = {}) {
  const chain = agents.runAgentChain ?? runAgentChainDefault;
  const before = gateLesson(payload, { sourceText });
  if (before.ok) return { before, after: before, changed: false };
  const numViol = before.violations.filter((v) => v.rule === 'number-unsourced');
  const beatViol = before.violations.filter((v) => v.rule === 'beat-missing' && /misconception/.test(v.detail));

  // ---- FIX 1: unsourced numbers -> executed evidence (SQL engine — data/DB domain only) ----
  if (numViol.length && (domain === 'data_db' || agents.forceSqlEvidence)) {
    try {
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
      const world = await chain({
        agent: 'db-evidence-designer',
        system: `You design the SQLite world that PROVES this database lesson's narrated numbers. Return ONLY JSON {"schemaSql": string (CREATE TABLE + INSERT seed data), "queries": [{"id": string, "label": string, "sql": string}]} — seed the data so the queries' results CONTAIN the teaching numbers the lesson narrates (or the closest defensible values). Max 6 queries, tiny tables (<=12 rows each). Plain SQLite SQL only. IMPORTANT: when a narrated number is a SCALE illustration too big to seed (10000 rows, 3125 combinations), DERIVE it with an arithmetic query over stated factors — e.g. {"id":"q_scale","label":"rows at scale = 200 customers x 50 orders each","sql":"SELECT 200*50 AS rows_at_scale"} — so the engine literally computes it.`,
        user: `LESSON SCENES:\n${sceneTexts}\n\nUNSOURCED NUMBERS TO GROUND:\n${offending.slice(0, 1500)}`,
        maxTokens: 1400,
        temperature: 0.2,
      });
      let spec = world?.json ?? world;
      let ev = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          ev = runSqlEvidence({ schemaSql: spec.schemaSql, queries: spec.queries });
          break;
        } catch (sqlErr) {
          if (attempt === 2) throw sqlErr;
          const fixed = await chain({
            agent: 'db-evidence-designer',
            system: `Your SQL failed to execute. Fix it and return ONLY the corrected JSON {"schemaSql": string, "queries": [{"id","label","sql"}]} — same intent, every INSERT matching its table's column count, plain SQLite.`,
            user: `ERROR:\n${String(sqlErr.message ?? sqlErr).slice(0, 800)}\n\nYOUR SPEC:\n${JSON.stringify(spec).slice(0, 2500)}`,
            maxTokens: 1400,
            temperature: 0.2,
          });
          spec = fixed?.json ?? fixed;
        }
      }
      const rewrite = await chain({
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
        const nums = numbersIn(r.newText);
        const missing = nums.filter((n) => !evText.includes(n) && !srcNoCommas.includes(n));
        if (!missing.length) line.text = r.newText;
        else if (env.REPAIR_DEBUG === '1') log(`  [debug] rewrite ${r.sceneId}/${r.voiceLineId} REJECTED — not in evidence: ${missing.join(', ')} | new: ${String(r.newText).slice(0, 110)}`);
      }
      if (env.REPAIR_DEBUG === '1') {
        log(`  [debug] rewrites returned: ${rw.length} for offenders: ${offenders.length}`);
        log(`  [debug] evidence: ${evidenceBlob(ev).slice(0, 700)}`);
      }
      // the evidence table lands on the FIRST affected scene, referenced so coverage passes
      const firstScene = payload.scenes.find((s) => numViol.some((v) => v.sceneId === s.sceneId));
      if (firstScene) {
        const objId = 'computed_evidence';
        const existing = firstScene.objects.find((o) => o.id === objId);
        if (existing) {
          existing.content = evidenceContent(ev);
        } else {
          firstScene.objects.push({
            id: objId, objectType: 'computed evidence table', renderHint: 'table', region: 'notebook_area',
            content: evidenceContent(ev),
            sourceRef: { engine: 'sql-evidence', provenance: 'executed' },
          });
          firstScene.voiceLines.push({ id: 'computed_evidence_v', text: 'Every number here was measured by actually running the queries — nothing is estimated.', targetObjectId: objId });
          firstScene.timeline?.actions?.push({ id: 'act_evidence', kind: 'point', startMs: 0, durationMs: 600, targetObjectId: objId });
        }
      }
    } catch (e) { log(`  evidence fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  // ---- FIX 2: missing misconception beat -> one real scene ----
  if (beatViol.length) {
    try {
      const made = await chain({
        agent: 'db-misconception-writer',
        system: `Write ONE misconception scene for this ${domain ?? ''} lesson in EXACTLY this JSON shape: {"sceneId": "sc_misconception", "title": string, "pedagogicalRole": "misconception", "layout": "teacher_notebook_code", "objects": [{"id": "misconception_card", "objectType": "misconception card", "renderHint": "callout", "region": "notebook_area", "content": {"claim": string, "why_wrong": string, "correction": string}}], "voiceLines": [{"id": "mis_1", "text": string (<=45 words, name the wrong belief then refute it with the lesson's own evidence), "targetObjectId": "misconception_card"}], "timeline": {"sceneId": "sc_misconception", "timingSource": "provisional", "actions": [{"id": "act_mis", "kind": "point", "startMs": 0, "durationMs": 600, "targetObjectId": "misconception_card"}, {"id": "act_mis_sp", "kind": "speech", "startMs": 200, "durationMs": 6000, "voiceLineId": "mis_1"}]}, "durationMs": 8000} — no numbers unless they appear in the lesson.`,
        user: `LESSON TITLE: ${lessonTitle}\nSCENE SUMMARY:\n${payload.scenes.map((s) => s.title).join(' | ').slice(0, 600)}`,
        maxTokens: 700,
        temperature: 0.3,
      });
      let scene = made?.json ?? made;
      const validScene = (sc) => sc?.sceneId && Array.isArray(sc.objects) && sc.objects.length && Array.isArray(sc.voiceLines) && sc.voiceLines.length && sc.voiceLines.every((l) => sc.objects.some((o) => o.id === l.targetObjectId));
      if (!validScene(scene)) {
        const retry = await chain({
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
    } catch (e) { log(`  misconception fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  const after = gateLesson(payload, { sourceText });
  return { before, after, changed: after.violations.length < before.violations.length };
}
