// DP-TABLE LENS — detector/compiler pair #7 of the record-once/detect-later engine: LCS,
// edit distance, knapsack, unique paths, Pascal's triangle — a 2D table the run FILLS.
//
// The disambiguation this lens owns (vs grid-walk — both are mutating 2D lists):
//   a DP table starts as SCAFFOLD (every cell equal, e.g. all zeros) or GROWS from nothing
//   (rows appended), fills in a REGULAR SWEEP (row-major for ≥80% of consecutive writes —
//   nested for-loops leave fingerprints), and is never driven by a breathing queue of
//   coordinates. A walked grid is the opposite on all three: it starts as meaningful INPUT,
//   mutates in NEIGHBORHOOD order, and usually breathes through a frontier queue.
// dp-table sits ABOVE grid-walk in the registry: when all three fingerprints say "fill",
// the dedicated DP animation (init scaffold beat, one orange write per cell with real
// old -> new values, answer read out of the final cell) beats the board view.

import { compileDpTable } from '../../dp-table/compiler.js';

const isScalar = (v) => v === null || ['number', 'string', 'boolean'].includes(typeof v);
const isTable = (v) => Array.isArray(v) && v.length >= 1 && v.every((row) => Array.isArray(row) && row.every(isScalar));

// Decide the lens from the recording. Returns null or:
//   { lens: 'dp-table', confidence, name, rows, cols }
export function detectDpTable(recording, _ctx = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) return null;

  // Candidate tables: every local that is EVER a 2D scalar list, with its snapshot sequence.
  const names = new Set(lines.flatMap((e) => Object.keys(e.locals).filter((k) => isTable(e.locals[k]))));
  let best = null;
  for (const name of names) {
    const snaps = lines.map((e) => e.locals[name]).filter(isTable);
    if (snaps.length < 2) continue;
    const final = snaps.at(-1);
    const rows = final.length;
    const cols = Math.max(...final.map((r) => r.length));
    if (rows < 2 || cols < 2) continue;

    // Fingerprint 1 — scaffold or growth: the first sighting is all-one-value, or smaller
    // than the final table (rows appended as the run built it).
    const first = snaps[0];
    const firstCells = first.flat();
    const uniform = firstCells.length > 0 && firstCells.every((v) => JSON.stringify(v) === JSON.stringify(firstCells[0]));
    const grew = first.flat().length < final.flat().length;
    if (!uniform && !grew) continue;

    // Fingerprint 2 — the fill leaves a sweep trail: collect every cell write in order and
    // demand ≥80% of consecutive writes advance in row-major order (nested loops' fingerprint).
    const writes = [];
    for (let i = 1; i < snaps.length; i += 1) {
      const prev = snaps[i - 1];
      const cur = snaps[i];
      for (let r = 0; r < cur.length; r += 1) {
        for (let c = 0; c < (cur[r]?.length ?? 0); c += 1) {
          if (JSON.stringify(prev?.[r]?.[c]) !== JSON.stringify(cur[r][c])) writes.push([r, c]);
        }
      }
    }
    // 3, not more: teaching inputs are TINY, and a write that stores the value a cell already
    // held (dp[1][1] = max(0,0) on a 0-scaffold) is invisible to state diffing.
    if (writes.length < 3) continue;
    let ordered = 0;
    for (let i = 1; i < writes.length; i += 1) {
      const [ar, ac] = writes[i - 1];
      const [br, bc] = writes[i];
      if (br > ar || (br === ar && bc >= ac)) ordered += 1;
    }
    if (ordered / (writes.length - 1) < 0.8) continue;

    // Fingerprint 3 — no frontier: a breathing list of in-bounds coordinate pairs means a
    // WALK is choosing the order, not nested loops — that run belongs to grid-walk.
    const isCoord = (v) => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && v[0] >= 0 && v[0] < rows && v[1] >= 0 && v[1] < cols;
    let frontier = false;
    for (const other of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
      if (other === name) continue;
      let grewQ = false;
      let shrankQ = false;
      let prevLen = null;
      let coordsOk = true;
      for (const e of lines) {
        const v = e.locals[other];
        if (!Array.isArray(v)) continue;
        if (!v.every(isCoord)) { coordsOk = false; break; }
        if (prevLen !== null) {
          if (v.length > prevLen) grewQ = true;
          if (v.length < prevLen) shrankQ = true;
        }
        prevLen = v.length;
      }
      if (coordsOk && grewQ && shrankQ) { frontier = true; break; }
    }
    if (frontier) continue;

    if (!best || writes.length > best.writes) best = { name, rows, cols, writes: writes.length };
  }
  if (!best) return null;
  return { lens: 'dp-table', confidence: 0.9, name: best.name, rows: best.rows, cols: best.cols };
}

// Adapt the recording to the proven dp-table compiler: one {line, table, locals} per sighting.
export function compileDpTableLens({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'dp-table') throw new Error('compileDpTableLens needs a plan from detectDpTable');
  const events = [];
  for (const e of (recording?.events ?? [])) {
    if (e.ev !== 'line') continue;
    const table = e.locals?.[plan.name];
    if (!isTable(table)) continue;
    const locals = {};
    for (const [k, v] of Object.entries(e.locals)) {
      if (['number', 'string', 'boolean'].includes(typeof v)) locals[k] = v;
    }
    events.push({ line: e.line, table, locals });
  }
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });
  return compileDpTable({ events, result: recording.result, code, entry, language });
}
