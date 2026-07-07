// ExecutionTrace — the UNIFIED algorithm-execution timeline (pure, tested). This is the
// "missing layer": one trace of algorithm state over time that drives EVERY panel in sync —
// code line, data-structure view, stack/queue, variable table, and the spoken explanation.
//
// Research (Algorithm Visualizer tracers + ALGOGEN "verifiable traces"): the trace must come
// from REAL execution, and ONE step is a full visual STATE. So each step here carries the
// active code line, an optional structure snapshot (array/graph — same shape our ArrayView/
// GraphView already render), collections (stack/queue), scalar variables, and a plain-English
// explanation. The player maps clock -> stepIndex and lights up all panels for that step.

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
  if (views.graph !== undefined) {
    if (!Array.isArray(views.graph.nodes) || views.graph.nodes.length === 0) throw new Error(`${context} views.graph needs nodes[]`);
    if (!Array.isArray(views.graph.edges)) throw new Error(`${context} views.graph needs edges[]`);
    graphIds = new Set(views.graph.nodes.map((n) => String(n.id)));
    for (const e of views.graph.edges) {
      if (!graphIds.has(String(e.from)) || !graphIds.has(String(e.to))) throw new Error(`${context} views.graph edge references a missing node`);
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
      validateArrayState(step.array, arrIn, at);
    }
    if (step.graph !== undefined) {
      if (!graphIds) throw new Error(`${at} has graph state but no views.graph is declared`);
      validateGraphState(step.graph, graphIds, at);
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
    }
    if (step.traceRow !== undefined && (typeof step.traceRow !== 'object' || Array.isArray(step.traceRow))) {
      throw new Error(`${at} traceRow must be an object`);
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

function validateArrayState(state, inBounds, at) {
  if (typeof state !== 'object' || Array.isArray(state)) throw new Error(`${at} array state must be an object`);
  if (state.current !== undefined && state.current !== null && !inBounds(state.current)) throw new Error(`${at} array current index out of bounds`);
  if (state.eliminated !== undefined) {
    if (!Array.isArray(state.eliminated)) throw new Error(`${at} array eliminated must be an array`);
    for (const i of state.eliminated) if (!inBounds(i)) throw new Error(`${at} array eliminated index out of bounds`);
  }
  if (state.pointers !== undefined) {
    if (typeof state.pointers !== 'object' || Array.isArray(state.pointers)) throw new Error(`${at} array pointers must be an object`);
    for (const i of Object.values(state.pointers)) if (!inBounds(i)) throw new Error(`${at} array pointer index out of bounds`);
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
