// NARRATION STAGE of the trie tool. Sentences composed from REAL recorded paths, hitting the
// research-verified beats: the create-vs-reuse fork (the moment every tutor slows down on),
// the end-flag flip with the app-vs-apple trap, delete's unmark-then-prune, and the O(L)
// complexity story (cost = word length, independent of how many words are stored).

export function narrateStart({ entry }) {
  return `We run ${entry} and watch the trie build itself: one node per character, shared prefixes stored ONCE. Green nodes are where a word ENDS — keep your eye on that flag, it is the difference between a word and a mere prefix.`;
}

// The reuse beat: the child already existed — the whole point of a trie.
export function narrateWalk({ name, char, prefix }) {
  if (!char) {
    return `${name} returns to the root — the empty prefix. Every trie operation starts here and pays one step per character, never more; what is stored below does not slow the walk down.`;
  }
  return `'${char}' already has a child, so ${name} just steps down the existing edge — the path so far spells '${prefix}'. Nothing is created: shared prefixes live in the tree exactly once, and that reuse is the whole point of a trie.`;
}

// The branching moment: no child for this character — create it.
export function narrateCreate({ char, prefix }) {
  return `No child for '${char}' here — this is the branching moment: the word stops overlapping everything stored so far. A new node is created and hung on the '${char}' edge; the path down to it now spells '${prefix}'.`;
}

// The end-flag flip — and the classic trap, taught at the exact moment it exists.
export function narrateEndSet({ prefix }) {
  return `The whole word is consumed, so THIS node's end flag flips ON — it turns green. Without that flag the trie would only know '${prefix}' as a path toward longer words, never as a word itself. That is the classic trap: the path for 'app' exists inside 'apple', but only the flag says which of them was actually inserted.`;
}

export function narrateEndClear({ prefix }) {
  return `Deleting starts by UNMARKING: '${prefix}' has its end flag flipped off — the node fades from green. The path itself stays for now; whether any nodes can actually be removed depends on who else still uses them.`;
}

// Pruning: a node that serves no one anymore is unlinked (bottom-up).
export function narratePrune({ prefix, char }) {
  return `The node at '${prefix}' now serves no one — its flag is off and it has no children — so the '${char}' link is cut and the node fades away. Pruning stops the moment a node still serves someone: another child below it, or its own flag still on.`;
}

export function narrateDone({ result, words, truncated }) {
  if (truncated) {
    return `The recording stops HERE, on purpose: the run kept repeating the same pattern past the recording cap, so watching more of it teaches nothing new. The run itself continued to completion and returned ${JSON.stringify(result)} — recorded honestly, cut openly.`;
  }
  const stored = words.length
    ? ` The trie now stores: ${words.join(', ')} — read each word by walking edges from the root to a green node.`
    : ' The trie is now empty.';
  return `The run is complete and the call returns ${JSON.stringify(result)}.${stored} Notice what you never saw: a walk that got slower because more words were stored. Every operation cost O(L) — the length of its own word — and that is the trie's promise.`;
}
