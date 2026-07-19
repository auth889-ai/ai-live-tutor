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

import { gateLesson, claimNumbersIn } from './lesson-gate.js';
import { runSqlEvidence } from '../../orchestration/agents/authoring/evidence/sql-evidence.js';
import { runCalcEvidence } from '../../orchestration/agents/authoring/evidence/calc-evidence.js';
import { runTrainEvidence } from '../../orchestration/agents/authoring/evidence/train-evidence.js';
import { runSimEvidence } from '../../orchestration/agents/authoring/evidence/sim-evidence.js';
import { runSchedEvidence } from '../../orchestration/agents/authoring/evidence/sched-evidence.js';
import { geneticsEvidence } from '../../orchestration/agents/authoring/evidence/genetics-evidence.js';
import { networkEvidence } from '../../orchestration/agents/authoring/evidence/network-evidence.js';
import { pubchemEvidence } from '../../orchestration/agents/authoring/evidence/pubchem.js';
import { primarySourceEvidence } from '../../orchestration/agents/authoring/evidence/primary-sources.js';
import { caseLawEvidence } from '../../orchestration/agents/authoring/evidence/case-law.js';
import { fredEvidence } from '../../orchestration/agents/authoring/evidence/fred.js';
import { pdbEvidence } from '../../orchestration/agents/authoring/evidence/rcsb-pdb.js';
import { ripeEvidence } from '../../orchestration/agents/authoring/evidence/ripestat.js';
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
  const before = gateLesson(payload, { sourceText, domain });
  // ---- SOURCE ENRICHMENT (history/law): attach a REAL external source the lesson can work
  // from — a genuine period newspaper (Library of Congress) or a real precedent (CourtListener).
  // Runs when the lesson has no such object yet; a fetch miss is silent (never fabricates).
  if ((domain === 'history' || domain === 'law') && (agents.enrichSources ?? true)) {
    try {
      const already = payload.scenes.some((sc) => (sc.objects ?? []).some((o) => o.sourceRef?.provenance === 'chronicling-america' || o.sourceRef?.provenance === 'courtlistener'));
      if (!already) {
        // ask the model for a good search query from the lesson's own topic
        const qRes = await chain({
          agent: 'source-query',
          system: `Give ONE short search query (3-6 words) to find a REAL ${domain === 'law' ? 'US court opinion (legal precedent)' : 'historic US newspaper article'} relevant to this lesson. Return ONLY JSON {"query": string}.`,
          user: `LESSON: ${lessonTitle}\nTOPICS: ${payload.scenes.map((s) => s.title).join(' | ').slice(0, 500)}`,
          maxTokens: 60,
          temperature: 0.2,
        });
        const query = (qRes?.json ?? qRes)?.query ?? lessonTitle;
        const fetched = domain === 'law'
          ? await (agents.caseLawEvidence ?? caseLawEvidence)(query, { rows: 2 })
          : await (agents.primarySourceEvidence ?? primarySourceEvidence)(query, { rows: 2 });
        if (fetched.length) {
          const rows = fetched.map((f) => domain === 'law'
            ? [f.caseName, f.court ?? '', `${f.date}${f.citation ? ' · ' + f.citation : ''}`]
            : [f.title, f.place ?? '', f.date]);
          const objId = domain === 'law' ? 'real_precedents' : 'real_primary_sources';
          const target = payload.scenes.find((sc) => /source|evidence|worked|example|rule|application/i.test(sc.pedagogicalRole ?? '')) ?? payload.scenes[Math.min(1, payload.scenes.length - 1)];
          if (target && !target.objects.some((o) => o.id === objId)) {
            target.objects.push({
              id: objId,
              objectType: domain === 'law' ? 'real case list' : 'real primary sources',
              renderHint: 'table',
              region: 'notebook_area',
              content: { title: domain === 'law' ? 'Real precedents (CourtListener)' : 'Real period sources (Library of Congress)', rows, links: fetched.map((f) => f.url).filter(Boolean) },
              sourceRef: { engine: domain === 'law' ? 'courtlistener' : 'chronicling-america', provenance: domain === 'law' ? 'courtlistener' : 'chronicling-america' },
            });
            target.voiceLines.push({ id: `${objId}_v`, text: domain === 'law' ? 'These are real cited precedents, not hypotheticals — pulled from the case-law database.' : 'These are genuine period sources, not paraphrases — pulled from the Library of Congress archive.', targetObjectId: objId });
            target.timeline?.actions?.push({ id: `act_${objId}`, kind: 'point', startMs: 0, durationMs: 600, targetObjectId: objId });
          }
        }
      }
    } catch (e) { log(`  source enrichment failed: ${String(e.message).slice(0, 100)}`); }
  }

  const stillOk = gateLesson(payload, { sourceText, domain });
  if (before.ok) return { before, after: stillOk, changed: false };
  const numViol = before.violations.filter((v) => v.rule === 'number-unsourced' || v.rule === 'board-number-unsourced');
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
      for (const sc of payload.scenes) {
        const execT = JSON.stringify((sc.objects ?? []).filter((o) => o.sourceRef?.provenance === 'executed').map((o) => o.content ?? '')).replace(/,/g, ' ');
        for (const o of sc.objects ?? []) {
          if (o.decorative || o.sourceRef?.provenance === 'executed') continue;
          for (const n of new Set(claimNumbersIn(o.content))) {
            if (!srcNoCommas.includes(n) && !execT.includes(n)) offenders.push({ sceneId: sc.sceneId, objectId: o.id, number: n, text: `board object ${o.id}` });
          }
        }
      }
      const offending = offenders.map((o) => `${o.sceneId}/${o.voiceLineId ?? o.objectId}: number ${o.number} in: ${String(o.text).slice(0, 120)}`).join('\n');
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
          system: `You design the tiny dataset and formulas that PROVE this ${domain ?? ''} lesson's narrated numbers by real arithmetic. Return ONLY JSON {"dataset": {"columns": [string], "rows": [[number]]}, "formulas": [{"id": string, "label": string (name the real-world meaning), "expr": string (a Python expression over the columns-as-lists and earlier formula ids)}]${domain === 'economics' ? ', optionally "fred": [series keys from: inflation_cpi, unemployment, gdp, real_gdp, fed_funds_rate, gas_price, median_income, 30yr_mortgage] — the engine fetches REAL latest Federal Reserve (FRED) data; each becomes citable evidence (use when the lesson references actual economic indicators)' : ''}${domain === 'chemistry' ? ', optionally "pubchem": [compound names] — the engine looks up REAL molecular weights/formulas from the NIH PubChem database (no key); each becomes citable evidence' : ''}${domain === 'networking' ? ', optionally "ripe": [AS numbers like "AS15169"] — the engine fetches REAL internet ownership + BGP prefixes (RIPEstat, no key); each becomes citable evidence, and "network": {"latencyFloor": {"distanceKm"}, "packetCount": {"payloadBytes","mtuBytes"}, "slowStart": {"rounds","ssthresh"?}} — REAL protocol-timing computation; the RTT floor, packet count and slow-start windows become citable evidence' : ''}${domain === 'biology' ? ', optionally "pdb": [protein names from hemoglobin/insulin/dna/lysozyme/myoglobin/collagen or a 4-char PDB id] — the engine fetches REAL 3D structures (RCSB Protein Data Bank, no key) with resolution/method; each becomes citable evidence, and "genetics": {"punnett": {"parent1","parent2","dominant"}, "hardyWeinberg": {"p"}} — REAL Punnett cross + Hardy-Weinberg computation; the genotype/phenotype ratios become citable evidence (proves 3:1 by counting the cross)' : ''}${domain === 'os_arch' ? ', optionally "sched": {"processes": [{"id","arrival","burst"}], "policies": [{"policy": "fcfs"|"sjf"|"rr", "quantum"?}]} — REAL scheduler simulations; each policy\'s computed average waiting time becomes citable evidence (proves SJF beats FCFS by RUNNING both)' : ''}${domain === 'physics' ? ', optionally "sim": {"model": "kinematics_1d"|"projectile_2d", "params": {"v0","a"|"angleDeg","g","dt","steps"}, "record": [step ints]} — a REAL numeric motion simulation the engine integrates; its trajectory rows and summary (range, final velocity) become citable evidence' : ''}${domain === 'ml_ai' ? ', optionally "train": {"lr": number, "epochs": int, "record": [epoch ints]} — a REAL gradient-descent run (linear model, columns = x then y) the engine executes; its recorded losses and final w/b become citable evidence (use this when the lesson narrates loss curves or trained parameters)' : ''}} — HARD RULE: every dataset number must literally appear in the SOURCE below (the dataset IS the source's data); the formulas then DERIVE the teaching numbers by arithmetic. Max 10 formulas, dataset <= 12 rows. Only arithmetic and sum/min/max/len/round/abs — no imports.`,
          user: `SOURCE:\n${sourceText.slice(0, 3000)}\n\nLESSON SCENES:\n${sceneTexts.slice(0, 2500)}\n\nUNSOURCED NUMBERS TO GROUND:\n${offending.slice(0, 1500)}`,
          maxTokens: 1400,
          temperature: 0.2,
        });
        let spec = world?.json ?? world;
        let cev = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            // anti-laundering: the dataset may contain ONLY numbers the source contains —
            // an invented seed would let the engine "prove" whatever the writer made up
            const srcNC2 = sourceText.replace(/,/g, '');
            const rowOk = (row) => row.every((x) => String(x).replace(/[-.%]/g, '').length < 2 || srcNC2.includes(String(x).replace(/^-/, '')));
            const goodRows = (spec.dataset?.rows ?? []).filter(rowOk);
            // salvage before rejecting: drop invented rows, keep the source-true ones
            if (goodRows.length >= 2) {
              spec = { ...spec, dataset: { ...spec.dataset, rows: goodRows } };
            } else {
              const invented = (spec.dataset?.rows ?? []).flat().map((x) => String(x)).filter((x) => x.replace(/[-.%]/g, '').length >= 2 && !srcNC2.includes(x.replace(/^-/, '')));
              if (invented.length) throw new Error(`dataset invents numbers not present in the source: ${invented.slice(0, 8).join(', ')} — ALLOWED seed numbers (use ONLY these): ${[...new Set(srcNC2.match(/\d+(?:\.\d+)?/g) ?? [])].filter((n) => n.length >= 2).slice(0, 60).join(', ')}`);
            }
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
        let fredRows = [];
        if (spec.fred && domain === 'economics') {
          try { fredRows = await fredEvidence(spec.fred, { env }); } catch (e) { log(`  FRED lookup failed: ${String(e.message).slice(0, 80)}`); }
        }
        let pubRows = [];
        if (spec.pubchem && domain === 'chemistry') {
          try { pubRows = await pubchemEvidence(spec.pubchem); } catch (e) { log(`  pubchem lookup failed: ${String(e.message).slice(0, 80)}`); }
        }
        let netRows = [];
        if (spec.network && domain === 'networking') {
          try { netRows = networkEvidence(spec.network); } catch (e) { log(`  network run failed: ${String(e.message).slice(0, 80)}`); }
        }
        let ripeRows = [];
        if (spec.ripe && domain === 'networking') {
          try { ripeRows = await ripeEvidence(spec.ripe); } catch (e) { log(`  ripe lookup failed: ${String(e.message).slice(0, 80)}`); }
        }
        let genRows = [];
        if (spec.genetics && domain === 'biology') {
          try { genRows = geneticsEvidence(spec.genetics); } catch (e) { log(`  genetics run failed: ${String(e.message).slice(0, 80)}`); }
        }
        let pdbRows = [];
        if (spec.pdb && domain === 'biology') {
          try { pdbRows = await pdbEvidence(spec.pdb); } catch (e) { log(`  pdb lookup failed: ${String(e.message).slice(0, 80)}`); }
        }
        let schedRows = [];
        if (spec.sched && domain === 'os_arch') {
          try {
            const each = (spec.sched.policies ?? [spec.sched]).map((sp) => {
              const ev = runSchedEvidence({ processes: spec.sched.processes, policy: sp.policy ?? sp, quantum: sp.quantum });
              return [`${(sp.policy ?? sp).toUpperCase()} average waiting time (simulated scheduler)`, `${(sp.policy ?? sp)} avg wait`, String(ev.avgWaiting)];
            });
            schedRows = each;
          } catch (e) { log(`  sched run failed: ${String(e.message).slice(0, 80)}`); }
        }
        let simRows = [];
        if (spec.sim && domain === 'physics') {
          try {
            const sev = runSimEvidence(spec.sim);
            simRows = [
              ...sev.rows.map((r) => [`state at t=${r.t}s (numerically simulated, dt=${spec.sim.params?.dt})`, `step ${r.step}`, JSON.stringify(r)]),
              ...Object.entries(sev.summary).map(([k, v]) => [`simulated ${k}`, k, String(v)]),
            ];
          } catch (e) { log(`  sim run failed: ${String(e.message).slice(0, 80)}`); }
        }
        let trainRows = [];
        if (spec.train && domain === 'ml_ai') {
          try {
            const tev = runTrainEvidence({ dataset: spec.dataset, train: spec.train });
            trainRows = [
              ...tev.losses.map((l) => [`MSE after epoch ${l.epoch} (executed gradient descent, lr=${spec.train.lr})`, `epoch ${l.epoch}`, String(l.mse)]),
              [`trained parameters after ${spec.train.epochs} epochs`, 'w, b', `w=${tev.final.w} b=${tev.final.b}`],
            ];
          } catch (e) { log(`  train run failed: ${String(e.message).slice(0, 80)}`); }
        }
        evBlobStr = JSON.stringify([...cev.results.map((r) => [r.label, r.expr, r.value]), ...trainRows, ...simRows, ...schedRows, ...genRows, ...netRows, ...pubRows, ...fredRows, ...pdbRows, ...ripeRows]);
        evContentObj = {
          title: 'Computed by executing the formulas (real arithmetic)',
          rows: [...cev.results.map((r) => [r.label, r.expr, String(r.value)]), ...trainRows, ...simRows, ...schedRows, ...genRows, ...netRows, ...pubRows, ...fredRows, ...pdbRows, ...ripeRows],
          dataset: cev.dataset,
        };
        provenanceEngine = 'calc-evidence';
      }

      // the evidence table lands on EVERY affected scene: the gate (and the student's eyes)
      // are scene-scoped — a number's proof must be on the board WHILE it is spoken.
      const affected = payload.scenes.filter((s) => numViol.some((v) => v.sceneId === s.sceneId));
      for (const sc of affected) {
        const objId = 'computed_evidence';
        const existing = sc.objects.find((o) => o.id === objId);
        if (existing) {
          // MERGE, never overwrite: earlier rounds' evidence still vouches for lines already
          // repaired — replacing it wholesale un-sources them and the gate count regresses
          const oldC = existing.content ?? {};
          const rows = [...(oldC.rows ?? []), ...(evContentObj.rows ?? [])];
          existing.content = {
            ...oldC,
            ...evContentObj,
            rows: rows.filter((r, i) => rows.findIndex((x) => JSON.stringify(x) === JSON.stringify(r)) === i),
            ...((oldC.results || evContentObj.results) ? { results: { ...(oldC.results ?? {}), ...(evContentObj.results ?? {}) } } : {}),
          };
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

      // voice rewrites verify like the GATE does: source + the scene's whole board — the
      // board itself is held honest by the board-number-unsourced rule, so it may vouch
      const sceneBoard = (sc) => JSON.stringify((sc?.objects ?? []).map((x) => x.content ?? '')).replace(/,/g, ' ');
      const rewrite = await chain({
        agent: 'db-evidence-rewriter',
        system: `You rewrite narration lines so every number cites the EXECUTED evidence. Return ONLY JSON {"rewrites": [{"sceneId": string, "voiceLineId": string, "newText": string}]} — same meaning, same length feel, but every figure must literally appear in the evidence or board content provided. THE LISTED NUMBER IN EACH LINE IS WRONG OR UNPROVEN: never keep it — find the CORRECT value in the evidence/board (e.g. the line says 2200 but the verified board shows the shifted demand at that price is 2000 -> write 2000). Rewrite ONLY the listed lines.`,
        user: `EXECUTED EVIDENCE:\n${evBlobStr.slice(0, 2200)}\n\nBOARD CONTENT ALREADY ON THE AFFECTED SCENES (numbers here are verified — you may cite them):\n${affected.map((sc) => sceneBoard(sc)).join(' ').slice(0, 1500)}\n\nLINES TO REWRITE (sceneId/voiceLineId: offending number: current text):\n${offending.slice(0, 2200)}`,
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
        const evScene = evText + ' ' + sceneBoard(scene);
        const missing = nums.filter((n) => !evScene.includes(n) && !srcNoCommas.includes(n));
        if (!missing.length) line.text = r.newText;
        else if (env.REPAIR_DEBUG === '1') log(`  [debug] rewrite ${r.sceneId}/${r.voiceLineId} REJECTED — not in evidence: ${missing.join(', ')} | new: ${String(r.newText).slice(0, 110)}`);
      }
      if (env.REPAIR_DEBUG === '1') {
        log(`  [debug] rewrites returned: ${rw.length} for offenders: ${offenders.length}`);
        log(`  [debug] evidence: ${evBlobStr.slice(0, 700)}`);
      }
      // board objects whose claim numbers STILL lack proof get their content corrected to
      // the sourced/executed values — the diagram must tell the same truth the engine does
      for (const sc of payload.scenes) {
        const execT = JSON.stringify((sc.objects ?? []).filter((o) => o.sourceRef?.provenance === 'executed').map((o) => o.content ?? '')).replace(/,/g, ' ');
        for (const o of sc.objects ?? []) {
          if (o.decorative || o.sourceRef?.provenance === 'executed') continue;
          const bad = [...new Set(claimNumbersIn(o.content))].filter((n) => !sourceText.replace(/,/g, '').includes(n) && !execT.includes(n));
          if (!bad.length) continue;
          try {
            const fixedObj = await chain({
              agent: 'board-content-fixer',
              system: `A board object shows numbers that are neither in the source nor in the executed evidence: ${bad.join(', ')}. Return ONLY the corrected content JSON (same structure, same keys) with every wrong number replaced by the correct value from the SOURCE or EVIDENCE below. If an element's number has NO source/evidence counterpart at all (an invented what-if ladder), REMOVE that element (drop the row/node/label) — a smaller true object beats a fuller false one. Change numbers/remove elements only, keep all layout keys (x, y, sizes) exactly.`,
              user: `OBJECT CONTENT:\n${JSON.stringify(o.content).slice(0, 2000)}\n\nSOURCE EXCERPT:\n${sourceText.slice(0, 2500)}\n\nEXECUTED EVIDENCE:\n${execT.slice(0, 1500)}`,
              maxTokens: 1500,
              temperature: 0.2,
            });
            const newContent = fixedObj?.json ?? fixedObj;
            if (newContent) {
              const srcNC3 = sourceText.replace(/,/g, '');
              let execNow = execT;
              let still = [...new Set(claimNumbersIn(newContent))].filter((n) => !srcNC3.includes(n) && !execNow.includes(n));
              if (still.length) {
                // ground-the-proposal: the fixer's numbers are often DERIVABLE (2800 = 2400
                // + the source's 400 shift) — ask the calc engine to derive exactly them
                // from source figures; only a real execution can admit them
                const supp = await chain({
                  agent: 'calc-evidence-designer',
                  system: `Derive the TARGET NUMBERS below by arithmetic from figures that appear in the SOURCE. Return ONLY JSON {"dataset": {"columns": [string], "rows": [[number]]}, "formulas": [{"id", "label", "expr"}]} — HARD RULE: every dataset number must literally appear in the SOURCE; each formula value must equal one target number. Plain arithmetic only.`,
                  user: `TARGET NUMBERS: ${still.join(', ')}\n\nSOURCE:\n${sourceText.slice(0, 3000)}`,
                  maxTokens: 1000,
                  temperature: 0.2,
                });
                const sp = supp?.json ?? supp;
                const seeds = (sp?.dataset?.rows ?? []).flat().map((x) => String(x)).filter((x) => x.replace(/[-.%]/g, '').length >= 2);
                if (sp && !seeds.some((x) => !srcNC3.includes(x.replace(/^-/, '')))) {
                  try {
                    const cev2 = runCalcEvidence({ dataset: sp.dataset, formulas: sp.formulas });
                    const addRows = cev2.results.map((r) => [r.label, r.expr, String(r.value)]);
                    let evObj = sc.objects.find((x) => x.id === 'computed_evidence');
                    if (evObj) {
                      evObj.content = { ...evObj.content, rows: [...(evObj.content?.rows ?? []), ...addRows] };
                    } else {
                      evObj = {
                        id: 'computed_evidence', objectType: 'computed evidence table', renderHint: 'table', region: 'notebook_area',
                        content: { title: 'Computed by executing the formulas (real arithmetic)', rows: addRows, dataset: cev2.dataset },
                        sourceRef: { engine: 'calc-evidence', provenance: 'executed' },
                      };
                      sc.objects.push(evObj);
                      sc.voiceLines.push({ id: 'computed_evidence_v', text: 'Every number here was measured by actually running the computation — nothing is estimated.', targetObjectId: 'computed_evidence' });
                      sc.timeline?.actions?.push({ id: 'act_evidence', kind: 'point', startMs: 0, durationMs: 600, targetObjectId: 'computed_evidence' });
                    }
                    execNow = JSON.stringify((sc.objects ?? []).filter((x) => x.sourceRef?.provenance === 'executed').map((x) => x.content ?? '')).replace(/,/g, ' ');
                    still = [...new Set(claimNumbersIn(newContent))].filter((n) => !srcNC3.includes(n) && !execNow.includes(n));
                  } catch { /* derivation failed — proposal stays rejected */ }
                }
              }
              if (!still.length) o.content = newContent;
              else if (env.REPAIR_DEBUG === '1') log(`  [debug] board fix ${sc.sceneId}/${o.id} rejected, still unsourced: ${still.join(', ')}`);
            }
          } catch (e) { log(`  board fix failed on ${o.id}: ${String(e.message).slice(0, 80)}`); }
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
    predict: { objType: 'prediction prompt', content: '{"variant": "checkpoint", "title": string, "body": string (ask the student to COMMIT to a prediction answerable from the lesson board — one question, indirect, no reveal)}', voiceHint: 'pose the prediction question and tell the student to commit before scrolling on — do NOT answer it', atEnd: false, atStart: true },
  };
  const missingBeats = before.violations
    .filter((v) => v.rule === 'beat-missing')
    .map((v) => (v.detail.match(/"(\w+)" beat/) ?? [])[1])
    .filter((b) => BEAT_SPECS[b]);
  if (before.violations.some((v) => v.rule === 'no-early-prediction')) missingBeats.push('predict');
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
      // deterministic number check on the WRITER'S OWN scene — the observed 69->78
      // regression was repair inserting scenes whose numbers were themselves unsourced
      const sceneNums = [...new Set(claimNumbersIn(scene?.objects?.map((o) => o.content) ?? [])), ...((scene?.voiceLines ?? []).flatMap((l) => claimNumbersIn(l.text)))];
      const srcNC4 = sourceText.replace(/,/g, '');
      const dirty = sceneNums.filter((n) => !srcNC4.includes(n));
      if (dirty.length) {
        if (env.REPAIR_DEBUG === '1') log(`  [debug] ${beat} scene rejected — unsourced numbers: ${dirty.join(', ')}`);
        scene = null;
      }
      if (validScene(scene)) {
        scene.pedagogicalRole = beat;
        if (!scene.timeline?.actions) scene.timeline = { sceneId: scene.sceneId, timingSource: 'provisional', actions: [{ id: `act_${beat}`, kind: 'point', startMs: 0, durationMs: 600, targetObjectId: scene.objects[0].id }] };
        if (spec.atEnd) payload.scenes.push(scene);
        else if (spec.atStart) payload.scenes.splice(1, 0, scene);
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

  // ---- FIX 5: fabricated quotations (history/law) -> verbatim source or honest paraphrase ----
  const quoteViol = before.violations.filter((v) => v.rule === 'quote-unsourced');
  if (quoteViol.length) {
    try {
      const items = quoteViol.map((v) => `${v.sceneId}: ${v.detail}`).join('\n').slice(0, 2500);
      const rewrite = await chain({
        agent: 'quote-fixer',
        system: `Lines below present quotations that are NOT verbatim in the source — in this field a quotation is a claim of verbatimness. For each, either (a) replace the quoted span with the EXACT source wording, or (b) remove the quotation marks and paraphrase honestly. Return ONLY JSON {"rewrites": [{"sceneId": string, "voiceLineId": string|null, "objectId": string|null, "newText": string (the FULL corrected line; for an object, the corrected content JSON as a string)}]}.`,
        user: `SOURCE:\n${sourceText.slice(0, 4000)}\n\nOFFENDING QUOTES:\n${items}`,
        maxTokens: 1600,
        temperature: 0.2,
      });
      const normSource2 = sourceText.toLowerCase().replace(/\s+/g, ' ');
      const spansOf = (t) => [...String(t ?? '').matchAll(/["\u201c]([^"\u201d]{20,300})["\u201d]/g)].map((m) => m[1].trim()).filter((x) => x.split(/\s+/).length >= 5);
      for (const r of (rewrite?.json ?? rewrite)?.rewrites ?? []) {
        const sc = payload.scenes.find((x) => x.sceneId === r.sceneId);
        if (!sc) continue;
        const bad = spansOf(r.newText).filter((sp) => !normSource2.includes(sp.toLowerCase().replace(/\s+/g, ' ')));
        if (bad.length) continue; // the fix itself fabricates — reject
        if (r.voiceLineId) {
          const vl = sc.voiceLines?.find((l) => l.id === r.voiceLineId);
          if (vl) vl.text = r.newText;
        } else if (r.objectId) {
          const o = sc.objects?.find((x) => x.id === r.objectId);
          if (o) { try { o.content = JSON.parse(r.newText); } catch { o.content = r.newText; } }
        }
      }
    } catch (e) { log(`  quote fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  // ---- FIX 6: malformed EARS requirements (srs) -> rewritten to the Mavin template ----
  const earsViol = before.violations.filter((v) => v.rule === 'ears-malformed');
  if (earsViol.length) {
    try {
      const items = earsViol.map((v) => `${v.sceneId}: ${v.detail}`).join('\n').slice(0, 2500);
      const rewrite = await chain({
        agent: 'ears-fixer',
        system: `Rewrite each requirement into EARS syntax (Mavin): "While <precondition>, when <trigger>, the <system> shall <single testable response>". Exactly one "shall" per requirement; conditional requirements put a comma before "the <system> shall". Return ONLY JSON {"rewrites": [{"sceneId": string, "voiceLineId": string|null, "objectId": string|null, "find": string (the exact bad requirement substring), "replace": string (EARS form)}]}. Keep the meaning; only fix the form.`,
        user: `MALFORMED REQUIREMENTS:\n${items}`,
        maxTokens: 1400,
        temperature: 0.2,
      });
      const { checkEarsRequirement } = await import('./ears-check.js');
      for (const r of (rewrite?.json ?? rewrite)?.rewrites ?? []) {
        if (!r.replace || !checkEarsRequirement(r.replace).ok) continue; // fix must itself be valid EARS
        const sc = payload.scenes.find((x) => x.sceneId === r.sceneId);
        if (!sc) continue;
        if (r.voiceLineId) {
          const vl = sc.voiceLines?.find((l) => l.id === r.voiceLineId);
          if (vl && r.find && vl.text.includes(r.find)) vl.text = vl.text.replace(r.find, r.replace);
        } else if (r.objectId) {
          const o = sc.objects?.find((x) => x.id === r.objectId);
          if (o && r.find) { try { o.content = JSON.parse(JSON.stringify(o.content).replace(r.find, r.replace)); } catch { /* leave */ } }
        } else {
          // no target: replace across the scene's voice lines
          for (const vl of sc.voiceLines ?? []) if (r.find && vl.text.includes(r.find)) vl.text = vl.text.replace(r.find, r.replace);
        }
      }
    } catch (e) { log(`  EARS fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  // ---- FIX 7: unbalanced chemical equations -> rebalanced, checker-verified ----
  const balViol = before.violations.filter((v) => v.rule === 'equation-unbalanced');
  if (balViol.length) {
    try {
      const { checkBalance } = await import('./chem-balance.js');
      const items = balViol.map((v) => `${v.sceneId}: ${v.detail}`).join('\n').slice(0, 2000);
      const rewrite = await chain({
        agent: 'equation-balancer',
        system: `Each chemical equation below is UNBALANCED. Return ONLY JSON {"rewrites": [{"sceneId": string, "find": string (the exact unbalanced equation substring), "replace": string (the same reaction, correctly balanced with integer coefficients)}]}. Balance by adjusting coefficients only; never change the chemical formulas.`,
        user: items,
        maxTokens: 800,
        temperature: 0.1,
      });
      for (const r of (rewrite?.json ?? rewrite)?.rewrites ?? []) {
        if (!r.replace || !checkBalance(r.replace).ok) continue; // the fix must actually balance
        const sc = payload.scenes.find((x) => x.sceneId === r.sceneId);
        if (!sc || !r.find) continue;
        for (const vl of sc.voiceLines ?? []) if (vl.text.includes(r.find)) vl.text = vl.text.replace(r.find, r.replace);
        for (const o of sc.objects ?? []) { try { const j = JSON.stringify(o.content); if (j.includes(r.find)) o.content = JSON.parse(j.split(r.find).join(r.replace)); } catch { /* leave */ } }
      }
    } catch (e) { log(`  balance fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  // ---- FIX 8: law lesson missing the IRAC application step -> insert an application scene ----
  if (before.violations.some((v) => v.rule === 'irac-no-application')) {
    try {
      const made = await chain({
        agent: 'irac-application-writer',
        system: `Write ONE scene that supplies the missing IRAC APPLICATION step for this law lesson. Return ONLY JSON {"sceneId": "sc_application", "title": string, "pedagogicalRole": "worked_example", "layout": "teacher_notebook_code", "objects": [{"id": "application_map", "objectType": "application table", "renderHint": "table", "region": "notebook_area", "content": {"title": string, "rows": [[ "rule element", "fact that satisfies (or fails) it" ] ...]}}], "voiceLines": [{"id": "app_1", "text": string (<=45 words, map EACH rule element to a specific fact — "applying the rule here, ..."), "targetObjectId": "application_map"}], "timeline": {"sceneId": "sc_application", "timingSource": "provisional", "actions": [{"id": "act_app", "kind": "point", "startMs": 0, "durationMs": 600, "targetObjectId": "application_map"}, {"id": "act_app_sp", "kind": "speech", "startMs": 200, "durationMs": 6000, "voiceLineId": "app_1"}]}, "durationMs": 8000}`,
        user: `LESSON: ${lessonTitle}\nSCENES: ${payload.scenes.map((s) => s.title).join(' | ').slice(0, 600)}`,
        maxTokens: 700,
        temperature: 0.3,
      });
      const scene = made?.json ?? made;
      if (scene?.sceneId && scene.objects?.length && scene.voiceLines?.length && scene.voiceLines.every((l) => scene.objects.some((o) => o.id === l.targetObjectId))) {
        // insert before the concluding scene
        payload.scenes.splice(Math.max(payload.scenes.length - 1, 1), 0, scene);
      }
    } catch (e) { log(`  IRAC fix failed: ${String(e.message).slice(0, 100)}`); }
  }

  const after = gateLesson(payload, { sourceText, domain });
  return { before, after, changed: after.violations.length < before.violations.length };
}
