// PLAYBACK STAGE of the dp-table tool: compile faithful table snapshots into a validated
// ExecutionTrace rendered by the existing GridView (current write orange, filled region green,
// values accumulating). Beats derived by diffing consecutive REAL snapshots: the table's
// creation is one init step, every subsequent cell write is its own visible moment narrated
// with its actual old -> new values, and the terminal beat reads the answer out of the table.
// A table the code grows row-by-row (dp.append) is handled: the view sizes to the FINAL
// dimensions and cells simply appear when the run created them. Only observed writes are ever
// shown — and dependency highlights are PROVED, never guessed: a write's reads light up only
// when exactly ONE arithmetic rule (diag+1 / top+left / max(top,left))
// reproduces the written value from the prior table state; any ambiguity means no highlight.

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

  const provedByCell = new Map(); // write cell -> { rule, cells:[{p,v}] } — the recon graph
  for (const ev of snapshots) {
    const line = Number(ev.line);
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
      steps.push(snap({
        line,
        explanation: narrateInit({ rows: ev.table.length, cols: Math.max(...ev.table.map((r) => r.length)) }),
        writes: writes.map(([r, c]) => [r, c]),
        current: null,
        variables: ev.locals ?? {},
      }));
      continue;
    }

    // PROVED-DEPENDENCY INFERENCE (the AlgoTutor-mockup arrows, honestly): single-cell,
    // non-base writes only. Candidates from the PRE-write state; exactly one matching rule
    // -> highlight those reads + name the rule; zero or several matches -> nothing.
    let proved = null;
    if (directReads && writes.length === 1) {
      // PROVENANCE MODE: arrows come ONLY from recorded reads executed on the writing line
      // (the previous snapshot's line — line events fire before their line runs). No reads
      // recorded -> no arrows, whatever the arithmetic looks like.
      const [wr, wc] = writes[0];
      const prevReads = snapshots[snapshots.indexOf(ev) - 1]?.reads ?? [];
      const seen = new Set();
      const cells = [];
      for (const rd of prevReads) {
        const key = `${rd.p[0]},${rd.p[1]}`;
        if ((rd.p[0] !== wr || rd.p[1] !== wc) && !seen.has(key)) { seen.add(key); cells.push(rd); }
      }
      if (cells.length >= 1 && cells.length <= 3) {
        const val = ev.table[wr]?.[wc];
        const vs = cells.map((c) => c.v);
        const nums = vs.every((v) => typeof v === 'number') && typeof val === 'number';
        let rule = null;
        if (nums) {
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
    } else if (informative && writes.length === 1) {
      const [r, c] = writes[0];
      if (r > 0 || c > 0) {
        const val = ev.table[r]?.[c];
        const top = r > 0 ? known.get(`${r - 1},${c}`) : undefined;
        const left = c > 0 ? known.get(`${r},${c - 1}`) : undefined;
        const diag = r > 0 && c > 0 ? known.get(`${r - 1},${c - 1}`) : undefined;
        const nums = (...vs) => vs.every((v) => typeof v === 'number');
        const matches = [];
        if (nums(val, diag) && val === diag + 1) matches.push({ rule: 'diagonal + 1', reads: [[r - 1, c - 1]] });
        if (nums(val, top, left) && val === top + left) matches.push({ rule: 'top + left', reads: [[r - 1, c], [r, c - 1]] });
        if (nums(val, top, left) && val === Math.max(top, left)) matches.push({ rule: 'max(top, left)', reads: [[r - 1, c], [r, c - 1]] });
        if (matches.length === 1) proved = matches[0];
      }
    }

    const parts = [];
    for (const [r, c, old] of writes.slice(0, 2)) {
      parts.push(narrateWrite({ r, c, value: known.get(`${r},${c}`), old, isBase: r === 0 || c === 0, proved: Boolean(proved), informative }));
    }
    if (writes.length > 2) parts.push(narrateBatch({ count: writes.length - 2 }));
    for (const [r, c] of writes) filled.push([r, c]);
    lastWrite = writes[writes.length - 1];
    // provable input columns (the reference ledger's X[i-1] / Y[j-1]): scalar reads of
    // non-table variables recorded on the WRITING line — shown only when they exist
    // the compare usually runs one line BEFORE the write (if X[i-1] == Y[j-1]: / dp[i][j] =)
    // — gather inputs from the write line AND its immediate predecessor
    const evAt = snapshots.indexOf(ev);
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
    if (proved) {
      stepObj.array2d.highlight = proved.reads;
      stepObj.array2d.rule = proved.rule;
    }
    // Typed events (B2): every cell write is a cell_update with recorded before/after; a
    // PROVED dependency additionally emits dependency_read events for the cells the rule
    // read — the machine-readable form of the mockups' arrows + formula column.
    // Stable role + STRUCTURED formula (reviewer rule: "top + left" is formula text, not a
    // semantic role) — operands reference canonical gridCell ids the resolver can prove.
    const FORMULA_OPS = { 'diagonal + 1': 'add_one', 'top + left': 'add', 'max(top, left)': 'max' };
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
  if (directReads && lastWrite && provedByCell.size >= 3) {
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
        steps.push(st);
      }
      steps.push(snap({
        line: snapshots.at(-1)?.line ?? 1,
        explanation: `Answer path complete: ${hops.length} hops walked backward, ${contributing} contributing cells — every single hop follows a read this run actually recorded, so the path cannot be invented.`,
        writes: [], current: null, variables: {},
      }));
    }
  }

  const answer = lastWrite ? { r: lastWrite[0], c: lastWrite[1], value: known.get(`${lastWrite[0]},${lastWrite[1]}`) } : { r: null, c: null, value: undefined };
  steps.push(snap({
    line: steps[steps.length - 1].line,
    explanation: narrateDone({ result, ...answer, truncated }),
    writes: [],
    current: lastWrite ? [lastWrite[0], lastWrite[1]] : null,
  }));

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
