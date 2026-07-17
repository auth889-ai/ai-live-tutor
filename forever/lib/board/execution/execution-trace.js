// ExecutionTrace — the UNIFIED algorithm-execution timeline (pure, tested). This is the
// "missing layer": one trace of algorithm state over time that drives EVERY panel in sync —
// code line, data-structure view, stack/queue, variable table, and the spoken explanation.
//
// Research (Algorithm Visualizer tracers + ALGOGEN "verifiable traces"): the trace must come
// from REAL execution, and ONE step is a full visual STATE. So each step here carries the
// active code line, an optional structure snapshot (array/graph — same shape our ArrayView/
// GraphView already render), collections (stack/queue), scalar variables, and a plain-English
// explanation. The player maps clock -> stepIndex and lights up all panels for that step.

import { validateStepEvents } from '../../execution/trace/events/taxonomy.js';

export const TRACE_LANGUAGES = Object.freeze(['python', 'javascript', 'typescript', 'cpp', 'c', 'java', 'go', 'sql']);

export function validateExecutionTrace(trace, context = 'execution trace') {
  if (!trace || typeof trace !== 'object') throw new Error(`${context} must be an object`);
  if (!TRACE_LANGUAGES.includes(trace.language)) {
    throw new Error(`${context} language must be one of ${TRACE_LANGUAGES.join(', ')} (got "${trace.language}")`);
  }
  if (typeof trace.code !== 'string' || !trace.code.trim()) throw new Error(`${context} needs a non-empty code string`);
  const lineCount = trace.code.split('\n').length;

  // Static definitions of the structural views this trace animates (at least one is typical,
  // but a pure loop/variable trace may have none).
  const views = trace.views ?? {};
  if (typeof views !== 'object' || Array.isArray(views)) throw new Error(`${context} views must be an object`);
  let arrayLen = 0;
  let graphIds = null;
  if (views.array !== undefined) {
    if (!Array.isArray(views.array.values) || views.array.values.length === 0) {
      throw new Error(`${context} views.array needs a non-empty values[]`);
    }
    arrayLen = views.array.values.length;
  }
  let graphEdgePairs = null;
  if (views.graph !== undefined) {
    if (!Array.isArray(views.graph.nodes) || views.graph.nodes.length === 0) throw new Error(`${context} views.graph needs nodes[]`);
    if (!Array.isArray(views.graph.edges)) throw new Error(`${context} views.graph needs edges[]`);
    graphIds = new Set(views.graph.nodes.map((n) => String(n.id)));
    for (const e of views.graph.edges) {
      if (!graphIds.has(String(e.from)) || !graphIds.has(String(e.to))) throw new Error(`${context} views.graph edge references a missing node`);
    }
    // DIRECTION LAW (external probe: a reverse 2->1 on a declared 1->2 rendered as an
    // ordinary traversal): on DIRECTED graphs an activeEdge must match the declared
    // orientation exactly; riding an edge BACKWARDS (returns/backtracks) is legal only when
    // the step SAYS so (activeEdgeReverse: true — drawn as a return, never as a traversal).
    // Undirected graphs accept either orientation.
    const directedG = views.graph.directed !== false;
    graphEdgePairs = {
      forward: new Set(views.graph.edges.map((e) => `${String(e.from)}>${String(e.to)}`)),
      any: new Set(views.graph.edges.flatMap((e) => [`${String(e.from)}>${String(e.to)}`, `${String(e.to)}>${String(e.from)}`])),
      directed: directedG,
    };
  }
  // Linked-list chain view: node ids in FIRST-APPEARANCE order (box positions are fixed for
  // the whole animation — only arrows and named pointers move between steps).
  let listIds = null;
  if (views.list !== undefined) {
    if (!Array.isArray(views.list.nodes) || views.list.nodes.length === 0) throw new Error(`${context} views.list needs nodes[]`);
    listIds = new Set(views.list.nodes.map((n) => String(n.id)));
  }
  // Number-line intervals (merge intervals, meeting rooms): sorted [start,end] bars that fuse.
  let intervalCount = 0;
  if (views.intervals !== undefined) {
    const list = views.intervals.intervals;
    const pair = (iv) => Array.isArray(iv) && iv.length === 2 && iv.every((n) => typeof n === 'number');
    if (!Array.isArray(list) || list.length === 0 || !list.every(pair)) {
      throw new Error(`${context} views.intervals needs a non-empty intervals[] of [start,end] number pairs`);
    }
    intervalCount = list.length;
  }
  // Array2DTracer equivalent: a grid / DP table (Fibonacci memo, LCS, knapsack, matrices, grids).
  let grid = null;
  if (views.array2d !== undefined) {
    const rows = views.array2d.rows;
    const cols = views.array2d.cols;
    if (!Number.isInteger(rows) || rows <= 0 || !Number.isInteger(cols) || cols <= 0) {
      throw new Error(`${context} views.array2d needs positive integer rows and cols`);
    }
    if (views.array2d.rowLabels !== undefined && (!Array.isArray(views.array2d.rowLabels) || views.array2d.rowLabels.length !== rows)) {
      throw new Error(`${context} views.array2d.rowLabels must be an array of length rows`);
    }
    if (views.array2d.colLabels !== undefined && (!Array.isArray(views.array2d.colLabels) || views.array2d.colLabels.length !== cols)) {
      throw new Error(`${context} views.array2d.colLabels must be an array of length cols`);
    }
    grid = { rows, cols };
  }

  if (views.bitmask !== undefined) {
    if (!Number.isInteger(views.bitmask.bits) || views.bitmask.bits < 1 || views.bitmask.bits > 20) {
      throw new Error(`${context} views.bitmask needs integer bits in 1..20`);
    }
  }
  if (!Array.isArray(trace.steps) || trace.steps.length === 0) throw new Error(`${context} needs a non-empty steps[]`);
  const arrIn = (i) => Number.isInteger(i) && i >= 0 && i < arrayLen;
  trace.steps.forEach((step, s) => {
    const at = `${context} step ${s}`;
    if (!step || typeof step !== 'object') throw new Error(`${at} must be an object`);
    if (!Number.isInteger(step.line) || step.line < 1 || step.line > lineCount) {
      throw new Error(`${at} line must be a valid 1-based code line (1..${lineCount})`);
    }
    if (typeof step.explanation !== 'string' || !step.explanation.trim()) throw new Error(`${at} needs an explanation`);

    if (step.array !== undefined) {
      if (arrayLen === 0) throw new Error(`${at} has array state but no views.array is declared`);
      validateArrayState(step.array, arrIn, at, arrayLen);
    }
    if (step.intervals !== undefined) {
      if (intervalCount === 0) throw new Error(`${at} has intervals state but no views.intervals is declared`);
      const pair = (iv) => Array.isArray(iv) && iv.length === 2 && iv.every((n) => typeof n === 'number');
      if (!Array.isArray(step.intervals.merged) || !step.intervals.merged.every(pair)) {
        throw new Error(`${at} intervals.merged must be an array of [start,end] number pairs`);
      }
      if (step.intervals.current !== undefined && (!Number.isInteger(step.intervals.current) || step.intervals.current < 0 || step.intervals.current >= intervalCount)) {
        throw new Error(`${at} intervals.current must index the declared intervals`);
      }
    }
    if (step.graph !== undefined) {
      if (!graphIds) throw new Error(`${at} has graph state but no views.graph is declared`);
      validateGraphState(step.graph, graphIds, at);
    }
    if (step.array2d !== undefined) {
      if (!grid) throw new Error(`${at} has array2d state but no views.array2d is declared`);
      validateGridState(step.array2d, grid, at);
    }
    if (step.list !== undefined) {
      if (!listIds) throw new Error(`${at} has list state but no views.list is declared`);
      validateListState(step.list, listIds, at);
    }
    if (step.stack !== undefined && !Array.isArray(step.stack)) throw new Error(`${at} stack must be an array`);
    if (step.queue !== undefined && !Array.isArray(step.queue)) throw new Error(`${at} queue must be an array`);
    if (step.variables !== undefined && (typeof step.variables !== 'object' || Array.isArray(step.variables))) {
      throw new Error(`${at} variables must be an object`);
    }
    // Clock-driven timing (optional): the player maps audio time -> step via [startMs, endMs).
    if (step.startMs !== undefined && !(Number.isFinite(step.startMs) && step.startMs >= 0)) throw new Error(`${at} startMs must be a non-negative number`);
    if (step.endMs !== undefined && !(Number.isFinite(step.endMs) && step.endMs > (step.startMs ?? 0))) throw new Error(`${at} endMs must be greater than startMs`);
    if (step.voiceLineId !== undefined && typeof step.voiceLineId !== 'string') throw new Error(`${at} voiceLineId must be a string`);
    // Active edge being traversed THIS step (e.g. A -> B in a BFS): [fromId, toId], both real nodes.
    if (step.activeEdge !== undefined && step.activeEdge !== null) {
      if (!Array.isArray(step.activeEdge) || step.activeEdge.length !== 2) throw new Error(`${at} activeEdge must be [fromId, toId]`);
      if (!graphIds) throw new Error(`${at} has activeEdge but no views.graph is declared`);
      for (const nid of step.activeEdge) if (!graphIds.has(String(nid))) throw new Error(`${at} activeEdge references a missing node`);
      // MEMBERSHIP, not just node existence (external review: an INVENTED edge whose two
      // endpoints happen to exist rendered as confidently as a real one — 3->1 on a graph
      // with no such edge). The edge must be declared, respecting direction.
      const fwdKey = `${String(step.activeEdge[0])}>${String(step.activeEdge[1])}`;
      const revKey = `${String(step.activeEdge[1])}>${String(step.activeEdge[0])}`;
      if (!graphEdgePairs.any.has(fwdKey)) {
        throw new Error(`${at} activeEdge ${step.activeEdge[0]}->${step.activeEdge[1]} is not a declared edge of views.graph`);
      }
      if (graphEdgePairs.directed && !graphEdgePairs.forward.has(fwdKey)) {
        if (step.activeEdgeReverse !== true) {
          throw new Error(`${at} activeEdge ${step.activeEdge[0]}->${step.activeEdge[1]} rides the declared edge ${revKey.replace('>', '->')} BACKWARDS without activeEdgeReverse — a directed traversal may not be drawn in reverse`);
        }
      }
    }
    if (step.traceRow !== undefined && (typeof step.traceRow !== 'object' || Array.isArray(step.traceRow))) {
      throw new Error(`${at} traceRow must be an object`);
    }
    // Typed events (B2): universal-verb vocabulary enforced; a graphNode target must exist.
    if (step.events !== undefined) {
      validateStepEvents(step.events, at);
      for (const e of step.events) {
        const id = e.target?.entityId;
        if (typeof id !== 'string') continue;
        // Structure gate (external review: gridCell:99:99 passed on a 1x1 grid): every typed
        // target must exist in the DECLARED structure — graph nodes, grid bounds, array bounds.
        if (id.startsWith('graphNode:') && graphIds && !graphIds.has(id.slice('graphNode:'.length))) {
          throw new Error(`${at} event targets missing ${id}`);
        }
        if (id.startsWith('gridCell:')) {
          const [r, c] = id.slice('gridCell:'.length).split(':').map(Number);
          if (!grid) throw new Error(`${at} event targets ${id} but no views.array2d is declared`);
          if (!(Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < grid.rows && c >= 0 && c < grid.cols)) {
            throw new Error(`${at} event targets ${id} outside the ${grid.rows}x${grid.cols} grid`);
          }
        }
        if (id.startsWith('arrayCell:')) {
          const i = Number(id.slice('arrayCell:'.length));
          if (!(Number.isInteger(i) && i >= 0 && i < arrayLen)) throw new Error(`${at} event targets ${id} outside the array`);
        }
        if (id.startsWith('listNode:') && listIds && !listIds.has(id.slice('listNode:'.length))) {
          throw new Error(`${at} event targets missing ${id}`);
        }
        // UNKNOWN TYPED IDS (external probe: listNode:ghost passed): only the known entity
        // namespaces may appear at all — an unrecognized type is rejected, not ignored.
        const knownType = ['graphNode:', 'gridCell:', 'arrayCell:', 'listNode:', 'edge:', 'interval:', 'collection:', 'callFrame:'].some((t) => id.startsWith(t));
        if (!knownType) throw new Error(`${at} event target "${id}" uses an unknown entity namespace`);
        // Formula operands are references too — same gate.
        for (const op of e.formula?.operands ?? []) {
          const ref = op?.ref;
          if (typeof ref === 'string' && ref.startsWith('gridCell:') && grid) {
            const [rr, cc] = ref.slice('gridCell:'.length).split(':').map(Number);
            if (!(rr >= 0 && rr < grid.rows && cc >= 0 && cc < grid.cols)) {
              throw new Error(`${at} formula operand ${ref} outside the ${grid.rows}x${grid.cols} grid`);
            }
          }
        }
      }
    }
    if (step.maskState !== undefined) {
      if (!Number.isInteger(step.maskState.mask) || typeof step.maskState.binary !== 'string') {
        throw new Error(`${at} maskState needs {mask:int, binary:string}`);
      }
    }
    // CallFrame channel (B3): the live call stack per step — light shape check.
    if (step.frames !== undefined) {
      if (!Array.isArray(step.frames)) throw new Error(`${at} frames must be an array`);
      for (const f of step.frames) {
        if (!f || typeof f.frameId !== 'string' || typeof f.functionName !== 'string'
          || !['active', 'waiting', 'returned', 'threw'].includes(f.status)) {
          throw new Error(`${at} frames entries need {frameId, functionName, status: active|waiting|returned|threw}`);
        }
      }
    }
    // Per-node state labels (disc/low/rank/level) riding on the drawing: {nodeId: {var: scalar}},
    // every node id real — a label pointing at a node that does not exist is a lie, so it throws.
    if (step.nodeState !== undefined) {
      if (typeof step.nodeState !== 'object' || Array.isArray(step.nodeState)) throw new Error(`${at} nodeState must be an object`);
      if (!graphIds) throw new Error(`${at} has nodeState but no views.graph is declared`);
      for (const [nid, kv] of Object.entries(step.nodeState)) {
        if (!graphIds.has(String(nid))) throw new Error(`${at} nodeState references a missing node "${nid}"`);
        if (!kv || typeof kv !== 'object' || Array.isArray(kv)) throw new Error(`${at} nodeState["${nid}"] must be an object of per-variable values`);
      }
    }
  });

  // If ANY step is timed, ALL must be, and windows must be ascending + non-overlapping — so the
  // clock maps to exactly one step (deterministic seek).
  const timedCount = trace.steps.filter((s) => s.startMs !== undefined).length;
  if (timedCount > 0 && timedCount !== trace.steps.length) {
    throw new Error(`${context}: either all steps carry startMs or none do (got ${timedCount}/${trace.steps.length})`);
  }
  if (timedCount === trace.steps.length && timedCount > 0) {
    for (let i = 1; i < trace.steps.length; i += 1) {
      if (trace.steps[i].startMs < (trace.steps[i - 1].endMs ?? trace.steps[i - 1].startMs)) {
        throw new Error(`${context} step ${i}: startMs must not precede the previous step's end (windows must be ordered)`);
      }
    }
  }
  return trace;
}

// Clock-driven, DETERMINISTIC: given audio time tMs, return the active step + accumulated history
// (visited persists, trace-table rows revealed so far). Pure — seeking to the same tMs always
// yields the same state, and it never uses setTimeout. Requires timed steps (startMs on each).
export function traceStateAtMs(trace, tMs) {
  const steps = trace.steps;
  if (!steps.length) return null;
  if (steps[0].startMs === undefined) {
    throw new Error('traceStateAtMs requires timed steps (each step needs startMs); use traceStateAt(progress) for untimed traces');
  }
  // Last step whose window has started at or before tMs (clamps to 0 before the first, last after).
  let index = 0;
  for (let i = 0; i < steps.length; i += 1) {
    if (tMs >= steps[i].startMs) index = i;
    else break;
  }
  const history = steps.slice(0, index + 1).map((s, i) => ({
    step: i + 1,
    line: s.line,
    variables: s.variables ?? {},
    traceRow: s.traceRow ?? null,
  }));
  return { index, step: steps[index], history };
}

function validateArrayState(state, inBounds, at, arrayLen) {
  if (typeof state !== 'object' || Array.isArray(state)) throw new Error(`${at} array state must be an object`);
  if (state.current !== undefined && state.current !== null && !inBounds(state.current)) throw new Error(`${at} array current index out of bounds`);
  if (state.eliminated !== undefined) {
    if (!Array.isArray(state.eliminated)) throw new Error(`${at} array eliminated must be an array`);
    for (const i of state.eliminated) if (!inBounds(i)) throw new Error(`${at} array eliminated index out of bounds`);
  }
  // `dimmed` = out of the active focus (another call's cells in divide & conquer): faded, NOT
  // struck through — those values are not ruled out, they simply belong to a different band.
  if (state.dimmed !== undefined) {
    if (!Array.isArray(state.dimmed)) throw new Error(`${at} array dimmed must be an array`);
    for (const i of state.dimmed) if (!inBounds(i)) throw new Error(`${at} array dimmed index out of bounds`);
  }
  if (state.pointers !== undefined) {
    if (typeof state.pointers !== 'object' || Array.isArray(state.pointers)) throw new Error(`${at} array pointers must be an object`);
    for (const i of Object.values(state.pointers)) if (!inBounds(i)) throw new Error(`${at} array pointer index out of bounds`);
  }
  // Sorting markers (Array1DTracer's select/patch): cells being compared, just swapped, or locked
  // in their final sorted position — the whole vocabulary of a sorting animation.
  for (const key of ['comparing', 'swapped', 'sorted']) {
    if (state[key] !== undefined) {
      if (!Array.isArray(state[key])) throw new Error(`${at} array ${key} must be an array of indices`);
      for (const i of state[key]) if (!inBounds(i)) throw new Error(`${at} array ${key} index out of bounds`);
    }
  }
  // Live per-step contents for in-place algorithms (sorting, partitioning): the REAL recorded
  // snapshot of the array at this step. Same length as the declared view — cells move, the
  // array never grows or shrinks mid-animation.
  if (state.rule !== undefined && typeof state.rule !== 'string') throw new Error(`${at} array2d rule must be a string`);
  if (state.values !== undefined) {
    if (!Array.isArray(state.values) || state.values.length !== arrayLen) {
      throw new Error(`${at} array values must be an array with the same length as views.array.values`);
    }
  }
}

// A grid / DP-table state (Array2DTracer): which cell is being computed now, which are filled,
// which are highlighted as dependencies, plus optional value updates {r,c,value}.
function validateGridState(state, grid, at) {
  if (typeof state !== 'object' || Array.isArray(state)) throw new Error(`${at} array2d state must be an object`);
  const cellIn = (cell) =>
    Array.isArray(cell) && cell.length === 2 && Number.isInteger(cell[0]) && Number.isInteger(cell[1]) &&
    cell[0] >= 0 && cell[0] < grid.rows && cell[1] >= 0 && cell[1] < grid.cols;
  if (state.current !== undefined && state.current !== null && !cellIn(state.current)) throw new Error(`${at} array2d current cell out of bounds`);
  for (const key of ['filled', 'highlight']) {
    if (state[key] !== undefined) {
      if (!Array.isArray(state[key])) throw new Error(`${at} array2d ${key} must be an array of [row,col] cells`);
      for (const cell of state[key]) if (!cellIn(cell)) throw new Error(`${at} array2d ${key} cell out of bounds`);
    }
  }
  if (state.rule !== undefined && typeof state.rule !== 'string') throw new Error(`${at} array2d rule must be a string`);
  if (state.values !== undefined) {
    if (!Array.isArray(state.values)) throw new Error(`${at} array2d values must be an array of [row,col,value]`);
    for (const v of state.values) {
      if (!Array.isArray(v) || v.length !== 3 || !cellIn([v[0], v[1]])) throw new Error(`${at} array2d value must be [row,col,value] within the grid`);
    }
  }
}

// A linked-list chain state: node snapshots {id, value, next, orphan?, rewired?} plus the
// named pointers standing on nodes (or None). Every referenced id must be a declared node.
function validateListState(state, ids, at) {
  if (typeof state !== 'object' || Array.isArray(state)) throw new Error(`${at} list state must be an object`);
  if (!Array.isArray(state.nodes)) throw new Error(`${at} list nodes must be an array`);
  for (const n of state.nodes) {
    if (!n || typeof n !== 'object' || !ids.has(String(n.id))) throw new Error(`${at} list node references a missing id`);
    if (n.next !== undefined && n.next !== null && !ids.has(String(n.next))) throw new Error(`${at} list node next references a missing id`);
  }
  if (state.pointers !== undefined) {
    if (typeof state.pointers !== 'object' || Array.isArray(state.pointers)) throw new Error(`${at} list pointers must be an object`);
    for (const nid of Object.values(state.pointers)) {
      if (nid !== null && !ids.has(String(nid))) throw new Error(`${at} list pointer references a missing id`);
    }
  }
}

function validateGraphState(state, ids, at) {
  if (typeof state !== 'object' || Array.isArray(state)) throw new Error(`${at} graph state must be an object`);
  if (state.current !== undefined && state.current !== null && !ids.has(String(state.current))) throw new Error(`${at} graph current references a missing node`);
  if (state.visited !== undefined) {
    if (!Array.isArray(state.visited)) throw new Error(`${at} graph visited must be an array`);
    for (const nid of state.visited) if (!ids.has(String(nid))) throw new Error(`${at} graph visited references a missing node`);
  }
  if (state.pointers !== undefined) {
    if (typeof state.pointers !== 'object' || Array.isArray(state.pointers)) throw new Error(`${at} graph pointers must be an object`);
    for (const nid of Object.values(state.pointers)) if (!ids.has(String(nid))) throw new Error(`${at} graph pointer references a missing node`);
  }
}

// The visual state at a clock position: which step is active, plus an accumulated variable
// history so a trace table can show how i/low/high/mid evolved up to now.
export function traceStateAt(trace, progress) {
  const n = trace.steps.length;
  const idx = Math.min(n - 1, Math.max(0, Math.floor(progress * n + 1e-9)));
  const history = trace.steps.slice(0, idx + 1).map((step, i) => ({ step: i + 1, line: step.line, variables: step.variables ?? {} }));
  return { index: idx, step: trace.steps[idx], history };
}
