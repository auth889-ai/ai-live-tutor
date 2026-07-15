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
export function compileDpTable({ events, result, code, entry = null, rowLabels = null, colLabels = null, language = 'python' } = {}) {
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
    if (writes.length === 1) {
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
      parts.push(narrateWrite({ r, c, value: known.get(`${r},${c}`), old, isBase: r === 0 || c === 0 }));
    }
    if (writes.length > 2) parts.push(narrateBatch({ count: writes.length - 2 }));
    for (const [r, c] of writes) filled.push([r, c]);
    lastWrite = writes[writes.length - 1];
    const stepObj = snap({
      line,
      explanation: proved ? `${parts.join(' ')} (rule: ${proved.rule})` : parts.join(' '),
      writes: writes.map(([r, c]) => [r, c]),
      current: [lastWrite[0], lastWrite[1]],
      variables: ev.locals ?? {},
    });
    if (proved) {
      stepObj.array2d.highlight = proved.reads;
      stepObj.array2d.rule = proved.rule;
    }
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
