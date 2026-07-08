// Pointer-walk trace compiler — binary search / two pointers / sliding window as a
// DETERMINISTIC TOOL. Built on the proven line-simulator machinery (sys.settrace over a REAL
// run), compiled through an ARRAY LENS: the model only DECLARES which variables are pointers
// into which array; every recorded event where a pointer moved becomes one step with pointer
// positions, eliminated cells, live variables, and a teacher sentence composed from the
// actual recorded values (never predicted). This is the VisuAlgo binary-search feel — arrows
// riding the array, half the search space dimming — for any pointer algorithm.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

// compilePointerWalk({ events, result, code, array, pointers, eliminatedOutside?, window?, language })
// events/result: from parseLineEvents (line-simulator run). array: the concrete values being
// walked. pointers: variable names that are indices into it (e.g. ["low","mid","high"]).
// eliminatedOutside: [loName, hiName] — cells outside that inclusive range are ruled out
// (binary search). window: [leftName, rightName] — cells inside are the current window.
export function compilePointerWalk({
  events, result, code, array, pointers = [], eliminatedOutside = null, window = null, language = 'python',
} = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('pointer walk recorded no events');
  if (!Array.isArray(array) || array.length === 0) throw new Error('pointer walk needs the concrete array');
  if (!Array.isArray(pointers) || pointers.length === 0) throw new Error('pointer walk needs pointer variable names');
  const lineCount = String(code ?? '').split('\n').length;
  const inArray = (v) => Number.isInteger(v) && v >= 0 && v < array.length;

  const steps = [];
  let prev = {};
  for (const ev of events) {
    const line = Number(ev.line);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    const locals = ev.locals && typeof ev.locals === 'object' ? ev.locals : {};
    const moved = pointers.filter((p) => inArray(locals[p]) && locals[p] !== prev[p]);
    if (moved.length === 0) { prev = { ...prev, ...locals }; continue; } // only pointer MOVES are steps

    const pos = Object.fromEntries(pointers.filter((p) => inArray(locals[p])).map((p) => [p, locals[p]]));
    const eliminated = [];
    if (eliminatedOutside) {
      const lo = locals[eliminatedOutside[0]];
      const hi = locals[eliminatedOutside[1]];
      if (inArray(lo) && inArray(hi)) {
        for (let i = 0; i < array.length; i += 1) if (i < lo || i > hi) eliminated.push(i);
      }
    }

    const moves = moved.map((p) => {
      const at = locals[p];
      const verb = p in prev ? 'moves to' : 'starts at';
      return `${p} ${verb} index ${at}, where the value is ${JSON.stringify(array[at])}`;
    }).join('; ');
    const searchNote = eliminatedOutside && eliminated.length > 0
      ? ` Everything outside ${locals[eliminatedOutside[0]]}..${locals[eliminatedOutside[1]]} is now ELIMINATED — ${eliminated.length} of ${array.length} cells dimmed, the search space keeps shrinking, and that shrinking is the whole reason this runs in logarithmic time.`
      : '';
    const windowNote = window && inArray(locals[window[0]]) && inArray(locals[window[1]])
      ? ` The window now spans indices ${locals[window[0]]}..${locals[window[1]]} — watch it slide rather than restart; reusing the overlap is what makes this linear instead of quadratic.`
      : '';
    steps.push({
      line,
      explanation: `${moves.charAt(0).toUpperCase()}${moves.slice(1)}. These positions are from the real run — the arrows you see are exactly where the pointers stood at this moment.${searchNote}${windowNote}`,
      array: {
        ...(inArray(pos.mid) ? { current: pos.mid } : {}),
        pointers: pos,
        ...(eliminated.length ? { eliminated } : {}),
      },
      variables: Object.fromEntries(Object.entries(locals).filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')),
    });
    prev = { ...prev, ...locals };
  }
  if (steps.length === 0) throw new Error('pointer walk saw no pointer movement — check the declared pointer names');

  steps.push({
    line: steps[steps.length - 1].line,
    explanation: `The walk is over and the call returns ${JSON.stringify(result)}. Replay the arrows in your head: every move you watched was a decision the code made on real data — that decision pattern IS the algorithm.`,
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
