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
import { runCalcEvidence } from '../../orchestration/agents/authoring/evidence/calc-evidence.js';
import { runAgentChain as runAgentChainDefault } from '../../qwen/client.js';

const numbersIn = (t) => (String(t ?? '').match(/\d+(?:[.,]\d+)?%?/g) ?? [])
  .map((n) => n.replace(/,/g, ''))
  .filter((n) => n.replace(/[%.]/g, '').length >= 2);

const evidenceBlob = (ev) => JSON.stringify(ev.queries.map((q) => [q.label, q.columns, q.rows, q.joinCount, q.opcodes]));

// Models often pack "CREATE ...; SELECT ..." into one query — SQLite executes one statement
// at a time, so setup statements are moved into the schema and the LAST statement is the
// measured query. Deterministic; the retry-with-error loop stays as the backstop.
const normalizeSpec = (sp) => {
  const extra = [];
  const queries = (sp?.queries ?? []).map((q) => {
    const parts = String(q.sql ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) { extra.push(...parts.slice(0, -1)); return { ...q, sql: parts.at(-1) }; }
    return { ...q, sql: parts[0] ?? '' };
  }).filter((q) => q.sql);
  return { schemaSql: [sp?.schemaSql, ...extra].filter(Boolean).join(';\n'), queries };
};

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

  // ---- FIX 1: unsourced numbers -> EXECUTED evidence ----
  // data_db speaks SQL (sql-evidence: real SQLite, joins, opcodes); every other domain
  // speaks arithmetic (calc-evidence: dataset + formulas executed in python) — the econ
  // register's law generalized: a narrated number must come out of an engine or the source.
  if (numViol.length) {
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

      let evBlobStr = null;   // what the rewriter cites and the verifier checks against
      let evContentObj = null; // what lands on the board (the gate reads object content)
      let provenanceEngine = null;
      if (domain === 'data_db' || agents.forceSqlEvidence) {
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
            ev = runSqlEvidence(normalizeSpec(spec));
            break;
          } catch (sqlErr) {
            if (attempt === 2) throw sqlErr;
            const fixed = await chain({
              agent: 'db-evidence-designer',
              system: `Your SQL failed to execute. Fix it and return ONLY the corrected JSON {"schemaSql": string, "queries": [{"id","label","sql"}]} — same intent, every INSERT matching its table's column count, plain SQLite.`,
              user: `ERROR:\n${String(sqlErr.message ?? sqlErr).slice(0, 800)}\n\nYOUR SPEC:\n${JSON.stringify(spec).slice(0, 2500)}`,
              maxTokens: 1400,
              temperature: 0.2 + attempt * 0.3, // same error twice means same rut — diversify
            });
            spec = fixed?.json ?? fixed;
          }
        }
        evBlobStr = evidenceBlob(ev);
        evContentObj = evidenceContent(ev);
        provenanceEngine = 'sql-evidence';
      } else {
        const world = await chain({
          agent: 'calc-evidence-designer',
          system: `You design the tiny dataset and formulas that PROVE this ${domain ?? ''} lesson's narrated numbers by real arithmetic. Return ONLY JSON {"dataset": {"columns": [string], "rows": [[number]]}, "formulas": [{"id": string, "label": string (name the real-world meaning), "expr": string (a Python expression over the columns-as-lists and earlier formula ids)}]} — the formulas' VALUES must equal the teaching numbers the lesson narrates (or the closest defensible values). Max 10 formulas, dataset <= 12 rows. Only arithmetic and sum/min/max/len/round/abs — no imports.`,
          user: `LESSON SCENES:\n${sceneTexts}\n\nUNSOURCED NUMBERS TO GROUND:\n${offending.slice(0, 1500)}`,
          maxTokens: 1400,
          temperature: 0.2,
        });
        let spec = world?.json ?? world;
        let cev = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            cev = runCalcEvidence({ dataset: spec.dataset, formulas: spec.formulas });
            break;
          } catch (calcErr) {
            if (attempt === 2) throw calcErr;
            const fixed = await chain({
              agent: 'calc-evidence-designer',
              system: `Your formulas failed to execute. Fix them and return ONLY the corrected JSON {"dataset": {...}, "formulas": [...]} — same intent, plain arithmetic Python expressions, columns are lists.`,
              user: `ERROR:\n${String(calcErr.message ?? calcErr).slice(0, 800)}\n\nYOUR SPEC:\n${JSON.stringify(spec).slice(0, 2500)}`,
              maxTokens: 1400,
              temperature: 0.2 + attempt * 0.3,
            });
            spec = fixed?.json ?? fixed;
          }
        }
        evBlobStr = JSON.stringify(cev.results.map((r) => [r.label, r.expr, r.value]));
        evContentObj = {
          title: 'Computed by executing the formulas (real arithmetic)',
          rows: cev.results.map((r) => [r.label, r.expr, String(r.value)]),
          dataset: cev.dataset,
        };
        provenanceEngine = 'calc-evidence';
      }

      const rewrite = await chain({
        agent: 'db-evidence-rewriter',
        system: `You rewrite narration lines so every number cites the EXECUTED evidence. Return ONLY JSON {"rewrites": [{"sceneId": string, "voiceLineId": string, "newText": string}]} — same meaning, same length feel, but every figure must literally appear in the evidence. Rewrite ONLY the listed lines.`,
        user: `EXECUTED EVIDENCE:\n${evBlobStr.slice(0, 3000)}\n\nLINES TO REWRITE (sceneId/voiceLineId: offending number: current text):\n${offending.slice(0, 2500)}`,
        maxTokens: 1200,
        temperature: 0.2,
      });
      const rw = (rewrite?.json ?? rewrite)?.rewrites ?? [];
      const evText = evBlobStr.replace(/,/g, ' ');
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
        log(`  [debug] evidence: ${evBlobStr.slice(0, 700)}`);
      }
      // the evidence table lands on EVERY affected scene: the gate (and the student's eyes)
      // are scene-scoped — a number's proof must be on the board WHILE it is spoken.
      const affected = payload.scenes.filter((s) => numViol.some((v) => v.sceneId === s.sceneId));
      for (const sc of affected) {
        const objId = 'computed_evidence';
        const existing = sc.objects.find((o) => o.id === objId);
        if (existing) {
          existing.content = evContentObj;
        } else {
          sc.objects.push({
            id: objId, objectType: 'computed evidence table', renderHint: 'table', region: 'notebook_area',
            content: evContentObj,
            sourceRef: { engine: provenanceEngine, provenance: 'executed' },
          });
          sc.voiceLines.push({ id: 'computed_evidence_v', text: 'Every number here was measured by actually running the computation — nothing is estimated.', targetObjectId: objId });
          sc.timeline?.actions?.push({ id: 'act_evidence', kind: 'point', startMs: 0, durationMs: 600, targetObjectId: objId });
        }
      }
    } catch (e) { log(`  evidence fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  // ---- FIX 2: ANY missing required beat -> one real scene in the stored schema ----
  const BEAT_SPECS = {
    misconception: { objType: 'misconception card', content: '{"claim": string, "why_wrong": string, "correction": string}', voiceHint: "name the wrong belief then refute it with the lesson's own evidence", atEnd: false },
    recap: { objType: 'recap list', content: '{"points": [3 to 5 short takeaway strings]}', voiceHint: 'restate the biggest takeaways in plain words, no new facts', atEnd: true },
    checkpoint: { objType: 'checkpoint quiz', content: '{"questions": [{"q": string, "answer": string}] (MAX 2 questions)}', voiceHint: 'ask at most 2 retrieval questions then give the answers', atEnd: false },
    worked_example: { objType: 'worked example steps', content: '{"steps": [4 to 6 short step strings]}', voiceHint: 'walk one concrete example step by step using only numbers already in the lesson', atEnd: false },
  };
  const missingBeats = before.violations
    .filter((v) => v.rule === 'beat-missing')
    .map((v) => (v.detail.match(/"(\w+)" beat/) ?? [])[1])
    .filter((b) => BEAT_SPECS[b]);
  for (const beat of missingBeats) {
    try {
      const spec = BEAT_SPECS[beat];
      const objId = `${beat}_card`;
      const sceneShape = `{"sceneId": "sc_${beat}", "title": string, "pedagogicalRole": "${beat}", "layout": "teacher_notebook_code", "objects": [{"id": "${objId}", "objectType": "${spec.objType}", "renderHint": "callout", "region": "notebook_area", "content": ${spec.content}}], "voiceLines": [{"id": "${beat}_1", "text": string (<=45 words, ${spec.voiceHint}), "targetObjectId": "${objId}"}], "timeline": {"sceneId": "sc_${beat}", "timingSource": "provisional", "actions": [{"id": "act_${beat}", "kind": "point", "startMs": 0, "durationMs": 600, "targetObjectId": "${objId}"}, {"id": "act_${beat}_sp", "kind": "speech", "startMs": 200, "durationMs": 6000, "voiceLineId": "${beat}_1"}]}, "durationMs": 8000}`;
      const made = await chain({
        agent: 'beat-scene-writer',
        system: `Write ONE ${beat} scene for this ${domain ?? ''} lesson in EXACTLY this JSON shape: ${sceneShape} — no numbers unless they appear in the lesson.`,
        user: `LESSON TITLE: ${lessonTitle}\nSCENE SUMMARY:\n${payload.scenes.map((s) => s.title).join(' | ').slice(0, 600)}`,
        maxTokens: 700,
        temperature: 0.3,
      });
      let scene = made?.json ?? made;
      const validScene = (sc) => sc?.sceneId && Array.isArray(sc.objects) && sc.objects.length && Array.isArray(sc.voiceLines) && sc.voiceLines.length && sc.voiceLines.every((l) => sc.objects.some((o) => o.id === l.targetObjectId));
      if (!validScene(scene)) {
        const retry = await chain({
          agent: 'beat-scene-writer',
          system: 'Your previous scene JSON was structurally invalid (objects/voiceLines missing or a voiceLine targeted a missing object id). Return ONLY the corrected JSON, exact same schema.',
          user: JSON.stringify(scene).slice(0, 1500),
          maxTokens: 700,
          temperature: 0.2,
        });
        scene = retry?.json ?? retry;
      }
      if (validScene(scene)) {
        scene.pedagogicalRole = beat;
        if (!scene.timeline?.actions) scene.timeline = { sceneId: scene.sceneId, timingSource: 'provisional', actions: [{ id: `act_${beat}`, kind: 'point', startMs: 0, durationMs: 600, targetObjectId: scene.objects[0].id }] };
        if (spec.atEnd) payload.scenes.push(scene);
        else payload.scenes.splice(Math.max(payload.scenes.length - 1, 1), 0, scene);
      }
    } catch (e) { log(`  ${beat} beat fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  // ---- FIX 3: voice lines over the 60-word speakability cap -> tightened, meaning kept ----
  const longViol = before.violations.filter((v) => v.rule === 'voiceline-too-long');
  if (longViol.length) {
    try {
      const lines = [];
      for (const v of longViol) {
        const id = (v.detail.match(/voiceLine "([^"]+)"/) ?? [])[1];
        const sc = payload.scenes.find((x) => x.sceneId === v.sceneId);
        const vl = sc?.voiceLines?.find((l) => l.id === id);
        if (sc && vl) lines.push({ sceneId: sc.sceneId, voiceLineId: vl.id, text: vl.text });
      }
      const rewrite = await chain({
        agent: 'line-tightener',
        system: `You tighten spoken teaching lines to UNDER 55 words each without losing meaning or any number. Return ONLY JSON {"rewrites": [{"sceneId": string, "voiceLineId": string, "newText": string}]}. Keep every number exactly as it was; cut filler, not facts.`,
        user: JSON.stringify(lines).slice(0, 3000),
        maxTokens: 1200,
        temperature: 0.2,
      });
      const srcNC = sourceText.replace(/,/g, '');
      const tightened = (rewrite?.json ?? rewrite)?.rewrites ?? [];
      if (env.REPAIR_DEBUG === '1') log(`  [debug] tightener returned ${tightened.length} rewrites: ${JSON.stringify(tightened).slice(0, 300)}`);
      for (const r of tightened) {
        // tolerate the classic mangle: "sc_06/line_id" packed into sceneId
        if (typeof r.sceneId === 'string' && r.sceneId.includes('/')) {
          const [scId, vlId] = r.sceneId.split('/');
          if (!r.newText && typeof r.voiceLineId === 'string' && r.voiceLineId.split(/\s+/).length > 8) r.newText = r.voiceLineId;
          r.sceneId = scId; r.voiceLineId = vlId;
        }
        const sc = payload.scenes.find((x) => x.sceneId === r.sceneId);
        const vl = sc?.voiceLines?.find((l) => l.id === r.voiceLineId);
        if (!sc || !vl || !r.newText) continue;
        const evT = JSON.stringify((sc.objects ?? []).map((o) => o.content ?? '')).replace(/,/g, ' ');
        const wordsOk = String(r.newText).trim().split(/\s+/).filter(Boolean).length <= 60;
        const numsOk = numbersIn(r.newText).every((n) => srcNC.includes(n) || evT.includes(n) || numbersIn(vl.text).includes(n));
        if (wordsOk && numsOk) vl.text = r.newText;
        else if (env.REPAIR_DEBUG === '1') log(`  [debug] tighten ${r.sceneId}/${r.voiceLineId} rejected: words=${String(r.newText).trim().split(/\s+/).filter(Boolean).length} numsOk=${numsOk}`);
      }
      if (env.REPAIR_DEBUG === '1') log(`  [debug] tightener: ${lines.length} lines sent`);
    } catch (e) { log(`  long-line fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  // ---- FIX 4: check-in question flood (>2 questions) -> focused check-in ----
  const floodViol = before.violations.filter((v) => v.rule === 'checkin-question-flood');
  for (const v of floodViol) {
    try {
      const sc = payload.scenes.find((x) => x.sceneId === v.sceneId);
      if (!sc) continue;
      const rewrite = await chain({
        agent: 'checkin-focuser',
        system: `This check-in scene asks too many questions. Rewrite its voice lines so AT MOST 2 questions remain total (keep the 2 most valuable, convert or drop the rest into statements). Return ONLY JSON {"voiceLines": [{"id": same id as input, "text": string}]} — same ids, same order, every number kept exactly, each line under 55 words.`,
        user: sc.voiceLines.map((l) => `${l.id}: ${l.text}`).join('\n').slice(0, 3000),
        maxTokens: 1400,
        temperature: 0.2,
      });
      const out = (rewrite?.json ?? rewrite)?.voiceLines ?? [];
      const byId = new Map(out.map((l) => [l.id, l.text]));
      const srcNC = sourceText.replace(/,/g, '');
      const evT = JSON.stringify((sc.objects ?? []).map((o) => o.content ?? '')).replace(/,/g, ' ');
      const proposed = sc.voiceLines.map((l) => ({ old: l, text: byId.get(l.id) ?? l.text }));
      const qCount = proposed.reduce((n, x) => n + (String(x.text).match(/\?/g) ?? []).length, 0);
      const allOk = qCount <= 2 && proposed.every((x) =>
        String(x.text).trim().split(/\s+/).filter(Boolean).length <= 60
        && numbersIn(x.text).every((n) => srcNC.includes(n) || evT.includes(n) || numbersIn(x.old.text).includes(n)));
      if (allOk) for (const x of proposed) x.old.text = x.text;
      else if (env.REPAIR_DEBUG === '1') log(`  [debug] check-in rewrite rejected: questions=${qCount}`);
    } catch (e) { log(`  check-in fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  const after = gateLesson(payload, { sourceText });
  return { before, after, changed: after.violations.length < before.violations.length };
}
