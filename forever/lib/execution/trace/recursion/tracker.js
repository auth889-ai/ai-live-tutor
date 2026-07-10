// RECORDING STAGE of the recursion tool: instrument the student's UNMODIFIED function, run it
// for real, and capture the call tree. (Studied at source: brpapa/recursion-tree-visualizer's
// lambda — one vertex per call with args/children/memoized, child value = return value.)
// The model never writes any of this machinery.

import { pyLiteral } from '../harness/py-literal.js';
import { assertEntryNamesDefined } from '../harness/assemble.js';

// Python instrumentation template — definitions only; assembleRecursionProgram() adds the
// student's function and the run line.
export const RECURSION_TRACKER_PY = `
import json, sys, math

MAX_CALLS = 60
vertices = {}
_curr_id = 0
_memo = {}
_stack = []

def _safe(v, depth=0):
    # Hybrid serialization (JSON-safe values pass; the rest become readable placeholders) —
    # float('inf')/NaN would otherwise make json.dumps emit INVALID JSON and kill the trace.
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return v if (not isinstance(v, float) or math.isfinite(v)) else repr(v)
    if depth >= 3:
        return repr(v)[:40]
    if isinstance(v, (list, tuple)):
        return [_safe(x, depth + 1) for x in list(v)[:20]]
    if isinstance(v, dict):
        return {str(k): _safe(x, depth + 1) for k, x in list(v.items())[:20]}
    return repr(v)[:40]

def _trace_call(*args):
    global _curr_id
    if _curr_id > MAX_CALLS:
        print('@@CALLTREE ' + json.dumps({'error': 'too many recursive calls', 'maxCalls': MAX_CALLS}))
        sys.exit(0)
    vid = _curr_id
    _curr_id += 1
    vertices[vid] = {'args': _safe(list(args)), 'children': [], 'memoized': False}
    if _stack:
        vertices[_stack[-1]]['children'].append({'id': vid, 'value': None})
    _stack.append(vid)
    key = json.dumps(list(args))
    if MEMOIZE and key in _memo:
        vertices[vid]['memoized'] = True
        value = _memo[key]
    else:
        value = _fn(*args)
        _memo[key] = value
    _stack.pop()
    if _stack:
        for child in vertices[_stack[-1]]['children']:
            if child['id'] == vid:
                child['value'] = _safe(value)
    return value
`.trim();

// Assemble the runnable tracker program around the student's UNMODIFIED function. The trick
// (Python resolves globals at call time): after defining the function, rebind its global name
// to the tracker — every recursive call inside the original body then routes through
// _trace_call() (underscore-prefixed so a student function named "fn" — the reference tool's
// own demo name — can never shadow it), recording the real call tree with zero cooperation
// from the code being traced.
export function assembleRecursionProgram({ code, fnName, args = [], memoize = false }) {
  const name = String(fnName ?? '').trim();
  if (!/^[A-Za-z]\w*$/.test(name)) throw new Error(`recursion fnName must be a python identifier not starting with "_" (got "${fnName}")`);
  if (!Array.isArray(args)) throw new Error('recursion args must be an array of literal argument values');
  if (!String(code ?? '').includes(`def ${name}(`)) throw new Error(`recursion code must define "def ${name}(...)"`);
  // The tracker rebinds the function in MODULE scope (`_fn = name; name = fn`) — a def nested
  // inside a wrapper is invisible there and dies as a confusing NameError at run time. Fail
  // fast pointing at the nested-def recorder, which traces that shape natively.
  if (!new RegExp(`^def ${name}\\(`, 'm').test(String(code ?? ''))) {
    throw new Error(`recursion fnName "${name}" is a NESTED def. Keep the idiomatic shape and ADD "entry": "<one outer call, e.g. maxPathSum(tree)>" with its input built at module level in code — the tracer then records the nested calls natively.`);
  }
  return [
    RECURSION_TRACKER_PY,
    '',
    String(code).trim(),
    '',
    `FN_NAME = ${JSON.stringify(name)}`,
    `ARGS = ${pyLiteral(args)}`,
    `MEMOIZE = ${memoize ? 'True' : 'False'}`,
    `_fn = ${name}`,
    `${name} = _trace_call`,
    'result = _trace_call(*ARGS)',
    "print('@@CALLTREE ' + json.dumps({'fnName': FN_NAME, 'result': _safe(result), 'vertices': vertices}))",
  ].join('\n');
}

// OUTPUT INTEGRITY VALIDATION (the studied repo runs a joi schema over the child process
// stdout before trusting it): the recorded call tree must be exactly the shape the compiler
// expects, with actionable errors naming the offending vertex — a malformed recording fails
// HERE, loudly, not as a confusing crash mid-compilation.
export function validateCallTree(callTree) {
  if (!callTree || typeof callTree !== 'object') throw new Error('call tree must be an object');
  if (callTree.error) return callTree; // honest tracker-side failure, surfaced by the compiler
  const vertices = callTree.vertices;
  if (!vertices || typeof vertices !== 'object' || Array.isArray(vertices)) {
    throw new Error('call tree needs a vertices object');
  }
  for (const [id, v] of Object.entries(vertices)) {
    if (!v || typeof v !== 'object') throw new Error(`call tree vertex ${id} must be an object`);
    if (!Array.isArray(v.args)) throw new Error(`call tree vertex ${id}: args must be an array`);
    if (!Array.isArray(v.children)) throw new Error(`call tree vertex ${id}: children must be an array`);
    for (const c of v.children) {
      if (!c || typeof c !== 'object' || c.id === undefined) throw new Error(`call tree vertex ${id}: each child needs an id`);
      if (vertices[String(c.id)] === undefined) throw new Error(`call tree vertex ${id}: child ${c.id} has no vertex of its own`);
    }
    if (typeof v.memoized !== 'boolean') throw new Error(`call tree vertex ${id}: memoized must be a boolean`);
  }
  return callTree;
}

// Extract the @@CALLTREE payload from a real run's stdout (null if absent/malformed).
export function parseCallTree(stdout) {
  for (const line of String(stdout ?? '').split('\n')) {
    const at = line.indexOf('@@CALLTREE ');
    if (at === -1) continue;
    try {
      return JSON.parse(line.slice(at + '@@CALLTREE '.length));
    } catch {
      return null;
    }
  }
  return null;
}

// NESTED-DEF RECORDER — the idiomatic-LeetCode shape (def gain() INSIDE maxPathSum(), closing
// over a running best) cannot be traced by global rebinding: the inner name never exists at
// module scope, and battery evidence shows the model writes this shape no matter how firmly
// the prompt says to flatten. So trace it natively: sys.settrace sees every 'call'/'return'
// frame regardless of nesting; we record exactly the frames whose code object bears FN_NAME.
// (memoize is not injectable here — closures own their state — so this variant records plain.)
const NESTED_RECURSION_TRACKER_PY = `
import json, sys, math

MAX_CALLS = 60
vertices = {}
_curr = [0]
_stack = []

def _safe(v, depth=0):
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return v if (not isinstance(v, float) or math.isfinite(v)) else repr(v)
    if depth >= 3:
        return repr(v)[:40]
    if isinstance(v, (list, tuple)):
        return [_safe(x, depth + 1) for x in list(v)[:20]]
    if isinstance(v, dict):
        return {str(k): _safe(x, depth + 1) for k, x in list(v.items())[:20]}
    return repr(v)[:40]

def _tr(frame, event, arg):
    if event == 'call' and frame.f_code.co_name == FN_NAME:
        vid = _curr[0]
        _curr[0] += 1
        if vid > MAX_CALLS:
            print('@@CALLTREE ' + json.dumps({'error': 'too many recursive calls', 'maxCalls': MAX_CALLS}))
            sys.exit(0)
        names = frame.f_code.co_varnames[:frame.f_code.co_argcount]
        vertices[vid] = {'args': _safe([frame.f_locals.get(n) for n in names]), 'children': [], 'memoized': False}
        if _stack:
            vertices[_stack[-1]]['children'].append({'id': vid, 'value': None})
        _stack.append(vid)
        return _tr
    if event == 'return' and frame.f_code.co_name == FN_NAME and _stack:
        vid = _stack.pop()
        if _stack:
            for c in vertices[_stack[-1]]['children']:
                if c['id'] == vid:
                    c['value'] = _safe(arg)
    return _tr
`.trim();

// assembleNestedRecursionProgram({ code, entry, fnName }) — code defines everything (including
// the wrapper and its module-level input); entry is ONE call expression; fnName is the nested
// recursive function whose call tree we record.
export function assembleNestedRecursionProgram({ code, entry, fnName }) {
  const name = String(fnName ?? '').trim();
  const call = String(entry ?? '').trim();
  if (!/^[A-Za-z]\w*$/.test(name)) throw new Error(`recursion fnName must be a python identifier not starting with "_" (got "${fnName}")`);
  if (!call || /[;\n]/.test(call)) throw new Error('nested recursion needs "entry": ONE call expression like "maxPathSum(tree)"');
  if (!String(code ?? '').includes(`def ${name}(`)) throw new Error(`recursion code must define "def ${name}(...)"`);
  assertEntryNamesDefined(call, String(code));
  return [
    NESTED_RECURSION_TRACKER_PY,
    '',
    `FN_NAME = ${JSON.stringify(name)}`,
    String(code).trim(),
    '',
    'sys.settrace(_tr)',
    'try:',
    `    result = ${call}`,
    'finally:',
    '    sys.settrace(None)',
    "print('@@CALLTREE ' + json.dumps({'fnName': FN_NAME, 'result': _safe(result), 'vertices': vertices}))",
  ].join('\n');
}
