// THE LENS-DETECTOR REGISTRY — one entry per visual family, one file per family under
// lenses/, one ordered list here (mirror of tracer-modes/index.js). Detectors read a universal
// recording AFTER the real run and return a lens plan with a confidence score, or null; the
// classification happens ONCE over the whole timeline, never per step, so the chosen lens can
// never flicker mid-animation. Order = specificity: when confidences tie, the earlier (more
// specific) family wins.

import { detectGridWalk, compileGridWalk } from './lenses/grid-walk.js';
import { detectRecursionTree, compileRecursionTree } from './lenses/recursion-tree.js';
import { detectPointerArray, compilePointerArray } from './lenses/pointer-array.js';
import { detectLinkedList, compileLinkedListLens } from './lenses/linked-list.js';
import { detectObjectStructure, compileObjectStructure } from './lenses/object-structure.js';
import { detectCollectionLens, compileCollectionOps } from './lenses/collection-ops.js';
import { detectDpTable, compileDpTableLens } from './lenses/dp-table.js';
import { detectGraphAdjacency, compileGraphAdjacency } from './lenses/graph-adjacency.js';

export const LENS_DETECTORS = Object.freeze([
  // dp-table above grid-walk: both fire on a mutating 2D list, but the DP detector demands
  // three fingerprints (scaffold/growing start, row-major sweep, no frontier queue) — when all
  // three say "fill", the dedicated DP animation beats the board view.
  // Structure lenses (grid, chain, tree/graph) outrank recursion-tree: a recursive flood fill,
  // reversal or traversal is BOTH families, but the structure is the lesson — the call tree is
  // merely how it happens (equal confidences — registry order breaks the tie).
  // collection-ops (0.8) sits below all of those: Rotten Oranges keeps its board and Subsets
  // keeps its tree even though both also carry a clean queue/stack; it wins only where the
  // collection IS the story (Valid Parentheses, frequency counters).
  { key: 'dp-table', detect: detectDpTable, compile: compileDpTableLens },
  { key: 'grid-walk', detect: detectGridWalk, compile: compileGridWalk },
  // graph-adjacency (0.88) between the boards and the object lenses: a walked adjacency dict
  // beats its own queue/recursion (Course Schedule shows the GRAPH, not just Kahn's queue).
  { key: 'graph-adjacency', detect: detectGraphAdjacency, compile: compileGraphAdjacency },
  { key: 'linked-list', detect: detectLinkedList, compile: compileLinkedListLens },
  { key: 'object-structure', detect: detectObjectStructure, compile: compileObjectStructure },
  { key: 'recursion-tree', detect: detectRecursionTree, compile: compileRecursionTree },
  { key: 'collection-ops', detect: detectCollectionLens, compile: compileCollectionOps },
  { key: 'pointer-array', detect: detectPointerArray, compile: compilePointerArray },
]);

// All lens plans this recording supports, best first. ctx carries { code } so detectors can use
// the source as a secondary signal (never the only one — behavior in the recording leads).
export function detectLenses(recording, ctx = {}) {
  return LENS_DETECTORS
    .map((d) => {
      const plan = d.detect(recording, ctx);
      return plan ? { ...plan, compile: d.compile } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);
}
