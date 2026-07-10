// Tracer mode: DP-TABLE — one file, one job. Engine: lib/execution/trace/dp-table/.

import { assembleDpProgram, parseDpEvents, compileDpTable } from '../../../../../execution/trace/engines.js';

export const dpTableMode = {
  key: 'dptable',
  label: 'DP-table trace',
  prompt: `DP-TABLE MODE (python only) — for TABULATION dynamic programming (LCS, edit distance, knapsack,
grid paths, coin change — any bottom-up table fill): INSTEAD of "program", output
  "dptable": {"entry": "<ONE call expression, e.g. lcs('abcde', 'ace')>",
              "dp": "dp" (the table variable inside 'code' — 2-D list of lists, or a 1-D list),
              "rowLabels": ["","a","b","c"] / "colLabels": [...] (optional, MUST match the final
              table dimensions — e.g. '' + one label per character for LCS)}
with "code" = the clean bottom-up implementation. Our tracker snapshots the REAL table at every
line: the grid fills cell by cell with actual old -> new values, base row/column taught, the
answer read out of the final cell. Keep the example SMALL (table <= 24x24 — bigger fails).
Top-down/memoized recursion stays in RECURSION MODE; do not write tracking code.`,
  canHandle: ({ json, lang, code }) => Boolean(json.dptable && typeof json.dptable === 'object' && lang === 'python' && code),
  async run({ json, code, exec }) {
    const d = json.dptable;
    const run = await exec({ language: 'python', source: assembleDpProgram({ code, entry: d.entry, dp: d.dp ?? 'dp' }) });
    if (run.timedOut) throw new Error('dp-table run timed out (likely an infinite loop)');
    const payload = parseDpEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(-400).trim()}` : 'run printed no @@DPTABLE line');
    const trace = compileDpTable({
      ...payload,
      code,
      entry: d.entry,
      rowLabels: Array.isArray(d.rowLabels) ? d.rowLabels : null,
      colLabels: Array.isArray(d.colLabels) ? d.colLabels : null,
      language: 'python',
    });
    trace.meta = {
      tool: 'dptable',
      params: { code, entry: d.entry, dp: d.dp ?? 'dp', rowLabels: d.rowLabels ?? null, colLabels: d.colLabels ?? null },
    };
    return trace;
  },
};
