// NARRATION STAGE of the linked-list tool. Sentences composed from REAL recorded node
// identities and values, hitting the canonical pointer-diagram teaching moments (research:
// Python Tutor's box-and-arrow model, debug-visualizer's reversal demo): a pointer advances,
// an arrow is REWIRED (the mutation that IS the algorithm), a node appears on the heap, a
// node becomes unreachable (the orphan/garbage moment every teacher draws an X over).

export function narrateStart({ entry }) {
  return `We run ${entry} and watch the chain itself: every box is a real node object from the run, every arrow is its live next-reference. Boxes never move — only the arrows and the named pointers do, and that is exactly where your eyes should be.`;
}

// A named pointer lands on a node (or walks off the end).
export function narratePointerMove({ name, valueLabel, isFirst }) {
  if (valueLabel === null) {
    return `${name} is now None — it has walked off the end of the chain. Reading ${name}.next here would crash: this exact moment is where null-checks earn their keep.`;
  }
  return isFirst
    ? `${name} starts on the node holding ${valueLabel} — remember which box it stands on; every decision below is made from where the named pointers stand.`
    : `${name} advances to the node holding ${valueLabel}. The pointer moved — the nodes did not; walking a list never touches the boxes, only where we are looking.`;
}

// A node's next-arrow changes target: the heart of insert/delete/reverse.
export function narrateRewire({ fromValue, oldToValue, newToValue }) {
  if (newToValue === null) {
    return `The arrow out of the node holding ${fromValue} is CUT: it pointed at ${oldToValue === null ? 'nothing' : `the node holding ${oldToValue}`}, and now it points at None — this node just became the tail of its chain.`;
  }
  if (oldToValue === null) {
    return `The node holding ${fromValue} gets its arrow: it now points at the node holding ${newToValue}. A link exists where there was none — the chain just grew by one connection.`;
  }
  return `REWIRE: the arrow out of the node holding ${fromValue} flips from the node holding ${oldToValue} to the node holding ${newToValue}. This single reassignment is the heart of the operation — everything else is just walking pointers into position.`;
}

// A new node object appears on the heap.
export function narrateNewNode({ valueLabel }) {
  return `A brand-new node holding ${valueLabel} appears on the heap. It exists, but until an arrow or a named pointer reaches it, the list does not know it — a node with nothing pointing at it is invisible to every traversal.`;
}

// A node becomes unreachable — the orphan/garbage teaching moment.
export function narrateDetach({ valueLabel }) {
  return `The node holding ${valueLabel} is now UNREACHABLE — no pointer and no arrow leads to it anymore (watch it fade). In Python the garbage collector quietly reclaims it; in C, forgetting to free at this exact moment is the classic memory leak.`;
}

export function narrateDone({ result, chain, truncated }) {
  if (truncated) {
    return `The recording stops HERE, on purpose: the walk kept repeating the same pattern past the recording cap, so watching more of it teaches nothing new. The run itself continued to completion and returned ${JSON.stringify(result)} — recorded honestly, cut openly.`;
  }
  const readback = chain.length ? ` Read the final chain off the arrows: ${chain.join(' → ')}.` : '';
  return `The operation is complete and the call returns ${JSON.stringify(result)}.${readback} Every arrow in the final picture was rewired in front of you — replay the flips and you have re-derived the algorithm.`;
}
