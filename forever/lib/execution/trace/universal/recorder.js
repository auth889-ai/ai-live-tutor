// UNIVERSAL RECORDER — piece #1 of the record-once/detect-later dry-run engine. ONE settrace
// pass over ONE real run captures everything every dedicated tracker records separately today:
// every executed line with its locals (line-sim), every call/return with args and value
// (recursion), and the live object graph reachable from locals — .next/.left/.right/neighbors
// links with stable identity (structure/linked-list). Detectors then choose the teaching lens
// from this recording AFTER the fact; nothing here depends on knowing the algorithm's family.
//
// Design rules carried over from the proven trackers:
//   - the model never writes any of this machinery (division of labor, same as every engine)
//   - hybrid serialization: JSON-safe values pass, non-finite floats become readable tokens
//   - caps are FIRST-CLASS events ({'truncated': True}), never silent cuts
//   - heap snapshots are recorded only when they CHANGE — hot loops stay small

import { buildTracedProgram, parseTracedEvents } from '../harness/assemble.js';

export const UNIVERSAL_TRACKER_PY = `
import json, sys, math

MAX_EVENTS = 1200
MAX_NODES = 40
_events = []
_depth = [0]
_last_heap = [None]

_LINK_ATTRS = ('next', 'prev', 'left', 'right', 'child', 'random', 'neighbors', 'children')
_VALUE_ATTRS = ('val', 'value', 'data', 'key', 'name')

def _is_node(v):
    # A "node" is a student-defined object that links onward (ListNode, TreeNode, graph Node) —
    # or a bare value-carrier; both draw as boxes, and identity (id) is what makes arrows real.
    if not hasattr(v, '__dict__'):
        return False
    return any(a in v.__dict__ for a in _LINK_ATTRS) or any(a in v.__dict__ for a in _VALUE_ATTRS)

def _safe(v, depth=0, cut=None):
    # cut: a shared flag list — appended to whenever ANY collection is capped, so the caller
    # can mark the variable as truncated (external review: silent 30-item cuts meant "every
    # value copied exactly" was not fully true; now truncation is first-class per variable).
    if isinstance(v, bool) or v is None or isinstance(v, (int, str)):
        return v
    if isinstance(v, float):
        # non-finite floats make json.dumps emit INVALID JSON -> readable token instead
        return v if math.isfinite(v) else repr(v)
    if depth >= 4:
        if cut is not None:
            cut.append(True)
        return repr(v)[:40]
    if _is_node(v):
        return {'@ref': str(id(v))}
    if v.__class__.__name__ == 'deque' or isinstance(v, (list, tuple)):
        if cut is not None and len(v) > 30:
            cut.append(True)
        return [_safe(x, depth + 1, cut) for x in list(v)[:30]]
    if isinstance(v, dict):
        if cut is not None and len(v) > 30:
            cut.append(True)
        return {str(k): _safe(x, depth + 1, cut) for k, x in list(v.items())[:30]}
    if isinstance(v, set):
        if cut is not None and len(v) > 30:
            cut.append(True)
        return sorted([_safe(x, depth + 1, cut) for x in list(v)[:30]], key=str)
    return repr(v)[:40]

def _locs(f_locals):
    # Serialize a frame's locals; returns (locals_dict, cut_names) — cut_names lists every
    # variable whose recorded value is INCOMPLETE, so downstream layers can refuse to build
    # structure from a partial recording instead of trusting a 30-item prefix as the whole.
    out = {}
    cut_names = []
    for k, v in f_locals.items():
        if k.startswith('_'):
            continue
        flag = []
        out[k] = _safe(v, 0, flag)
        if flag:
            cut_names.append(k)
    return out, cut_names

def _walk_heap(locs):
    # Bounded BFS over node objects reachable from the frame's locals: one record per object,
    # keyed by str(id()) so arrows (next/left/right/neighbors) survive as REAL identities.
    objs = {}
    queue = []
    def _seed(v, depth=0):
        if _is_node(v):
            queue.append(v)
        elif depth < 2 and isinstance(v, (list, tuple)):
            for x in list(v)[:30]:
                _seed(x, depth + 1)
        elif depth < 2 and isinstance(v, dict):
            for x in list(v.values())[:30]:
                _seed(x, depth + 1)
    for v in locs.values():
        _seed(v)
    while queue and len(objs) < MAX_NODES:
        o = queue.pop(0)
        oid = str(id(o))
        if oid in objs:
            continue
        rec = {'type': type(o).__name__}
        for a in _VALUE_ATTRS:
            p = o.__dict__.get(a)
            if isinstance(p, (bool, int, float, str)):
                rec[a] = _safe(p)
                break
        for a in _LINK_ATTRS:
            p = o.__dict__.get(a)
            if p is None:
                continue
            if _is_node(p):
                rec[a] = str(id(p))
                queue.append(p)
            elif isinstance(p, (list, tuple)):
                ids = []
                for x in list(p)[:20]:
                    if _is_node(x):
                        ids.append(str(id(x)))
                        queue.append(x)
                if ids:
                    rec[a] = ids
        objs[oid] = rec
    return objs

def _push(ev):
    if len(_events) >= MAX_EVENTS:
        # NEVER a silent cut: the cap becomes a first-class terminal event so the compiled
        # trace can SAY the recording stopped (the run itself continues to completion).
        _events.append({'truncated': True})
        sys.settrace(None)
        return False
    _events.append(ev)
    return True

def _tracer(frame, event, arg):
    if frame.f_code.co_filename != '<student>' or frame.f_code.co_name.startswith('<'):
        return _tracer
    if _events and _events[-1].get('truncated'):
        return None
    if event == 'call':
        names = frame.f_code.co_varnames[:frame.f_code.co_argcount]
        _depth[0] += 1
        _push({'ev': 'call', 'fn': frame.f_code.co_name, 'line': frame.f_lineno,
               'depth': _depth[0], 'args': {n: _safe(frame.f_locals.get(n)) for n in names}})
    elif event == 'line':
        loc, cut = _locs(frame.f_locals)
        ev = {'ev': 'line', 'line': frame.f_lineno, 'fn': frame.f_code.co_name,
              'depth': _depth[0], 'locals': loc}
        if cut:
            ev['cut'] = cut
        heap = _walk_heap(frame.f_locals)
        if heap:
            blob = json.dumps(heap, sort_keys=True)
            if blob != _last_heap[0]:
                ev['heap'] = heap
                _last_heap[0] = blob
        _push(ev)
    elif event == 'exception':
        # First-class exception event (B3): without it a frame unwound by an exception is
        # indistinguishable from a normal return (CPython fires 'return' on unwind too) —
        # the CallFrame panel could never show "threw".
        try:
            _push({'ev': 'exception', 'fn': frame.f_code.co_name, 'line': frame.f_lineno,
                   'depth': _depth[0], 'type': arg[0].__name__, 'message': str(arg[1])[:80]})
        except Exception:
            pass
    elif event == 'return':
        # locals AT RETURN are the frame's FINAL state — a mutation on a frame's last line
        # (arr[lo:hi] = tmp in merge sort) is visible nowhere else: line events fire BEFORE
        # each line runs, and after the last line there is no next event in that frame.
        ret_loc, ret_cut = _locs(frame.f_locals)
        ret_ev = {'ev': 'return', 'fn': frame.f_code.co_name, 'line': frame.f_lineno,
                  'depth': _depth[0], 'value': _safe(arg), 'locals': ret_loc}
        if ret_cut:
            ret_ev['cut'] = ret_cut
        _push(ret_ev)
        _depth[0] -= 1
    return _tracer
`.trim();

// Assemble the runnable program via the SHARED harness (one owner for the compile-under-
// '<student>' / entry-eval / marker-print tail every tracker needs).
export function assembleUniversalProgram({ code, entry }) {
  return buildTracedProgram({
    trackerPy: UNIVERSAL_TRACKER_PY,
    code,
    entry,
    marker: '@@UNIREC',
    resultLine: '_out = _safe(_result)',
    entryExample: '"orangesRotting([[2,1,1],[1,1,0],[0,1,1]])"',
  });
}

export function parseUniversalEvents(stdout) {
  return parseTracedEvents(stdout, '@@UNIREC');
}

// OUTPUT INTEGRITY VALIDATION (same posture as the recursion tracker's joi-style check): a
// malformed recording fails HERE with the offending event named — not as a confusing crash
// inside a detector that trusted the shape.
export function validateUniversalRecording(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('universal recording must be an object');
  if (!Array.isArray(payload.events) || payload.events.length === 0) {
    throw new Error('universal recording needs a non-empty events array');
  }
  payload.events.forEach((e, i) => {
    const at = `event ${i}`;
    if (!e || typeof e !== 'object') throw new Error(`${at} must be an object`);
    if (e.truncated === true) return;
    if (!['line', 'call', 'return', 'exception'].includes(e.ev)) throw new Error(`${at}: ev must be line|call|return|exception (got ${JSON.stringify(e.ev)})`);
    if (!Number.isInteger(e.line) || e.line < 1) throw new Error(`${at}: needs a positive integer line`);
    if (typeof e.fn !== 'string' || !e.fn) throw new Error(`${at}: needs the function name`);
    if (!Number.isInteger(e.depth) || e.depth < 0) throw new Error(`${at}: needs an integer call depth`);
    if (e.ev === 'line' && (typeof e.locals !== 'object' || e.locals === null || Array.isArray(e.locals))) {
      throw new Error(`${at}: a line event needs a locals object`);
    }
    if (e.ev === 'call' && (typeof e.args !== 'object' || e.args === null || Array.isArray(e.args))) {
      throw new Error(`${at}: a call event needs an args object`);
    }
    if (e.heap !== undefined) {
      if (typeof e.heap !== 'object' || e.heap === null || Array.isArray(e.heap)) throw new Error(`${at}: heap must be an object keyed by id`);
      for (const [oid, rec] of Object.entries(e.heap)) {
        if (!rec || typeof rec !== 'object' || typeof rec.type !== 'string') throw new Error(`${at}: heap object ${oid} needs its type`);
      }
    }
  });
  return payload;
}
