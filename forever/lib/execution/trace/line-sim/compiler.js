// Universal line-level simulator — the GUARANTEED FLOOR for dry runs (Python Tutor principle:
// sys.settrace records every executed line and every variable change of REAL execution).
// Division of labor, same as our other engines: the model supplies only the algorithm code and
// its entry call; THIS machinery instruments, runs, records, and compiles. With this floor a
// dry_run scene can never end up trace-less: the worst case is still a real, synced,
// line-by-line animation with live variables — never an imagined frame, never text-only.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

// Our instrumentation harness (definitions only; assembleLineProgram adds the student code +
// entry call). Records one @@LINE event per executed line of the STUDENT'S code with the local
// variables that are JSON-safe, capped so a hot loop cannot flood stdout.
export const LINE_TRACKER_PY = `
import json, sys

MAX_EVENTS = 200
_events = []

def _safe(v):
    if isinstance(v, (int, float, str, bool)) or v is None:
        return v
    if isinstance(v, (list, tuple)):
        return [_safe(x) for x in list(v)[:20]]
    if isinstance(v, dict):
        return {str(k): _safe(x) for k, x in list(v.items())[:20]}
    if isinstance(v, set):
        return sorted([_safe(x) for x in list(v)[:20]], key=str)
    return repr(v)[:40]

def _tracer(frame, event, arg):
    if event == 'line' and frame.f_code.co_filename == '<student>':
        if len(_events) >= MAX_EVENTS:
            sys.settrace(None)
            return None
        _events.append({
            'line': frame.f_lineno,
            'fn': frame.f_code.co_name,
            'locals': {k: _safe(v) for k, v in frame.f_locals.items() if not k.startswith('_')},
        })
    return _tracer
`.trim();

// Assemble the runnable program: compile the student's code under the '<student>' filename so
// the tracer keeps only ITS lines (harness lines never leak into the animation).
export function assembleLineProgram({ code, entry }) {
  const call = String(entry ?? '').trim();
  if (!call || /[;\n]/.test(call)) throw new Error('line-sim entry must be a single expression like "binary_search([1,3,5], 5)"');
  if (!String(code ?? '').trim()) throw new Error('line-sim needs the algorithm code');
  return [
    LINE_TRACKER_PY,
    '',
    `_src = ${JSON.stringify(String(code))}`,
    `_compiled = compile(_src, '<student>', 'exec')`,
    '_ns = {}',
    'exec(_compiled, _ns)',
    'sys.settrace(_tracer)',
    'try:',
    `    _result = eval(${JSON.stringify(call)}, _ns)`,
    'finally:',
    '    sys.settrace(None)',
    "print('@@LINESIM ' + json.dumps({'events': _events, 'result': _safe(_result)}))",
  ].join('\n');
}

export function parseLineEvents(stdout) {
  for (const line of String(stdout ?? '').split('\n')) {
    const at = line.indexOf('@@LINESIM ');
    if (at === -1) continue;
    try {
      return JSON.parse(line.slice(at + '@@LINESIM '.length));
    } catch {
      return null;
    }
  }
  return null;
}

// Compile recorded line events into a validated ExecutionTrace: one step per executed line,
// narrated from what ACTUALLY changed (diff of locals) — deterministic teacher sentences.
// Consecutive-duplicate states collapse so tight loops read as logical steps.
export function compileLineTrace({ events, result, code, language = 'python' } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('line simulator recorded no events');
  const lineCount = String(code ?? '').split('\n').length;
  const codeLines = String(code ?? '').split('\n');

  const steps = [];
  let prevLocals = {};
  for (const ev of events) {
    const line = Number(ev.line);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    const locals = ev.locals && typeof ev.locals === 'object' ? ev.locals : {};
    const changed = Object.entries(locals).filter(([k, v]) => JSON.stringify(prevLocals[k]) !== JSON.stringify(v));
    const src = (codeLines[line - 1] ?? '').trim();

    let explanation;
    if (changed.length > 0) {
      const what = changed.map(([k, v]) => `${k} ${k in prevLocals ? 'becomes' : 'starts as'} ${JSON.stringify(v)}`).join(', ');
      explanation = `Line ${line} runs: \`${src}\`. As a result ${what} — watch the variables panel update at this exact moment. The state you see is real: it was recorded from an actual run of this code, not predicted.`;
    } else {
      explanation = `Line ${line} runs: \`${src}\`. No variable changes here — this line is deciding WHERE the execution goes next, and the line highlight shows you the path it chose.`;
    }
    // Collapse consecutive duplicates (same line, same state) so hot loops stay readable.
    const prev = steps[steps.length - 1];
    if (prev && prev.line === line && JSON.stringify(prev.variables) === JSON.stringify(locals)) continue;
    steps.push({ line, explanation, variables: locals });
    prevLocals = locals;
  }
  if (steps.length === 0) throw new Error('line simulator produced no in-range steps');

  steps.push({
    line: steps[steps.length - 1].line,
    explanation: `Execution finishes and the call returns ${JSON.stringify(result)}. Scroll back through the steps and notice how every value on screen came from the real run — that is the whole story of this algorithm, line by line.`,
    variables: steps[steps.length - 1].variables,
  });

  return validateExecutionTrace({ language, code: String(code ?? ''), views: {}, steps }, 'line-sim trace');
}
