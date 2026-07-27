// VOICE STAGE of the recursion tool: the tutor's sentence for each moment of the Euler tour.
// Separated so the words can keep being sharpened (and tested) independently of the recording
// and playback machinery — the sentences ARE the narration the student hears (voice-match is
// 1:1 by contract), so this file is where teaching quality lives.

export function narrateRootCall(root) {
  return `We start by calling ${root}. Nothing is computed yet — its answer depends entirely on smaller subproblems we are about to open. Watch the tree grow downward: every node that appears is a fresh recursive call.`;
}

export function narrateDownCall(parent, child) {
  return `${parent} cannot finish on its own — it needs ${child} first, so it calls it and pauses. Look at the call stack: ${parent} is still there, waiting for this answer. We descend one level, and a new node appears on the tree.`;
}

export function narrateMemoHit(child, value) {
  return `${child} looks familiar — we already solved it earlier and stored its answer in the memo, so it hands back ${JSON.stringify(value)} instantly with no recomputation. Compare this single purple lookup with the whole subtree we grew the first time: that repeated work is exactly what memoization saves.`;
}

export function narrateBaseCase(child, value, parent) {
  return `${child} hits the base case — the input is now small enough to answer directly, so it returns ${JSON.stringify(value)} without making any further calls. This is the floor that stops the descent; from here the answers start flowing back up, and ${JSON.stringify(value)} travels along the edge to ${parent}.`;
}

export function narrateCombineReturn(child, value, parent, childReturns = null) {
  // TREE GRAMMAR (mined from Striver's tree lectures — max depth, diameter, max path sum):
  // the recurring beat is "the left gave you X, the right gave you Y, so this node returns
  // Z, and Z flows up". The children's answers named here are the RECORDED return values of
  // this call's real children — the template never claims a formula, only the recorded flow.
  if (Array.isArray(childReturns) && childReturns.length > 0) {
    const gave = childReturns.map((v) => JSON.stringify(v)).join(' and ');
    return `${child} has all the answers it was waiting for: its ${childReturns.length === 1 ? 'child gave it' : 'children gave it'} ${gave}, and combining ${childReturns.length === 1 ? 'that' : 'them'} it returns ${JSON.stringify(value)}. That value now flows up the edge to ${parent}, which is still waiting on the stack until every one of its children reports back.`;
  }
  return `${child} has finished: all of its own children have answered, and combining them gives ${JSON.stringify(value)}. That value now flows up the edge to ${parent}, which is still waiting on the stack until every one of its children reports back.`;
}

// BACKTRACKING GRAMMAR (mined from Striver's recursion/backtracking lectures — subsequences
// pick/not-pick, N-Queens): choose = "we pick X and move ahead"; undo = "since you added X
// you need to remove it — after removal it is back to the state it was, and only then do you
// try the next option". Templates are filled ONLY from recorded trace values.
export function narrateChooseCall(parent, child, varName, value) {
  return `${parent} makes a choice: it picks ${JSON.stringify(value)} and adds it to ${varName}, then recurses into ${child} to explore everything that choice allows. ${parent} pauses on the stack — and remember, a choice made before a recursive call must be undone when that call comes back.`;
}

export function narrateBacktrackUndo(child, varName, value, stateBefore, stateAfter) {
  const states = stateBefore !== undefined && stateAfter !== undefined
    ? ` ${varName} goes from ${JSON.stringify(stateBefore)} back to ${JSON.stringify(stateAfter)} — exactly the state it was in before the pick, and the recording shows both states.`
    : '';
  return `${child} has been fully explored, so we backtrack: we remove ${JSON.stringify(value)} from ${varName}, undoing the choice we made before that call.${states} Only now, with the state restored, are we free to try the next option.`;
}

export function narrateFinalReturn(root, result, usedMemo) {
  return `Every branch has reported back, so ${root} combines its children's answers and returns ${JSON.stringify(result)} — the final result. Read the finished tree bottom-up: each node's value was built from its children${usedMemo ? ', and every purple node marks an entire subtree of work the memo saved us from repeating' : ''}.`;
}
