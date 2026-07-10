// GRID-WALK LENS — the first detector/compiler pair of the record-once/detect-later engine.
// One file owns the whole family (mirror of tracer-modes' one-file-per-mode): detectGridWalk()
// reads a universal recording and decides, ONCE over the whole timeline, whether this run is a
// grid walk (a stable 2D board mutating cell by cell, usually with a queue/stack of coordinates
// and a round counter — Islands, Rotten Oranges, 0/1 Matrix, Surrounded Regions, flood fill);
// compileGridWalk() then turns the same recording into a validated, narrated ExecutionTrace.
//
// Detection rules learned from prior art (Heapviz): classify over the WHOLE timeline so the
// lens never flickers mid-animation, and never trust one signal alone — a candidate must pass
// shape (rectangular, scalar cells), stability (fixed dims across every sighting; a queue of
// [r,c] pairs also LOOKS like a grid, but its length breathes), and behavior (cells actually
// change — a grid nobody writes to is scenery, not a lesson).

import { validateExecutionTrace } from '../../../../board/execution/execution-trace.js';

const isScalar = (v) => v === null || ['number', 'string', 'boolean'].includes(typeof v);
const is2d = (v) =>
  Array.isArray(v) && v.length >= 2 &&
  v.every((row) => Array.isArray(row) && row.length >= 2 && row.length === v[0].length && row.every(isScalar));

const isCoordPair = (v, rows, cols) =>
  Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]) &&
  v[0] >= 0 && v[0] < rows && v[1] >= 0 && v[1] < cols;

// Decide the lens from the recording. Returns null (not our family) or a plan:
//   { lens: 'grid-walk', confidence, grid: {name, rows, cols}, queue: {name, kind}|null, counters: [name] }
export function detectGridWalk(recording, { code = '' } = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) return null;

  // THE GRID: the 2D-list local seen most often — with dims IDENTICAL at every sighting.
  const dims = new Map(); // name -> {rows, cols, count, unstable}
  for (const e of lines) {
    for (const [k, v] of Object.entries(e.locals)) {
      if (!is2d(v)) continue;
      const d = dims.get(k) ?? { rows: v.length, cols: v[0].length, count: 0, unstable: false };
      if (d.rows !== v.length || d.cols !== v[0].length) d.unstable = true;
      d.count += 1;
      dims.set(k, d);
    }
  }
  // THE BOARD is the candidate that MUTATES the most, not the one seen most often: in
  // 0/1-Matrix the static input grid and the filling dist table appear in the same events —
  // the lesson is on the one whose cells change.
  let grid = null;
  for (const [name, d] of dims) {
    if (d.unstable || d.count < Math.max(2, lines.length / 3)) continue;
    let mutations = 0;
    let prev = null;
    for (const e of lines) {
      const g = e.locals[name];
      if (!is2d(g)) continue;
      if (prev) mutations += diffCells(prev, g).length;
      prev = g;
    }
    if (mutations === 0) continue; // a board nobody writes to is scenery, not a walk
    if (!grid || mutations > grid.mutations || (mutations === grid.mutations && d.count > grid.count)) {
      grid = { name, rows: d.rows, cols: d.cols, count: d.count, mutations };
    }
  }
  if (!grid) return null;

  // THE QUEUE/STACK: a list local whose elements are in-bounds [r,c] pairs whenever it is
  // non-empty, and whose length both GREW and SHRANK (a frontier breathes; a grid does not).
  let queue = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === grid.name) continue;
    let grew = false;
    let shrank = false;
    let coordsOk = true;
    let prevLen = null;
    let sightings = 0;
    for (const e of lines) {
      const v = e.locals[name];
      if (!Array.isArray(v)) continue;
      sightings += 1;
      if (!v.every((x) => isCoordPair(x, grid.rows, grid.cols))) coordsOk = false;
      if (prevLen !== null) {
        if (v.length > prevLen) grew = true;
        if (v.length < prevLen) shrank = true;
      }
      prevLen = v.length;
    }
    if (coordsOk && grew && shrank && sightings >= 3) {
      const kind = /\bpopleft\b|\.pop\(0\)/.test(code) ? 'queue' : /\.pop\(\)/.test(code) ? 'stack' : 'queue';
      queue = { name, kind };
      break;
    }
  }

  // ROUND COUNTERS: integer locals that only ever tick UP across the run (minutes, levels,
  // island counts) — and are never used as a subscript in the code (an index is not a counter).
  const counters = [];
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === grid.name || name === queue?.name) continue;
    if (code.includes(`[${name}]`)) continue;
    const seen = lines.map((e) => e.locals[name]).filter((v) => Number.isInteger(v));
    if (seen.length < 3 || seen.at(-1) <= seen[0]) continue;
    if (seen.every((v, i) => i === 0 || v >= seen[i - 1])) counters.push(name);
  }

  return {
    lens: 'grid-walk',
    confidence: queue ? 0.9 : 0.7,
    grid: { name: grid.name, rows: grid.rows, cols: grid.cols },
    queue,
    counters,
  };
}

// Compile the recording through the plan into a validated ExecutionTrace: one step per moment
// the BOARD, the FRONTIER, or a ROUND COUNTER changes — narrated from real recorded values.
export function compileGridWalk({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'grid-walk') throw new Error('compileGridWalk needs a grid-walk plan from detectGridWalk');
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) throw new Error('the recording has no line events to compile');
  const truncated = recording.events.at(-1)?.truncated === true;

  const codeLines = String(code ?? '').split('\n');
  const src = (line) => (codeLines[line - 1] ?? '').trim();
  const cellStr = ([r, c]) => `(${r}, ${c})`;
  const { rows, cols } = plan.grid;

  const steps = [];
  const filledSet = new Set();
  let prevGrid = null;
  let prevQueue = null;
  const prevCounters = {};

  const allValues = (g) => g.flatMap((row, r) => row.map((v, c) => [r, c, v]));
  const board = (g, current = null) => ({
    ...(current ? { current } : {}),
    values: allValues(g),
    filled: [...filledSet].map((key) => key.split(',').map(Number)),
  });
  const panels = (e, line, g, extra = {}) => ({
    line,
    array2d: extra.array2d ?? board(g),
    ...(plan.queue ? { queue: (e.locals[plan.queue.name] ?? prevQueue ?? []).map(cellStr) } : {}),
    variables: scalars(e.locals),
  });

  // settrace reports a frame's locals BEFORE the event's line runs — so a change first shows up
  // one event late. The line that CAUSED what we see at event e is the previous event's line,
  // and that is the line the step must highlight (elite = the code and the board agree).
  let prevEvent = null;
  for (const e of lines) {
    const g = e.locals[plan.grid.name];
    if (!is2d(g)) continue;

    if (!prevGrid) {
      // Opening beat (the tutor's framing move, same as every engine): state the goal and what
      // to watch BEFORE anything moves — then show the untouched starting board.
      const watch = [
        'the highlighted current cell',
        ...(plan.queue ? [`the ${plan.queue.kind} of coordinates waiting their turn`] : []),
        ...(plan.counters.length ? [`\`${plan.counters[0]}\` counting the rounds`] : []),
      ].join(', ');
      steps.push({
        ...panels(e, e.line, g),
        explanation: `${entry ? `We run \`${entry}\` and record the real execution. ` : ''}The board is a ${rows}×${cols} grid, and this walk is a rhythm you can watch: ${watch}. Every value that follows was recorded from this exact run — nothing is imagined.`,
      });
      prevGrid = g;
      prevQueue = plan.queue ? e.locals[plan.queue.name] ?? [] : null;
      for (const name of plan.counters) prevCounters[name] = e.locals[name];
      prevEvent = e;
      continue;
    }

    const cause = prevEvent?.line ?? e.line;
    const changes = diffCells(prevGrid, g);
    const q = plan.queue ? e.locals[plan.queue.name] : null;
    const queueChanged = q !== null && q !== undefined && JSON.stringify(q) !== JSON.stringify(prevQueue);
    const counter = plan.counters.find((n) => Number.isInteger(e.locals[n]) && e.locals[n] !== prevCounters[n]);

    if (changes.length > 0) {
      const [r, c, oldV, newV] = changes[0];
      changes.forEach(([cr, cc]) => filledSet.add(`${cr},${cc}`));
      steps.push({
        ...panels(e, cause, g, { array2d: board(g, [r, c]) }),
        explanation: `Line ${cause} runs \`${src(cause)}\`. Cell ${cellStr([r, c])} changes from ${JSON.stringify(oldV)} to ${JSON.stringify(newV)}${changes.length > 1 ? ` (${changes.length} cells change on this step)` : ''} — that is ${filledSet.size} cell${filledSet.size === 1 ? '' : 's'} rewritten so far. The board you see is the recorded state at this exact moment of the run.`,
      });
    } else if (queueChanged) {
      const fifo = plan.queue.kind === 'queue';
      if (q.length < prevQueue.length) {
        const gone = fifo ? prevQueue[0] : prevQueue.at(-1);
        steps.push({
          ...panels(e, cause, g),
          explanation: `Line ${cause}: \`${src(cause)}\`. ${cellStr(gone)} leaves the ${fifo ? 'front of the queue' : 'top of the stack'} and becomes the cell we process now. ${q.length === 0 ? `The ${plan.queue.kind} is empty — if nothing new joins, the walk is about to end.` : `Still waiting: ${q.map(cellStr).join(', ')}.`}`,
        });
      } else {
        const added = q.slice(prevQueue.length);
        steps.push({
          ...panels(e, cause, g),
          explanation: `Line ${cause} runs \`${src(cause)}\`. ${added.map(cellStr).join(' and ')} join${added.length === 1 ? 's' : ''} the ${plan.queue.kind} — freshly changed cells always queue up so their own neighbours get examined later. The ${plan.queue.kind} now holds ${q.length}: ${q.map(cellStr).join(', ')}.`,
        });
      }
    } else if (counter) {
      steps.push({
        ...panels(e, cause, g),
        explanation: `Line ${cause}: \`${src(cause)}\` — \`${counter}\` ticks up to ${e.locals[counter]}. A full round of the walk is complete — every coordinate that was waiting when this round began has been processed, and the next round starts from the cells just added.`,
      });
    }

    prevEvent = e;
    prevGrid = g;
    if (q !== null && q !== undefined) prevQueue = q;
    for (const name of plan.counters) if (e.locals[name] !== undefined) prevCounters[name] = e.locals[name];
  }
  if (steps.length === 0) throw new Error('grid-walk compiled no steps — the board never changed on any recorded line');

  steps.push({
    line: steps.at(-1).line,
    array2d: board(prevGrid),
    ...(plan.queue ? { queue: (prevQueue ?? []).map(cellStr) } : {}),
    variables: steps.at(-1).variables,
    explanation: truncated
      ? `The recording stops HERE, on purpose: the walk keeps repeating the same rhythm, so watching more of it teaches nothing new. The run itself continued to completion and returned ${JSON.stringify(recording.result)} — recorded honestly, cut openly.`
      : `The walk is over and the call returns ${JSON.stringify(recording.result)}. Scroll back and notice the rhythm — take a cell, rewrite it, queue its fresh neighbours — because that rhythm, repeated until nothing is left, IS the whole algorithm.`,
  });

  return validateExecutionTrace(
    { language, code: String(code ?? ''), views: { array2d: { rows, cols } }, steps },
    'grid-walk trace',
  );
}

function diffCells(a, b) {
  const out = [];
  for (let r = 0; r < b.length; r += 1) {
    for (let c = 0; c < b[r].length; c += 1) {
      if (JSON.stringify(a?.[r]?.[c]) !== JSON.stringify(b[r][c])) out.push([r, c, a?.[r]?.[c], b[r][c]]);
    }
  }
  return out;
}

function scalars(locals) {
  const out = {};
  for (const [k, v] of Object.entries(locals ?? {})) {
    if (['number', 'string', 'boolean'].includes(typeof v)) out[k] = v;
    if (Object.keys(out).length >= 8) break;
  }
  return out;
}
