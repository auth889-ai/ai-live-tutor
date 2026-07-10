// Tracer mode: RECURSION — one file, one job (the mode's prompt + how to run its engine).
// The engine itself lives in lib/execution/trace/recursion/ (tracker -> compiler -> narrate).

import { assembleRecursionProgram, parseCallTree, compileRecursionTrace } from '../../../../../execution/trace/engines.js';
import { assembleNestedRecursionProgram } from '../../../../../execution/trace/recursion/tracker.js';

export const recursionMode = {
  key: 'recursion',
  label: 'Recursion trace',
  prompt: `RECURSION MODE (python only) — when the algorithm IS a recursive function whose CALL TREE is the lesson
(fibonacci, subsets, tree recursion, top-down DP/memoization): INSTEAD of "program", output
  "recursion": {"fnName": "fib", "args": [5], "memoize": true,
                "lines": {"call": <line of the recursive call>, "base": <line of the base-case return>,
                          "memo": <line of the memo check, if any>, "combine": <line combining results>}}
and make "code" EXACTLY the clean recursive function definition (def fnName(...)), nothing else.
If the recursive function is NESTED inside a wrapper (the idiomatic LeetCode shape — e.g.
maxPathSum's inner gain() updating a nonlocal best), KEEP that shape and ALSO provide
"entry": "<ONE outer call, e.g. maxPathSum(tree)>" with its input built at module level in
"code" (tree = build(...)) — the tracer records the nested calls natively. Top-level recursive
functions use "args" instead and support "memoize". The function must be PURE and
SELF-CONTAINED: its parameters are its ONLY inputs — no global
variables, no own memo/cache dict, no prints. Its arguments MUST be plain JSON literals
(numbers/strings/lists) — NEVER tree nodes or objects. A recursive TREE/GRAPH walk is NOT
recursion mode: use TRAVERSAL MODE for it (declare the tree in views.graph instead). For memoization lessons set "memoize": true — OUR
tracker supplies the memo and the animation shows every memo hit; the recursive calls stay plain
(e.g. return fib(n-1) + fib(n-2)). Our instrumented tracker runs it for real and derives every
animation step — do not write tracking code.`,
  canHandle: ({ json, lang, code }) => Boolean(json.recursion && typeof json.recursion === 'object' && lang === 'python' && code),
  async run({ json, code, exec }) {
    // A nested recursive fn (idiomatic LeetCode) with an outer entry call is traced natively
    // via settrace; the classic top-level shape keeps the rebinding tracker (which adds memo).
    const fnName = json.recursion.fnName;
    const nested = !new RegExp(`^def ${fnName}\\(`, 'm').test(String(code ?? ''));
    const source = nested && json.recursion.entry
      ? assembleNestedRecursionProgram({ code, entry: json.recursion.entry, fnName })
      : assembleRecursionProgram({
        code,
        fnName,
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
