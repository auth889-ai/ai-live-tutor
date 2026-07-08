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

export function narrateCombineReturn(child, value, parent) {
  return `${child} has finished: all of its own children have answered, and combining them gives ${JSON.stringify(value)}. That value now flows up the edge to ${parent}, which is still waiting on the stack until every one of its children reports back.`;
}

export function narrateFinalReturn(root, result, usedMemo) {
  return `Every branch has reported back, so ${root} combines its children's answers and returns ${JSON.stringify(result)} — the final result. Read the finished tree bottom-up: each node's value was built from its children${usedMemo ? ', and every purple node marks an entire subtree of work the memo saved us from repeating' : ''}.`;
}
