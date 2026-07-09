// Tracer mode: DIVIDE-CONQUER — one file, one job. Engine: lib/execution/trace/divide-conquer/.

import { assembleDivideProgram, parseDivideEvents, compileDivideConquer } from '../../../../../execution/trace/engines.js';

export const divideConquerMode = {
  key: 'divideconquer',
  label: 'Divide-conquer trace',
  prompt: `DIVIDE-CONQUER MODE (python only) — for recursive ARRAY splitting (merge sort, quicksort, and
any partition/segment recursion): INSTEAD of "program", output
  "divideconquer": {"entry": "<ONE call, e.g. quick_sort([5,2,9,1,7,3], 0, 5)>",
                    "fn": "quick_sort" (the RECURSIVE function's name),
                    "arrayVar": "arr" (the array PARAMETER name inside 'code'),
                    "lo": "low", "hi": "high" (the segment-bound parameter names),
                    "pointers": ["i","j","pivot"] (index variables to show riding the array)}
with "code" = the clean implementation that sorts IN PLACE on that one array (never slices into
new lists — slices are invisible). Our tracker records every call/return/line of the real run:
the student sees the focus band dim everything outside the active segment, swaps flash, AND the
recursion tree of segments grow — with each call returning its sorted band. Do not write
tracking code. Plain recursion WITHOUT an array (fib, subsets) stays in RECURSION MODE.`,
  canHandle: ({ json, lang, code }) => Boolean(json.divideconquer && typeof json.divideconquer === 'object' && lang === 'python' && code),
  async run({ json, code, exec }) {
    const dc = json.divideconquer;
    const source = assembleDivideProgram({ code, entry: dc.entry, fn: dc.fn, arrayVar: dc.arrayVar, loVar: dc.lo, hiVar: dc.hi });
    const run = await exec({ language: 'python', source });
    if (run.timedOut) throw new Error('divide & conquer run timed out (likely unbounded recursion)');
    const payload = parseDivideEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@DIVIDE line');
    const trace = compileDivideConquer({
      ...payload,
      code,
      entry: dc.entry,
      fn: dc.fn,
      pointers: Array.isArray(dc.pointers) ? dc.pointers : [],
      language: 'python',
    });
    trace.meta = {
      tool: 'divideconquer',
      params: { code, entry: dc.entry, fn: dc.fn, arrayVar: dc.arrayVar, lo: dc.lo, hi: dc.hi, pointers: Array.isArray(dc.pointers) ? dc.pointers : [] },
    };
    return trace;
  },
};
