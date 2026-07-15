// PURE trace -> per-step visual state for the graph/tree renderer. No React, no DOM, no timers
// — a deterministic function of (content, cursor), so it is unit-testable and the render layer
// stays dumb (the split the studied tools use: compute a view-model, then render it). GraphView
// consumes these; the animation/styling lives in the components, the DECISIONS live here.

// resolveTraceStep({content, progress, activeStep, activeNode}) -> the resolved step state:
//   { current, visited(Set), pointerAt(Map name[]), note, stepNum, stepTotal, activeEdge,
//     revealed(Set|null), returned(obj), memo(Set) }
// Priority: explicit voice-synced step (activeStep) > timed/write progress > highlightSequence
// > a single active node. A pointer that sits on the current node is dropped (redundant).
export function resolveTraceStep({ content, progress = 1, activeStep = null, activeNode = null } = {}) {
  const trace = Array.isArray(content?.trace) && content.trace.length ? content.trace : null;
  if (trace) {
    const idx = activeStep != null
      ? Math.max(0, Math.min(trace.length - 1, activeStep))
      : Math.min(trace.length - 1, Math.floor(progress * trace.length + 1e-9));
    const at = Math.max(0, idx);
    const step = trace[at];
    // visited accumulates every node ever marked current up to (and not including) now.
    const visited = new Set((step.visited ?? []).map(String));
    for (let i = 0; i <= at; i += 1) if (trace[i].current != null) visited.add(String(trace[i].current));
    const current = step.current != null ? String(step.current) : null;
    if (current) visited.delete(current);
    const pointerAt = new Map();
    for (const [name, nid] of Object.entries(step.pointers ?? {})) {
      const key = String(nid);
      if (current && key === current) continue; // redundant with the current highlight
      if (!pointerAt.has(key)) pointerAt.set(key, []);
      pointerAt.get(key).push(name);
    }
    const activeEdge = Array.isArray(step.activeEdge) ? step.activeEdge.map(String) : null;
    const revealed = Array.isArray(step.revealed) ? new Set(step.revealed.map(String)) : null;
    const returned = step.returned && typeof step.returned === 'object' && !Array.isArray(step.returned) ? step.returned : {};
    const memo = new Set(Array.isArray(step.memo) ? step.memo.map(String) : []);
    // Per-node values (dist/indegree) live ON the drawing; the previous step's values let the
    // view render the instructor's "7 -> 3" rewrite at the exact relaxation moment.
    const values = step.values && typeof step.values === 'object' ? step.values : {};
    const prevValues = (at > 0 && trace[at - 1].values && typeof trace[at - 1].values === 'object') ? trace[at - 1].values : {};
    // Multi-key per-node state (disc/low, LH/RH): {nodeId: {var: value}} — the previous step's
    // map lets the renderer flash exactly the key that was rewritten at this moment.
    const nodeState = step.nodeState && typeof step.nodeState === 'object' ? step.nodeState : {};
    const prevNodeState = (at > 0 && trace[at - 1].nodeState && typeof trace[at - 1].nodeState === 'object') ? trace[at - 1].nodeState : {};
    return { current, visited, pointerAt, note: step.note ?? null, stepNum: at + 1, stepTotal: trace.length, activeEdge, revealed, returned, memo, values, prevValues, nodeState, prevNodeState };
  }
  const seq = Array.isArray(content?.highlightSequence) ? content.highlightSequence.map(String) : null;
  if (seq) {
    const n = Math.floor(progress * seq.length + 1e-9);
    const visited = new Set(seq.slice(0, n));
    const current = n > 0 ? seq[n - 1] : null;
    if (current) visited.delete(current);
    return EMPTY({ current, visited });
  }
  return EMPTY({ current: activeNode != null ? String(activeNode) : null });
}

function EMPTY(over) {
  return { current: null, visited: new Set(), pointerAt: new Map(), note: null, stepNum: 0, stepTotal: 0, activeEdge: null, revealed: null, returned: {}, memo: new Set(), values: {}, prevValues: {}, nodeState: {}, prevNodeState: {}, ...over };
}

// A node is a ghost until it has been revealed (recursion tree grows call by call). Ghost holds
// the layout steady; the current node is never a ghost even before it is formally "revealed".
export function isGhostNode(id, state) {
  return state.revealed !== null && !state.revealed.has(String(id)) && String(id) !== state.current;
}

// The per-node status enum the renderer maps to color + animation.
//   ghost | current | memoized | visited | notyet | plain
export function nodeStatus(id, state) {
  const key = String(id);
  if (isGhostNode(key, state)) return 'ghost';
  if (key === state.current) return 'current';
  if (state.memo.has(key)) return 'memoized';
  if (state.visited.has(key)) return 'visited';
  return state.stepTotal > 0 ? 'notyet' : 'plain';
}

// The per-edge status enum.
//   ghost | traversing (walked THIS step) | active (touches current / both-visited) | idle
export function edgeStatus(edge, state, directed = true) {
  const from = String(edge.from);
  const to = String(edge.to);
  if (isGhostNode(from, state) || isGhostNode(to, state)) return 'ghost';
  const ae = state.activeEdge;
  const traversing = !!ae && ((ae[0] === from && ae[1] === to) || (directed === false && ae[0] === to && ae[1] === from));
  if (traversing) return 'traversing';
  const active = from === state.current || to === state.current || (state.visited.has(from) && state.visited.has(to));
  return active ? 'active' : 'idle';
}
