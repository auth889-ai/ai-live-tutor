// Tracer mode: AUTO (the universal recorder) — one file, one job. Engine: lib/execution/
// trace/universal/. The record-once/detect-later path: the model supplies ONLY clean code and
// one entry call; the engine runs it for real, detects the structure FROM THE EXECUTION
// (dp table, grid, adjacency graph, linked list, object tree, recursion tree, stack/queue/
// hash map, array pointers — in that teaching priority), and compiles the elite view itself.
// When the run truly has no structure, the line-table floor still delivers a full dry run —
// with auto, an empty result is architecturally impossible.

import { traceUniversal } from '../../../../../execution/trace/universal/trace.js';
import { oracleIssue } from '../../../../../execution/trace/oracle.js';

export const autoMode = {
  key: 'auto',
  label: 'Auto (universal recorder)',
  prompt: `AUTO MODE (python only) — when NONE of the dedicated modes above fits cleanly, or you are NOT
CERTAIN which structure the algorithm walks: INSTEAD of "program", output
  "auto": {"entry": "<ONE call expression invoking 'code', e.g. solve(nums, 3)>",
          "expect": <the output the problem's OWN example states for this exact input — copy it; omit if the source states none>}
and make "code" clean runnable definitions with any concrete input built at module level. The
engine runs the code for real, DETECTS the structure from the execution (grid, graph, tree,
linked list, recursion tree, DP table, stack/queue/hash map, array pointers) and picks the
elite view itself — falling back to a full line-by-line variable table only when the run truly
has no structure to draw. Never pick auto to dodge a dedicated mode that obviously fits; pick
it when the honest answer is "unsure".`,
  canHandle: ({ json, lang, code }) => Boolean(json.auto && typeof json.auto === 'object' && json.auto.entry && lang === 'python' && code),
  async run({ json, code, exec }) {
    const { trace, recording } = await traceUniversal({ code, entry: json.auto.entry, exec });
    // Solution oracle: a run that fails the problem's own stated example never becomes a
    // lesson — the retry message demands a CODE fix, never an expect adjustment.
    const issue = oracleIssue(recording?.result, json.auto.expect);
    if (issue) throw new Error(issue);
    return trace;
  },
};
