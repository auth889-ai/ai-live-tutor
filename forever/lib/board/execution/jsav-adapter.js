// TRACE -> JSAV ADAPTER — a PURE translator (no DOM, no jQuery, fully node-testable) from a
// Forever algorithm object's ExecutionTrace steps to an ordered list of ABSTRACT JSAV
// operations. The law: JSAV renders, Forever's ExecutionTrace decides. Forever steps are
// SNAPSHOTS (each step declares full structure state + emphasis); JSAV's model is recorded
// EFFECTS (highlight/setValue/swap appended to an animation log — vendor/jsav/src/anim.js).
// This module bridges the two by DIFFING consecutive snapshots and emitting the effect ops
// a JSAV-style renderer replays: [{ stepIndex, structure, op, target, value?, meta? }].
//
// Step families covered (shapes are the validated ExecutionTrace contract,
// lib/board/execution/execution-trace.js, as emitted by the trace compilers):
//   pointer-array — step.array {current, pointers, eliminated, comparing, swapped, sorted,
//                   dimmed, values} over views.array.values
//   dp-table      — step.array2d {current, filled, highlight, values:[[r,c,v]]} plus the
//                   dpvis provenance fields reads/chosen/phase; reads FLASH BEFORE the write
//   graph-walk    — step.graph {current, visited, pointers} + activeEdge(+Reverse) +
//                   queue/stack frontiers + nodeState per-node labels
//   recursion-tree— step.graph {revealed, returned, memo, ...} + callId/parentCallId/phase
//                   (enter|compute|return|backtrack) + undo — the tree GROWS (addNode/addEdge),
//                   returns land as node values, backtracks mark the undoing caller
//   collections   — step.stack / step.queue diffs -> push/pop/enqueue/dequeue
//
// Unknown or unrecognized step kinds NEVER throw — they become a safe generic 'note' op.

export const JSAV_STRUCTURES = Object.freeze(['array', 'matrix', 'graph', 'tree', 'list', 'code', 'message']);

export const JSAV_OPS = Object.freeze([
  // shared emphasis
  'highlight', 'unhighlight', 'setValue', 'swap', 'movePointer', 'dim',
  // graph / tree
  'visit', 'inspectEdge', 'traverseEdge', 'addNode', 'addEdge', 'setNodeValue', 'backtrack',
  // collections (stack/queue/call stack)
  'push', 'pop', 'enqueue', 'dequeue',
  // narration / code line / fallback
  'setLine', 'umsg', 'note',
]);

// Highlight kinds that live for ONE step only — the adapter emits the matching unhighlight
// at the start of the next step (JSAV effects are otherwise persistent).
const TRANSIENT_KINDS = new Set(['current', 'comparing', 'read', 'chosen', 'dep', 'active']);

const json = (v) => {
  try { return JSON.stringify(v); } catch { return String(v); }
};
const sameVal = (a, b) => json(a) === json(b);

// Accept the trace itself, or the board object carrying it (renderHint 'algorithm' objects
// hold the trace as their content). Never throws.
function normalizeTrace(algo) {
  if (!algo || typeof algo !== 'object') return null;
  if (Array.isArray(algo.steps) && algo.steps.length > 0) return algo;
  const inner = algo.content;
  if (inner && typeof inner === 'object' && Array.isArray(inner.steps) && inner.steps.length > 0) return inner;
  return null;
}

// ---- collection diffs ------------------------------------------------------------------

// Stack semantics: change happens at the TOP (end). Longest common prefix; what the old
// stack kept above it was popped (top first), what the new stack adds was pushed in order.
export function diffStack(prev = [], next = []) {
  const a = Array.isArray(prev) ? prev : [];
  const b = Array.isArray(next) ? next : [];
  let k = 0;
  while (k < a.length && k < b.length && sameVal(a[k], b[k])) k += 1;
  return { popped: a.slice(k).reverse(), pushed: b.slice(k) };
}

// Queue semantics: removals at the FRONT, additions at the BACK. Find the smallest number of
// front removals that makes the remainder a prefix of the new queue.
export function diffQueue(prev = [], next = []) {
  const a = Array.isArray(prev) ? prev : [];
  const b = Array.isArray(next) ? next : [];
  for (let d = 0; d <= a.length; d += 1) {
    const rest = a.slice(d);
    if (rest.length <= b.length && rest.every((v, i) => sameVal(v, b[i]))) {
      return { dequeued: a.slice(0, d), enqueued: b.slice(rest.length) };
    }
  }
  return { dequeued: [...a], enqueued: [...b] }; // no overlap: full turnover
}

// ---- the translator ----------------------------------------------------------------------

// Ordered abstract op list for the WHOLE trace. Each op: { stepIndex, structure, op, target,
// value?, meta? }. Pure and total: bad input yields note ops, never an exception.
export function traceToJsavOps(algorithmObject) {
  const trace = normalizeTrace(algorithmObject);
  if (!trace) {
    return [{ stepIndex: 0, structure: 'message', op: 'note', target: null, value: 'no algorithm steps to animate' }];
  }
  const views = trace.views && typeof trace.views === 'object' ? trace.views : {};
  const ctx = {
    arrayLen: Array.isArray(views.array?.values) ? views.array.values.length : 0,
    initialArray: Array.isArray(views.array?.values) ? views.array.values : null,
    grid: views.array2d && Number.isInteger(views.array2d.rows) ? { rows: views.array2d.rows, cols: views.array2d.cols } : null,
    nodeIds: new Set((views.graph?.nodes ?? []).map((n) => String(n.id))),
    nodeLabel: new Map((views.graph?.nodes ?? []).map((n) => [String(n.id), n.label ?? n.id])),
    nodeCoords: new Map((views.graph?.nodes ?? []).map((n) => [String(n.id), Number.isFinite(n.x) && Number.isFinite(n.y) ? { x: n.x, y: n.y } : null])),
    edges: (views.graph?.edges ?? []).map((e) => [String(e.from), String(e.to)]),
    edgeKeys: new Set((views.graph?.edges ?? []).flatMap((e) => [`${String(e.from)}>${String(e.to)}`, `${String(e.to)}>${String(e.from)}`])),
    listIds: new Set((views.list?.nodes ?? []).map((n) => String(n.id))),
  };

  const ops = [];
  let transients = []; // [{structure, target, kind}] highlights to clear at the next step
  let prev = null;
  let prevLine = null;
  let shownArray = ctx.initialArray; // last full array snapshot (in-place algorithms)

  const state = { // accumulated recursion/graph memory across steps
    revealed: new Set(),
    returned: {},
    memo: new Set(),
    visited: new Set(),
    nodeState: {},
  };

  trace.steps.forEach((step, stepIndex) => {
    const emit = (structure, op, target, value, meta) => {
      ops.push({
        stepIndex,
        structure,
        op,
        target: target ?? null,
        ...(value !== undefined ? { value } : {}),
        ...(meta ? { meta } : {}),
      });
    };
    if (!step || typeof step !== 'object') {
      emit('message', 'note', null, 'unrecognized step (not an object)');
      return;
    }

    // 1) clear last step's one-step emphasis (JSAV effects persist unless undone).
    for (const t of transients) emit(t.structure, 'unhighlight', t.target, undefined, { kind: t.kind });
    transients = [];
    const flash = (structure, target, kind) => {
      emit(structure, 'highlight', target, undefined, { kind });
      if (TRANSIENT_KINDS.has(kind)) transients.push({ structure, target, kind });
    };

    // 2) code line + narration ride every step (JSAV: code.highlight + umsg).
    if (Number.isInteger(step.line) && step.line !== prevLine) {
      emit('code', 'setLine', step.line);
      prevLine = step.line;
    }
    if (typeof step.explanation === 'string' && step.explanation.trim()) {
      emit('message', 'umsg', null, step.explanation);
    }

    let recognized = false;
    const isRecursion = step.callId !== undefined || (step.graph && step.graph.revealed !== undefined);

    // ---- pointer-array family -------------------------------------------------------------
    if (step.array && typeof step.array === 'object' && !Array.isArray(step.array)) {
      recognized = true;
      const a = step.array;
      const inArr = (i) => Number.isInteger(i) && i >= 0 && (ctx.arrayLen === 0 || i < ctx.arrayLen);

      // pointers move first (the arrows riding the array)
      const prevPtrs = prev?.array?.pointers ?? {};
      for (const [name, idx] of Object.entries(a.pointers ?? {})) {
        if (!inArr(idx)) continue;
        if (prevPtrs[name] !== idx) emit('array', 'movePointer', idx, undefined, { name });
      }

      // in-place value changes: swap when the step declares one, setValue for the rest
      const swapPair = Array.isArray(a.swapped) && a.swapped.length === 2 && a.swapped.every(inArr) ? a.swapped : null;
      if (swapPair) emit('array', 'swap', [swapPair[0], swapPair[1]]);
      if (Array.isArray(a.values) && (ctx.arrayLen === 0 || a.values.length === ctx.arrayLen)) {
        const before = shownArray ?? [];
        a.values.forEach((v, i) => {
          if (swapPair && (i === swapPair[0] || i === swapPair[1])) return; // the swap already moved them
          if (!sameVal(before[i], v)) emit('array', 'setValue', i, v);
        });
        shownArray = a.values;
      }

      // emphasis
      for (const i of (a.comparing ?? []).filter(inArr)) flash('array', i, 'comparing');
      if (inArr(a.current)) flash('array', a.current, 'current');
      const prevElim = new Set(prev?.array?.eliminated ?? []);
      for (const i of (a.eliminated ?? []).filter(inArr)) {
        if (!prevElim.has(i)) emit('array', 'dim', i, undefined, { kind: 'eliminated' });
      }
      const prevDim = new Set(prev?.array?.dimmed ?? []);
      for (const i of (a.dimmed ?? []).filter(inArr)) {
        if (!prevDim.has(i)) emit('array', 'dim', i, undefined, { kind: 'dimmed' });
      }
      const prevSorted = new Set(prev?.array?.sorted ?? []);
      for (const i of (a.sorted ?? []).filter(inArr)) {
        if (!prevSorted.has(i)) emit('array', 'highlight', i, undefined, { kind: 'sorted' });
      }
    }

    // ---- dp-table / grid family -------------------------------------------------------------
    if (step.array2d && typeof step.array2d === 'object' && !Array.isArray(step.array2d)) {
      recognized = true;
      const g = step.array2d;
      const inGrid = (cell) => Array.isArray(cell) && cell.length >= 2 && Number.isInteger(cell[0]) && Number.isInteger(cell[1])
        && (!ctx.grid || (cell[0] >= 0 && cell[0] < ctx.grid.rows && cell[1] >= 0 && cell[1] < ctx.grid.cols));

      // dpvis order: the RECORDED reads flash FIRST, then the chosen winner, then the write —
      // the student sees where the value comes from before it lands.
      for (const cell of (step.reads ?? []).filter(inGrid)) flash('matrix', [cell[0], cell[1]], 'read');
      for (const cell of (step.chosen ?? []).filter(inGrid)) flash('matrix', [cell[0], cell[1]], 'chosen');
      for (const cell of (g.highlight ?? []).filter(inGrid)) flash('matrix', [cell[0], cell[1]], 'dep');
      if (inGrid(g.current)) flash('matrix', [g.current[0], g.current[1]], 'current');
      for (const v of g.values ?? []) {
        if (Array.isArray(v) && v.length === 3 && inGrid([v[0], v[1]])) {
          emit('matrix', 'setValue', [v[0], v[1]], v[2], step.phase ? { phase: step.phase } : undefined);
        }
      }
    }

    // ---- graph-walk vs recursion-tree (both declare views.graph) ----------------------------
    if (step.graph && typeof step.graph === 'object' && !Array.isArray(step.graph)) {
      recognized = true;
      const gr = step.graph;
      const structure = isRecursion ? 'tree' : 'graph';
      const knowsNodes = ctx.nodeIds.size > 0;
      const hasNode = (id) => id !== null && id !== undefined && (!knowsNodes || ctx.nodeIds.has(String(id)));

      if (isRecursion) {
        // the call tree GROWS: newly revealed vertices become addNode + the parent edge
        for (const idRaw of gr.revealed ?? []) {
          const id = String(idRaw);
          if (state.revealed.has(id) || !hasNode(id)) continue;
          state.revealed.add(id);
          const coords = ctx.nodeCoords.get(id) ?? null;
          emit('tree', 'addNode', id, ctx.nodeLabel.get(id) ?? id, coords ? { ...coords } : undefined);
          const parentEdge = ctx.edges.find(([from, to]) => to === id && state.revealed.has(from));
          if (parentEdge) emit('tree', 'addEdge', [parentEdge[0], parentEdge[1]]);
        }
        // returns land on the node and stay
        for (const [idRaw, val] of Object.entries(gr.returned ?? {})) {
          const id = String(idRaw);
          if (!hasNode(id)) continue;
          if (!(id in state.returned) || !sameVal(state.returned[id], val)) {
            state.returned[id] = val;
            emit('tree', 'setNodeValue', id, val, { kind: 'returned', ...(step.phase ? { phase: step.phase } : {}) });
          }
        }
        for (const idRaw of gr.memo ?? []) {
          const id = String(idRaw);
          if (!state.memo.has(id) && hasNode(id)) {
            state.memo.add(id);
            emit('tree', 'highlight', id, undefined, { kind: 'memo' });
          }
        }
        if (hasNode(gr.current)) flash('tree', String(gr.current), 'active');
        if (step.phase === 'backtrack') {
          const target = hasNode(step.callId) ? String(step.callId) : hasNode(gr.current) ? String(gr.current) : null;
          emit('tree', 'backtrack', target, undefined, step.undo ? { undo: step.undo } : undefined);
        }
      } else {
        // graph walk: visits are permanent, the current ring is transient
        for (const idRaw of gr.visited ?? []) {
          const id = String(idRaw);
          if (state.visited.has(id) || !hasNode(id)) continue; // existing nodes ONLY — never invent
          state.visited.add(id);
          emit('graph', 'visit', id);
        }
        if (hasNode(gr.current)) flash('graph', String(gr.current), 'current');
        // per-node label writes (dist/disc/low/indegree) — changed vars only
        if (step.nodeState && typeof step.nodeState === 'object' && !Array.isArray(step.nodeState)) {
          for (const [idRaw, kv] of Object.entries(step.nodeState)) {
            const id = String(idRaw);
            if (!hasNode(id) || !kv || typeof kv !== 'object') continue;
            for (const [k, v] of Object.entries(kv)) {
              if (!sameVal(state.nodeState[id]?.[k], v)) {
                emit('graph', 'setNodeValue', id, v, { field: k });
              }
            }
            state.nodeState[id] = { ...(state.nodeState[id] ?? {}), ...kv };
          }
        }
      }

      // the edge being ridden THIS step (declared edges only; reverse = a return ride)
      if (Array.isArray(step.activeEdge) && step.activeEdge.length === 2) {
        const [from, to] = step.activeEdge.map(String);
        const declared = ctx.edgeKeys.size === 0 || ctx.edgeKeys.has(`${from}>${to}`);
        if (declared && hasNode(from) && hasNode(to)) {
          emit(structure, isRecursion ? 'traverseEdge' : 'inspectEdge', [from, to],
            undefined, step.activeEdgeReverse === true ? { reverse: true } : undefined);
        }
      }
    }

    // ---- linked list (light coverage: named pointers stepping the chain) --------------------
    if (step.list && typeof step.list === 'object' && !Array.isArray(step.list)) {
      recognized = true;
      const prevListPtrs = prev?.list?.pointers ?? {};
      for (const [name, idRaw] of Object.entries(step.list.pointers ?? {})) {
        if (sameVal(prevListPtrs[name], idRaw)) continue;
        const id = idRaw === null ? null : String(idRaw);
        if (id === null || ctx.listIds.size === 0 || ctx.listIds.has(id)) {
          emit('list', 'movePointer', id, undefined, { name });
        }
      }
    }

    // ---- companion collections (frontiers, monotonic stacks, the call stack) ---------------
    if (Array.isArray(step.stack)) {
      recognized = true;
      const collection = isRecursion ? 'callStack' : 'stack';
      const { popped, pushed } = diffStack(prev?.stack ?? [], step.stack);
      for (const v of popped) emit('list', 'pop', collection, v, { collection });
      for (const v of pushed) emit('list', 'push', collection, v, { collection });
    }
    if (Array.isArray(step.queue)) {
      recognized = true;
      const { dequeued, enqueued } = diffQueue(prev?.queue ?? [], step.queue);
      for (const v of dequeued) emit('list', 'dequeue', 'queue', v, { collection: 'queue' });
      for (const v of enqueued) emit('list', 'enqueue', 'queue', v, { collection: 'queue' });
    }

    // intervals and any other structure this adapter does not yet animate: honest note, no throw
    if (!recognized) {
      if (step.intervals !== undefined) {
        emit('message', 'note', null, typeof step.explanation === 'string' ? step.explanation : 'intervals step', { kind: 'intervals' });
      } else {
        emit('message', 'note', null, typeof step.explanation === 'string' ? step.explanation : 'unrecognized step kind');
      }
    }

    prev = step;
  });

  return ops;
}

// Group the flat op list per step — convenience for step-scrubbing renderers.
export function opsByStep(algorithmObject) {
  const trace = normalizeTrace(algorithmObject);
  const total = trace?.steps?.length ?? 1;
  const grouped = Array.from({ length: total }, () => []);
  for (const op of traceToJsavOps(algorithmObject)) {
    if (op.stepIndex >= 0 && op.stepIndex < total) grouped[op.stepIndex].push(op);
  }
  return grouped;
}
