// DIVIDE-CONQUER LENS — detector/compiler pair #14 of the record-once/detect-later engine:
// merge sort, quicksort, and every recursive split over ONE shared array. The proven
// divide-conquer compiler drives two views in lock-step (focus band dims outside the active
// segment while the recursion tree of segments grows); this detector derives its declarations
// from the recording's geometry:
//
//   the DIVIDE FINGERPRINT: a self-recursive function whose calls carry two int args (lo, hi)
//   with lo <= hi at every call AND every child call's segment NESTED inside its parent's —
//   nothing but a divide-and-conquer recursion has that shape. Recursive binary search nests
//   too, so the second signal is IN-PLACE MUTATION of the shared array arg: a splitter that
//   never writes is a searcher, and stays with its own lens.
//
// Both hi conventions are handled from evidence: when the largest hi equals the array LENGTH
// the code is exclusive-hi (merge_sort(arr, 0, len)) and bounds shift by -1 for the inclusive
// segment labels the compiler renders.

import { compileDivideConquer } from '../../divide-conquer/compiler.js';

const isScalarArray = (v) => Array.isArray(v) && v.length >= 2 && v.every((x) => x === null || ['number', 'string', 'boolean'].includes(typeof x));

// Decide the lens from the recording. Returns null or:
//   { lens: 'divide-conquer', confidence, fn, arrVar, loArg, hiArg, hiAdjust, pointers }
export function detectDivideConquer(recording, { code = '' } = {}) {
  const events = recording?.events ?? [];
  if (events.at(-1)?.truncated === true) return null;

  // Reconstruct per-function call nesting (args included) from the flat event stream.
  const stack = [];
  const byFn = new Map(); // fn -> [{args, parentArgs}]
  for (const e of events) {
    if (e.ev === 'call') {
      const parent = [...stack].reverse().find((f) => f.fn === e.fn);
      (byFn.get(e.fn) ?? byFn.set(e.fn, []).get(e.fn)).push({ args: e.args ?? {}, parentArgs: parent?.args ?? null });
      stack.push({ fn: e.fn, args: e.args ?? {} });
    } else if (e.ev === 'return' && stack.at(-1)?.fn === e.fn) {
      stack.pop();
    }
  }

  for (const [fn, calls] of byFn) {
    if (calls.length < 3 || !calls.some((c) => c.parentArgs)) continue; // must actually recurse

    // The shared array arg: a scalar list present in every call.
    const argNames = Object.keys(calls[0].args);
    const arrVar = argNames.find((a) => calls.every((c) => isScalarArray(c.args[a])));
    if (!arrVar) continue;

    // The bound pair: two int args, lo <= hi always, child segment nested in the parent's.
    const intArgs = argNames.filter((a) => calls.every((c) => Number.isInteger(c.args[a])));
    let bounds = null;
    for (const lo of intArgs) {
      for (const hi of intArgs) {
        if (lo === hi) continue;
        // lo <= hi + 1, not lo <= hi: quicksort's base calls carry EMPTY segments
        // (quicksort(arr, 0, -1)) — one past each other is the empty-segment convention.
        const ordered = calls.every((c) => c.args[lo] <= c.args[hi] + 1);
        const nested = calls.every((c) => !c.parentArgs || (c.args[lo] >= c.parentArgs[lo] && c.args[hi] <= c.parentArgs[hi]));
        if (ordered && nested) { bounds = { lo, hi }; break; }
      }
      if (bounds) break;
    }
    if (!bounds) continue;

    // The splitter must WRITE: the shared array's contents change across the run.
    const lines = events.filter((e) => e.ev === 'line');
    const snaps = lines.map((e) => e.locals[arrVar]).filter(isScalarArray);
    if (snaps.length < 2 || !snaps.some((s) => JSON.stringify(s) !== JSON.stringify(snaps[0]))) continue;

    const maxHi = Math.max(...calls.map((c) => c.args[bounds.hi]));
    const hiAdjust = maxHi >= snaps[0].length ? -1 : 0; // exclusive-hi convention detected from evidence
    const pointers = [...new Set(lines.flatMap((e) => Object.keys(e.locals)))]
      .filter((p) => p !== bounds.lo && p !== bounds.hi)
      .filter((p) => new RegExp(`\\b${arrVar}\\s*\\[[^\\]]*\\b${p}\\b`).test(code))
      .filter((p) => lines.some((e) => Number.isInteger(e.locals[p])))
      .slice(0, 3);

    return { lens: 'divide-conquer', confidence: 0.86, fn, arrVar, loArg: bounds.lo, hiArg: bounds.hi, hiAdjust, pointers };
  }
  return null;
}

// Synthesize the dedicated tracker's event stream from the universal recording, then delegate.
export function compileDivideConquerLens({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'divide-conquer') throw new Error('compileDivideConquerLens needs a plan from detectDivideConquer');
  const events = [];
  const stack = [];
  let nextId = 0;
  for (const e of (recording?.events ?? [])) {
    if (e.truncated === true) { events.push({ truncated: true }); continue; }
    if (e.ev === 'call' && e.fn === plan.fn) {
      const id = nextId;
      nextId += 1;
      events.push({
        type: 'call',
        id,
        parent: stack.length > 0 ? stack.at(-1) : null,
        line: e.line,
        lo: e.args?.[plan.loArg],
        hi: Number.isInteger(e.args?.[plan.hiArg]) ? e.args[plan.hiArg] + plan.hiAdjust : e.args?.[plan.hiArg],
      });
      stack.push(id);
    } else if (e.ev === 'return' && e.fn === plan.fn && stack.length > 0) {
      // The frame's final state (locals at return) carries the merge a last-line slice-assign
      // just performed — land it as a line snapshot BEFORE the return step reads the segment.
      const arrAtReturn = e.locals?.[plan.arrVar];
      if (isScalarArray(arrAtReturn)) events.push({ type: 'line', line: e.line, array: arrAtReturn, locals: {} });
      events.push({ type: 'return', id: stack.pop(), line: e.line });
    } else if (e.ev === 'line') {
      const arr = e.locals[plan.arrVar];
      const locals = {};
      for (const [k, v] of Object.entries(e.locals)) if (['number', 'string', 'boolean'].includes(typeof v)) locals[k] = v;
      events.push({ type: 'line', line: e.line, ...(isScalarArray(arr) ? { array: arr } : {}), locals });
    }
  }
  return compileDivideConquer({
    events,
    result: recording.result,
    code,
    entry,
    fn: plan.fn,
    pointers: plan.pointers,
    language,
  });
}
