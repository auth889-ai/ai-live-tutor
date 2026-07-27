// VENDORED from brpapa/recursion-tree-visualizer (MIT) — the recursion-tree builder inside
// lambda/src/runner/steps/source-code.ts (the `fn(...args)` wrapper of the node/python
// codegen `bottom` blocks). See SOURCE.md for provenance and the exact modifications.
//
// The original builds the tree AT RUNTIME by wrapping the live recursive function: a currId
// counter mints one vertex per call, a stack keeps "the current top is the parent id of the
// current vertex", each new call pushes {childId, weight} onto its parent's adjList, and the
// weight lands when the call returns. Forever already records every real call/return with a
// sys.settrace pass (universal recorder), so this port replays the SAME stack discipline over
// the recorded events instead of wrapping the function — the ONLY event source is Forever's
// recording; the reference's Lambda runner and code templates are not used.
//
// MODIFIED vs upstream (each noted inline):
//   1. input is recorded events ({ev:'call'|'return', fn, args|value}), not live calls
//   2. memoized marking is behavioral: upstream flags a vertex when its own cache wrapper
//      short-circuits; a recording has no wrapper, so a vertex is flagged when it returned
//      CHILDLESS with the exact args+value an earlier call solved WITH real work (children)
//   3. no MAX_RECURSIVE_CALLS process exit — Forever's recorder caps events upstream; calls
//      left open by a truncated recording are reported in `openIds` instead
//   4. call/return event indices are reported per vertex so the adapter can align other
//      recorded evidence (collection ops, line events) with each call's lifetime

/**
 * Replay recorded call/return events of `fnName` through the reference builder's stack
 * discipline. Every edge parent->child exists only because child's call event fired while
 * parent was the innermost open call of fnName — proved by the recording, never inferred.
 *
 * @param {{ events: Array<object>, fnName: string, result?: any }} input
 * @returns {{
 *   vertices: import('./types.js').Vertices,
 *   fnResult: any,
 *   openIds: number[],
 *   callEventIndex: Map<number, number>,
 *   returnEventIndex: Map<number, number>,
 * }}
 */
export function buildTreeFromEvents({ events, fnName, result = undefined }) {
  const vertices = {};

  let currId = 0; // current vertex id                     (upstream: let currId = 0)
  const memoizedResults = new Map(); // for each list of args (upstream: memoizedResults = {})
  const stack = []; // the current top is the parent id of the current vertex

  const callEventIndex = new Map(); // MOD 4: vertexId -> index of its recorded call event
  const returnEventIndex = new Map();

  for (const [i, e] of (events ?? []).entries()) {
    if (e.ev === 'call' && e.fn === fnName) {
      // upstream fn() entry: mint the vertex, hang it under the open parent, push the stack
      vertices[currId] = {
        argsList: Object.values(e.args ?? {}),
        adjList: [],
        memoized: false,
      };
      if (stack.length > 0) {
        const parentId = stack[stack.length - 1];
        vertices[parentId].adjList.push({ childId: currId, weight: undefined });
      }
      callEventIndex.set(currId, i);
      stack.push(currId++);
    } else if (e.ev === 'return' && e.fn === fnName && stack.length > 0) {
      // upstream fn() exit: pop, land the weight on the parent's adj entry, feed the cache
      const vid = stack.pop();
      returnEventIndex.set(vid, i);
      if (stack.length > 0) {
        const parentId = stack[stack.length - 1];
        const adj = vertices[parentId].adjList.find((a) => a.childId === vid);
        if (adj) adj.weight = e.value;
      }
      // MOD 2 — behavioral memo detection: upstream marks memoized when its wrapper answers
      // from memoizedResults before recursing; the recorded equivalent of that shortcut is a
      // CHILDLESS return whose exact subproblem (same args, same value) was already solved
      // with real work earlier. The recording proves the shortcut — no naming conventions.
      const argsKey = JSON.stringify(vertices[vid].argsList);
      const prior = memoizedResults.get(argsKey);
      if (
        vertices[vid].adjList.length === 0
        && prior !== undefined
        && prior.hadChildren
        && JSON.stringify(prior.weight) === JSON.stringify(e.value)
      ) {
        vertices[vid].memoized = true;
      }
      if (prior === undefined) {
        memoizedResults.set(argsKey, { weight: e.value, hadChildren: vertices[vid].adjList.length > 0 });
      }
    }
  }

  // MOD 3: a truncated recording leaves the deepest spine open — report, never fake a close.
  return {
    vertices,
    fnResult: result,
    openIds: [...stack],
    callEventIndex,
    returnEventIndex,
  };
}
