// Tracer mode: POINTER-WALK — one file, one job. Engine: lib/execution/trace/pointer-walk/.

import { assembleLineProgram, parseLineEvents, compilePointerWalk } from '../../../../../execution/trace/engines.js';

export const pointerWalkMode = {
  key: 'pointerwalk',
  label: 'Pointer walk',
  prompt: `POINTER-WALK MODE (python only) — for ARRAY algorithms driven by index pointers (binary search,
two pointers, sliding window, in-place sorting/partitioning): INSTEAD of "program", output
  "pointerwalk": {"entry": "<ONE call expression invoking 'code' on a concrete array>",
                  "array": [the concrete array values], "pointers": ["low","mid","high"],
                  "examine": "mid" (optional: the pointer whose cell the code READS each step — that cell gets the highlight),
                  "arrayVar": "arr" (optional: the list variable the code mutates IN PLACE — swaps then animate with live values),
                  "eliminatedOutside": ["low","high"] (optional, binary-search style: cells outside low..high dim),
                  "window": ["left","right"] (optional, sliding-window style)}
with "code" = the clean function definition. Our engine runs it for real and animates the
pointers riding the array — do not write tracking code. For sorting ALWAYS set "arrayVar" so
every swap is a visible flash, and set "examine" for search algorithms so the probed cell lights up.`,
  canHandle: ({ json, lang, code }) => Boolean(json.pointerwalk && typeof json.pointerwalk === 'object' && lang === 'python' && code),
  async run({ json, code, exec }) {
    const run = await exec({ language: 'python', source: assembleLineProgram({ code, entry: json.pointerwalk.entry }) });
    if (run.timedOut) throw new Error('pointer walk timed out (likely an infinite loop)');
    const payload = parseLineEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@LINESIM line');
    const trace = compilePointerWalk({
      ...payload,
      code,
      language: 'python',
      array: json.pointerwalk.array,
      pointers: json.pointerwalk.pointers,
      examine: json.pointerwalk.examine ?? null,
      arrayVar: json.pointerwalk.arrayVar ?? null,
      eliminatedOutside: json.pointerwalk.eliminatedOutside ?? null,
      window: json.pointerwalk.window ?? null,
    });
    trace.meta = {
      tool: 'pointerwalk',
      params: {
        code,
        entry: json.pointerwalk.entry,
        array: json.pointerwalk.array,
        pointers: json.pointerwalk.pointers,
        examine: json.pointerwalk.examine ?? null,
        arrayVar: json.pointerwalk.arrayVar ?? null,
        eliminatedOutside: json.pointerwalk.eliminatedOutside ?? null,
        window: json.pointerwalk.window ?? null,
      },
    };
    return trace;
  },
};
