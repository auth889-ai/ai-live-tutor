// PLAYBACK STAGE of the dp-table tool: compile faithful table snapshots into a validated
// ExecutionTrace rendered by the existing GridView (current write orange, filled region green,
// values accumulating). Beats derived by diffing consecutive REAL snapshots: the table's
// creation is one init step, every subsequent cell write is its own visible moment narrated
// with its actual old -> new values, and the terminal beat reads the answer out of the table.
// A table the code grows row-by-row (dp.append) is handled: the view sizes to the FINAL
// dimensions and cells simply appear when the run created them. Only observed writes are ever
// shown — and dependency highlights come ONLY from RECORDED reads (correctness lock,
// 2026-07-28: the old arithmetic-consensus fallback — "exactly one of diag+1 / top+left /
// max(top,left) reproduces the value" — could still invent an arrow no runtime read backs,
// so it was DELETED). No recorded read → reads: [] and no arrow: an honest bare write
// beats a guessed arrow, every time.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import { narrateStart, narrateInit, narrateWrite, narrateBatch, narrateDone } from './narrate.js';

// compileDpTable({ events, result, code, entry?, rowLabels?, colLabels?, language })
export function compileDpTable({ events, result, code, entry = null, rowLabels = null, colLabels = null, language = 'python' , directReads = false } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('dp-table tracker recorded no events');
  if (events.some((e) => e?.too_big === true)) {
    throw new Error('the dp table exceeds 24x24 — pick a smaller teaching example (a dry run must stay readable)');
  }
  const truncated = events[events.length - 1]?.truncated === true;
  if (truncated) events = events.slice(0, -1);
  const lineCount = String(code ?? '').split('\n').length;

  const snapshots = events.filter((e) => Array.isArray(e.table) && Number.isInteger(Number(e.line)) && Number(e.line) >= 1 && Number(e.line) <= lineCount);
  if (snapshots.length === 0) throw new Error('dp-table tracker saw no table — check the declared dp variable name');
  const rows = Math.max(...snapshots.map((e) => e.table.length));
  const cols = Math.max(...snapshots.map((e) => Math.max(...e.table.map((r) => r.length))));

  const steps = [];
  const known = new Map(); // "r,c" -> value (everything ever written)
  const filled = []; // cells written AFTER init, in write order (the green region)
  let initialized = false;
  let lastWrite = null;

  const snap = ({ line, explanation, writes, current, variables }) => ({
    line,
    explanation,
    array2d: {
      ...(current ? { current } : {}),
      ...(writes.length ? { values: writes.map(([r, c]) => [r, c, known.get(`${r},${c}`)]) } : {}),
      ...(filled.length ? { filled: [...filled] } : {}),
    },
    variables: variables ?? {},
  });

  // GUARD (reproduced fake-arrow, 2026-07-19): rules are only provable when writes carry
  // information. A constant fill (table[i][j] = 1 on a zero scaffold) satisfies
  // 'diagonal + 1' at EVERY cell — systematically — so exactly-one-match passes on a
  // coincidence. Fewer than 2 distinct written values across the run -> no claims, ever.
  const distinctWritten = new Set();
  {
    let prevT = null;
    for (const e of snapshots) {
      if (!Array.isArray(e?.table)) continue;
      if (prevT) {
        for (let r = 0; r < e.table.length; r += 1) {
          for (let c = 0; c < (e.table[r]?.length ?? 0); c += 1) {
            if (JSON.stringify(prevT?.[r]?.[c]) !== JSON.stringify(e.table[r][c])) distinctWritten.add(JSON.stringify(e.table[r][c]));
          }
        }
      }
      prevT = e.table;
    }
  }
  // a systematic coincidence needs repetition: only suppress when 3+ writes all carry
  // one single value (the constant-fill signature) — tiny demos keep their proofs
  let totalWrites = 0;
  {
    let prevT = null;
    for (const e of snapshots) {
      if (!Array.isArray(e?.table)) continue;
      if (prevT) {
        for (let r = 0; r < e.table.length; r += 1) {
          for (let c = 0; c < (e.table[r]?.length ?? 0); c += 1) {
            if (JSON.stringify(prevT?.[r]?.[c]) !== JSON.stringify(e.table[r][c])) totalWrites += 1;
          }
        }
      }
      prevT = e.table;
    }
  }
  const informative = !(totalWrites >= 3 && distinctWritten.size < 2);

  // dpvis STEP MODEL (2026-07-28): phase derivation needs "has ANY dp read happened before
  // snapshot k's timestep?" — prefix-computed from the RECORDED reads, never from formulas.
  const dpReadBefore = snapshots.map(() => false);
  {
    let seen = false;
    snapshots.forEach((s, k) => { dpReadBefore[k] = seen; if (directReads && (s.reads?.length ?? 0) > 0) seen = true; });
  }

  const provedByCell = new Map(); // write cell -> { rule, cells:[{p,v}] } — the recon graph
  for (const ev of snapshots) {
    const line = Number(ev.line);
    const evAt = snapshots.indexOf(ev);
    const writes = [];
    ev.table.forEach((row, r) => {
      row.forEach((v, c) => {
        const key = `${r},${c}`;
        if (!known.has(key) || JSON.stringify(known.get(key)) !== JSON.stringify(v)) {
          writes.push([r, c, known.get(key)]);
          known.set(key, v);
        }
      });
    });
    if (writes.length === 0) continue;

    if (!initialized) {
      // The first snapshot is the table's creation — scaffold, not answers.
      initialized = true;
      const initStep = snap({
        line,
        explanation: narrateInit({ rows: ev.table.length, cols: Math.max(...ev.table.map((r) => r.length)) }),
        writes: writes.map(([r, c]) => [r, c]),
        current: null,
        variables: ev.locals ?? {},
      });
      initStep.phase = 'base'; // the scaffold IS the base layer — nothing was read to seed it
      steps.push(initStep);
      continue;
    }

    // TIMESTEP READS (dpvis rule): the dp-array subscript reads recorded since the previous
    // write — line events fire BEFORE their line runs, so a write observed at snapshot k was
    // performed by snapshot k-1's line, and k-1's recorded reads are its timestep. Deduped,
    // straight from the recording; when nothing was recorded the list is EMPTY, never inferred.
    const stepReads = [];
    if (directReads) {
      const seenRd = new Set();
      for (const rd of snapshots[evAt - 1]?.reads ?? []) {
        const key = `${rd.p[0]},${rd.p[1]}`;
        if (!seenRd.has(key)) { seenRd.add(key); stepReads.push(rd); }
      }
    }
    // CHOSEN (max/min winners): only from a RECORDED max/min op whose result IS the written
    // value and which executed AFTER the last RHS read — the winner cells are the reads whose
    // recorded value equals that result. No recorded op -> no chosen, ever (never guess).
    let chosen = null;
    let tookBest = false;
    if (directReads && writes.length === 1 && stepReads.length > 0) {
      const [wr, wc] = writes[0];
      const val = ev.table[wr]?.[wc];
      const rhsOps = snapshots[evAt - 1]?.rhsOps ?? [];
      const lastQ = Math.max(0, ...stepReads.map((x) => x.q ?? 0));
      const mm = rhsOps.filter((o) => (o.op === 'max' || o.op === 'min') && o.r === val && (o.q ?? 0) > lastQ);
      if (mm.length === 1) {
        tookBest = true;
        const winners = stepReads.filter((x) => x.v === mm[0].r).map((x) => x.p);
        if (winners.length > 0) chosen = winners;
      }
    }
    // PHASE (dpvis state machine): base = written before the dp array was ever read (or the
    // row-0/col-0 seeding pattern) with no reads of its own; answer is the terminal beat.
    const rowCol0 = writes.every(([r, c]) => (rows > 1 ? r === 0 || c === 0 : c === 0));
    const phase = stepReads.length === 0 && ((directReads ? !dpReadBefore[evAt] : false) || rowCol0) ? 'base' : 'fill';

    // PROVED DEPENDENCIES — provenance mode ONLY (correctness lock, 2026-07-28): arrows come
    // exclusively from reads the run RECORDED on the writing line. The arithmetic-inference
    // fallback that used to live in an else-branch here (derive reads from formula/position
    // when none were recorded) is DELETED: no runtime read -> no arrow, whatever the numbers
    // coincidentally satisfy. A write without recorded reads ships as an honest bare write.
    let proved = null;
    if (directReads && writes.length === 1) {
      // PROVENANCE MODE: arrows come ONLY from recorded reads executed on the writing line
      // (the previous snapshot's line — line events fire before their line runs). No reads
      // recorded -> no arrows, whatever the arithmetic looks like.
      const [wr, wc] = writes[0];
      const cells = stepReads.filter((rd) => rd.p[0] !== wr || rd.p[1] !== wc);
      if (cells.length >= 1 && cells.length <= 3) {
        const val = ev.table[wr]?.[wc];
        const vs = cells.map((c) => c.v);
        const nums = vs.every((v) => typeof v === 'number') && typeof val === 'number';
        let rule = null;
        // RECORDED OPERATOR (phase 2): if the RHS executed an op whose result IS the written
        // value, the rule is a fact — no consensus needed, valid even in constant runs
        const rhsOps = snapshots[evAt - 1]?.rhsOps ?? [];
        const lastReadQ = Math.max(0, ...cells.map((x) => x.q ?? 0));
        // only ops that executed AFTER the last RHS read can be the combining op — index
        // arithmetic (i - 1) runs before its read and must never name the rule
        // a MULTI-op expression (x * 0 + 1) cannot be summarized by one operator without a
        // real expression DAG — no single-op rule is named for it (review lib18 #3)
        const certain = rhsOps.length === 1 ? rhsOps.filter((o) => o.r === val && (o.q ?? 0) > lastReadQ) : [];
        if (certain.length) {
          const o = certain[certain.length - 1];
          rule = ({ Add: 'sum (recorded op)', Sub: 'difference (recorded op)', Mult: 'product (recorded op)', FloorDiv: 'floor-div (recorded op)', Mod: 'mod (recorded op)', max: 'max (recorded op)', min: 'min (recorded op)' })[o.op] ?? `${o.op} (recorded op)`;
        } else if (nums) {
          // the same honesty rule as arrows: if MORE than one op reproduces the value from
          // these reads (max(0,1) === 0+1), no op is named — the reads stay, the claim doesn't
          const ops = [];
          if (vs.length === 1 && val === vs[0] + 1) ops.push('read + 1');
          if (vs.length >= 2 && val === vs.reduce((a, b) => a + b, 0)) ops.push('sum of reads');
          if (vs.length >= 2 && val === Math.max(...vs)) ops.push('max of reads');
          if (vs.length >= 2 && val === Math.min(...vs)) ops.push('min of reads');
          if (vs.length >= 2 && val === Math.min(...vs) + 1) ops.push('min of reads + 1');
          if (vs.length >= 2 && val === Math.max(...vs) + 1) ops.push('max of reads + 1');
          if (ops.length === 1 && informative) rule = ops[0]; // constant-output runs earn no op name
        }
        proved = { rule: rule ?? (informative ? 'from read cells' : 'reads recorded — value not derived from them'), reads: cells.map((c) => c.p) };
        provedByCell.set(`${wr},${wc}`, { rule: proved.rule, cells });
      }
    }
    // (Deleted 2026-07-28: the non-provenance else-branch that INFERRED a dependency when
    // exactly one of diag+1 / top+left / max(top,left) reproduced the value from the prior
    // table state. Arithmetic coincidence is not evidence — recordings without read
    // instrumentation now render bare writes and zero arrows, which is the truth they carry.)

    const parts = [];
    for (const [r, c, old] of writes.slice(0, 2)) {
      parts.push(narrateWrite({
        r, c, value: known.get(`${r},${c}`), old, isBase: phase === 'base' || r === 0 || c === 0,
        proved: Boolean(proved), informative, readsInstrumented: directReads,
        // Striver-grammar facts (recorded only): the reads this write's timestep logged, and
        // the max/min winners when a recorded op proved them — single-cell writes only.
        readCells: directReads && writes.length === 1 ? stepReads : null,
        chosen, tookBest,
      }));
    }
    if (writes.length > 2) parts.push(narrateBatch({ count: writes.length - 2 }));
    for (const [r, c] of writes) filled.push([r, c]);
    lastWrite = writes[writes.length - 1];
    // provable input columns (the reference ledger's X[i-1] / Y[j-1]): scalar reads of
    // non-table variables recorded on the WRITING line — shown only when they exist
    // the compare usually runs one line BEFORE the write (if X[i-1] == Y[j-1]: / dp[i][j] =)
    // — gather inputs from the write line AND its immediate predecessor
    const inputReads = directReads
      ? [...(snapshots[evAt - 2]?.inputs ?? []), ...(snapshots[evAt - 1]?.inputs ?? [])].slice(0, 4)
      : [];
    const inputNote = inputReads.length
      ? ` Inputs read: ${inputReads.map((x) => `${x.n}[${x.p[0]}] = ${JSON.stringify(x.v)}`).join(', ')}.`
      : '';
    const stepObj = snap({
      line,
      explanation: (proved ? `${parts.join(' ')} (rule: ${proved.rule})` : parts.join(' ')) + inputNote,
      writes: writes.map(([r, c]) => [r, c]),
      current: [lastWrite[0], lastWrite[1]],
      variables: ev.locals ?? {},
    });
    if (inputReads.length) stepObj.inputs = inputReads;
    // dpvis STEP MODEL (additive contract): reads = this timestep's RECORDED dp reads (empty
    // when none were recorded — an empty list is a fact, a guessed list is a lie); chosen =
    // recorded max/min winners; phase = base|fill from the rules above.
    stepObj.phase = phase;
    if (directReads) stepObj.reads = stepReads.map((x) => [x.p[0], x.p[1]]);
    if (chosen) stepObj.chosen = chosen.map((p) => [p[0], p[1]]);
    if (proved) {
      stepObj.array2d.highlight = proved.reads;
      stepObj.array2d.rule = proved.rule;
    }
    // Typed events (B2): every cell write is a cell_update with recorded before/after; a
    // PROVED dependency additionally emits dependency_read events for the cells the rule
    // read — the machine-readable form of the mockups' arrows + formula column.
    // Stable role + STRUCTURED formula (reviewer rule: "sum of reads" is formula text, not a
    // semantic role) — operands reference canonical gridCell ids the resolver can prove.
    // Keys are the PROVENANCE-mode rule names only (the inferred-rule names died with the
    // inference branch); anything unmapped passes through as its literal text.
    const FORMULA_OPS = {
      'read + 1': 'add_one', 'sum of reads': 'add', 'max of reads': 'max', 'min of reads': 'min',
      'max of reads + 1': 'max_add_one', 'min of reads + 1': 'min_add_one',
      'sum (recorded op)': 'add', 'difference (recorded op)': 'sub', 'product (recorded op)': 'mult',
      'floor-div (recorded op)': 'floor_div', 'mod (recorded op)': 'mod',
      'max (recorded op)': 'max', 'min (recorded op)': 'min',
    };
    stepObj.events = [
      ...writes.map(([r, c, old]) => ({
        eventType: 'cell_update',
        ...(proved ? {
          semanticRole: 'dp_recurrence_update',
          formula: { operator: FORMULA_OPS[proved.rule] ?? proved.rule, operands: proved.reads.map(([rr, cc]) => ({ ref: `gridCell:${rr}:${cc}` })), text: proved.rule },
        } : {}),
        target: { entityId: `gridCell:${r}:${c}` },
        before: old,
        after: known.get(`${r},${c}`),
      })),
      ...(proved ? proved.reads.map(([r, c]) => ({
        eventType: 'dependency_read',
        target: { entityId: `gridCell:${r}:${c}` },
        after: known.get(`${r},${c}`),
      })) : []),
    ];
    steps.push(stepObj);
  }
  if (steps.length === 0) throw new Error('dp-table tracker saw no table writes — the run never changed the dp variable');

  if (entry) {
    steps.unshift({
      line: steps[0].line,
      explanation: narrateStart({ entry, rows, cols }),
      array2d: {},
      variables: {},
    });
  }
  // RECONSTRUCTION (the reference mockup's final episode), fully dynamic: walk BACKWARD from
  // the last-written cell along the PROVED read edges of THIS run — no problem knowledge,
  // no direction assumptions. A '+' rule marks a contributing cell; a max/min rule follows
  // the donor whose recorded value equals the cell's value.
  if (directReads && informative && lastWrite && provedByCell.size >= 3) {
    let cur = [lastWrite[0], lastWrite[1]];
    const hops = [];
    const seenCells = new Set();
    while (cur && provedByCell.has(`${cur[0]},${cur[1]}`) && hops.length < rows + cols + 4 && !seenCells.has(`${cur[0]},${cur[1]}`)) {
      seenCells.add(`${cur[0]},${cur[1]}`);
      const proof = provedByCell.get(`${cur[0]},${cur[1]}`);
      const val = known.get(`${cur[0]},${cur[1]}`);
      const donor = proof.cells.length === 1
        ? proof.cells[0]
        : (proof.cells.find((x) => x.v === val) ?? proof.cells[0]);
      const contributes = proof.rule === 'read + 1' || proof.rule === 'sum of reads';
      hops.push({ cur: [...cur], next: donor.p, rule: proof.rule, val, contributes });
      cur = [...donor.p];
    }
    if (hops.length >= 2) {
      const contributing = hops.filter((h) => h.contributes).length;
      for (const h of hops) {
        const st = snap({
          line: snapshots.at(-1)?.line ?? 1,
          explanation: h.contributes
            ? `Reconstruction: dp[${h.cur[0]}][${h.cur[1]}] = ${JSON.stringify(h.val)} was PROVED as ${h.rule} from dp[${h.next[0]}][${h.next[1]}] — this cell CONTRIBUTES to the answer. We step back along that recorded read.`
            : `Reconstruction: dp[${h.cur[0]}][${h.cur[1]}] = ${JSON.stringify(h.val)} was written after reading dp[${h.next[0]}][${h.next[1]}] (recorded). No value flow is claimed beyond that read. Step back along it.`,
          writes: [],
          current: h.cur,
          variables: {},
        });
        st.array2d.highlight = [h.next];
        st.array2d.rule = 'reconstruction';
        st.phase = 'answer'; // terminal read-only beats — nothing is written past here
        steps.push(st);
      }
      const closeStep = snap({
        line: snapshots.at(-1)?.line ?? 1,
        explanation: `Answer path complete: ${hops.length} hops walked backward, ${contributing} contributing cells — every single hop follows a read this run actually recorded, so the path cannot be invented.`,
        writes: [], current: null, variables: {},
      });
      closeStep.phase = 'answer';
      steps.push(closeStep);
    }
  }

  const answer = lastWrite ? { r: lastWrite[0], c: lastWrite[1], value: known.get(`${lastWrite[0]},${lastWrite[1]}`) } : { r: null, c: null, value: undefined };
  const doneStep = snap({
    line: steps[steps.length - 1].line,
    explanation: narrateDone({ result, ...answer, truncated }),
    writes: [],
    current: lastWrite ? [lastWrite[0], lastWrite[1]] : null,
  });
  doneStep.phase = 'answer'; // the dpvis terminal state: a read with no subsequent write
  steps.push(doneStep);

  const labelsOk = (labels, n) => Array.isArray(labels) && labels.length === n && labels.every((l) => typeof l === 'string');
  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: {
      array2d: {
        rows,
        cols,
        ...(labelsOk(rowLabels, rows) ? { rowLabels } : {}),
        ...(labelsOk(colLabels, cols) ? { colLabels } : {}),
      },
    },
    steps,
  }, 'dp-table trace');
}
