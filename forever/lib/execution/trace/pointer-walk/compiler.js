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

// compilePointerWalk({ events, result, code, array, pointers, examine?, arrayVar?,
//                      eliminatedOutside?, window?, language })
// events/result: from parseLineEvents (line-simulator run). array: the concrete values being
// walked. pointers: variable names that are indices into it (e.g. ["low","mid","high"]).
// eliminatedOutside: [loName, hiName] — cells outside that inclusive range are ruled out
// (binary search). window: [leftName, rightName] — cells inside are the current window.
export function compilePointerWalk({
  events, result, code, array, pointers = [], examine = null, arrayVar = null,
  eliminatedOutside = null, window = null, language = 'python',
} = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('pointer walk recorded no events');
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

    if (moved.length === 0 && written.length === 0 && changedScalars.length === 0) {
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
    if (moved.length > 0) {
      const moves = moved.map((p) => {
        const at = locals[p];
        const verb = p in prev ? 'moves to' : 'starts at';
        return `${p} ${verb} index ${at}, where the value is ${JSON.stringify(shown[at])}`;
      }).join('; ');
      parts.push(`${moves.charAt(0).toUpperCase()}${moves.slice(1)}. These positions are from the real run — the arrows you see are exactly where the pointers stood at this moment.`);
    }
    if (written.length === 2) {
      const [i, j] = written;
      parts.push(`Cells ${i} and ${j} trade contents: ${JSON.stringify(shown[i])} now sits at index ${i} and ${JSON.stringify(shown[j])} at index ${j}. Watch the swap flash — in-place rearrangement is the whole trick: no second array, just disciplined exchanges.`);
    } else if (written.length > 0) {
      parts.push(`The array itself changes at ${written.length === 1 ? `index ${written[0]}, which now holds ${JSON.stringify(shown[written[0]])}` : `indices ${written.join(', ')}`} — a real in-place write recorded from the run, not an animation guess.`);
    }
    const introduced = changedScalars.filter(([k]) => !(k in prev));
    const updated = changedScalars.filter(([k]) => k in prev);
    if (introduced.length > 0) {
      const what = introduced.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ');
      parts.push(`New state appears: ${what} — keep your eye on ${introduced.length === 1 ? 'this value' : 'these values'}; every pointer move below is decided by ${introduced.length === 1 ? 'it' : 'them'}.`);
    }
    if (updated.length > 0) {
      const what = updated.map(([k, v]) => `${k} becomes ${JSON.stringify(v)}`).join(', ');
      parts.push(`The bookkeeping updates: ${what}. This is the decision the comparison just produced — the pointers only move BECAUSE values like these said so.`);
    }
    const searchNote = eliminatedOutside && eliminated.length > 0
      ? ` Everything outside ${locals[eliminatedOutside[0]]}..${locals[eliminatedOutside[1]]} is now ELIMINATED — ${eliminated.length} of ${array.length} cells dimmed, the search space keeps shrinking, and that shrinking is the whole reason this runs in logarithmic time.`
      : '';
    const windowNote = window && inArray(locals[window[0]]) && inArray(locals[window[1]])
      ? ` The window now spans indices ${locals[window[0]]}..${locals[window[1]]} — watch it slide rather than restart; reusing the overlap is what makes this linear instead of quadratic.`
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
      variables: Object.fromEntries(Object.entries(locals).filter(([k, v]) => k !== arrayVar && isScalar(v))),
    });
    prev = { ...prev, ...locals };
  }
  if (steps.length === 0 || !anyPointerMoved) throw new Error('pointer walk saw no pointer movement — check the declared pointer names');

  const finalValues = liveValues ? ` The array ends as [${liveValues.map((v) => JSON.stringify(v)).join(', ')}] — compare it with where it started and every difference is a step you just watched.` : '';
  steps.push({
    line: steps[steps.length - 1].line,
    explanation: `The walk is over and the call returns ${JSON.stringify(result)}.${finalValues} Replay the arrows in your head: every move you watched was a decision the code made on real data — that decision pattern IS the algorithm.`,
    array: steps[steps.length - 1].array,
    variables: steps[steps.length - 1].variables,
  });

  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: { array: { values: array } },
    steps,
  }, 'pointer-walk trace');
}
