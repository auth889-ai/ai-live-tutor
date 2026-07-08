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
import { parseStepEvents } from '../../../execution/trace/parse-steps.js';
import { assembleRecursionProgram, parseCallTree, compileRecursionTrace } from '../../../execution/trace/recursion-compiler.js';
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
variables, no own memo/cache dict, no prints. For memoization lessons set "memoize": true — OUR
tracker supplies the memo and the animation shows every memo hit; the recursive calls stay plain
(e.g. return fib(n-1) + fib(n-2)). Our instrumented tracker runs it for real and derives every
animation step — do not write tracking code.

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
    const fix = attempt === 0
      ? ''
      : `\nThe previous attempt failed: ${lastError}\nFix it and output the full JSON again (keep 'code' and 'program' line-aligned).`;
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
        return { trace, usage, fixes: attempt };
      } catch (error) {
        lastError = `Recursion trace failed: ${error.message}`;
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
    // QUALITY GATE, not just validity: an elite dry-run shows pointers RIDING the structure
    // (low/mid/high, slow/fast, curr) at every step — a trace without them is a lecture,
    // not a VisuAlgo-grade animation. One repair pass demands them.
    if (attempt < maxFixes) {
      const stateful = steps.filter((s) => s.array || s.graph);
      const withPointers = stateful.filter((s) => s.array?.pointers || s.graph?.pointers);
      if (stateful.length > 0 && withPointers.length < stateful.length) {
        lastError = `Only ${withPointers.length}/${stateful.length} steps carry "pointers" — EVERY array/graph step must include its pointer positions (e.g. {"low":0,"mid":3,"high":6}) so they visibly move on the structure.`;
        logAttempt(attempt, lastError);
        continue;
      }
      // Same bar for the collection: a queue/stack-driven algorithm (BFS, iterative DFS) whose
      // steps never SHOW the queue/stack is a dry run with the engine hidden — the student must
      // watch it grow and shrink (mockup: "Queue (front → back)" panel at every step).
      const algoText = `${directive}\n${code}`.toLowerCase();
      const missingCollection = ['queue', 'stack'].find(
        (kind) => new RegExp(`\\b${kind}\\b`).test(algoText) && !steps.some((s) => Array.isArray(s[kind])),
      );
      if (missingCollection) {
        lastError = `The algorithm uses a ${missingCollection} but NO step carries "${missingCollection}" — every step must include the live ${missingCollection} contents (e.g. "${missingCollection}": ["2","3"]; use [] when empty) so the student watches it grow and shrink.`;
        logAttempt(attempt, lastError);
        continue;
      }
      // Elite bar for the WORDS, not just the state: the explanation IS the narration the
      // student hears. A majority of one-liners ("Visit node 1") is a slideshow, not teaching.
      const thin = steps.filter((s) => String(s.explanation ?? '').trim().length < 50);
      if (thin.length > Math.floor(steps.length / 2)) {
        lastError = `${thin.length}/${steps.length} explanations are one-line stubs — every step's "explanation" must be 2-3 full sentences in a human tutor voice: the actual values involved, the decision taken, and why it matters for the next step.`;
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

// Every failed attempt is visible in production logs (concise); TRACE_DEBUG adds the dumps.
function logAttempt(attempt, message) {
  console.error(`[tracer] attempt ${attempt} failed: ${String(message).slice(0, 220)}`);
}
