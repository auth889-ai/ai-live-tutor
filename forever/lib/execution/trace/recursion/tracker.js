// RECORDING STAGE of the recursion tool: instrument the student's UNMODIFIED function, run it
// for real, and capture the call tree. (Studied at source: brpapa/recursion-tree-visualizer's
// lambda — one vertex per call with args/children/memoized, child value = return value.)
// The model never writes any of this machinery.

// Python instrumentation template — definitions only; assembleRecursionProgram() adds the
// student's function and the run line.
export const RECURSION_TRACKER_PY = `
import json, sys

MAX_CALLS = 60
vertices = {}
_curr_id = 0
_memo = {}
_stack = []

def fn(*args):
    global _curr_id
    if _curr_id > MAX_CALLS:
        print('@@CALLTREE ' + json.dumps({'error': 'too many recursive calls', 'maxCalls': MAX_CALLS}))
        sys.exit(0)
    vid = _curr_id
    _curr_id += 1
    vertices[vid] = {'args': list(args), 'children': [], 'memoized': False}
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
                child['value'] = value
    return value
`.trim();

// Assemble the runnable tracker program around the student's UNMODIFIED function. The trick
// (Python resolves globals at call time): after defining the function, rebind its global name
// to the tracker — every recursive call inside the original body then routes through fn(),
// recording the real call tree with zero cooperation from the code being traced.
export function assembleRecursionProgram({ code, fnName, args = [], memoize = false }) {
  const name = String(fnName ?? '').trim();
  if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error(`recursion fnName must be a python identifier (got "${fnName}")`);
  if (!Array.isArray(args)) throw new Error('recursion args must be an array of literal argument values');
  if (!String(code ?? '').includes(`def ${name}(`)) throw new Error(`recursion code must define "def ${name}(...)"`);
  return [
    RECURSION_TRACKER_PY,
    '',
    String(code).trim(),
    '',
    `FN_NAME = ${JSON.stringify(name)}`,
    `ARGS = ${JSON.stringify(args)}`,
    `MEMOIZE = ${memoize ? 'True' : 'False'}`,
    `_fn = ${name}`,
    `${name} = fn`,
    'result = fn(*ARGS)',
    "print('@@CALLTREE ' + json.dumps({'fnName': FN_NAME, 'result': result, 'vertices': vertices}))",
  ].join('\n');
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
