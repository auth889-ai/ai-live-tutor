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
export function detectDpTable(recording, ctx = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) return null;

  // Candidate tables: every local that is EVER a 2D scalar list, with its snapshot sequence.
  const names = new Set(lines.flatMap((e) => Object.keys(e.locals).filter((k) => isTable(e.locals[k]))));
  let best = null;
  for (const name of names) {
    // GUARD (reproduced miss, 2026-07-19): a SET has no stable order — its sorted-list
    // snapshot shows insertion shifts that read as in-place writes. seen = set() in a
    // bitmask BFS classified as a DP table. If the code builds this name as a set, skip it.
    if (ctx?.code && new RegExp(`\\b${name}\\s*=\\s*set\\s*\\(|\\b${name}\\.add\\s*\\(`).test(ctx.code)) continue;
    // DP EVIDENCE RULE (review #4): a DP table's interior writes READ THE SAME TABLE.
    // Transpose/copy/constant fills write a 2D scaffold row-major but never read it —
    // they are matrix transforms, and the grid/floor views own them.
    if (Array.isArray(recording?.writes)) {
      const selfDeps = recording.writes.filter((wv) => (wv.rhs ?? []).some((x) => x.n === name)).length;
      if (selfDeps < 2) continue;
    }
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
    let inPlace = false; // any write into a cell that EXISTED before (a fill, not an append)
    for (let i = 1; i < snaps.length; i += 1) {
      const prev = snaps[i - 1];
      const cur = snaps[i];
      for (let r = 0; r < cur.length; r += 1) {
        for (let c = 0; c < (cur[r]?.length ?? 0); c += 1) {
          if (JSON.stringify(prev?.[r]?.[c]) !== JSON.stringify(cur[r][c])) {
            writes.push([r, c]);
            if (prev?.[r]?.[c] !== undefined) inPlace = true;
          }
        }
      }
    }
    // 3, not more: teaching inputs are TINY, and a write that stores the value a cell already
    // held (dp[1][1] = max(0,0) on a 0-scaffold) is invisible to state diffing.
    if (writes.length < 3) continue;
    // GUARD (reproduced miss, 2026-07-19): a DP table NEVER loses cells — a "table" whose
    // total cell count ever shrinks is a queue/stack of tuples wearing a table's shape
    // (bitmask-BFS deque of (node, mask, dist) triples classified as dp-table).
    let shrank = false;
    for (let i = 1; i < snaps.length; i += 1) {
      if (snaps[i].flat().length < snaps[i - 1].flat().length) { shrank = true; break; }
    }
    if (shrank) continue;
    // GUARD (reproduced miss, same day): an append-grown ragged "table" must grow its row
    // lengths MONOTONICALLY (Pascal's 1,2,3,4) — bouncing lengths ([],[1],[1,2],[1],[1,3]...)
    // are a backtracking result accumulator, not a fill.
    if (!inPlace) {
      let monotone = true;
      for (let r = 1; r < final.length; r += 1) if (final[r].length < final[r - 1].length) { monotone = false; break; }
      if (!monotone) continue;
    }
    // APPEND-ONLY + 2 columns = a growing PAIRS list (bridges/edges/intervals/coordinates —
    // a RESULT accumulator, not a DP fill). Measured live: Tarjan on an 8-node graph found 3
    // bridges and the [[u,v],...] accumulator out-claimed the real graph as a 3x2 "DP table".
    // A genuine 2-col DP is pre-allocated (in-place writes); an appended DP row is >= 3 wide.
    if (!inPlace && cols === 2) continue;
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
  if (best) return { lens: 'dp-table', confidence: 0.9, name: best.name, rows: best.rows, cols: best.cols };

  // 1-D DP (LC70-class: dp[i] = dp[i-1] + dp[i-2]) — previously fell to pointer-array, which
  // renders fine but loses the dp lens's reads/deps coloring. STRICT fingerprint so result-
  // building appends can never false-positive: a flat scalar list of FIXED length (>=3) whose
  // first sighting is uniform (the scaffold) and whose snapshot diffs are single-cell writes
  // advancing left-to-right (>=80%), with >=3 writes.
  const isRow = (v) => Array.isArray(v) && v.length >= 3 && v.every((x) => ['number', 'string', 'boolean'].includes(typeof x));
  const rowNames = new Set(lines.flatMap((e) => Object.keys(e.locals).filter((k) => isRow(e.locals[k]))));
  let bestRow = null;
  for (const name of rowNames) {
    const snaps = lines.map((e) => e.locals[name]).filter(isRow);
    if (snaps.length < 3) continue;
    const len = snaps[0].length;
    if (!snaps.every((r) => r.length === len)) continue; // fixed length: appends excluded
    const firstCells = snaps[0];
    if (!firstCells.every((v) => JSON.stringify(v) === JSON.stringify(firstCells[0]))) continue; // uniform scaffold
    const writes = [];
    let clean = true;
    for (let i = 1; i < snaps.length; i += 1) {
      const changed = [];
      for (let c = 0; c < len; c += 1) {
        if (JSON.stringify(snaps[i - 1][c]) !== JSON.stringify(snaps[i][c])) changed.push(c);
      }
      if (changed.length > 1) { clean = false; break; } // one cell per step: DP fill, not bulk mutation
      if (changed.length === 1) writes.push(changed[0]);
    }
    if (!clean || writes.length < 3) continue;
    let ordered = 0;
    for (let i = 1; i < writes.length; i += 1) if (writes[i] >= writes[i - 1]) ordered += 1;
    if (ordered / (writes.length - 1) < 0.8) continue;
    if (!bestRow || writes.length > bestRow.writes) bestRow = { name, cols: len, writes: writes.length };
  }
  if (!bestRow) return null;
  // 0.86, deliberately BELOW graph-adjacency's 0.88: the 1-D fingerprint is a heuristic while
  // an adjacency + a walker is structural proof — and Tarjan's disc[] ([-1]*n scaffold, written
  // strictly left-to-right by DFS discovery order) is a perfect FALSE 1-D DP. Measured live:
  // LC1192 critical-connections rendered as "dp[0][5], bottom-right" — a lying visual. The
  // graph lens must win whenever both fire; genuine 1-D DP (LC70-class) has no walked graph
  // in the recording, so it still claims its own family at 0.86.
  return { lens: 'dp-table', confidence: 0.86, name: bestRow.name, rows: 1, cols: bestRow.cols, oneD: true };
}

// Adapt the recording to the proven dp-table compiler: one {line, table, locals} per sighting.
export function compileDpTableLens({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'dp-table') throw new Error('compileDpTableLens needs a plan from detectDpTable');
  // DIRECT READS (external review 2026-07-19): a read logged at _events length L happened
  // DURING the line event at index L-1 — attach each line's reads of the DP table so the
  // compiler can prove arrows from provenance instead of arithmetic coincidence.
  const hasDirectReads = Array.isArray(recording?.reads);
  // RHS-scoped write events outrank the line window: when present, arrow evidence is the
  // reads INSIDE the assignment expression itself (read -> expression -> write lineage)
  const hasWriteEvents = Array.isArray(recording?.writes);
  const rhsByEvent = new Map();
  const opsByEvent = new Map();
  for (const wv of recording?.writes ?? []) {
    const idx = wv.i - 1;
    const cells = (wv.rhs ?? []).filter((x) => x.n === plan.name && (plan.oneD ? x.p.length === 1 : x.p.length === 2))
      .map((x) => ({ p: plan.oneD ? [0, x.p[0]] : x.p, v: x.v, q: x.q }));
    if (!rhsByEvent.has(idx)) rhsByEvent.set(idx, []);
    rhsByEvent.get(idx).push(...cells);
    if (Array.isArray(wv.ops) && wv.ops.length) {
      if (!opsByEvent.has(idx)) opsByEvent.set(idx, []);
      opsByEvent.get(idx).push(...wv.ops);
    }
  }
  const readsByEvent = new Map();
  // the mockup's X[i-1]/Y[j-1] columns, provably: scalar reads of OTHER variables on the
  // writing line (the strings being compared) ride along as that step's inputs
  const inputsByEvent = new Map();
  for (const r of recording?.reads ?? []) {
    if (r.n !== plan.name && r.v !== undefined && r.p.length === 1) {
      const idx = r.i - 1;
      if (!inputsByEvent.has(idx)) inputsByEvent.set(idx, []);
      if (inputsByEvent.get(idx).length < 4) inputsByEvent.get(idx).push({ n: r.n, p: r.p, v: r.v });
    }
  }
  for (const r of recording?.reads ?? []) {
    if (r.n !== plan.name) continue;
    const path = plan.oneD ? (r.p.length === 1 ? [0, r.p[0]] : null) : (r.p.length === 2 ? r.p : null);
    if (!path) continue;
    const idx = r.i - 1;
    if (!readsByEvent.has(idx)) readsByEvent.set(idx, []);
    readsByEvent.get(idx).push({ p: path, v: r.v });
  }
  const events = [];
  (recording?.events ?? []).forEach((e, idx) => {
    if (e.ev !== 'line') return;
    let table = e.locals?.[plan.name];
    // 1-D DP renders as a single-row table — same lens, same reads/deps coloring.
    if (plan.oneD && Array.isArray(table) && !isTable(table)) table = [table];
    if (!isTable(table)) return;
    const locals = {};
    for (const [k, v] of Object.entries(e.locals)) {
      if (['number', 'string', 'boolean'].includes(typeof v)) locals[k] = v;
    }
    const ev = { line: e.line, table, locals };
    if (hasDirectReads) {
      ev.reads = hasWriteEvents ? (rhsByEvent.get(idx) ?? []) : (readsByEvent.get(idx) ?? []);
      ev.rhsOps = opsByEvent.get(idx) ?? [];
      ev.inputs = inputsByEvent.get(idx) ?? [];
    }
    events.push(ev);
  });
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });
  return compileDpTable({ events, result: recording.result, code, entry, language, directReads: hasDirectReads });
}
