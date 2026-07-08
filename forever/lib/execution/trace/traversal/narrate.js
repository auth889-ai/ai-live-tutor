// NARRATION STAGE of the traversal tool (the recursion tool's narrate.js pattern — words are
// their own tested stage, never inlined into the step compiler). Every sentence is composed
// from REAL walk state and follows the tutor beats: what we do → what it means → what the
// engine (queue/stack) now holds → the common-mistake callout at the exact moment it applies.

// The walk begins: name the engine and the rule it enforces.
export function narrateInit({ isQueue, startName }) {
  return isQueue
    ? `We begin by placing the start node ${startName} into the queue. The queue is the engine of this traversal: whatever sits at its FRONT is always the next node we visit, and newly discovered neighbors join at the BACK — that is exactly what makes the walk go level by level.`
    : `We begin by pushing the start node ${startName} onto the stack. The stack drives depth-first order: we always continue from the node we discovered MOST recently, diving as deep as possible before backtracking.`;
}

// One visit: take → discover → skip-callout → order/engine recap. All names/positions real.
export function narrateVisit({ isQueue, structure, currentName, childNames, skippedNames, position, pendingNames }) {
  const takeVerb = isQueue
    ? `dequeue ${currentName} from the front of the queue`
    : `pop ${currentName} off the top of the stack`;
  const discover = childNames.length === 0
    ? `It has no unvisited neighbours, so nothing new is ${isQueue ? 'enqueued' : 'pushed'} — the ${structure} only shrinks here.`
    : childNames.length > 1
      ? `Its unvisited neighbours ${childNames.join(' and ')} are discovered and ${isQueue ? 'join the back of the queue to wait their turn' : 'are pushed onto the stack to be explored next'}.`
      : `Its unvisited neighbour ${childNames[0]} is discovered and ${isQueue ? 'joins the back of the queue to wait its turn' : 'is pushed onto the stack to be explored next'}.`;
  // The common-mistake callout every good tutor makes at exactly this moment: WHY a
  // neighbour gets skipped — the seen-set is what turns a possible infinite loop into O(V+E).
  const skipNote = skippedNames.length > 0
    ? ` Note ${skippedNames.join(' and ')} ${skippedNames.length > 1 ? 'are' : 'is'} skipped: already seen. That check is the whole reason this walk can never loop forever — forgetting it is THE classic traversal bug.`
    : '';
  const orderNote = isQueue
    ? ` Watch the visit order strip: ${currentName} takes position ${position}, and the queue now holds ${pendingNames.length ? pendingNames.join(', ') : 'nothing — we are almost done'}.`
    : ` The stack now holds ${pendingNames.length ? pendingNames.join(', ') + ' (top last)' : 'nothing — every path has been fully explored'}.`;
  return `We ${takeVerb} and visit it — it turns green and stays green, it is done forever. ${discover}${skipNote}${orderNote}`;
}

// The terminal beat: read the answer OUT of the walk just performed, then the complexity.
export function narrateDone({ isQueue, structure, orderNames }) {
  return `The ${structure} is empty, so the traversal is complete. Read the visit order back: ${orderNames.join(' → ')} — ${isQueue ? 'level by level, exactly the order the queue released them' : 'each branch explored to its full depth before backtracking'}. Every node was visited exactly once, which is why this runs in O(V + E).`;
}
