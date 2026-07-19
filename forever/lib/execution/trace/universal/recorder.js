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
import ast as _ast_mod

# DIRECT OPERATION PROVENANCE (external review 2026-07-19): subscript LOADS are rewritten
# by _INSTRUMENT into recorded reads — dependency arrows downstream may ONLY come from
# these events, never from arithmetic coincidence.
_reads = []

def __tr_read__(name, obj, *keys):
    val = obj
    for k in keys:
        val = val[k]
    try:
        if len(_reads) < 4000 and all(isinstance(k, (int, str)) and not isinstance(k, bool) for k in keys):
            if isinstance(val, (int, float, str, bool)):
                _seq[0] += 1
                _reads.append({'i': len(_events), 'n': name, 'p': list(keys), 'v': _safe(val), 'q': _seq[0]})
            elif isinstance(val, (list, dict, set, tuple)):
                # non-scalar read: value omitted, but the ACCESS itself is the evidence —
                # a walked adjacency is indexed (adj[u]); a result accumulator never is
                _reads.append({'i': len(_events), 'n': name, 'p': [k if isinstance(k, int) else str(k) for k in keys], 't': 'o'})
    except Exception:
        pass
    return val

class _InstrReads(_ast_mod.NodeTransformer):
    # rewrite 1-2 level subscript LOADS with a simple Name base (a[i], dp[i][j]); stores and
    # slices untouched, index expressions visited recursively (dp[a[i]] records both reads)
    def visit_Subscript(self, node):
        if isinstance(node.ctx, _ast_mod.Load):
            chain = []
            cur = node
            ok = True
            while isinstance(cur, _ast_mod.Subscript):
                if not isinstance(cur.ctx, _ast_mod.Load) or isinstance(cur.slice, _ast_mod.Slice):
                    ok = False
                    break
                chain.append(cur.slice)
                cur = cur.value
            if ok and isinstance(cur, _ast_mod.Name) and 1 <= len(chain) <= 2:
                args = [_ast_mod.Constant(value=cur.id), _ast_mod.Name(id=cur.id, ctx=_ast_mod.Load())]
                for sl in reversed(chain):
                    args.append(self.visit(sl))
                new = _ast_mod.Call(func=_ast_mod.Name(id='__tr_read__', ctx=_ast_mod.Load()), args=args, keywords=[])
                return _ast_mod.copy_location(new, node)
        self.generic_visit(node)
        return node

    def visit_BinOp(self, node):
        self.generic_visit(node)
        opname = type(node.op).__name__
        if opname in ('Add', 'Sub', 'Mult', 'FloorDiv', 'Mod'):
            return _ast_mod.copy_location(_ast_mod.Call(
                func=_ast_mod.Name(id='__tr_binop__', ctx=_ast_mod.Load()),
                args=[_ast_mod.Constant(value=opname), node.left, node.right], keywords=[]), node)
        return node

    def visit_Call(self, node):
        self.generic_visit(node)
        # collection methods on a simple name: q.append(x), q.popleft(), seen.add(x)
        if (isinstance(node.func, _ast_mod.Attribute) and isinstance(node.func.value, _ast_mod.Name)
                and node.func.attr in _COLL_ATTRS_AST and not node.keywords
                and not any(isinstance(a, _ast_mod.Starred) for a in node.args)):
            base = node.func.value
            return _ast_mod.copy_location(_ast_mod.Call(
                func=_ast_mod.Name(id='__tr_meth__', ctx=_ast_mod.Load()),
                args=[_ast_mod.Constant(value=base.id), _ast_mod.Constant(value=node.func.attr),
                      _ast_mod.Name(id=base.id, ctx=_ast_mod.Load())] + node.args, keywords=[]), node)
        # heapq.heappush(pq, v) / heappop(pq) — module-attr or from-import name
        fname = node.func.attr if (isinstance(node.func, _ast_mod.Attribute) and isinstance(node.func.value, _ast_mod.Name) and node.func.value.id == 'heapq') else (node.func.id if isinstance(node.func, _ast_mod.Name) else None)
        if fname in ('heappush', 'heappop') and node.args and isinstance(node.args[0], _ast_mod.Name) and not node.keywords:
            return _ast_mod.copy_location(_ast_mod.Call(
                func=_ast_mod.Name(id='__tr_heap__', ctx=_ast_mod.Load()),
                args=[_ast_mod.Constant(value=fname), _ast_mod.Constant(value=node.args[0].id),
                      _ast_mod.Name(id=node.args[0].id, ctx=_ast_mod.Load())] + node.args[1:], keywords=[]), node)
        if (isinstance(node.func, _ast_mod.Name) and node.func.id in ('max', 'min')
                and len(node.args) >= 2 and not node.keywords
                and not any(isinstance(a, _ast_mod.Starred) for a in node.args)):
            return _ast_mod.copy_location(_ast_mod.Call(
                func=_ast_mod.Name(id='__tr_minmax__', ctx=_ast_mod.Load()),
                args=[_ast_mod.Constant(value=node.func.id)] + node.args, keywords=[]), node)
        return node

    def visit_Assign(self, node):
        # dp[i][j] = RHS  ->  _trm_ = __tr_begin__(); dp[i][j] = __tr_write__(_trm_, RHS')
        if (len(node.targets) == 1 and isinstance(node.targets[0], _ast_mod.Subscript)):
            chain = []
            cur = node.targets[0]
            ok = True
            while isinstance(cur, _ast_mod.Subscript):
                if isinstance(cur.slice, _ast_mod.Slice):
                    ok = False
                    break
                chain.append(cur.slice)
                cur = cur.value
            if ok and isinstance(cur, _ast_mod.Name) and 1 <= len(chain) <= 2:
                rhs = self.visit(node.value)
                mark = _ast_mod.Assign(
                    targets=[_ast_mod.Name(id='_trm_', ctx=_ast_mod.Store())],
                    value=_ast_mod.Call(func=_ast_mod.Name(id='__tr_begin__', ctx=_ast_mod.Load()), args=[], keywords=[]))
                node.value = _ast_mod.Call(
                    func=_ast_mod.Name(id='__tr_write__', ctx=_ast_mod.Load()),
                    args=[_ast_mod.Name(id='_trm_', ctx=_ast_mod.Load()), rhs], keywords=[])
                self.generic_visit(node.targets[0])
                return [_ast_mod.copy_location(mark, node), node]
        self.generic_visit(node)
        return node

_writes = []
_ops = []
_seq = [0]  # shared order stamp across reads and ops — value-ops execute AFTER the reads they consume

_OPMAP = {
    'Add': lambda a, b: a + b, 'Sub': lambda a, b: a - b, 'Mult': lambda a, b: a * b,
    'FloorDiv': lambda a, b: a // b, 'Mod': lambda a, b: a % b,
}

def __tr_binop__(opname, a, b):
    # BINARY_OP event: the operator ACTUALLY executed, with its real operands and result —
    # rule names downstream become recorded facts, never arithmetic consensus.
    r = _OPMAP[opname](a, b)
    try:
        if len(_ops) < 4000 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (a, b, r)):
            _seq[0] += 1
            _ops.append({'i': len(_events), 'op': opname, 'a': a, 'b': b, 'r': r, 'q': _seq[0]})
    except Exception:
        pass
    return r

def __tr_minmax__(fname, *args):
    r = (max if fname == 'max' else min)(*args)
    try:
        if len(_ops) < 4000 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in list(args) + [r]):
            _seq[0] += 1
            _ops.append({'i': len(_events), 'op': fname, 'args': list(args)[:4], 'r': r, 'q': _seq[0]})
    except Exception:
        pass
    return r

_collops = []
_COLL_ATTRS = ('append', 'appendleft', 'pop', 'popleft', 'add', 'remove', 'discard')
_COLL_ATTRS_AST = _COLL_ATTRS

def __tr_meth__(name, attr, obj, *args):
    # COLLECTION OP event: q.popleft() / q.append(x) / seen.add(x) recorded as the operation
    # it is — queue/heap/set semantics become facts, not snapshot reconstructions.
    ret = getattr(obj, attr)(*args)
    try:
        if len(_collops) < 4000:
            _seq[0] += 1
            ev = {'i': len(_events), 'q': _seq[0], 'n': name, 'op': attr}
            if args:
                ev['arg'] = _safe(args[0])
            if ret is not None:
                ev['ret'] = _safe(ret)
            _collops.append(ev)
    except Exception:
        pass
    return ret

def __tr_heap__(kind, name, heap, *args):
    import heapq as _hq
    ret = _hq.heappush(heap, args[0]) if kind == 'heappush' else _hq.heappop(heap)
    try:
        if len(_collops) < 4000:
            _seq[0] += 1
            ev = {'i': len(_events), 'q': _seq[0], 'n': name, 'op': kind}
            if args:
                ev['arg'] = _safe(args[0])
            if kind == 'heappop':
                ev['ret'] = _safe(ret)
            _collops.append(ev)
    except Exception:
        pass
    return ret

def __tr_begin__():
    return (len(_reads), len(_ops))

def __tr_write__(mark, val):
    # RHS-scoped write event: reads recorded between mark and now are EXACTLY the reads
    # inside this assignment's right-hand side — the only legal evidence for an arrow.
    try:
        if len(_writes) < 3000:
            r0, o0 = mark if isinstance(mark, tuple) else (mark, len(_ops))
            _writes.append({'i': len(_events), 'rhs': [dict(r) for r in _reads[r0:]][:6], 'ops': [dict(o) for o in _ops[o0:]][:4]})
    except Exception:
        pass
    return val

def _INSTRUMENT(src):
    try:
        tree = _InstrReads().visit(_ast_mod.parse(src))
        _ast_mod.fix_missing_locations(tree)
        return tree
    except Exception:
        return src


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

_budget = [0]
HARD_BUDGET = 2000000

def _count_tracer(frame, event, arg):
    # Post-cap guard (Pyodide adoption list #2, header-free): recording stopped at MAX_EVENTS,
    # but the RUN must not spin forever — an infinite loop would hang the sandbox (and, in the
    # browser, the student's tab). Count on, and kill the run past a generous hard budget.
    _budget[0] += 1
    if _budget[0] > HARD_BUDGET:
        raise RuntimeError('step budget exceeded - likely an infinite loop')
    return _count_tracer

def _push(ev):
    if len(_events) >= MAX_EVENTS:
        # NEVER a silent cut: the cap becomes a first-class terminal event so the compiled
        # trace can SAY the recording stopped. The run continues UNDER THE BUDGET TRACER —
        # finite programs still finish and report their result; runaway loops die loudly.
        _events.append({'truncated': True})
        sys.settrace(_count_tracer)
        return False
    _events.append(ev)
    return True

def _tracer(frame, event, arg):
    _budget[0] += 1
    if _budget[0] > HARD_BUDGET:
        raise RuntimeError('step budget exceeded - likely an infinite loop')
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
