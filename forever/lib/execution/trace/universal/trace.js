// THE UNIVERSAL ORCHESTRATOR — the one entry point of the record-once/detect-later engine:
// run the student's real code ONCE under the universal recorder, detect the teaching lenses
// from the recording, compile through the best one; when no lens claims the run, compile the
// LINE-TABLE FLOOR from lines + variables — which exist in EVERY recording, so a dry run can
// never come back empty. Correctness is architectural (everything on screen was recorded),
// coverage is total (the floor), and quality is whatever the best matching lens delivers.

import { compileLineTrace } from '../line-sim/compiler.js';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from './recorder.js';
import { detectLenses } from './detect.js';

// traceUniversal({ code, entry, exec, language }) -> { trace, lens, confidence, recording, attempts }
// exec: async ({language, source}) -> {stdout, stderr, timedOut} (run-code.js shape, injected).
export async function traceUniversal({ code, entry, exec, language = 'python' } = {}) {
  if (typeof exec !== 'function') throw new Error('traceUniversal needs an exec function (run-code shape)');
  const program = assembleUniversalProgram({ code, entry });
  const run = await exec({ language: 'python', source: program });
  if (run.timedOut) throw new Error('universal recording timed out (likely an infinite loop)');
  const payload = parseUniversalEvents(run.stdout);
  if (!payload) {
    throw new Error(run.stderr ? `recording errored: ${run.stderr.slice(-400).trim()}` : 'recording printed no @@UNIREC line');
  }
  const recording = validateUniversalRecording(payload);

  // Best lens first; a lens that detects but fails to compile is LOGGED and the next one takes
  // over — the engine degrades one teaching notch at a time, never to nothing.
  const attempts = [];
  for (const plan of detectLenses(recording, { code })) {
    try {
      const trace = plan.compile({ recording, plan, code, entry, language });
      // Independent value verification: the recording judges every claimed before/after;
      // unprovable events are stripped and counted — never rendered.
      const { verifyEventValues } = await import('./verify-events.js');
      const { stripped } = verifyEventValues(recording, trace);
      if (stripped > 0) console.error(`[verify-events] stripped ${stripped} unprovable event(s) from ${plan.lens}`);
      return { trace, lens: plan.lens, confidence: plan.confidence, recording, attempts };
    } catch (error) {
      attempts.push(`${plan.lens}: ${error.message}`);
    }
  }

  // THE FLOOR — the trace/dry-run.png step table: every executed line with its live variables,
  // conditions narrated as check -> verdict, the hero list drawn as cells. Object references
  // are resolved to readable labels (ListNode(3)) so the table never shows a memory id.
  let heap = {};
  const events = [];
  for (const e of recording.events) {
    if (e.truncated === true) { events.push({ truncated: true }); continue; }
    if (e.ev !== 'line') continue;
    if (e.heap) heap = e.heap;
    events.push({ line: e.line, fn: e.fn, locals: resolveRefs(e.locals, heap) });
  }
  const trace = compileLineTrace({ events, result: resolveRefs(recording.result, heap), code, entry, language: 'python' });
  return { trace, lens: 'line-floor', confidence: 0.5, recording, attempts };
}

// Deep-replace {'@ref': id} with a readable node label — the floor speaks values, never addresses.
function resolveRefs(v, heap) {
  if (Array.isArray(v)) return v.map((x) => resolveRefs(x, heap));
  if (v && typeof v === 'object') {
    if (typeof v['@ref'] === 'string') {
      const rec = heap[v['@ref']];
      if (!rec) return 'object';
      const value = rec.val ?? rec.value ?? rec.data ?? rec.key ?? rec.name;
      return value === undefined ? rec.type : `${rec.type}(${JSON.stringify(value)})`;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x, heap)]));
  }
  return v;
}
