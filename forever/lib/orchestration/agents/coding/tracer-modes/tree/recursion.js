// Tracer mode: RECURSION — one file, one job (the mode's prompt + how to run its engine).
// The engine itself lives in lib/execution/trace/recursion/ (tracker -> compiler -> narrate).

import { assembleRecursionProgram, parseCallTree, compileRecursionTrace } from '../../../../../execution/trace/engines.js';

export const recursionMode = {
  key: 'recursion',
  label: 'Recursion trace',
  prompt: `RECURSION MODE (python only) — when the algorithm IS a recursive function whose CALL TREE is the lesson
(fibonacci, subsets, tree recursion, top-down DP/memoization): INSTEAD of "program", output
  "recursion": {"fnName": "fib", "args": [5], "memoize": true,
                "lines": {"call": <line of the recursive call>, "base": <line of the base-case return>,
                          "memo": <line of the memo check, if any>, "combine": <line combining results>}}
and make "code" EXACTLY the clean recursive function definition (def fnName(...)), nothing else.
The def MUST be at MODULE TOP LEVEL (column 0) — NEVER nested inside a wrapper function. If the
idiomatic solution uses an inner helper closing over outer state (e.g. maxPathSum's gain updating
a nonlocal best), FLATTEN it: the recursive function stands alone and RETURNS everything it
computes (return a tuple if it needs to carry the running best). The function must be PURE and
SELF-CONTAINED: its parameters are its ONLY inputs — no global
variables, no own memo/cache dict, no prints. Its arguments MUST be plain JSON literals
(numbers/strings/lists) — NEVER tree nodes or objects. A recursive TREE/GRAPH walk is NOT
recursion mode: use TRAVERSAL MODE for it (declare the tree in views.graph instead). For memoization lessons set "memoize": true — OUR
tracker supplies the memo and the animation shows every memo hit; the recursive calls stay plain
(e.g. return fib(n-1) + fib(n-2)). Our instrumented tracker runs it for real and derives every
animation step — do not write tracking code.`,
  canHandle: ({ json, lang, code }) => Boolean(json.recursion && typeof json.recursion === 'object' && lang === 'python' && code),
  async run({ json, code, exec }) {
    const source = assembleRecursionProgram({
      code,
      fnName: json.recursion.fnName,
      args: json.recursion.args,
      memoize: json.recursion.memoize === true,
    });
    const run = await exec({ language: 'python', source });
    if (run.timedOut) throw new Error('tracker timed out (likely unbounded recursion)');
    const callTree = parseCallTree(run.stdout);
    if (!callTree) throw new Error(run.stderr ? `tracker errored: ${run.stderr.slice(-400).trim()}` : 'tracker printed no @@CALLTREE line');
    const trace = compileRecursionTrace({ callTree, code, language: 'python', lines: json.recursion.lines ?? {} });
    // The trace carries its own recipe so the PLAYER can re-run this engine on student input.
    trace.meta = {
      tool: 'recursion',
      params: { code, fnName: json.recursion.fnName, args: json.recursion.args, memoize: json.recursion.memoize === true, lines: json.recursion.lines ?? {} },
    };
    return trace;
  },
};
