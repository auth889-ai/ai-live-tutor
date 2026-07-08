// NARRATION STAGE of the graph-walk tool. Every sentence is composed from REAL recorded
// values and hits the canonical teaching moments of graph algorithms (research-verified from
// algorithm-visualizer's own Dijkstra/Bellman-Ford/Kahn sources): take/extract-min, relax
// with old -> new, finalize, union, indegree drop, and the terminal read-back.

// The tutor's frame beat: announce the run and what to track before anything moves.
export function narrateStart({ entry }) {
  return `We run ${entry} on this exact graph and watch the algorithm's own variables — the node being processed, the distance table, the frontier. Every value below was recorded from the real run; the picture can never disagree with the code.`;
}

// A node is pulled out of the frontier to be processed (Dijkstra's extract-min, Kahn's dequeue).
export function narrateTake({ node, via, dist }) {
  const cost = dist !== undefined ? ` Its tentative distance is ${JSON.stringify(dist)} — the smallest of everything still waiting, which is exactly why it goes next.` : '';
  const engine = via === 'stack' ? 'off the stack' : via === 'queue' ? 'out of the frontier' : 'up next';
  return `Now ${node} is taken ${engine} and becomes the node under the pointer.${cost} Whatever we learn in this moment, we learn by looking along ${node}'s edges.`;
}

// A distance-table entry improves (or appears): THE relaxation beat, old -> new with the why.
export function narrateRelax({ from, to, oldValue, newValue }) {
  if (oldValue === undefined) {
    return from
      ? `Through ${from} we reach ${to} for the first time: its distance becomes ${JSON.stringify(newValue)}. A blank cell in the table just got its first real number — watch it, it may still improve.`
      : `The table starts with ${to} = ${JSON.stringify(newValue)} — the starting point costs nothing to reach, and every other node begins unknown.`;
  }
  return `Relaxation: through ${from ?? 'the current node'}, ${to} is reachable in ${JSON.stringify(newValue)} — better than the ${JSON.stringify(oldValue)} we knew before, so the table is UPDATED. This one comparison, repeated everywhere, is the entire algorithm.`;
}

// A node is finalized (added to the visited/done set): the invariant beat.
export function narrateFinalize({ node }) {
  return `${node} is now FINALIZED — it turns green and its distance can never improve again, because any other route into it would have to pass through a node that is already farther away. That certainty is the invariant the whole algorithm rests on.`;
}

// Union-find: a root changes (merge) or an element starts as its own set.
export function narrateUnion({ child, root }) {
  if (String(child) === String(root)) {
    return `${child} starts as its own root — every element begins as a lone set of one, and the parent table simply points each element at itself until a union merges it into a family.`;
  }
  return `Union: ${child}'s root becomes ${root} — the two sets merge into one family, and any future find() on ${child}'s side will now walk up to ${root}. Watch the forest get flatter as unions accumulate.`;
}

// Kahn's: an incoming edge is satisfied and the count drops (0 = free to schedule).
export function narrateIndegree({ node, value }) {
  return Number(value) === 0
    ? `${node}'s indegree drops to 0 — every prerequisite it was waiting on is done, so ${node} is now FREE and joins the frontier to be scheduled.`
    : `One incoming edge of ${node} is satisfied; its indegree drops to ${JSON.stringify(value)}. It still waits — a node may only be scheduled when NOTHING points at it anymore.`;
}

// The frontier changed with no other event — still a visible moment, never a silent one.
export function narrateCollection({ kind, items }) {
  return items.length === 0
    ? `The ${kind} is now empty — nothing is waiting anymore, which is exactly the signal that the algorithm is about to finish.`
    : `The ${kind} now holds ${items.join(', ')} — these are the candidates still waiting for their turn; everything the algorithm will do next comes out of this list.`;
}

// Terminal beat: read the answer OUT of the walk (or cut the recording openly).
export function narrateDone({ result, orderNames, truncated }) {
  if (truncated) {
    return `The recording stops HERE, on purpose: the walk kept repeating the same pattern past the recording cap, so watching more of it teaches nothing new. The run itself continued to completion and returned ${JSON.stringify(result)} — recorded honestly, cut openly.`;
  }
  const order = orderNames.length ? ` Read the processing order back: ${orderNames.join(' → ')}.` : '';
  return `The walk is complete and the call returns ${JSON.stringify(result)}.${order} Every number in the final table was earned by a relaxation you watched happen — that is the whole proof, performed in front of you.`;
}
