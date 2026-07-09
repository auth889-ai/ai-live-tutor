// Tracer mode: LINE-SIM (the honest floor) — one file, one job. Engine: lib/execution/trace/
// line-sim/. Owns the AUTO-UPGRADE: if the real run reveals a clean in-code stack/queue/hash-map
// (our operation-pattern edge), render the elite operations view instead of a plain line trace.

import { assembleLineProgram, parseLineEvents, compileLineTrace, compileOperationsTrace } from '../../../../../execution/trace/engines.js';
import { detectCollectionOps } from '../../../../../execution/trace/collections/detect.js';

export const lineSimMode = {
  key: 'linesim',
  label: 'Line simulation',
  prompt: `LINE-SIM MODE (python only) — ONLY for algorithms with genuinely NO structure to draw (pure math
like GCD, string building, greedy counting): INSTEAD of "program", output
  "linesim": {"entry": "<ONE call expression invoking 'code', e.g. gcd(48, 18)>"}
and make "code" the clean runnable function definition. Our tracer executes it for real and
records every line + variable change. NEVER pick line-sim because another mode looks hard or a
previous attempt failed — if the algorithm walks an array, tree, graph, stack, queue, DP table
or call tree, it MUST use the matching mode above. A line-only animation of a structural
algorithm is a quality failure, not a safe choice.`,
  canHandle: ({ json, lang, code }) => Boolean(json.linesim && typeof json.linesim === 'object' && lang === 'python' && code),
  async run({ json, code, exec, gate }) {
    const run = await exec({ language: 'python', source: assembleLineProgram({ code, entry: json.linesim.entry }) });
    if (run.timedOut) throw new Error('simulation timed out (likely an infinite loop)');
    const payload = parseLineEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `simulation errored: ${run.stderr.slice(0, 300)}` : 'simulation printed no @@LINESIM line');
    // AUTO-UPGRADE off the floor: a clean in-code collection (tail add/pop = stack, front pop =
    // queue, growing string-keyed dict = hash map) renders the elite operations view instead —
    // no per-problem declaration. Falls back to the honest line trace when unsure.
    const detected = detectCollectionOps(payload.events);
    if (detected && detected.ops.length >= 3 && detected.ops.length <= 40) {
      try {
        const opsTrace = compileOperationsTrace({ structure: detected.structure, ops: detected.ops, code, lines: detected.lines });
        gate(opsTrace);
        return opsTrace;
      } catch { /* detection was a false positive for the elite view — keep the honest floor */ }
    }
    return compileLineTrace({ ...payload, code, entry: json.linesim.entry, language: 'python' });
  },
};
