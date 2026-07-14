// Execution Tracer agent — CLASSIFIER + DISPATCHER ONLY (no god-file: each mode's prompt and
// engine wiring lives in its own file under tracer-modes/<family>/, and every engine is its own
// staged folder under lib/execution/trace/). Following ALGOGEN (decouple execution from
// rendering): the LLM only picks a mode and supplies the problem; the mode runs the REAL code
// and compiles a validated ExecutionTrace. Honest failure (null) if no real, contract-valid,
// quality-gated trace can be produced — never a fake animation.
//
// NO DOWNGRADE ON RETRY (user's standing order): a failed attempt fixes ITS error in the SAME
// mode or moves to a RICHER representation — never a weaker one. Every mode's output passes the
// same dryRunQualityIssue() gate.

import { runAgentChain } from '../../../qwen/client.js';
import { runCode } from '../../../execution/run-code.js';
import { TRACER_MODES } from './tracer-modes/index.js';

const RUNNABLE_LANGUAGES = ['python', 'javascript'];

// The system prompt = the JSON envelope + every mode's own prompt section, in registry order.
function tracerSystem(lang) {
  const header = `You are the Execution Tracer of an AI tutor. You make an algorithm's dry-run VISIBLE by running it
for real and emitting its state at each step. Output ONLY JSON with FOUR fields:
{
  "language": "${lang}",
  "code": "<the CLEAN algorithm, exactly as shown to the student, 1 statement per line>",
  "views": { "array": {"values":[...]}  OR  "graph": {"nodes":[{"id":"1","label":"8"}],"edges":[{"from":"1","to":"2"}],"directed":true}
             (for BINARY trees: every edge also carries "side":"left" or "side":"right", children listed left-then-right)
             OR "array2d": {"rows":5,"cols":5,"rowLabels":["","A","B","C","D"],"colLabels":["","A","C","D","G"]} },
  "program": "<a runnable ${lang} program that RUNS 'code' on ONE concrete example and prints the trace>"
}`;
  const sections = TRACER_MODES.map((m) => (typeof m.prompt === 'function' ? m.prompt(lang) : m.prompt));
  return [header, ...sections].join('\n\n');
}

// Runs the tracker for real and compiles a validated ExecutionTrace, or null on honest failure.
export async function traceExecution({ directive, sourceText = '', language = 'python', maxFixes = 3, deps = {} } = {}) {
  const call = deps.runAgentChain ?? runAgentChain;
  const exec = deps.runCode ?? runCode;
  const lang = RUNNABLE_LANGUAGES.includes(language) ? language : 'python';

  let lastError = '';
  let usage = null;
  for (let attempt = 0; attempt <= maxFixes; attempt += 1) {
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

    const ctx = { json, code, program, views, lang, exec };
    const mode = TRACER_MODES.find((m) => m.canHandle(ctx));
    if (!mode) {
      // Battery-measured: a bare "missing code or program" burned 3 retries on the same
      // mistake — name exactly what a valid output contains so the next attempt can comply.
      lastError = `No tracer mode matched the output. Emit "code" (the clean algorithm) AND exactly one mode key: ${TRACER_MODES.map((m) => m.key).join(', ')} — or a runnable "program" that prints @@STEP lines via json.dumps (never hand-built strings). Fields present were: ${Object.keys(json).join(', ') || 'none'}.`;
      logAttempt(attempt, lastError);
      continue;
    }
    // The quality gate is a closure so a mode (line-sim's auto-upgrade) can also apply it to an
    // intermediate candidate. Last attempt ships ungated — every earlier failure logged loudly.
    const gate = (trace) => {
      if (attempt >= maxFixes) return;
      const issue = dryRunQualityIssue({ steps: trace.steps, directive, code });
      if (issue) throw new Error(`quality gate: ${issue}`);
    };
    try {
      const trace = await mode.run({ ...ctx, gate });
      gate(trace);
      return { trace, usage, fixes: attempt };
    } catch (error) {
      lastError = `${mode.label} failed: ${error.message}`;
      logAttempt(attempt, lastError);
      continue;
    }
  }

  // Honest failure — but LOUD: a silently-degraded dry run is how quality rots.
  console.error(`[tracer] GAVE UP after ${maxFixes + 1} attempts: ${String(lastError).slice(0, 300)}`);
  return null;
}

// THE ELITE-QUALITY GATE — one bar for EVERY mode. A trace that merely validates is not
// automatically a lesson: pointers must ride the structure at every stateful step, a
// stack/queue algorithm must SHOW its collection, and the words must teach — not caption.
export function dryRunQualityIssue({ steps, directive, code }) {
  const stateful = steps.filter((s) => s.array || s.graph);
  const withPointers = stateful.filter((s) => s.array?.pointers || s.graph?.pointers);
  if (stateful.length > 0 && withPointers.length < stateful.length) {
    return `Only ${withPointers.length}/${stateful.length} steps carry "pointers" — EVERY array/graph step must include its pointer positions (e.g. {"low":0,"mid":3,"high":6}) so they visibly move on the structure.`;
  }
  const algoText = `${directive}\n${code}`.toLowerCase();
  const missingCollection = ['queue', 'stack'].find(
    (kind) => new RegExp(`\\b${kind}\\b`).test(algoText) && !steps.some((s) => Array.isArray(s[kind])),
  );
  if (missingCollection) {
    return `The algorithm uses a ${missingCollection} but NO step carries "${missingCollection}" — every step must include the live ${missingCollection} contents (e.g. "${missingCollection}": ["2","3"]; use [] when empty) so the student watches it grow and shrink.`;
  }
  const thin = steps.filter((s) => String(s.explanation ?? '').trim().length < 50);
  if (thin.length > Math.floor(steps.length / 2)) {
    return `${thin.length}/${steps.length} explanations are one-line stubs — every step's "explanation" must be 2-3 full sentences in a human tutor voice: the actual values involved, the decision taken, and why it matters for the next step.`;
  }
  return null;
}

// Every failed attempt is visible in production logs (concise); TRACE_DEBUG adds the dumps.
function logAttempt(attempt, message) {
  console.error(`[tracer] attempt ${attempt} failed: ${String(message).slice(0, 220)}`);
}
