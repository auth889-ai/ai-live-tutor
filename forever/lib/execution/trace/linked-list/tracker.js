// RECORDING STAGE of the linked-list tool (the recursion tool's tracker.js pattern — one stage
// records a REAL run, later stages compile and narrate). A linked list cannot be captured by
// the generic line tracker: its _safe() flattens node objects to repr strings and loses the one
// thing a pointer diagram needs — OBJECT IDENTITY. This dedicated harness keeps it:
//
//   - every node ever observed gets a stable serial id on first sight (n1, n2, ...) held in a
//     registry with a STRONG reference, so Python cannot recycle id() under us
//     (Python Tutor's unique-id-from-id() idea, hardened per the researched pitfall)
//   - at each executed line it chases the DECLARED pointer roots (head/prev/curr/slow/fast...)
//     through the DECLARED next-attribute, cycle-safe and capped — the chase itself is the
//     cycle detector, so Floyd's algorithm traces instead of hanging
//   - it emits {pointers: name -> nodeId|null, nodes: nodeId -> {value, next}} per line, plus
//     plain scalar locals for the variables panel

import { buildTracedProgram, parseTracedEvents } from '../harness/assemble.js';

export const LIST_TRACKER_PY = `
import json, sys

MAX_EVENTS = 200
MAX_CHAIN = 50
_events = []
_registry = {}
_keep = []
_counter = [0]

def _nid(node):
    k = id(node)
    if k not in _registry:
        _counter[0] += 1
        _registry[k] = 'n' + str(_counter[0])
        _keep.append(node)  # strong ref: id() must never be recycled behind our back
    return _registry[k]

def _is_node(obj):
    return obj is not None and hasattr(obj, NEXT_ATTR)

def _val(node):
    try:
        v = getattr(node, VAL_ATTR, None)
    except Exception:
        v = None
    if v is None or isinstance(v, (int, float, str, bool)):
        return v
    return repr(v)[:24]

def _snap(local_vars):
    pointers = {}
    nodes = {}
    for name in ROOTS:
        if name not in local_vars:
            continue
        obj = local_vars[name]
        pointers[name] = _nid(obj) if _is_node(obj) else None
        seen = set()
        while _is_node(obj) and id(obj) not in seen and len(seen) < MAX_CHAIN:
            seen.add(id(obj))
            nxt = getattr(obj, NEXT_ATTR)
            nodes[_nid(obj)] = {'value': _val(obj), 'next': _nid(nxt) if _is_node(nxt) else None}
            obj = nxt
    return {'pointers': pointers, 'nodes': nodes}

def _scalars(local_vars):
    out = {}
    for k, v in local_vars.items():
        if k.startswith('_') or k in ROOTS:
            continue
        if isinstance(v, (int, float, str, bool)):
            out[k] = v
    return out

def _tracer(frame, event, arg):
    if event == 'line' and frame.f_code.co_filename == '<student>':
        if len(_events) >= MAX_EVENTS:
            _events.append({'truncated': True})
            sys.settrace(None)
            return None
        _events.append({'line': frame.f_lineno, 'state': _snap(frame.f_locals), 'variables': _scalars(frame.f_locals)})
    return _tracer
`.trim();

const IDENT = /^[A-Za-z_]\w*$/;

// Assemble the runnable program via the SHARED harness — this tracker declares only its
// constants, its python source, its marker and its result serialization.
export function assembleListProgram({ code, entry, roots, nextAttr = 'next', valAttr = 'val' }) {
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every((r) => IDENT.test(String(r)))) {
    throw new Error('linked-list tool needs pointer root names (simple identifiers like ["head","prev","curr"])');
  }
  if (!IDENT.test(nextAttr) || !IDENT.test(valAttr)) throw new Error('nextAttr/valAttr must be simple identifiers');
  return buildTracedProgram({
    constants: { ROOTS: roots.map(String), NEXT_ATTR: nextAttr, VAL_ATTR: valAttr },
    trackerPy: LIST_TRACKER_PY,
    code,
    entry,
    marker: '@@LISTWALK',
    resultLine: '_out = _nid(_result) if _is_node(_result) else (_result if _result is None or isinstance(_result, (int, float, str, bool)) else repr(_result)[:40])',
    entryExample: '"reverse(build([1,2,3]))"',
  });
}

export function parseListEvents(stdout) {
  return parseTracedEvents(stdout, '@@LISTWALK');
}
