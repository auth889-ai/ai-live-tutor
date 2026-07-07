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
import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

const RUNNABLE_LANGUAGES = ['python', 'javascript'];

function tracerSystem(lang) {
  return `You are the Execution Tracer of an AI tutor. You make an algorithm's dry-run VISIBLE by running it
for real and emitting its state at each step. Output ONLY JSON with FOUR fields:
{
  "language": "${lang}",
  "code": "<the CLEAN algorithm, exactly as shown to the student, 1 statement per line>",
  "views": { "array": {"values":[...]}  OR  "graph": {"nodes":[{"id":"1","label":"8"}],"edges":[{"from":"1","to":"2"}],"directed":true} },
  "program": "<a runnable ${lang} program that RUNS 'code' on ONE concrete example and prints the trace>"
}
Rules for "program" — it must print, at each LOGICAL step (each comparison/decision/loop turn), exactly one line:
@@STEP {"line": <1-based line in 'code' active now>, "explanation": "<plain English: the comparison + the decision>", <state...>}
where <state...> is the fields that apply this step:
  - array algorithms: "array": {"current": <index>, "eliminated": [<indices ruled out>], "pointers": {"low":0,"mid":3,"high":6}}
  - tree/graph algorithms: "graph": {"current": "<nodeId>", "visited": ["<nodeId>"...], "pointers": {"curr":"<nodeId>"}}
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
export async function traceExecution({ directive, sourceText = '', language = 'python', maxFixes = 2, deps = {} } = {}) {
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
    if (!code || !program) {
      lastError = 'Missing code or program in output.';
      continue;
    }

    const run = await exec({ language: lang, source: program });
    if (run.timedOut) {
      lastError = 'Program timed out (likely an infinite loop).';
      if (process.env.TRACE_DEBUG) console.error(`[tracer] attempt ${attempt}: timed out`);
      continue;
    }
    const steps = parseStepEvents(run.stdout);
    if (steps.length === 0) {
      lastError = run.stderr ? `Program errored: ${run.stderr.slice(0, 400)}` : 'Program printed no @@STEP lines.';
      if (process.env.TRACE_DEBUG) console.error(`[tracer] attempt ${attempt}: ${lastError}\n--program--\n${program}\n--stdout--\n${run.stdout?.slice(0, 300)}`);
      continue;
    }

    const trace = { language: lang, code, views, steps };
    try {
      validateExecutionTrace(trace);
    } catch (error) {
      lastError = `Trace failed contract validation: ${error.message}`;
      if (process.env.TRACE_DEBUG) console.error(`[tracer] attempt ${attempt}: ${lastError}\n--steps--\n${JSON.stringify(steps).slice(0, 500)}\n--views--\n${JSON.stringify(views)}`);
      continue;
    }
    return { trace, usage, fixes: attempt };
  }

  return null; // honest: no real, valid trace — the caller falls back to a simpler visual, never a fake one
}
