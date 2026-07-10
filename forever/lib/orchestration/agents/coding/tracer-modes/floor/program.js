// Tracer mode: RAW @@STEP PROGRAM — the model-written tracker program, the last resort for
// shapes no deterministic engine covers (and the JS path). One file, one job: execute the
// program for real, parse its @@STEP lines, refuse silent holes, validate the contract.

import { parseStepEvents, countMalformedStepLines } from '../../../../../execution/trace/parse-steps.js';
import { validateExecutionTrace } from '../../../../../board/execution/execution-trace.js';

export const programMode = {
  key: 'program',
  label: 'Raw @@STEP program',
  prompt: (lang) => `Rules for "program" — it must print, at each LOGICAL step (each comparison/decision/loop turn), exactly one line:
@@STEP {"line": <1-based line in 'code' active now>, "explanation": "<2-3 full sentences in a warm human tutor voice: the ACTUAL action with its real values, the decision taken, and WHY it matters for the next step — never a stub like 'Visit node 1'>", <state...>}
where <state...> is the fields that apply this step:
  - array algorithms: "array": {"current": <index>, "eliminated": [<indices ruled out>], "pointers": {"low":0,"mid":3,"high":6}}
  - tree/graph algorithms: "graph": {"current": "<nodeId>", "visited": ["<nodeId>"...], "pointers": {"curr":"<nodeId>"}}
  - DP/table algorithms: "array2d": {"current":[i,j], "values":[[i,j,v]] (cells WRITTEN this step),
    "highlight":[[i-1,j-1]] (dependency cells READ this step), "max":[i,j] (running best, when tracked)}
    — ONE step per cell write: the reads and the write belong to the SAME step (that is the dry run).
  - if it uses a stack or queue: "stack": [...]  and/or  "queue": [...]
  - a MIN-HEAP / priority queue serializes as "queue" SORTED smallest-first (there is NO "heap"
    field — the queue panel with the next-out item at the front IS the heap view)
  - "variables": {"i":2,"low":0,"mid":3,"high":6}   (only the key variables a student tracks)
Hard requirements:
  - "line" MUST be the line number in "code" (1-based) that is executing at that step. Keep 'code' and 'program' aligned.
  - Indices/node-ids in state MUST exist in "views". Group micro-steps into 4–12 LOGICAL steps (not every line).
  - Standard library only. No input, no file/network. The program must terminate quickly.
  - CRITICAL — emit valid JSON by SERIALIZING a dict, never by hand-formatting a string:
      ${lang === 'javascript'
    ? 'console.log("@@STEP " + JSON.stringify({line, explanation, array, variables}))'
    : 'import json  # then:  print("@@STEP " + json.dumps({"line": line, "explanation": expl, "array": arr_state, "variables": vars}))'}
    This guarantees lists/ints serialize correctly. Print ONLY @@STEP lines on their own lines.`,
  canHandle: ({ code, program }) => Boolean(code && program),
  async run({ code, program, views, lang, exec }) {
    const run = await exec({ language: lang, source: program });
    if (run.timedOut) throw new Error('Program timed out (likely an infinite loop).');
    // A malformed @@STEP line is a missing frame the student would never know about — never
    // ship a trace with silent holes; demand the structural fix (serialize, don't format).
    const malformed = countMalformedStepLines(run.stdout);
    if (malformed > 0) {
      throw new Error(`${malformed} @@STEP line(s) were malformed JSON and would silently vanish from the dry run — print steps ONLY by serializing a dict (json.dumps / JSON.stringify), never by hand-formatting strings.`);
    }
    const steps = parseStepEvents(run.stdout);
    if (steps.length === 0) {
      if (process.env.TRACE_DEBUG) console.error(`[tracer] --program--\n${program}\n--stdout--\n${run.stdout?.slice(0, 300)}`);
      // Battery-measured: a bare "printed no @@STEP lines" burned 4 blind retries — show the
      // agent what the program ACTUALLY printed and name the usual cause.
      throw new Error(run.stderr
        ? `Program errored: ${run.stderr.slice(-400).trim()}`
        : `Program printed no @@STEP lines — it ran but never printed. Usual cause: the printing loop is inside a function that is never CALLED at module level, or steps are collected in a list without printing. Actual stdout started with: ${JSON.stringify((run.stdout ?? '').slice(0, 120))}`);
    }
    const trace = { language: lang, code, views, steps };
    try {
      validateExecutionTrace(trace);
    } catch (error) {
      if (process.env.TRACE_DEBUG) console.error(`[tracer] --steps--\n${JSON.stringify(steps).slice(0, 500)}\n--views--\n${JSON.stringify(views)}`);
      throw new Error(`Trace failed contract validation: ${error.message}`);
    }
    return trace;
  },
};
