// Tracer mode: INTERVALS — one file, one job. Engine: lib/execution/trace/intervals/.
// The researched number-line lens: sorted [start,end] bars fuse into islands.

import { assembleLineProgram, parseLineEvents } from '../../../../../execution/trace/engines.js';
import { compileIntervals } from '../../../../../execution/trace/intervals/compiler.js';

export const intervalsMode = {
  key: 'intervals',
  label: 'Intervals trace',
  prompt: `INTERVALS MODE (python only) — for interval problems (merge intervals, insert interval,
meeting rooms, non-overlapping intervals): INSTEAD of "program", output
  "intervals": {"entry": "<ONE call expression, e.g. merge([[1,3],[2,6],[8,10],[15,18]])>",
                "intervalsVar": "intervals" (the SORTED input list variable inside the function),
                "mergedVar": "merged" (the result list the code appends islands to)}
with "code" = the clean function that SORTS first, then walks once appending/extending in
mergedVar. Our engine runs it for real and draws the number line: sorted bars fuse into islands
step by step, each overlap check narrated with the actual boundaries. Do not write tracking code.`,
  canHandle: ({ json, lang, code }) => Boolean(json.intervals && typeof json.intervals === 'object' && lang === 'python' && code),
  async run({ json, code, exec }) {
    const run = await exec({ language: 'python', source: assembleLineProgram({ code, entry: json.intervals.entry }) });
    if (run.timedOut) throw new Error('intervals run timed out (likely an infinite loop)');
    const payload = parseLineEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(-400).trim()}` : 'run printed no @@LINESIM line');
    const trace = compileIntervals({
      ...payload,
      code,
      intervalsVar: json.intervals.intervalsVar,
      mergedVar: json.intervals.mergedVar,
      language: 'python',
    });
    trace.meta = {
      tool: 'intervals',
      params: { code, entry: json.intervals.entry, intervalsVar: json.intervals.intervalsVar, mergedVar: json.intervals.mergedVar },
    };
    return trace;
  },
};
