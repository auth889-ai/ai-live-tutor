// NARRATION STAGE of the universal structure tool. Sentences composed from REAL extracted
// state: nodes appearing (the structure builds itself), the cursor walking (the traversal),
// and the terminal read-back. Generic across tree/graph problems but always value-specific —
// the labels and counts come from the actual objects in memory, never a template guess.

export function narrateStart({ entry }) {
  return `We run ${entry} and watch the structure itself: every circle is a real node object (or adjacency entry) extracted live from memory, every arrow a real reference. Nothing here was declared — the picture IS the program's own data, drawn as it exists at each step.`;
}

export function narrateGrow({ labels, total }) {
  const shown = labels.slice(0, 2).map((l) => `'${l}'`).join(' and ');
  const more = labels.length > 2 ? ` (and ${labels.length - 2} more)` : '';
  return `The structure grows: ${labels.length === 1 ? `a node holding ${shown} appears and is linked in` : `nodes holding ${shown}${more} appear and are linked in`} — ${total} node${total === 1 ? '' : 's'} now live in memory. Watch WHERE it attaches: the shape being built is the algorithm's whole plan.`;
}

export function narrateCursor({ name, label, fromLabel }) {
  const from = fromLabel != null ? ` leaving '${fromLabel}' behind` : '';
  return `${name} steps to the node holding '${label}'${from} — the pointer moved, the nodes did not. Every decision the code makes next is made from where ${name} now stands.`;
}

export function narrateDone({ result, nodeCount, edgeCount, truncated }) {
  if (truncated) {
    return `The recording stops HERE, on purpose: the walk kept repeating the same pattern past the recording cap, so watching more of it teaches nothing new. The run itself continued to completion and returned ${JSON.stringify(result)} — recorded honestly, cut openly.`;
  }
  return `The run is complete and the call returns ${JSON.stringify(result)}. The final structure holds ${nodeCount} node${nodeCount === 1 ? '' : 's'} and ${edgeCount} link${edgeCount === 1 ? '' : 's'} — every one extracted from the real objects the code created and walked. That picture is not an illustration of the algorithm; it IS the algorithm's memory.`;
}
