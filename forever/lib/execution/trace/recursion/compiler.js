// PLAYBACK STAGE of the recursion tool: compile a recorded call tree into a validated
// ExecutionTrace via the Euler tour (a node is current when CALLED and again when RETURNED-to
// — brpapa/recursion-tree-visualizer's playback model, studied at source). The tree GROWS
// call by call (revealed), the pointer walks down and back up (activeEdge both directions),
// return values land on nodes and edges (returned), memo hits stay purple (memo), and the
// call stack tracks the path — every step carries its code line and tutor sentence, so the
// whole AlgorithmStage stays in lock-step from one step object.
//
// The tool's stages: tracker.js (record a real run) -> this file (derive every animation
// step) -> narrate.js (the tutor's words per moment).

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';
import {
  narrateRootCall, narrateDownCall, narrateMemoHit, narrateBaseCase,
  narrateCombineReturn, narrateFinalReturn,
} from './narrate.js';

import { validateCallTree } from './tracker.js';

export { RECURSION_TRACKER_PY, assembleRecursionProgram, parseCallTree, validateCallTree } from './tracker.js';

const label = (fnName, args) => `${fnName}(${args.map((a) => JSON.stringify(a)).join(',')})`.replace(/"/g, "'");

// The readable-circle rule the reference visualizer lives by: a node shows ONLY the arguments
// that VARY between calls. gain(vals, i) where vals never changes reads as gain(6), never as
// gain([-10,9,20,null,null,15,7],6) — the invariant payload would drown every label, chip and
// stack row. With a single call (nothing to compare) or all-constant args, show everything.
function varyingArgPositions(vertices) {
  const all = Object.values(vertices).map((v) => v.args ?? []);
  if (all.length < 2) return null; // one call — no basis to drop anything
  const width = Math.max(...all.map((a) => a.length));
  const varying = [];
  for (let i = 0; i < width; i += 1) {
    const first = JSON.stringify(all[0][i]);
    if (all.some((a) => JSON.stringify(a[i]) !== first)) varying.push(i);
  }
  return varying.length > 0 ? varying : null;
}

// callTree: { fnName, result, vertices: {id: {args, children: [{id, value}], memoized}} }
// lines: 1-based lines in `code` for the teaching moments — {call, base, memo, combine};
// missing entries fall back to line 1 (the function signature).
export function compileRecursionTrace({ callTree, code, language = 'python', lines = {} } = {}) {
  if (callTree?.error) throw new Error(`recursion tracker failed: ${callTree.error}`);
  validateCallTree(callTree ?? {}); // output integrity BEFORE compilation — loud, actionable
  const { fnName = 'fn', vertices = {}, result } = callTree ?? {};
  const ids = Object.keys(vertices);
  if (ids.length === 0) throw new Error('recursion call tree has no vertices');
  const lineCount = String(code ?? '').split('\n').length;
  const lineOf = (kind) => {
    const l = Number(lines[kind]);
    return Number.isInteger(l) && l >= 1 && l <= lineCount ? l : 1;
  };

  const varying = varyingArgPositions(vertices);
  const nameOf = (id) => {
    const args = vertices[id]?.args ?? [];
    return label(fnName, varying ? varying.map((i) => args[i]) : args);
  };
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
    ...(over.activeEdgeReverse ? { activeEdgeReverse: true } : {}),
  });

  const rootId = ids.find((id) => !edges.some((e) => e.to === String(id))) ?? ids[0];
  revealed.push(String(rootId));
  visited.push(String(rootId));
  stack.push(nameOf(rootId));
  steps.push(snap({
    line: lineOf('call'),
    current: String(rootId),
    // Every step fills the `call` column; `returns` stays blank until the value exists — a
    // dry-run table must never show rows that are empty except for the step number.
    variables: { call: nameOf(rootId) },
    explanation: narrateRootCall(nameOf(rootId)),
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
        variables: { call: nameOf(child.id) },
        explanation: narrateDownCall(nameOf(id), nameOf(child.id)),
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
        activeEdgeReverse: true, // the return ride: child -> parent along the declared call edge
        // STABLE table keys (call/returns) — per-child keys made the trace table grow a new
        // column per node, shifting headers mid-lesson.
        variables: { call: nameOf(child.id), returns: child.value },
        explanation: childV.memoized
          ? narrateMemoHit(nameOf(child.id), child.value)
          : kind === 'base'
            ? narrateBaseCase(nameOf(child.id), child.value, nameOf(id))
            : narrateCombineReturn(nameOf(child.id), child.value, nameOf(id)),
      }));
    }
  })(rootId);

  returned[String(rootId)] = result;
  stack.pop();
  steps.push(snap({
    line: lineOf('combine'),
    current: String(rootId),
    variables: { call: nameOf(rootId), returns: result },
    explanation: narrateFinalReturn(nameOf(rootId), result, memo.length > 0),
  }));

  const trace = {
    language,
    code: String(code ?? ''),
    views: { graph: { nodes, edges, directed: true } },
    steps,
  };
  return validateExecutionTrace(trace, 'recursion trace');
}
