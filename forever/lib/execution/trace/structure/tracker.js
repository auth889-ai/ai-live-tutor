// RECORDING STAGE of the universal STRUCTURE tool — for ANY LeetCode-style problem THAT IS
// tree/graph-related, this draws the actual structure from the real run with NO per-problem
// declaration. Problems with no tree/graph produce NO snapshots (the tracker emits nothing and
// the tracer falls through to another mode) — the gates below exist so a Counter dict or a DP
// table is never mistaken for a graph. Research-verified design:
//
//   - node-object extraction = Python Tutor's recursive REF-following (stable ids from an
//     id() registry with strong refs, REGISTER-BEFORE-EXPAND so cycles short-circuit) +
//     debug-visualizer's capped BFS (stop EXPANDING at the cap, keep frontier edges) +
//     jGRASP's node-class test (a class instance counts as a node when it has a same-class
//     reference field, a list of same-class children, or a canonical node field name).
//   - adjacency detection = NetworkX-style shape guessing HARDENED with the domain-closure
//     gate (a dict-of-lists is a graph only when its neighbor values live in the key domain;
//     a ragged list-of-lists of ints in [0, n) is adjacency-by-index) — so a Counter or a
//     DP table never renders as a graph.
//   - the CURSOR = whichever whitelisted top-frame local's id() currently equals an extracted
//     node, re-evaluated every traced line — that is what animates the traversal.

export const STRUCTURE_TRACKER_PY = `
import json, sys
from collections import deque as _deque

MAX_EVENTS = 300
MAX_NODES = 60
ROOT_NAMES = ['root', 'head', 'tree', 'graph', 'adj', 'start', 'dummy', 'node', 'cur', 'curr', 'u', 'p']
CURSOR_NAMES = ['node', 'cur', 'curr', 'current', 'u', 'v', 'p', 'x', 'root', 'head']
NODE_FIELDS = ('left', 'right', 'next', 'prev', 'children', 'neighbors', 'child')

_events = []
_registry = {}
_keep = []
_counter = [0]

def _nid(o):
    k = id(o)
    if k not in _registry:
        _counter[0] += 1
        _registry[k] = 'n' + str(_counter[0])
        _keep.append(o)  # strong ref: id() must never be recycled behind our back
    return _registry[k]

def _is_node(o):
    if o is None or isinstance(o, (int, float, str, bool, list, dict, set, tuple)):
        return False
    d = getattr(o, '__dict__', None)
    if not isinstance(d, dict):
        return False
    cls = type(o)
    for k, v in d.items():
        if k in NODE_FIELDS:
            return True
        if isinstance(v, cls):
            return True
        if isinstance(v, (list, tuple)) and any(isinstance(x, cls) for x in v):
            return True
    return False

def _label(o):
    for k in ('val', 'value', 'key', 'data', 'name'):
        v = getattr(o, k, None)
        if isinstance(v, (int, float, str, bool)):
            return v
    return type(o).__name__

def _refs(o):
    for k, v in getattr(o, '__dict__', {}).items():
        if _is_node(v):
            yield k, v
        elif isinstance(v, (list, tuple)):
            for x in v:
                if _is_node(x):
                    yield k, x

def _adjacency(v):
    # Rule B: dict-of-lists with DOMAIN CLOSURE (neighbors are keys; >=50% closes the domain).
    if isinstance(v, dict) and v:
        if not all(isinstance(lst, (list, set, tuple)) for lst in v.values()):
            return None
        keys = set(v.keys())
        vals = [x for lst in v.values() for x in lst]
        if not vals or not all(isinstance(x, (int, str)) for x in vals):
            return None
        ratio = sum(1 for x in vals if x in keys) / len(vals)
        if ratio < 0.5:
            return None  # grouping dict, not a graph
        nodes = [str(k) for k in v.keys()]
        for x in vals:
            if x not in keys and str(x) not in nodes:
                nodes.append(str(x))
        return {'kind': 'adj', 'nodes': nodes[:MAX_NODES],
                'edges': [[str(k), str(x)] for k, lst in v.items() for x in lst][:MAX_NODES * 3]}
    # Rule C: ragged list-of-lists of ints all in [0, n) => adjacency by index.
    if isinstance(v, list) and v and all(isinstance(r, list) for r in v):
        n = len(v)
        flat = [x for r in v for x in r]
        if flat and all(isinstance(x, int) and not isinstance(x, bool) and 0 <= x < n for x in flat):
            if len({len(r) for r in v}) > 1:
                return {'kind': 'adj', 'nodes': [str(i) for i in range(n)][:MAX_NODES],
                        'edges': [[str(i), str(x)] for i, r in enumerate(v) for x in r][:MAX_NODES * 3]}
    return None

def _snap(lv):
    roots = []
    seen_root_ids = set()
    for name in ROOT_NAMES + CURSOR_NAMES:
        o = lv.get(name)
        if _is_node(o) and id(o) not in seen_root_ids:
            seen_root_ids.add(id(o))
            roots.append(o)
    if roots:
        nodes = {}
        q = _deque(roots)
        while q:
            o = q.popleft()
            oid = _nid(o)
            if oid in nodes:
                continue  # register-before-expand: cycles/aliases short-circuit here
            if len(nodes) >= MAX_NODES:
                break
            refs = []
            for f, c in _refs(o):
                refs.append([f, _nid(c)])
                q.append(c)
            nodes[oid] = {'label': _label(o), 'refs': refs}
        if nodes:
            pointers = {}
            for name in CURSOR_NAMES:
                o = lv.get(name)
                if o is not None and id(o) in _registry and _registry[id(o)] in nodes:
                    pointers[name] = _registry[id(o)]
            return {'kind': 'nodes', 'nodes': nodes, 'pointers': pointers}
    for name in ROOT_NAMES:
        a = _adjacency(lv.get(name))
        if a:
            pointers = {}
            ids = set(a['nodes'])
            for cn in CURSOR_NAMES:
                cv = lv.get(cn)
                if isinstance(cv, (int, str)) and str(cv) in ids:
                    pointers[cn] = str(cv)
            a['pointers'] = pointers
            return a
    return None

def _scalars(lv):
    out = {}
    for k, v in lv.items():
        if k.startswith('_'):
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
        state = _snap(frame.f_locals)
        if state is not None:
            _events.append({'line': frame.f_lineno, 'state': state, 'variables': _scalars(frame.f_locals)})
    return _tracer
`.trim();

import { buildTracedProgram, parseTracedEvents } from '../harness/assemble.js';

export function assembleStructureProgram({ code, entry }) {
  return buildTracedProgram({
    trackerPy: STRUCTURE_TRACKER_PY,
    code,
    entry,
    marker: '@@STRUCTURE',
    resultLine: "_out = _registry.get(id(_result)) if id(_result) in _registry else (_result if _result is None or isinstance(_result, (int, float, str, bool)) else repr(_result)[:40])",
    entryExample: '"invert(tree)"',
  });
}

export function parseStructureEvents(stdout) {
  return parseTracedEvents(stdout, '@@STRUCTURE');
}
