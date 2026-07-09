// Pointer-walk trace compiler — binary search / two pointers / sliding window / in-place
// sorting as a DETERMINISTIC TOOL. Built on the proven line-simulator machinery (sys.settrace
// over a REAL run), compiled through an ARRAY LENS: the model only DECLARES which variables are
// pointers into which array; every recorded event where the state meaningfully changed becomes
// one step with pointer positions, eliminated cells, live variables, and a teacher sentence
// composed from the actual recorded values (never predicted). This is the VisuAlgo feel —
// arrows riding the array, half the search space dimming, swapped cells flashing — for any
// pointer algorithm.
//
// Declared semantics, never magic names (the old code highlighted the "current" cell only when
// a pointer was literally called `mid`):
//   examine:  which pointer's cell the algorithm READS each step (orange highlight). Defaults
//             to the pointer that moved most recently.
//   arrayVar: the list variable the code mutates in place — its recorded snapshots become live
//             per-step values, and every in-place write/swap is its own visible step.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import {
  narrateMoves, narrateSwap, narrateWrite, narrateIntroduced, narrateUpdated,
  narrateEliminated, narrateWindow, narrateClose, narrateCollection,
} from './narrate.js';

// compilePointerWalk({ events, result, code, array, pointers, examine?, arrayVar?,
//                      eliminatedOutside?, window?, language })
// events/result: from parseLineEvents (line-simulator run). array: the concrete values being
// walked. pointers: variable names that are indices into it (e.g. ["low","mid","high"]).
// eliminatedOutside: [loName, hiName] — cells outside that inclusive range are ruled out
// (binary search). window: [leftName, rightName] — cells inside are the current window.
export function compilePointerWalk({
  events, result, code, array, pointers = [], examine = null, arrayVar = null,
  eliminatedOutside = null, window = null, stackVar = null, queueVar = null, language = 'python',
} = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('pointer walk recorded no events');
  // The shared line tracker appends {'truncated': true} at its recording cap — honor it here
  // too so a long walk is CUT OPENLY, never silently.
  const truncated = events[events.length - 1]?.truncated === true;
  if (truncated) events = events.slice(0, -1);
  if (!Array.isArray(array) || array.length === 0) throw new Error('pointer walk needs the concrete array');
  if (!Array.isArray(pointers) || pointers.length === 0) throw new Error('pointer walk needs pointer variable names');
  const lineCount = String(code ?? '').split('\n').length;
  const inArray = (v) => Number.isInteger(v) && v >= 0 && v < array.length;
  const isScalar = (v) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';

  const steps = [];
  let prev = {};
  let liveValues = null; // latest known in-place contents (arrayVar tracking)
  let anyPointerMoved = false; // a walk where no pointer EVER moves is a mis-declared trace
  for (const ev of events) {
    const line = Number(ev.line);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    const locals = ev.locals && typeof ev.locals === 'object' ? ev.locals : {};

    const moved = pointers.filter((p) => inArray(locals[p]) && locals[p] !== prev[p]);
    // In-place mutation: diff the declared array variable's REAL recorded snapshot.
    const snapshot = arrayVar && Array.isArray(locals[arrayVar]) && locals[arrayVar].length === array.length
      ? locals[arrayVar]
      : null;
    const before = liveValues ?? array;
    const written = snapshot ? before.map((v, i) => (JSON.stringify(v) !== JSON.stringify(snapshot[i]) ? i : -1)).filter((i) => i >= 0) : [];
    // Decision moments: a non-pointer scalar changed (found flag, running sum, best-so-far).
    // The old engine dropped these — comparisons and bookkeeping vanished from the dry run.
    const changedScalars = Object.entries(locals)
      .filter(([k, v]) => !pointers.includes(k) && k !== arrayVar && isScalar(v) && JSON.stringify(prev[k]) !== JSON.stringify(v));
    // Declared companion collection (monotonic stack / BFS queue): its live contents ride
    // every step, and a push/pop is a step of its own even when no pointer moved.
    const stackSnap = stackVar && Array.isArray(locals[stackVar]) ? locals[stackVar] : null;
    const queueSnap = queueVar && Array.isArray(locals[queueVar]) ? locals[queueVar] : null;
    const stackChanged = stackSnap && JSON.stringify(prev[stackVar]) !== JSON.stringify(stackSnap);
    const queueChanged = queueSnap && JSON.stringify(prev[queueVar]) !== JSON.stringify(queueSnap);

    if (moved.length === 0 && written.length === 0 && changedScalars.length === 0 && !stackChanged && !queueChanged) {
      prev = { ...prev, ...locals };
      continue;
    }
    if (snapshot) liveValues = [...snapshot];
    if (moved.length > 0) anyPointerMoved = true;

    const pos = Object.fromEntries(pointers.filter((p) => inArray(locals[p])).map((p) => [p, locals[p]]));
    const eliminated = [];
    if (eliminatedOutside) {
      const lo = locals[eliminatedOutside[0]];
      const hi = locals[eliminatedOutside[1]];
      if (inArray(lo) && inArray(hi)) {
        for (let i = 0; i < array.length; i += 1) if (i < lo || i > hi) eliminated.push(i);
      }
    }
    // The cell being READ this step: the DECLARED examine pointer (no highlight until it
    // exists — never a random stand-in), else the single unambiguous mover of this step.
    const examineName = examine
      ? (inArray(pos[examine]) ? examine : null)
      : (moved.length === 1 ? moved[0] : null);
    const shown = liveValues ?? array;

    const parts = [];
    if (moved.length > 0) parts.push(narrateMoves(moved, locals, prev, shown));
    if (written.length === 2) parts.push(narrateSwap(written, shown));
    else if (written.length > 0) parts.push(narrateWrite(written, shown));
    const introduced = changedScalars.filter(([k]) => !(k in prev));
    const updated = changedScalars.filter(([k]) => k in prev);
    if (introduced.length > 0) parts.push(narrateIntroduced(introduced));
    if (updated.length > 0) parts.push(narrateUpdated(updated));
    if (stackChanged) parts.push(narrateCollection({ kind: 'stack', was: Array.isArray(prev[stackVar]) ? prev[stackVar] : [], now: stackSnap }));
    if (queueChanged) parts.push(narrateCollection({ kind: 'queue', was: Array.isArray(prev[queueVar]) ? prev[queueVar] : [], now: queueSnap }));
    const searchNote = eliminatedOutside && eliminated.length > 0
      ? narrateEliminated({ lo: locals[eliminatedOutside[0]], hi: locals[eliminatedOutside[1]], eliminatedCount: eliminated.length, total: array.length })
      : '';
    const windowNote = window && inArray(locals[window[0]]) && inArray(locals[window[1]])
      ? narrateWindow({ left: locals[window[0]], right: locals[window[1]] })
      : '';

    steps.push({
      line,
      explanation: `${parts.join(' ')}${searchNote}${windowNote}`,
      array: {
        ...(examineName ? { current: pos[examineName] } : {}),
        pointers: pos,
        ...(eliminated.length ? { eliminated } : {}),
        ...(written.length === 2 ? { swapped: written } : {}),
        ...(written.length > 0 && written.length !== 2 ? { comparing: written } : {}),
        ...(liveValues ? { values: [...liveValues] } : {}),
      },
      ...(stackSnap ? { stack: stackSnap } : {}),
      ...(queueSnap ? { queue: queueSnap } : {}),
      variables: Object.fromEntries(Object.entries(locals).filter(([k, v]) => k !== arrayVar && isScalar(v))),
    });
    prev = { ...prev, ...locals };
  }
  if (steps.length === 0 || !anyPointerMoved) throw new Error('pointer walk saw no pointer movement — check the declared pointer names');

  const last = steps[steps.length - 1];
  steps.push({
    line: last.line,
    explanation: narrateClose({ truncated, result, liveValues }),
    array: last.array,
    ...(last.stack ? { stack: last.stack } : {}),
    ...(last.queue ? { queue: last.queue } : {}),
    variables: last.variables,
  });

  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: { array: { values: array } },
    steps,
  }, 'pointer-walk trace');
}
