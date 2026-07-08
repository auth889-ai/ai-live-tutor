// Traversal trace compiler — BFS / DFS / level-order as a DETERMINISTIC TOOL (pure code,
// tested), following the same division of labor as the recursion compiler: the model supplies
// only the STRUCTURE (nodes/edges), the traversal kind and start node, and which code lines
// teach each action; OUR engine actually runs the traversal and emits every step — current
// node, cumulative visited, live queue/stack, active edge, and a full teacher explanation.
// No model-written tracker programs, no sandbox, no imagined frames: the most common DSA
// lessons (tree/graph walks) become instant and exact.

import { validateExecutionTrace } from '../../board/execution/execution-trace.js';

export const TRAVERSAL_KINDS = Object.freeze(['bfs', 'dfs', 'level_order']);

// compileTraversalTrace({ graph, kind, start, code, language, lines })
// graph: { nodes: [{id, label}], edges: [{from, to, side?}], directed? } — children in emission
// order (or left/right by side). lines: teaching lines in `code` — {init, dequeue, visit,
// enqueue, pop, push, done}; missing entries fall back to line 1.
export function compileTraversalTrace({ graph, kind = 'bfs', start, code, language = 'python', lines = {} } = {}) {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  if (nodes.length === 0) throw new Error('traversal needs a non-empty graph');
  const kindName = TRAVERSAL_KINDS.includes(kind) ? kind : 'bfs';
  const ids = new Set(nodes.map((n) => String(n.id)));
  const startId = String(start ?? nodes[0].id);
  if (!ids.has(startId)) throw new Error(`traversal start "${start}" is not a node in the graph`);
  const labelOf = new Map(nodes.map((n) => [String(n.id), String(n.label ?? n.id)]));
  const name = (id) => labelOf.get(String(id)) ?? String(id);

  const lineCount = String(code ?? '').split('\n').length;
  const lineOf = (k) => {
    const l = Number(lines[k]);
    return Number.isInteger(l) && l >= 1 && l <= lineCount ? l : 1;
  };

  // Adjacency in teaching order: emission order, or left-before-right when sides are given.
  const adj = new Map([...ids].map((id) => [id, []]));
  for (const e of edges) {
    const from = String(e.from);
    const to = String(e.to);
    if (!ids.has(from) || !ids.has(to)) throw new Error(`traversal edge ${from}->${to} references a missing node`);
    adj.get(from).push({ to, side: e.side === 'left' || e.side === 'right' ? e.side : null });
    if (graph.directed === false) adj.get(to).push({ to: from, side: null });
  }
  for (const list of adj.values()) {
    if (list.length === 2 && list.every((c) => c.side)) list.sort((a) => (a.side === 'left' ? -1 : 1));
  }

  const isQueue = kindName !== 'dfs';
  const structure = isQueue ? 'queue' : 'stack';
  const steps = [];
  const visited = [];
  const seen = new Set([startId]);
  const pending = [startId]; // queue (shift) or stack (pop)
  const collection = () => pending.map(name);
  const snap = (over) => ({
    line: over.line,
    explanation: over.explanation,
    graph: { current: over.current ?? null, visited: [...visited], pointers: over.current ? { curr: over.current } : {} },
    [structure]: collection(),
    variables: over.variables ?? {},
    ...(over.activeEdge ? { activeEdge: over.activeEdge } : {}),
  });

  steps.push(snap({
    line: lineOf('init'),
    current: null,
    explanation: isQueue
      ? `We begin by placing the start node ${name(startId)} into the queue. The queue is the engine of this traversal: whatever sits at its FRONT is always the next node we visit, and newly discovered neighbors join at the BACK — that is exactly what makes the walk go level by level.`
      : `We begin by pushing the start node ${name(startId)} onto the stack. The stack drives depth-first order: we always continue from the node we discovered MOST recently, diving as deep as possible before backtracking.`,
  }));

  let guard = 0;
  while (pending.length > 0 && (guard += 1) < 10_000) {
    const currentId = isQueue ? pending.shift() : pending.pop();
    visited.push(currentId);
    const children = (adj.get(currentId) ?? []).filter((c) => !seen.has(c.to));
    for (const c of children) seen.add(c.to);
    const pushList = isQueue ? children : [...children].reverse(); // stack: reverse so first child is explored first
    pending.push(...pushList.map((c) => c.to));

    const childNames = children.map((c) => name(c.to));
    const takeVerb = isQueue ? `dequeue ${name(currentId)} from the front of the queue` : `pop ${name(currentId)} off the top of the stack`;
    const discover = childNames.length === 0
      ? `It has no unvisited neighbours, so nothing new is ${isQueue ? 'enqueued' : 'pushed'} — the ${structure} only shrinks here.`
      : childNames.length > 1
        ? `Its unvisited neighbours ${childNames.join(' and ')} are discovered and ${isQueue ? 'join the back of the queue to wait their turn' : 'are pushed onto the stack to be explored next'}.`
        : `Its unvisited neighbour ${childNames[0]} is discovered and ${isQueue ? 'joins the back of the queue to wait its turn' : 'is pushed onto the stack to be explored next'}.`;
    const orderNote = isQueue
      ? ` Watch the visit order strip: ${name(currentId)} takes position ${visited.length}, and the queue now holds ${pending.length ? pending.map(name).join(', ') : 'nothing — we are almost done'}.`
      : ` The stack now holds ${pending.length ? pending.map(name).join(', ') + ' (top last)' : 'nothing — every path has been fully explored'}.`;

    steps.push(snap({
      line: lineOf('visit'),
      current: currentId,
      activeEdge: visited.length > 1 ? findParentEdge(edges, currentId, visited, graph.directed) : null,
      variables: isQueue ? { visiting: name(currentId), queueSize: pending.length } : { visiting: name(currentId), stackDepth: pending.length },
      explanation: `We ${takeVerb} and visit it — it turns green and stays green, it is done forever. ${discover}${orderNote}`,
    }));
  }

  steps.push(snap({
    line: lineOf('done'),
    current: null,
    explanation: `The ${structure} is empty, so the traversal is complete. Read the visit order back: ${visited.map(name).join(' → ')} — ${isQueue ? 'level by level, exactly the order the queue released them' : 'each branch explored to its full depth before backtracking'}. Every node was visited exactly once, which is why this runs in O(V + E).`,
  }));

  const trace = {
    language,
    code: String(code ?? ''),
    views: { graph: { nodes, edges, directed: graph.directed !== false } },
    steps,
  };
  return validateExecutionTrace(trace, 'traversal trace');
}

// The edge we walked to reach `currentId`: from its already-visited parent (teaching visual —
// the coral flowing edge). Undirected graphs match either endpoint.
function findParentEdge(edges, currentId, visited, directed) {
  const before = new Set(visited.slice(0, -1).map(String));
  for (const e of edges) {
    const from = String(e.from);
    const to = String(e.to);
    if (to === String(currentId) && before.has(from)) return [from, to];
    if (directed === false && from === String(currentId) && before.has(to)) return [to, from];
  }
  return null;
}
