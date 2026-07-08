// Recursion-tree trace compiler — the strong tool, built as CODE (pure, deterministic, tested),
// not model imagination. Studied at source level: brpapa/recursion-tree-visualizer (call-tree
// recording: one vertex per call with argsList/adjList/memoized, child-edge weight = return
// value; Euler-tour playback where a node is current when CALLED and again when RETURNED-to)
// and algorithm-visualizer's GraphTracer verbs (visit/leave = go down/backtrack up).
//
// Division of labor that makes this reliable: the LLM supplies only the recursive function;
// OUR tracker template records the real call tree during real execution, and THIS compiler
// derives every animation step deterministically — the tree GROWS call by call, the pointer
// walks down and back up, return values land on nodes, memo hits are called out as the DP win.
// Stronger than the studied tools: steps carry code lines, the live call stack, and teaching
// explanations, so the whole AlgorithmStage (code + tree + stack + caption + voice) stays in
// lock-step from one step object.

import { validateExecutionTrace } from '../../board/execution/execution-trace.js';

// Our original Python instrumentation template (modeled on the studied recording technique,
// written for our @@CALLTREE protocol). Definitions only — assembleRecursionProgram() adds the
// student's function and the run line, so the model never writes any of this machinery.
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

const label = (fnName, args) => `${fnName}(${args.map((a) => JSON.stringify(a)).join(',')})`.replace(/"/g, "'");

// Compile a recorded call tree into a validated ExecutionTrace via the Euler tour.
// callTree: { fnName, result, vertices: {id: {args, children: [{id, value}], memoized}} }
// lines: 1-based lines in `code` for the teaching moments — {call, base, memo, combine};
// missing entries fall back to line 1 (the function signature).
export function compileRecursionTrace({ callTree, code, language = 'python', lines = {} } = {}) {
  const { fnName = 'fn', vertices = {}, result } = callTree ?? {};
  if (callTree?.error) throw new Error(`recursion tracker failed: ${callTree.error}`);
  const ids = Object.keys(vertices);
  if (ids.length === 0) throw new Error('recursion call tree has no vertices');
  const lineCount = String(code ?? '').split('\n').length;
  const lineOf = (kind) => {
    const l = Number(lines[kind]);
    return Number.isInteger(l) && l >= 1 && l <= lineCount ? l : 1;
  };

  const nameOf = (id) => label(fnName, vertices[id]?.args ?? []);
  const nodes = ids.map((id) => ({ id: String(id), label: nameOf(id) }));
  const edges = ids.flatMap((id) => (vertices[id].children ?? []).map((c) => ({ from: String(id), to: String(c.id) })));

  // Euler tour -> snapshot steps. State accumulates: revealed (the tree GROWS), returned
  // (values land and stay), memo (hits stay purple), visited (every node the pointer touched).
  const steps = [];
  const revealed = [];
  const visited = [];
  const returned = {};
  const memo = [];
  const stack = []; // call path, root -> current (rendered by the stage's stack panel)
  const snap = (over) => ({
    line: over.line,
    explanation: over.explanation,
    graph: {
      current: over.current,
      visited: [...visited],
      revealed: [...revealed],
      returned: { ...returned },
      memo: [...memo],
      pointers: { call: over.current },
    },
    stack: [...stack],
    variables: over.variables ?? {},
    ...(over.activeEdge ? { activeEdge: over.activeEdge } : {}),
  });

  const rootId = ids.find((id) => !edges.some((e) => e.to === String(id))) ?? ids[0];
  revealed.push(String(rootId));
  visited.push(String(rootId));
  stack.push(nameOf(rootId));
  steps.push(snap({
    line: lineOf('call'),
    current: String(rootId),
    explanation: `We start by calling ${nameOf(rootId)}. Nothing is computed yet — its answer depends entirely on smaller subproblems we are about to open. Watch the tree grow downward: every node that appears is a fresh recursive call.`,
  }));

  (function tour(id) {
    const v = vertices[id];
    const children = v.children ?? [];
    if (v.memoized) {
      memo.push(String(id));
      return; // a memo hit never recurses — that IS the lesson
    }
    if (children.length === 0) return; // base case: the return step below narrates it
    for (const child of children) {
      const childId = String(child.id);
      revealed.push(childId);
      visited.push(childId);
      stack.push(nameOf(child.id));
      steps.push(snap({
        line: lineOf('call'),
        current: childId,
        activeEdge: [String(id), childId],
        explanation: `${nameOf(id)} cannot finish on its own — it needs ${nameOf(child.id)} first, so it calls it and pauses. Look at the call stack: ${nameOf(id)} is still there, waiting for this answer. We descend one level, and a new node appears on the tree.`,
      }));

      tour(child.id);

      returned[childId] = child.value;
      stack.pop();
      const childV = vertices[child.id];
      const kind = childV.memoized ? 'memo' : (childV.children ?? []).length === 0 ? 'base' : 'combine';
      steps.push(snap({
        line: lineOf(kind),
        current: String(id),
        activeEdge: [childId, String(id)],
        variables: { [nameOf(child.id)]: child.value },
        explanation: childV.memoized
          ? `${nameOf(child.id)} looks familiar — we already solved it earlier and stored its answer in the memo, so it hands back ${JSON.stringify(child.value)} instantly with no recomputation. Compare this single purple lookup with the whole subtree we grew the first time: that repeated work is exactly what memoization saves.`
          : (childV.children ?? []).length === 0
            ? `${nameOf(child.id)} hits the base case — the input is now small enough to answer directly, so it returns ${JSON.stringify(child.value)} without making any further calls. This is the floor that stops the descent; from here the answers start flowing back up, and ${JSON.stringify(child.value)} travels along the edge to ${nameOf(id)}.`
            : `${nameOf(child.id)} has finished: all of its own children have answered, and combining them gives ${JSON.stringify(child.value)}. That value now flows up the edge to ${nameOf(id)}, which is still waiting on the stack until every one of its children reports back.`,
      }));
    }
  })(rootId);

  returned[String(rootId)] = result;
  stack.pop();
  steps.push(snap({
    line: lineOf('combine'),
    current: String(rootId),
    variables: { [nameOf(rootId)]: result },
    explanation: `Every branch has reported back, so ${nameOf(rootId)} combines its children's answers and returns ${JSON.stringify(result)} — the final result. Read the finished tree bottom-up: each node's value was built from its children${memo.length ? ', and every purple node marks an entire subtree of work the memo saved us from repeating' : ''}.`,
  }));

  const trace = {
    language,
    code: String(code ?? ''),
    views: { graph: { nodes, edges, directed: true } },
    steps,
  };
  return validateExecutionTrace(trace, 'recursion trace');
}
