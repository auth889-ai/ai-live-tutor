// RECORDING STAGE of the divide-&-conquer tool. Sorting and D&C need what no other tracker
// records: the RECURSION SHAPE (call/return events of the recursive function, with each
// call's segment bounds) interleaved with ARRAY SNAPSHOTS per executed line (research:
// USFCA's ComparisonSort keeps a focus band per call; in-place mutation forces a defensive
// copy at every captured event). One harness records all three event kinds:
//
//   {type:'call',   id, parent, line, lo, hi}   — the recursive fn was entered on a segment
//   {type:'return', id, line}                   — that segment's call finished
//   {type:'line',   line, array, locals}        — a real line ran; array = defensive copy
//
// The model declares only: the recursive function's NAME, the array parameter's NAME, and the
// lo/hi bound parameter NAMES. The algorithm must sort IN PLACE on that one array.

export const DIVIDE_TRACKER_PY = `
import json, sys

MAX_EVENTS = 300
_events = []
_stack = []
_counter = [0]

def _copyarr(v):
    if not isinstance(v, list):
        return None
    out = []
    for x in v[:60]:
        out.append(x if x is None or isinstance(x, (int, float, str, bool)) else repr(x)[:24])
    return out

def _scalars(lv):
    out = {}
    for k, v in lv.items():
        if k.startswith('_') or k == ARRAY_VAR:
            continue
        if isinstance(v, (int, float, str, bool)):
            out[k] = v
    return out

def _emit(e):
    if len(_events) >= MAX_EVENTS:
        if not _events or _events[-1].get('truncated') is not True:
            _events.append({'truncated': True})
        sys.settrace(None)
        return
    _events.append(e)

def _tracer(frame, event, arg):
    if frame.f_code.co_filename != '<student>':
        return _tracer
    if event == 'call' and frame.f_code.co_name == FN_NAME:
        _counter[0] += 1
        cid = _counter[0]
        parent = _stack[-1] if _stack else None
        _stack.append(cid)
        lv = frame.f_locals
        lo = lv.get(LO_VAR)
        hi = lv.get(HI_VAR)
        _emit({'type': 'call', 'id': cid, 'parent': parent, 'line': frame.f_lineno,
               'lo': lo if isinstance(lo, int) else None,
               'hi': hi if isinstance(hi, int) else None})
    elif event == 'return' and frame.f_code.co_name == FN_NAME:
        cid = _stack.pop() if _stack else None
        _emit({'type': 'return', 'id': cid, 'line': frame.f_lineno})
    elif event == 'line':
        lv = frame.f_locals
        arr = _copyarr(lv.get(ARRAY_VAR))
        if arr is None:
            arr = _copyarr(frame.f_globals.get(ARRAY_VAR))
        _emit({'type': 'line', 'line': frame.f_lineno, 'array': arr, 'locals': _scalars(lv)})
    return _tracer
`.trim();

const IDENT = /^[A-Za-z_]\w*$/;

export function assembleDivideProgram({ code, entry, fn, arrayVar, loVar = 'lo', hiVar = 'hi' }) {
  const call = String(entry ?? '').trim();
  if (!call || /[;\n]/.test(call)) throw new Error('divide-conquer entry must be a single expression like "quick_sort([5,2,9,1], 0, 3)"');
  if (!String(code ?? '').trim()) throw new Error('divide-conquer tool needs the algorithm code');
  for (const [what, v] of [['fn', fn], ['arrayVar', arrayVar], ['loVar', loVar], ['hiVar', hiVar]]) {
    if (!IDENT.test(String(v ?? ''))) throw new Error(`divide-conquer ${what} must be a simple identifier`);
  }
  return [
    `FN_NAME = ${JSON.stringify(String(fn))}`,
    `ARRAY_VAR = ${JSON.stringify(String(arrayVar))}`,
    `LO_VAR = ${JSON.stringify(String(loVar))}`,
    `HI_VAR = ${JSON.stringify(String(hiVar))}`,
    DIVIDE_TRACKER_PY,
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
    "_out = _result if _result is None or isinstance(_result, (int, float, str, bool)) else (_copyarr(_result) if isinstance(_result, list) else repr(_result)[:40])",
    "print('@@DIVIDE ' + json.dumps({'events': _events, 'result': _out}))",
  ].join('\n');
}

export function parseDivideEvents(stdout) {
  for (const line of String(stdout ?? '').split('\n')) {
    const at = line.indexOf('@@DIVIDE ');
    if (at === -1) continue;
    try {
      return JSON.parse(line.slice(at + '@@DIVIDE '.length));
    } catch {
      return null;
    }
  }
  return null;
}
