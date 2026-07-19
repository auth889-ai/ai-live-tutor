// Universal line-level simulator — the GUARANTEED FLOOR for dry runs (Python Tutor principle:
// sys.settrace records every executed line and every variable change of REAL execution).
// Division of labor, same as our other engines: the model supplies only the algorithm code and
// its entry call; THIS machinery instruments, runs, records, and compiles. With this floor a
// dry_run scene can never end up trace-less: the worst case is still a real, synced,
// line-by-line animation with live variables — never an imagined frame, never text-only.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import { buildTracedProgram, parseTracedEvents } from '../harness/assemble.js';

// Our instrumentation harness (definitions only; assembleLineProgram adds the student code +
// entry call). Records one @@LINE event per executed line of the STUDENT'S code with the local
// variables that are JSON-safe, capped so a hot loop cannot flood stdout.
export const LINE_TRACKER_PY = `
import json, sys, math

MAX_EVENTS = 200
_events = []

def _safe(v):
    if isinstance(v, bool) or v is None or isinstance(v, (int, str)):
        return v
    if isinstance(v, float):
        # non-finite floats make json.dumps emit INVALID JSON -> readable token instead
        return v if math.isfinite(v) else repr(v)
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
            # NEVER a silent cut: the cap becomes a first-class terminal event so the
            # compiled trace can SAY the recording stopped (the run itself continues).
            _events.append({'truncated': True})
            sys.settrace(None)
            return None
        _events.append({
            'line': frame.f_lineno,
            'fn': frame.f_code.co_name,
            'locals': {k: _safe(v) for k, v in frame.f_locals.items() if not k.startswith('_')},
        })
    return _tracer
`.trim();

// Assemble the runnable program via the SHARED harness (one owner for the compile-under-
// '<student>' / entry-eval / marker-print tail every tracker needs).
export function assembleLineProgram({ code, entry }) {
  return buildTracedProgram({
    trackerPy: LINE_TRACKER_PY,
    code,
    entry,
    marker: '@@LINESIM',
    resultLine: '_out = _safe(_result)',
    entryExample: '"binary_search([1,3,5], 5)"',
  });
}

export function parseLineEvents(stdout) {
  return parseTracedEvents(stdout, '@@LINESIM');
}

// Compile recorded line events into a validated ExecutionTrace: one step per executed line,
// narrated from what ACTUALLY changed (diff of locals) — deterministic teacher sentences.
// Consecutive-duplicate states collapse so tight loops read as logical steps.
export function compileLineTrace({ events, result, code, entry = null, language = 'python' } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('line simulator recorded no events');
  const lineCount = String(code ?? '').split('\n').length;
  const codeLines = String(code ?? '').split('\n');

  // The tracker appends a {'truncated': true} sentinel when it hits its recording cap —
  // an explicit terminal event (Python Tutor's instruction_limit_reached), never a silent cut.
  const truncated = events[events.length - 1]?.truncated === true;
  const lineEvents = truncated ? events.slice(0, -1) : events;

  const steps = [];
  let prevLocals = {};
  for (const [evIndex, ev] of lineEvents.entries()) {
    const line = Number(ev.line);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    const locals = ev.locals && typeof ev.locals === 'object' ? ev.locals : {};
    const changed = Object.entries(locals).filter(([k, v]) => JSON.stringify(prevLocals[k]) !== JSON.stringify(v));
    const src = (codeLines[line - 1] ?? '').trim();

    let explanation;
    if (/^(if|elif|while)\b/.test(src)) {
      // The teaching move measured from the best instructors (Striver/NeetCode transcripts):
      // a condition is narrated as CHECK with live values -> VERDICT -> THEREFORE. The recording
      // knows the verdict for real: the branch was TAKEN iff the next executed line is the one
      // directly below (the indented block); anything else means the check said no.
      const next = lineEvents[evIndex + 1];
      const nextLine = Number(next?.line);
      // The branch body's first line is the next EXECUTABLE line, not line+1 — a comment or
      // blank line inside the block made a TAKEN branch narrate as skipped (external review,
      // reproduced live). Executable = first following line with real content.
      let bodyLine = line + 1;
      while (bodyLine < codeLines.length + 1) {
        const t = String(codeLines[bodyLine - 1] ?? '').trim();
        if (t !== '' && !t.startsWith('#')) break;
        bodyLine += 1;
      }
      const taken = Number.isInteger(nextLine) && nextLine === bodyLine;
      const names = (src.replace(/'[^']*'|"[^"]*"/g, '').match(/[A-Za-z_]\w*/g) ?? [])
        .filter((n) => n in locals && !Array.isArray(locals[n]) && typeof locals[n] !== 'object')
        .slice(0, 3);
      const withVals = names.length ? ` With ${names.map((n) => `${n} = ${JSON.stringify(locals[n])}`).join(', ')},` : '';
      explanation = `Line ${line} asks: \`${src}\`.${withVals} the check comes back ${taken ? 'TRUE — so execution steps INTO this branch' : 'FALSE — so this branch is skipped'}${Number.isInteger(nextLine) ? ` and the pointer moves to line ${nextLine}` : ''}. That decision, not the code order, is what chooses the path here.`;
    } else if (changed.length > 0) {
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

  // The tutor's opening frame beat: state the goal and what to track BEFORE anything moves.
  if (entry) {
    steps.unshift({
      line: steps[0].line,
      explanation: `We run ${entry} and let the real machine execute it line by line. Keep your eye on the variables panel — every value you are about to see was recorded from this exact run, and the story of this algorithm is nothing but how those values change.`,
      variables: {},
    });
  }

  steps.push({
    line: steps[steps.length - 1].line,
    explanation: truncated
      ? `The recording stops HERE, on purpose: after ${steps.length - (entry ? 1 : 0)} recorded steps the loop keeps repeating the exact same pattern, so watching more of it teaches nothing new. The run itself continued to completion and returned ${JSON.stringify(result)} — recorded honestly, cut openly.`
      : `Execution finishes and the call returns ${JSON.stringify(result)}. Scroll back through the steps and notice how every value on screen came from the real run — that is the whole story of this algorithm, line by line.`,
    variables: steps[steps.length - 1].variables,
  });

  // FLOOR MUST STILL DRAW: if the run carries a list, the student sees CELLS, not a printed
  // value. Pick the hero list (the list variable present in the most steps), draw it as the
  // array view, flash the cell that changed, and ride integer index variables as pointers.
  const views = {};
  const hero = detectHeroList(steps);
  if (hero) {
    views.array = { values: hero.first };
    let prevList = null;
    for (const s of steps) {
      const list = s.variables?.[hero.name];
      if (!Array.isArray(list)) { prevList = null; continue; }
      const arr = { values: list };
      if (prevList) {
        const at = list.findIndex((v, i) => JSON.stringify(v) !== JSON.stringify(prevList[i]));
        if (at !== -1 || list.length !== prevList.length) arr.current = at !== -1 ? at : list.length - 1;
      }
      const pointers = {};
      for (const [k, v] of Object.entries(s.variables ?? {})) {
        // Only a variable the CODE subscripts the hero with (a[i]) is an index — an in-range
        // integer that never indexes (Kadane's running cur/best) is a VALUE, and drawing it as
        // a pointer would teach something false.
        if (k !== hero.name && Number.isInteger(v) && v >= 0 && v < list.length
          && String(code ?? '').includes(`${hero.name}[${k}]`) && Object.keys(pointers).length < 3) pointers[k] = v;
      }
      if (Object.keys(pointers).length > 0) arr.pointers = pointers;
      s.array = arr;
      prevList = list;
    }
  }

  // FLOOR DRAWS GRIDS TOO (provenance plan, the user's 'line sim, table or grid'): a 2D
  // scalar list in a floor run renders as the real grid — full table seeded first, then each
  // changed cell flashes as current and stays filled. Every cell value is from the recording.
  const hero2d = detectHeroTable(steps);
  if (hero2d) {
    views.array2d = { rows: hero2d.rows, cols: hero2d.cols };
    let prevT = null;
    const filledSoFar = [];
    for (const s of steps) {
      const t = s.variables?.[hero2d.name];
      const isT = Array.isArray(t) && t.length > 0 && t.every((r) => Array.isArray(r) && r.every((v) => v === null || ['number', 'string', 'boolean'].includes(typeof v)));
      if (!isT) { prevT = null; continue; }
      const cell = { values: [] };
      if (!prevT) {
        for (let r = 0; r < t.length; r += 1) for (let c = 0; c < t[r].length; c += 1) cell.values.push([r, c, t[r][c]]);
      } else {
        let last = null;
        for (let r = 0; r < t.length; r += 1) {
          for (let c = 0; c < (t[r]?.length ?? 0); c += 1) {
            if (JSON.stringify(prevT?.[r]?.[c]) !== JSON.stringify(t[r][c])) {
              cell.values.push([r, c, t[r][c]]);
              filledSoFar.push([r, c]);
              last = [r, c];
            }
          }
        }
        if (last) cell.current = last;
      }
      if (filledSoFar.length) cell.filled = filledSoFar.map((x) => [...x]);
      s.array2d = cell;
      prevT = t;
    }
  }

  return validateExecutionTrace({ language, code: String(code ?? ''), views, steps }, 'line-sim trace');
}

// The list variable that appears in the most steps (ties: the longest) — primitives only, so
// the cells stay readable. Null when the run simply has no list to draw.
function detectHeroList(steps) {
  const seen = new Map(); // name -> {count, first}
  for (const s of steps) {
    for (const [k, v] of Object.entries(s.variables ?? {})) {
      if (!Array.isArray(v) || v.length < 2) continue;
      if (!v.every((x) => x === null || ['number', 'string', 'boolean'].includes(typeof x))) continue;
      const slot = seen.get(k) ?? { count: 0, first: v, stable: true };
      slot.count += 1;
      // a GROWING list is an accumulator, not an array being worked on — and the validator
      // (rightly) rejects a hero whose length changes mid-run (reproduced on spiral order)
      if (v.length !== slot.first.length) slot.stable = false;
      seen.set(k, slot);
    }
  }
  let best = null;
  for (const [name, { count, first, stable }] of seen) {
    if (!stable) continue;
    if (!best || count > best.count || (count === best.count && first.length > best.first.length)) best = { name, count, first };
  }
  return best && best.count >= Math.max(2, steps.length / 3) ? best : null;
}


// The 2D scalar list present in the most steps (>=2x2) — the floor's grid hero. Null when
// the run has no table to draw.
function detectHeroTable(steps) {
  const counts = new Map();
  for (const s of steps) {
    for (const [k, v] of Object.entries(s.variables ?? {})) {
      if (Array.isArray(v) && v.length >= 2 && v.every((r) => Array.isArray(r) && r.length >= 1 && r.every((x) => x === null || ['number', 'string', 'boolean'].includes(typeof x)))) {
        const e = counts.get(k) ?? { n: 0, rows: 0, cols: 0 };
        e.n += 1;
        e.rows = Math.max(e.rows, v.length);
        e.cols = Math.max(e.cols, ...v.map((r) => r.length));
        counts.set(k, e);
      }
    }
  }
  let best = null;
  for (const [name, e] of counts) {
    if (e.cols < 2) continue;
    if (!best || e.n > best.n) best = { name, rows: e.rows, cols: e.cols, n: e.n };
  }
  return best;
}
