// Execution Tracer agent — the "missing layer" made real. Following ALGOGEN (decouple
// execution from rendering): the LLM writes a TRACKER program that runs the real algorithm on
// a concrete example and prints one @@STEP JSON event per logical step; we EXECUTE it for real,
// parse the events, and compile a validated ExecutionTrace. The step STATE (current node,
// pointers, variables, stack/queue) therefore comes from a real run — not an LLM imagining
// frames — which is what kills the hallucinated/inconsistent-animation problem.
//
// One trace drives the whole synced AlgorithmStage (code line + structure + vars + collections
// + voice). Self-debugs like the Code Runner; honest failure (null) if it can't produce a real,
// contract-valid trace — never a fake animation.

import { callQwenJson } from '../../../qwen/client.js';
import { runCode } from '../../../execution/run-code.js';
import { parseStepEvents, countMalformedStepLines } from '../../../execution/trace/parse-steps.js';
import { assembleRecursionProgram, parseCallTree, compileRecursionTrace } from '../../../execution/trace/engines.js';
import { compileTraversalTrace } from '../../../execution/trace/engines.js';
import { compileGraphWalk } from '../../../execution/trace/engines.js';
import { compileLinkedListTrace, assembleListProgram, parseListEvents } from '../../../execution/trace/engines.js';
import { compileDivideConquer, assembleDivideProgram, parseDivideEvents } from '../../../execution/trace/engines.js';
import { compileTrieTrace, assembleTrieProgram, parseTrieEvents } from '../../../execution/trace/engines.js';
import { compileDpTable, assembleDpProgram, parseDpEvents } from '../../../execution/trace/engines.js';
import { assembleLineProgram, parseLineEvents, compileLineTrace } from '../../../execution/trace/engines.js';
import { compilePointerWalk } from '../../../execution/trace/engines.js';
import { compileOperationsTrace } from '../../../execution/trace/engines.js';
import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

const RUNNABLE_LANGUAGES = ['python', 'javascript'];

function tracerSystem(lang) {
  return `You are the Execution Tracer of an AI tutor. You make an algorithm's dry-run VISIBLE by running it
for real and emitting its state at each step. Output ONLY JSON with FOUR fields:
{
  "language": "${lang}",
  "code": "<the CLEAN algorithm, exactly as shown to the student, 1 statement per line>",
  "views": { "array": {"values":[...]}  OR  "graph": {"nodes":[{"id":"1","label":"8"}],"edges":[{"from":"1","to":"2"}],"directed":true}
             (for BINARY trees: every edge also carries "side":"left" or "side":"right", children listed left-then-right)
             OR "array2d": {"rows":5,"cols":5,"rowLabels":["","A","B","C","D"],"colLabels":["","A","C","D","G"]} },
  "program": "<a runnable ${lang} program that RUNS 'code' on ONE concrete example and prints the trace>"
}
RECURSION MODE (python only) — when the algorithm IS a recursive function whose CALL TREE is the lesson
(fibonacci, subsets, tree recursion, top-down DP/memoization): INSTEAD of "program", output
  "recursion": {"fnName": "fib", "args": [5], "memoize": true,
                "lines": {"call": <line of the recursive call>, "base": <line of the base-case return>,
                          "memo": <line of the memo check, if any>, "combine": <line combining results>}}
and make "code" EXACTLY the clean recursive function definition (def ${'fnName'}(...)), nothing else.
The function must be PURE and SELF-CONTAINED: its parameters are its ONLY inputs — no global
variables, no own memo/cache dict, no prints. Its arguments MUST be plain JSON literals
(numbers/strings/lists) — NEVER tree nodes or objects. A recursive TREE/GRAPH walk is NOT
recursion mode: use TRAVERSAL MODE for it (declare the tree in views.graph instead). For memoization lessons set "memoize": true — OUR
tracker supplies the memo and the animation shows every memo hit; the recursive calls stay plain
(e.g. return fib(n-1) + fib(n-2)). Our instrumented tracker runs it for real and derives every
animation step — do not write tracking code.

TRAVERSAL MODE — when the algorithm IS breadth-first / depth-first / level-order over a CONCRETE
tree or graph: INSTEAD of "program", output
  "traversal": {"kind": "bfs" | "dfs" | "level_order", "start": "<nodeId from views.graph>",
                "lines": {"init": <line that seeds the queue/stack>, "visit": <line that visits>, "done": <line after the loop>}}
plus "views.graph" (edges carry "side" for binary trees) and "code" = the clean traversal function.
Our engine executes the walk itself, exactly — do not write tracking code.

GRAPH-WALK MODE (python only) — for ANY graph algorithm BEYOND plain BFS/DFS (Dijkstra,
Bellman-Ford, topological sort/Kahn, Prim, union-find, cycle detection): INSTEAD of "program", output
  "graphwalk": {"entry": "<ONE call expression invoking 'code' on the concrete graph>",
                "lens": {"current": "u" (variable holding the node being processed),
                         "dist": "dist" (tentative-distance dict, if any),
                         "visited": "visited" (finalized set/list, if any),
                         "pq": "pq" (heapq list) OR "queue": "q" OR "stack": "st" (the frontier, if any),
                         "parent": "parent" (union-find parent map, if any),
                         "indegree": "indeg" (Kahn's counts, if any)}}
plus "views.graph" and "code" = the clean function. CRITICAL: node ids in views.graph MUST equal
the node keys the code uses (dist/parent/indegree keys, visited elements, current values). Our
engine runs the code for real under the tracer and derives every teaching moment (extract-min,
relax old->new, finalize, union, indegree drop) from the actual variables — do not write
tracking code. Declare every lens role that exists in the code; skip roles it doesn't have.

POINTER-WALK MODE (python only) — for ARRAY algorithms driven by index pointers (binary search,
two pointers, sliding window, in-place sorting/partitioning): INSTEAD of "program", output
  "pointerwalk": {"entry": "<ONE call expression invoking 'code' on a concrete array>",
                  "array": [the concrete array values], "pointers": ["low","mid","high"],
                  "examine": "mid" (optional: the pointer whose cell the code READS each step — that cell gets the highlight),
                  "arrayVar": "arr" (optional: the list variable the code mutates IN PLACE — swaps then animate with live values),
                  "eliminatedOutside": ["low","high"] (optional, binary-search style: cells outside low..high dim),
                  "window": ["left","right"] (optional, sliding-window style)}
with "code" = the clean function definition. Our engine runs it for real and animates the
pointers riding the array — do not write tracking code. For sorting ALWAYS set "arrayVar" so
every swap is a visible flash, and set "examine" for search algorithms so the probed cell lights up.

DP-TABLE MODE (python only) — for TABULATION dynamic programming (LCS, edit distance, knapsack,
grid paths, coin change — any bottom-up table fill): INSTEAD of "program", output
  "dptable": {"entry": "<ONE call expression, e.g. lcs('abcde', 'ace')>",
              "dp": "dp" (the table variable inside 'code' — 2-D list of lists, or a 1-D list),
              "rowLabels": ["","a","b","c"] / "colLabels": [...] (optional, MUST match the final
              table dimensions — e.g. '' + one label per character for LCS)}
with "code" = the clean bottom-up implementation. Our tracker snapshots the REAL table at every
line: the grid fills cell by cell with actual old -> new values, base row/column taught, the
answer read out of the final cell. Keep the example SMALL (table <= 24x24 — bigger fails).
Top-down/memoized recursion stays in RECURSION MODE; do not write tracking code.

TRIE MODE (python only) — for prefix-tree lessons (implement trie, insert/search/startsWith,
autocomplete, word dictionary): INSTEAD of "program", output
  "trie": {"entry": "<ONE call expression, e.g. demo()>",
           "root": "trie" (the variable holding the Trie instance or root node),
           "childrenAttr": "children" (dict char->node, or a 26-slot list),
           "endAttr": "is_end" (the end-of-word flag attribute),
           "cursors": ["node","cur"] (EVERY node variable the code walks with)}
with "code" = the clean TrieNode/Trie classes + operations + a demo function the entry calls
(insert several words sharing prefixes, then search for a stored word AND for a prefix-only
word like 'app' when 'apple' is stored — that contrast is the lesson). Our tracker runs it for
real: the tree grows character by character, end-of-word nodes turn green, the cursor rides
under the student's own variable name. Do not write tracking code.

DIVIDE-CONQUER MODE (python only) — for recursive ARRAY splitting (merge sort, quicksort, and
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
tracking code. Plain recursion WITHOUT an array (fib, subsets) stays in RECURSION MODE.

LINKED-LIST MODE (python only) — for algorithms over node chains (traverse, reverse, insert,
delete, middle via slow/fast, cycle detection): INSTEAD of "program", output
  "linkedlist": {"entry": "<ONE call expression, e.g. reverse(build([1,2,3,4]))>",
                 "roots": ["head","prev","curr","nxt"] (EVERY pointer variable the code uses),
                 "nextAttr": "next", "valAttr": "val"}
with "code" = the clean Node class + algorithm. BUILD THE INPUT LIST AT MODULE LEVEL (a plain
statement like "lst = build([1,2,3,4])" after the defs) and make "entry" the operation on it
(e.g. "reverse(lst)") — NOT "reverse(build([...]))". This keeps the dry run focused on the
ACTUAL operation (the build runs untraced as setup) and lays the boxes out head→tail, left to
right. Our identity-preserving tracker runs it for real: boxes are real node objects, arrows are
live next-references, rewires flash, unreachable nodes fade (the garbage moment). Declare every
pointer variable the OPERATION uses in "roots" — undeclared pointers are invisible. Do not write
tracking code.

OPERATIONS MODE — when the lesson teaches a DATA STRUCTURE ITSELF (stack, queue, hash map —
push/pop, enqueue/dequeue, put/get/remove with collisions): INSTEAD of "program", output
  "operations": {"structure": "stack" | "queue" | "hash_map",
                 "ops": [{"op":"push","value":7}, {"op":"pop"}, {"op":"put","key":"cat","value":1}, ...],
                 "lines": {"push": <code line of push>, "pop": <...>, "put": <...>, "get": <...>}}
with "code" = the short usage snippet shown to the student. Design the ops to TEACH: include a
collision (hash_map), an update of an existing key, a miss, and one underflow (pop/dequeue on
empty) — our engine executes every operation for real and narrates sizes, hashes and chains.

LINE-SIM MODE (python only) — ONLY for algorithms with genuinely NO structure to draw (pure math
like GCD, string building, greedy counting): INSTEAD of "program", output
  "linesim": {"entry": "<ONE call expression invoking 'code', e.g. gcd(48, 18)>"}
and make "code" the clean runnable function definition. Our tracer executes it for real and
records every line + variable change. NEVER pick line-sim because another mode looks hard or a
previous attempt failed — if the algorithm walks an array, tree, graph, stack, queue, DP table
or call tree, it MUST use the matching mode above. A line-only animation of a structural
algorithm is a quality failure, not a safe choice.

Rules for "program" — it must print, at each LOGICAL step (each comparison/decision/loop turn), exactly one line:
@@STEP {"line": <1-based line in 'code' active now>, "explanation": "<2-3 full sentences in a warm human tutor voice: the ACTUAL action with its real values, the decision taken, and WHY it matters for the next step — never a stub like 'Visit node 1'>", <state...>}
where <state...> is the fields that apply this step:
  - array algorithms: "array": {"current": <index>, "eliminated": [<indices ruled out>], "pointers": {"low":0,"mid":3,"high":6}}
  - tree/graph algorithms: "graph": {"current": "<nodeId>", "visited": ["<nodeId>"...], "pointers": {"curr":"<nodeId>"}}
  - DP/table algorithms: "array2d": {"current":[i,j], "values":[[i,j,v]] (cells WRITTEN this step),
    "highlight":[[i-1,j-1]] (dependency cells READ this step), "max":[i,j] (running best, when tracked)}
    — ONE step per cell write: the reads and the write belong to the SAME step (that is the dry run).
  - if it uses a stack or queue: "stack": [...]  and/or  "queue": [...]
  - "variables": {"i":2,"low":0,"mid":3,"high":6}   (only the key variables a student tracks)
Hard requirements:
  - "line" MUST be the line number in "code" (1-based) that is executing at that step. Keep 'code' and 'program' aligned.
  - Indices/node-ids in state MUST exist in "views". Group micro-steps into 4–12 LOGICAL steps (not every line).
  - Standard library only. No input, no file/network. The program must terminate quickly.
  - CRITICAL — emit valid JSON by SERIALIZING a dict, never by hand-formatting a string:
      ${lang === 'javascript'
        ? 'console.log("@@STEP " + JSON.stringify({line, explanation, array, variables}))'
        : 'import json  # then:  print("@@STEP " + json.dumps({"line": line, "explanation": expl, "array": arr_state, "variables": vars}))'}
    This guarantees lists/ints serialize correctly. Print ONLY @@STEP lines on their own lines.`;
}

// Runs the tracker for real and compiles a validated ExecutionTrace, or null on honest failure.
export async function traceExecution({ directive, sourceText = '', language = 'python', maxFixes = 3, deps = {} } = {}) {
  const call = deps.callQwenJson ?? callQwenJson;
  const exec = deps.runCode ?? runCode;
  const lang = RUNNABLE_LANGUAGES.includes(language) ? language : 'python';

  let lastError = '';
  let usage = null;
  for (let attempt = 0; attempt <= maxFixes; attempt += 1) {
    // NO DOWNGRADE ON RETRY (user's standing order: real dynamic, never fallback normalization):
    // a failed attempt fixes ITS error or moves to a RICHER representation — it never escapes to
    // a weaker one to make the error go away. The old "switch to line-sim, it cannot fail" hatch
    // funneled every hard algorithm into the poorest visual; honest failure beats quiet decay.
    const fix = attempt === 0
      ? ''
      : `\nThe previous attempt failed: ${lastError}\nFix THIS error and output the full JSON again (keep 'code' and 'program' line-aligned). If the error says the trace is missing structure (pointers, stack, queue), pick the mode that SHOWS that structure — never drop to a weaker representation to avoid the error.`;
    const res = await call({
      agent: 'execution_tracer',
      system: tracerSystem(lang) + fix,
      user: `Trace this algorithm step by step as a real dry run:\n${directive}\n\nGrounding source:\n${sourceText}`.slice(0, 6000),
      model: process.env.MODEL_CODER || 'qwen3-coder-plus',
      temperature: 0.2,
    });
    usage = res.usage ?? usage;
    const json = res.json ?? {};
    const code = String(json.code || '').trim();
    const program = String(json.program || '').trim();
    const views = json.views && typeof json.views === 'object' ? json.views : {};

    // RECURSION MODE: the model supplied only the clean recursive function — OUR instrumented
    // tracker (recursion-compiler) wraps it, runs it for real, and derives every step
    // deterministically. No model-written tracking code, no imagined frames.
    if (json.recursion && typeof json.recursion === 'object' && lang === 'python' && code) {
      try {
        const source = assembleRecursionProgram({
          code,
          fnName: json.recursion.fnName,
          args: json.recursion.args,
          memoize: json.recursion.memoize === true,
        });
        const run = await exec({ language: 'python', source });
        if (run.timedOut) throw new Error('tracker timed out (likely unbounded recursion)');
        const callTree = parseCallTree(run.stdout);
        if (!callTree) {
          throw new Error(run.stderr ? `tracker errored: ${run.stderr.slice(0, 300)}` : 'tracker printed no @@CALLTREE line');
        }
        const trace = compileRecursionTrace({ callTree, code, language: 'python', lines: json.recursion.lines ?? {} });
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        // The trace carries its own recipe so the PLAYER can re-run this engine on
        // student-modified inputs (fib(7), memo on/off) — a live instrument, not a recording.
        trace.meta = {
          tool: 'recursion',
          params: { code, fnName: json.recursion.fnName, args: json.recursion.args, memoize: json.recursion.memoize === true, lines: json.recursion.lines ?? {} },
        };
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Recursion trace failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    // TRAVERSAL MODE: BFS/DFS/level-order over a declared graph — our engine runs the walk
    // natively and exactly (no sandbox, no model tracker, instant).
    if (json.traversal && typeof json.traversal === 'object' && views.graph && code) {
      try {
        const trace = compileTraversalTrace({
          graph: views.graph,
          kind: json.traversal.kind,
          start: json.traversal.start,
          code,
          language: lang,
          lines: json.traversal.lines ?? {},
        });
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        trace.meta = {
          tool: 'traversal',
          params: { graph: views.graph, kind: json.traversal.kind, start: json.traversal.start, code, lines: json.traversal.lines ?? {} },
        };
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Traversal trace failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    // GRAPH-WALK MODE: ANY graph algorithm — the student's REAL code runs under the tracer
    // and the declared variable lens derives every teaching moment (extract-min, relax
    // old->new, finalize, union, indegree drop). Dijkstra/topo-sort/DSU-grade dry runs.
    if (json.graphwalk && typeof json.graphwalk === 'object' && lang === 'python' && views.graph && code) {
      try {
        const run = await exec({ language: 'python', source: assembleLineProgram({ code, entry: json.graphwalk.entry }) });
        if (run.timedOut) throw new Error('graph walk timed out (likely an infinite loop)');
        const payload = parseLineEvents(run.stdout);
        if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@LINESIM line');
        const trace = compileGraphWalk({
          ...payload,
          code,
          entry: json.graphwalk.entry,
          graph: views.graph,
          lens: json.graphwalk.lens ?? {},
          language: 'python',
        });
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        // Live instrument: the student edits the entry call (their own graph weights/start)
        // and the same lens re-walks their scenario.
        trace.meta = {
          tool: 'graphwalk',
          params: { code, entry: json.graphwalk.entry, graph: views.graph, lens: json.graphwalk.lens ?? {} },
        };
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Graph walk failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    // DP-TABLE MODE: bottom-up DP — the declared table variable is snapshotted faithfully per
    // line; the grid fills from the REAL run (the last family to shed model-written trackers).
    if (json.dptable && typeof json.dptable === 'object' && lang === 'python' && code) {
      try {
        const d = json.dptable;
        const source = assembleDpProgram({ code, entry: d.entry, dp: d.dp ?? 'dp' });
        const run = await exec({ language: 'python', source });
        if (run.timedOut) throw new Error('dp-table run timed out (likely an infinite loop)');
        const payload = parseDpEvents(run.stdout);
        if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@DPTABLE line');
        const trace = compileDpTable({
          ...payload, code, entry: d.entry,
          rowLabels: Array.isArray(d.rowLabels) ? d.rowLabels : null,
          colLabels: Array.isArray(d.colLabels) ? d.colLabels : null,
          language: 'python',
        });
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        trace.meta = {
          tool: 'dptable',
          params: { code, entry: d.entry, dp: d.dp ?? 'dp', rowLabels: d.rowLabels ?? null, colLabels: d.colLabels ?? null },
        };
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `DP-table trace failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    // TRIE MODE: prefix trees — the identity-preserving tracker chases the declared root and
    // the tree grows character by character from the student's REAL run.
    if (json.trie && typeof json.trie === 'object' && lang === 'python' && code) {
      try {
        const t = json.trie;
        const source = assembleTrieProgram({
          code, entry: t.entry, root: t.root, childrenAttr: t.childrenAttr ?? 'children', endAttr: t.endAttr ?? 'is_end',
          cursors: Array.isArray(t.cursors) && t.cursors.length ? t.cursors : undefined,
        });
        const run = await exec({ language: 'python', source });
        if (run.timedOut) throw new Error('trie run timed out (likely an infinite loop)');
        const payload = parseTrieEvents(run.stdout);
        if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@TRIE line');
        const trace = compileTrieTrace({ ...payload, code, entry: t.entry, language: 'python' });
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        trace.meta = {
          tool: 'trie',
          params: { code, entry: t.entry, root: t.root, childrenAttr: t.childrenAttr ?? 'children', endAttr: t.endAttr ?? 'is_end', cursors: Array.isArray(t.cursors) ? t.cursors : null },
        };
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Trie trace failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    // DIVIDE-CONQUER MODE: recursive array splitting — one real run drives the focus-band
    // array view AND the growing segment recursion tree in lock-step.
    if (json.divideconquer && typeof json.divideconquer === 'object' && lang === 'python' && code) {
      try {
        const dc = json.divideconquer;
        const source = assembleDivideProgram({ code, entry: dc.entry, fn: dc.fn, arrayVar: dc.arrayVar, loVar: dc.lo, hiVar: dc.hi });
        const run = await exec({ language: 'python', source });
        if (run.timedOut) throw new Error('divide & conquer run timed out (likely unbounded recursion)');
        const payload = parseDivideEvents(run.stdout);
        if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@DIVIDE line');
        const trace = compileDivideConquer({
          ...payload, code, entry: dc.entry, fn: dc.fn, pointers: Array.isArray(dc.pointers) ? dc.pointers : [], language: 'python',
        });
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        trace.meta = {
          tool: 'divideconquer',
          params: { code, entry: dc.entry, fn: dc.fn, arrayVar: dc.arrayVar, lo: dc.lo, hi: dc.hi, pointers: Array.isArray(dc.pointers) ? dc.pointers : [] },
        };
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Divide-conquer trace failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    // LINKED-LIST MODE: node chains — the dedicated identity-preserving tracker runs the
    // student's REAL code; boxes never move, arrows flip, orphans fade.
    if (json.linkedlist && typeof json.linkedlist === 'object' && lang === 'python' && code) {
      try {
        const source = assembleListProgram({
          code,
          entry: json.linkedlist.entry,
          roots: json.linkedlist.roots,
          nextAttr: json.linkedlist.nextAttr ?? 'next',
          valAttr: json.linkedlist.valAttr ?? 'val',
        });
        const run = await exec({ language: 'python', source });
        if (run.timedOut) throw new Error('linked-list run timed out (likely an infinite loop — a cycle without Floyd?)');
        const payload = parseListEvents(run.stdout);
        if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@LISTWALK line');
        const trace = compileLinkedListTrace({ ...payload, code, entry: json.linkedlist.entry, language: 'python' });
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        trace.meta = {
          tool: 'linkedlist',
          params: {
            code,
            entry: json.linkedlist.entry,
            roots: json.linkedlist.roots,
            nextAttr: json.linkedlist.nextAttr ?? 'next',
            valAttr: json.linkedlist.valAttr ?? 'val',
          },
        };
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Linked-list trace failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    // OPERATIONS MODE: the structure itself is the lesson — our engine executes every op.
    if (json.operations && typeof json.operations === 'object' && code) {
      try {
        const trace = compileOperationsTrace({
          structure: json.operations.structure,
          ops: json.operations.ops,
          code,
          lines: json.operations.lines ?? {},
          buckets: json.operations.buckets ?? 5,
          language: lang,
        });
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Operations trace failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    // POINTER-WALK MODE: array algorithms — real run under settrace, compiled through the
    // array lens (pointer arrows, eliminated half, window span; sentences from real values).
    if (json.pointerwalk && typeof json.pointerwalk === 'object' && lang === 'python' && code) {
      try {
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
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        // Live instrument: the student can re-run the same engine on their OWN entry call
        // (their array, their target) — the whole stage re-animates their scenario.
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
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Pointer walk failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    // LINE-SIM MODE: the guaranteed floor — our settrace harness runs the code and records
    // every executed line + variable change; the trace cannot lie and cannot be malformed.
    if (json.linesim && typeof json.linesim === 'object' && lang === 'python' && code) {
      try {
        const run = await exec({ language: 'python', source: assembleLineProgram({ code, entry: json.linesim.entry }) });
        if (run.timedOut) throw new Error('simulation timed out (likely an infinite loop)');
        const payload = parseLineEvents(run.stdout);
        if (!payload) throw new Error(run.stderr ? `simulation errored: ${run.stderr.slice(0, 300)}` : 'simulation printed no @@LINESIM line');
        const trace = compileLineTrace({ ...payload, code, entry: json.linesim.entry, language: 'python' });
        // The gate is what keeps line-sim honest: a structural algorithm routed here fails the
        // pointer/collection bar and the retry pushes the model UP to the matching engine mode.
        assertDryRunQuality(trace, { directive, code, attempt, maxFixes });
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Line simulation failed: ${error.message}`;
        logAttempt(attempt, lastError);
        continue;
      }
    }

    if (!code || !program) {
      lastError = 'Missing code or program in output.';
      logAttempt(attempt, lastError);
      continue;
    }

    const run = await exec({ language: lang, source: program });
    if (run.timedOut) {
      lastError = 'Program timed out (likely an infinite loop).';
      logAttempt(attempt, lastError);
      continue;
    }
    const steps = parseStepEvents(run.stdout);
    // A malformed @@STEP line is a missing frame the student would never know about — never
    // ship a trace with silent holes; demand the structural fix (serialize, don't format).
    const malformed = countMalformedStepLines(run.stdout);
    if (malformed > 0) {
      lastError = `${malformed} @@STEP line(s) were malformed JSON and would silently vanish from the dry run — print steps ONLY by serializing a dict (json.dumps / JSON.stringify), never by hand-formatting strings.`;
      logAttempt(attempt, lastError);
      continue;
    }
    if (steps.length === 0) {
      lastError = run.stderr ? `Program errored: ${run.stderr.slice(0, 400)}` : 'Program printed no @@STEP lines.';
      logAttempt(attempt, lastError);
      if (process.env.TRACE_DEBUG) console.error(`[tracer] --program--\n${program}\n--stdout--\n${run.stdout?.slice(0, 300)}`);
      continue;
    }

    const trace = { language: lang, code, views, steps };
    try {
      validateExecutionTrace(trace);
    } catch (error) {
      lastError = `Trace failed contract validation: ${error.message}`;
      logAttempt(attempt, lastError);
      if (process.env.TRACE_DEBUG) console.error(`[tracer] --steps--\n${JSON.stringify(steps).slice(0, 500)}\n--views--\n${JSON.stringify(views)}`);
      continue;
    }
    // QUALITY GATE, not just validity — see dryRunQualityIssue below. One repair pass demands it.
    if (attempt < maxFixes) {
      const issue = dryRunQualityIssue({ steps, directive, code });
      if (issue) {
        lastError = issue;
        logAttempt(attempt, lastError);
        continue;
      }
    }
    return { trace, usage, fixes: attempt };
  }

  // Honest failure — but LOUD: a silently-degraded dry run is how quality rots. The caller
  // refuses to fake an animation; the log tells us exactly what to fix.
  console.error(`[tracer] GAVE UP after ${maxFixes + 1} attempts: ${String(lastError).slice(0, 300)}`);
  return null;
}

// THE ELITE-QUALITY GATE — one bar for EVERY engine, raw @@STEP and deterministic tools alike
// (previously only the @@STEP path was gated, so an engine output could ship unaudited).
// A trace that merely validates is not automatically a lesson: pointers must ride the structure
// at every stateful step, a stack/queue algorithm must SHOW its collection growing and
// shrinking, and the words must teach — not caption. Returns the failure message, or null.
export function dryRunQualityIssue({ steps, directive, code }) {
  const stateful = steps.filter((s) => s.array || s.graph);
  const withPointers = stateful.filter((s) => s.array?.pointers || s.graph?.pointers);
  if (stateful.length > 0 && withPointers.length < stateful.length) {
    return `Only ${withPointers.length}/${stateful.length} steps carry "pointers" — EVERY array/graph step must include its pointer positions (e.g. {"low":0,"mid":3,"high":6}) so they visibly move on the structure.`;
  }
  // A queue/stack-driven algorithm (BFS, iterative DFS) whose steps never SHOW the queue/stack
  // is a dry run with the engine hidden — the student must watch it grow and shrink.
  const algoText = `${directive}\n${code}`.toLowerCase();
  const missingCollection = ['queue', 'stack'].find(
    (kind) => new RegExp(`\\b${kind}\\b`).test(algoText) && !steps.some((s) => Array.isArray(s[kind])),
  );
  if (missingCollection) {
    return `The algorithm uses a ${missingCollection} but NO step carries "${missingCollection}" — every step must include the live ${missingCollection} contents (e.g. "${missingCollection}": ["2","3"]; use [] when empty) so the student watches it grow and shrink.`;
  }
  // Elite bar for the WORDS, not just the state: the explanation IS the narration the
  // student hears. A majority of one-liners ("Visit node 1") is a slideshow, not teaching.
  const thin = steps.filter((s) => String(s.explanation ?? '').trim().length < 50);
  if (thin.length > Math.floor(steps.length / 2)) {
    return `${thin.length}/${steps.length} explanations are one-line stubs — every step's "explanation" must be 2-3 full sentences in a human tutor voice: the actual values involved, the decision taken, and why it matters for the next step.`;
  }
  return null;
}

// Gate an ENGINE-compiled trace: throws so the surrounding branch's catch retries the attempt
// (same rules as @@STEP — the last attempt ships only after every earlier one logged loudly).
function assertDryRunQuality(trace, { directive, code, attempt, maxFixes }) {
  if (attempt >= maxFixes) return;
  const issue = dryRunQualityIssue({ steps: trace.steps, directive, code });
  if (issue) throw new Error(`quality gate: ${issue}`);
}

// Every failed attempt is visible in production logs (concise); TRACE_DEBUG adds the dumps.
function logAttempt(attempt, message) {
  console.error(`[tracer] attempt ${attempt} failed: ${String(message).slice(0, 220)}`);
}
