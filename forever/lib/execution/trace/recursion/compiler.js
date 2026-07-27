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
  narrateCombineReturn, narrateFinalReturn, narrateChooseCall, narrateBacktrackUndo,
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
// layout (optional): {id: [x,y]} grid coordinates (Reingold-Tilford, from the vendored
// brpapa layout) attached to graph nodes so renderers can draw the reference's exact shape.
// A child entry may carry `undo: {name, value, stateBefore, stateAfter, line}` — PROVED
// choose→recurse→undo evidence supplied by the caller (from recorded collection ops); it
// yields an explicit backtrack step after that child's return, never inferred here.
export function compileRecursionTrace({ callTree, code, language = 'python', lines = {}, layout = null } = {}) {
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
  const nodes = ids.map((id) => {
    const coord = layout?.[id];
    return {
      id: String(id),
      label: nameOf(id),
      // Reference layout coordinates ride along when the caller derived them — optional
      // fields, renderers without layout support simply ignore them.
      ...(Array.isArray(coord) && coord.length === 2 ? { x: coord[0], y: coord[1] } : {}),
    };
  });
  const edges = ids.flatMap((id) => (vertices[id].children ?? []).map((c) => ({ from: String(id), to: String(c.id) })));
  // parentCallId is read off the DECLARED edges — which exist only because the recording
  // (or the dedicated tracker's parent stack) proved that caller→callee pair.
  const parentOf = {};
  for (const e of edges) parentOf[e.to] = e.from;
  // CALL-LIFECYCLE STEP MODEL (brpapa node grade, additive): every step names the call it
  // animates — {callId, parentCallId, args, phase, returned?, stackDepth} — so renderers can
  // track one call's enter/compute/return/backtrack beats without re-deriving the tour.
  const tag = (extras) => Object.assign(steps.at(-1), extras);

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
  tag({ callId: String(rootId), parentCallId: null, args: vertices[rootId]?.args ?? [], phase: 'enter', stackDepth: stack.length });

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
        // A PROVED choose→recurse→undo child narrates its pick (backtracking grammar);
        // an ordinary descent keeps the plain down-call sentence.
        explanation: child.undo
          ? narrateChooseCall(nameOf(id), nameOf(child.id), child.undo.name, child.undo.value)
          : narrateDownCall(nameOf(id), nameOf(child.id)),
      }));
      tag({ callId: childId, parentCallId: String(id), args: vertices[child.id]?.args ?? [], phase: 'enter', stackDepth: stack.length });

      tour(child.id);

      returned[childId] = child.value;
      stack.pop();
      const childV = vertices[child.id];
      const kind = childV.memoized ? 'memo' : (childV.children ?? []).length === 0 ? 'base' : 'combine';
      // The RECORDED answers this child collected from its own children — the "left gave you
      // X, right gave you Y" facts of the tree grammar (never computed, only read back).
      const childReturns = kind === 'combine' ? (childV.children ?? []).map((c) => c.value) : null;
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
            : narrateCombineReturn(nameOf(child.id), child.value, nameOf(id), childReturns),
      }));
      // phase: a leaf/memo call simply RETURNS its value; an internal call COMPUTES its
      // value from its children's answers — the beat where combination happened.
      tag({
        callId: childId,
        parentCallId: String(id),
        args: vertices[child.id]?.args ?? [],
        phase: kind === 'combine' ? 'compute' : 'return',
        returned: child.value,
        stackDepth: stack.length,
      });

      // EXPLICIT BACKTRACK BEAT — only when the caller supplied recorded proof that a state
      // mutation made before this call was reverted after it returned (choose→recurse→undo).
      if (child.undo) {
        const u = child.undo;
        const undoLine = Number.isInteger(u.line) && u.line >= 1 && u.line <= lineCount ? u.line : lineOf('call');
        steps.push(snap({
          line: undoLine,
          current: String(id),
          variables: { call: nameOf(id) },
          explanation: narrateBacktrackUndo(nameOf(child.id), u.name, u.value, u.stateBefore, u.stateAfter),
        }));
        tag({
          callId: String(id),
          parentCallId: parentOf[String(id)] ?? null,
          args: vertices[id]?.args ?? [],
          phase: 'backtrack',
          stackDepth: stack.length,
          undo: {
            name: u.name,
            value: u.value,
            ...(u.stateBefore !== undefined ? { stateBefore: u.stateBefore } : {}),
            ...(u.stateAfter !== undefined ? { stateAfter: u.stateAfter } : {}),
          },
        });
      }
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
  tag({
    callId: String(rootId),
    parentCallId: null,
    args: vertices[rootId]?.args ?? [],
    phase: (vertices[rootId]?.children ?? []).length > 0 ? 'compute' : 'return',
    returned: result,
    stackDepth: stack.length,
  });

  const trace = {
    language,
    code: String(code ?? ''),
    views: { graph: { nodes, edges, directed: true } },
    steps,
  };
  return validateExecutionTrace(trace, 'recursion trace');
}
