// RECORDING STAGE of the trie tool. Like the linked-list tracker, this needs what the generic
// line tracker cannot give: node OBJECT IDENTITY across snapshots (strong-ref id registry) —
// plus a tree chase instead of a chain chase. At each executed line it resolves the declared
// root (a Trie instance's .root or a bare root node), walks it breadth-first through the
// declared children attribute (dict char->node OR the 26-slot list style, per the research),
// and records {nodes: id -> {end, children}, cursor, cursorName} — the cursor being whichever
// declared cursor variable currently stands on a known node, reported under the student's own
// variable name.

import { buildTracedProgram, parseTracedEvents } from '../harness/assemble.js';

export const TRIE_TRACKER_PY = `
import json, sys

MAX_EVENTS = 300
MAX_NODES = 80
_events = []
_registry = {}
_keep = []
_counter = [0]

def _nid(node):
    k = id(node)
    if k not in _registry:
        _counter[0] += 1
        _registry[k] = 't' + str(_counter[0])
        _keep.append(node)  # strong ref: id() must never be recycled behind our back
    return _registry[k]

def _children(node):
    c = getattr(node, CHILDREN_ATTR, None)
    if isinstance(c, dict):
        return [(str(k)[:2], v) for k, v in c.items() if v is not None]
    if isinstance(c, list):
        return [((chr(97 + i) if 0 <= i < 26 else str(i)), v) for i, v in enumerate(c) if v is not None]
    return None

def _is_node(obj):
    try:
        return obj is not None and _children(obj) is not None
    except Exception:
        return False

def _find_root(obj):
    if _is_node(obj):
        return obj
    r = getattr(obj, 'root', None)
    return r if _is_node(r) else None

def _snap(local_vars, root):
    nodes = {}
    queue = [root]
    seen = set()
    while queue and len(nodes) < MAX_NODES:
        n = queue.pop(0)
        if id(n) in seen:
            continue
        seen.add(id(n))
        kids = _children(n) or []
        nodes[_nid(n)] = {
            'end': bool(getattr(n, END_ATTR, False)),
            'children': {ch: _nid(c) for ch, c in kids},
        }
        queue.extend(c for _, c in kids)
    cursor = None
    cname = None
    for name in CURSORS:
        v = local_vars.get(name)
        if v is not None and id(v) in _registry:
            cursor = _registry[id(v)]
            cname = name
            break
    return {'nodes': nodes, 'cursor': cursor, 'cursorName': cname}

def _scalars(lv):
    out = {}
    for k, v in lv.items():
        if k.startswith('_') or k in CURSORS or k == ROOT_VAR:
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
        holder = frame.f_locals.get(ROOT_VAR)
        if holder is None:
            holder = frame.f_locals.get('self')
        if holder is None:
            holder = frame.f_globals.get(ROOT_VAR)
        root = _find_root(holder) if holder is not None else None
        if root is not None:
            _events.append({'line': frame.f_lineno, 'state': _snap(frame.f_locals, root), 'variables': _scalars(frame.f_locals)})
    return _tracer
`.trim();

const IDENT = /^[A-Za-z_]\w*$/;

export function assembleTrieProgram({ code, entry, root, childrenAttr = 'children', endAttr = 'is_end', cursors = ['node', 'cur', 'curr', 'current'] }) {
  if (!IDENT.test(String(root ?? ''))) throw new Error('trie root must be a simple identifier (the variable holding the Trie or its root node)');
  if (!IDENT.test(childrenAttr) || !IDENT.test(endAttr)) throw new Error('childrenAttr/endAttr must be simple identifiers');
  if (!Array.isArray(cursors) || cursors.length === 0 || !cursors.every((c) => IDENT.test(String(c)))) {
    throw new Error('trie cursors must be simple identifiers (the node variables the code walks with)');
  }
  return buildTracedProgram({
    constants: { ROOT_VAR: String(root), CHILDREN_ATTR: childrenAttr, END_ATTR: endAttr, CURSORS: cursors.map(String) },
    trackerPy: TRIE_TRACKER_PY,
    code,
    entry,
    marker: '@@TRIE',
    resultLine: '_out = _result if _result is None or isinstance(_result, (int, float, str, bool)) else repr(_result)[:40]',
    entryExample: '"demo()"',
  });
}

export function parseTrieEvents(stdout) {
  return parseTracedEvents(stdout, '@@TRIE');
}
