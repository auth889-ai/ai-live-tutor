// RECORDING STAGE of the dp-table tool. DP was the last family whose dry run depended on the
// model WRITING a correct @@STEP program — the weakest link. This tracker replaces that with
// the same declared-lens discipline as every other engine: the model names ONE variable (the
// dp table — a 2-D list of lists, or a 1-D list treated as a single row), and this harness
// snapshots it FAITHFULLY at every executed line of the student's real code.
//
// Faithful means no silent caps: a table too big to teach (over 24x24) is recorded as an
// explicit {'too_big': true} event, so the compiler can fail loudly and the tracer can retry
// with a smaller example — never a quietly clipped table presented as complete.

export const DP_TRACKER_PY = `
import json, sys

MAX_EVENTS = 300
MAX_DIM = 24
_events = []

def _cell(x):
    if x is None or isinstance(x, (int, str, bool)):
        return x
    if isinstance(x, float):
        return x if x == x and x not in (float('inf'), float('-inf')) else repr(x)
    return repr(x)[:16]

def _table(v):
    if not isinstance(v, list) or len(v) == 0:
        return None
    if all(isinstance(r, list) for r in v):
        if len(v) > MAX_DIM or any(len(r) > MAX_DIM for r in v):
            return 'too_big'
        return [[_cell(x) for x in r] for r in v]
    if len(v) > MAX_DIM:
        return 'too_big'
    return [[_cell(x) for x in v]]

def _scalars(lv):
    out = {}
    for k, v in lv.items():
        if k.startswith('_') or k == DP_VAR:
            continue
        if isinstance(v, (int, float, str, bool)):
            out[k] = v
    return out

def _tracer(frame, event, arg):
    if event == 'line' and frame.f_code.co_filename == '<student>':
        if len(_events) >= MAX_EVENTS:
            if not _events or _events[-1].get('truncated') is not True:
                _events.append({'truncated': True})
            sys.settrace(None)
            return None
        v = frame.f_locals.get(DP_VAR)
        if v is None:
            v = frame.f_globals.get(DP_VAR)
        t = _table(v) if v is not None else None
        if t == 'too_big':
            _events.append({'too_big': True})
            sys.settrace(None)
            return None
        if t is not None:
            _events.append({'line': frame.f_lineno, 'table': t, 'locals': _scalars(frame.f_locals)})
    return _tracer
`.trim();

import { buildTracedProgram, parseTracedEvents } from '../harness/assemble.js';

const IDENT = /^[A-Za-z_]\w*$/;

export function assembleDpProgram({ code, entry, dp = 'dp' }) {
  if (!IDENT.test(String(dp ?? ''))) throw new Error('dp-table dp must be a simple identifier (the table variable)');
  return buildTracedProgram({
    constants: { DP_VAR: String(dp) },
    trackerPy: DP_TRACKER_PY,
    code,
    entry,
    marker: '@@DPTABLE',
    resultLine: '_out = _result if _result is None or isinstance(_result, (int, float, str, bool)) else repr(_result)[:40]',
    entryExample: '"lcs(\'abcde\', \'ace\')"',
  });
}

export function parseDpEvents(stdout) {
  return parseTracedEvents(stdout, '@@DPTABLE');
}
